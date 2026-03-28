import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter, createProvider } from "@dojops/api";
import {
  ChatSession,
  buildSessionContext,
  saveSession as saveChatSession,
  listSessions as listChatSessions,
  generateSessionId,
} from "@dojops/session";
import type { ChatSessionState, SessionMode, ChatProgressCallbacks } from "@dojops/session";
import { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import { extractFlagValue, hasFlag } from "../parser";
import { VALID_PROVIDERS, resolveToken, resolveOllamaHost, resolveOllamaTls } from "../config";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { expandFileReferences } from "../input-expander";
import {
  renderHeader,
  renderTurnStats,
  renderContextBar,
  renderPhaseIndicator,
  renderCompactionNotice,
  getTermWidth,
} from "../tui/status-bar";
import type { StatusBarState, TurnStats, ContextBarState } from "../tui/status-bar";
import { execFileSync } from "node:child_process";
import { highlightCodeBlocks } from "../tui/code-highlight";
import { renderMascotWithText } from "../mascot";
import type { VoiceConfig } from "../voice";

type DocAugmenter = { augmentPrompt(s: string, kw: string[], q: string): Promise<string> };

/** Detect the current git branch, or undefined if not a git repo. */
function detectGitBranch(rootDir: string): string | undefined {
  try {
    return (
      execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function loadDocAugmenter(): Promise<DocAugmenter | undefined> {
  if (process.env.DOJOPS_CONTEXT_ENABLED !== "true") return undefined;
  try {
    const { createDocAugmenter } = await import("@dojops/context");
    return createDocAugmenter({ apiKey: process.env.DOJOPS_CONTEXT7_API_KEY });
  } catch {
    return undefined;
  }
}

function resolveResumeSession(
  rootDir: string,
  sessionName: string | undefined,
): ChatSessionState | undefined {
  const sessions = listChatSessions(rootDir);
  if (sessionName) {
    const state = sessions.find((s) => s.name === sessionName || s.id === sessionName) ?? undefined;
    if (!state) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Session "${sessionName}" not found.`);
    }
    p.log.info(`Resuming session ${pc.cyan(state.name ?? state.id)}`);
    return state;
  }
  if (sessions.length > 0) {
    p.log.info(`Resuming session ${pc.cyan(sessions[0].id)}`);
    return sessions[0];
  }
  p.log.warn("No sessions found to resume.");
  return undefined;
}

function resolveNamedSession(
  rootDir: string,
  sessionName: string,
  deterministic: boolean,
): ChatSessionState {
  const sessions = listChatSessions(rootDir);
  const existing = sessions.find((s) => s.name === sessionName) ?? undefined;
  if (existing) {
    p.log.info(`Resuming session ${pc.cyan(sessionName)} (${existing.id})`);
    return existing;
  }
  return {
    id: generateSessionId(),
    name: sessionName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: deterministic ? "DETERMINISTIC" : "INTERACTIVE",
    messages: [],
    metadata: { totalTokensEstimate: 0, messageCount: 0 },
  };
}

function resolveSessionState(
  rootDir: string,
  resumeFlag: boolean,
  sessionName: string | undefined,
  deterministic: boolean,
): ChatSessionState | undefined {
  if (resumeFlag) return resolveResumeSession(rootDir, sessionName);
  if (sessionName) return resolveNamedSession(rootDir, sessionName, deterministic);
  return undefined;
}

function validateAgentFlag(session: ChatSession, agentFlag: string): void {
  try {
    session.pinAgent(agentFlag);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }
}

const formatError = toErrorMessage;

// ── Status bar state ────────────────────────────────────────────

function buildStatusBarState(
  session: ChatSession,
  ctx: CLIContext,
  streaming: boolean,
): StatusBarState {
  const state = session.getState();
  return {
    sessionId: state.id,
    sessionName: state.name,
    agent: state.pinnedAgent ?? "auto-route",
    model: ctx.globalOpts.model ?? process.env.DOJOPS_MODEL ?? "(default)",
    provider: ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER ?? "openai",
    tokenEstimate: state.metadata.totalTokensEstimate,
    messageCount: state.metadata.messageCount,
    mode: state.mode,
    streaming,
  };
}

// ── Single message mode ─────────────────────────────────────────

async function sendSingleMessage(
  session: ChatSession,
  messageFlag: string,
  isStructuredOutput: boolean,
  ctx: CLIContext,
): Promise<void> {
  const model = ctx.globalOpts.model ?? process.env.DOJOPS_MODEL ?? "(default)";
  const provider = ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";
  const s = p.spinner();
  const startTime = Date.now();
  let compactionInfo: { messagesSummarized: number; messagesRetained: number } | undefined;

  const progress: ChatProgressCallbacks = {
    onPhase: (phase, detail) => {
      if (isStructuredOutput) return;
      const line = renderPhaseIndicator({ phase, detail, provider, model });
      if (line) s.message(line);
    },
    onCompaction: (info) => {
      compactionInfo = info;
    },
  };

  if (!isStructuredOutput) s.start(renderPhaseIndicator({ phase: "routing" }));
  try {
    const result = await session.send(messageFlag, progress);
    const durationMs = Date.now() - startTime;
    if (!isStructuredOutput) {
      s.stop(pc.green("Done"));
      if (compactionInfo) {
        process.stdout.write(`${renderCompactionNotice(compactionInfo)}\n`);
      }
    }
    displaySingleResult(result, isStructuredOutput);
    if (!isStructuredOutput) {
      const turnStats: TurnStats = {
        agent: result.agent,
        durationMs,
        usage: result.usage,
        sessionTokens: result.sessionTokens,
        model,
      };
      process.stdout.write(`${renderTurnStats(turnStats)}\n`);
    }
  } catch (err) {
    if (!isStructuredOutput) s.stop("Error");
    p.log.error(formatError(err));
  }
}

function displaySingleResult(
  result: { agent: string; content: string },
  isStructuredOutput: boolean,
): void {
  if (isStructuredOutput) {
    console.log(JSON.stringify({ agent: result.agent, content: result.content }));
    return;
  }
  p.log.message(highlightCodeBlocks(result.content));
}

async function handleSingleMessage(
  session: ChatSession,
  messageFlag: string,
  rootDir: string,
  ctx: CLIContext,
): Promise<void> {
  const isStructuredOutput = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
  await sendSingleMessage(session, messageFlag, isStructuredOutput, ctx);
  saveChatSession(rootDir, session.getState());
  if (ctx.globalOpts.output !== "json") {
    p.log.info(pc.dim(`Session: ${session.id}`));
  }
}

// ── TUI Welcome ─────────────────────────────────────────────────

/** Display previous conversation messages when resuming a session. */
function displayResumedHistory(session: ChatSession): void {
  const msgs = session.messages;
  if (msgs.length === 0) return;

  const width = getTermWidth();
  const divider = pc.dim("─".repeat(Math.min(width, 80)));
  console.log(divider);
  console.log(pc.dim(`  Conversation history (${msgs.length} messages)`));
  console.log(divider);

  // Show last 10 messages for context — enough to pick up where you left off
  const recent = msgs.slice(-10);
  const skipped = msgs.length - recent.length;
  if (skipped > 0) {
    console.log(pc.dim(`  ... ${skipped} earlier message${skipped > 1 ? "s" : ""} omitted\n`));
  }

  for (const msg of recent) {
    const role = msg.role === "user" ? pc.cyan("You") : pc.green("Agent");
    const time = pc.dim(new Date(msg.timestamp).toLocaleTimeString());
    const content = msg.content.length > 500 ? msg.content.slice(0, 497) + "..." : msg.content;
    console.log(`  ${role} ${time}`);
    // Indent each line of content for visual grouping
    for (const line of highlightCodeBlocks(content).split("\n")) {
      console.log(`  ${pc.dim("│")} ${line}`);
    }
    console.log();
  }

  console.log(divider);
}

function showWelcome(session: ChatSession, ctx: CLIContext, contextInfo: unknown): void {
  const sessionState = session.getState();
  const msgCount = sessionState.messages.length;
  const hasProvider = session.hasProvider();
  const provider = hasProvider
    ? (ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER ?? "openai")
    : pc.yellow("(not configured)");
  const model = hasProvider
    ? (ctx.globalOpts.model ?? process.env.DOJOPS_MODEL ?? "(default)")
    : pc.dim("—");

  // Fresh session: show mascot alongside status info
  if (msgCount === 0) {
    const textLines = [
      pc.bold(pc.cyan("DojOps Interactive Chat")),
      "",
      `${pc.dim("Provider:")} ${pc.white(provider)}  ${pc.dim("Model:")} ${pc.white(model)}`,
      `${pc.dim("Session:")} ${pc.white(sessionState.id.slice(0, 8))}`,
      contextInfo ? `${pc.green("●")} ${pc.dim("Project context loaded")}` : "",
      hasProvider
        ? ""
        : pc.yellow("Run /config to set up a provider, /init to initialize your project."),
      "",
      pc.dim("Type a message to chat, or ") + pc.cyan("/help") + pc.dim(" for commands."),
    ].filter(Boolean);

    console.log();
    console.log(renderMascotWithText(textLines));
    console.log();
    return;
  }

  // Resumed session: standard header + history
  p.intro(pc.bold(pc.cyan("DojOps Interactive Chat")));

  const barState = buildStatusBarState(session, ctx, false);
  console.log(renderHeader(barState));

  const indicators: string[] = [];
  if (contextInfo) indicators.push(`${pc.green("●")} ${pc.dim("Project context loaded")}`);
  if (indicators.length > 0) p.log.message(indicators.join("  "));

  displayResumedHistory(session);

  p.log.message(
    pc.dim("Type a message to chat, or ") + pc.cyan("/help") + pc.dim(" for available commands."),
  );
}

// ── Slash command handlers ──────────────────────────────────────

function handleHistoryCommand(session: ChatSession): void {
  const msgs = session.messages;
  if (msgs.length === 0) {
    p.log.info("No messages in this session.");
    return;
  }
  for (const msg of msgs.slice(-20)) {
    const role = msg.role === "user" ? pc.cyan("You") : pc.green("Agent");
    const time = pc.dim(new Date(msg.timestamp).toLocaleTimeString());
    p.log.message(`${role} ${time}\n${highlightCodeBlocks(msg.content)}`);
  }
}

function handleAgentCommand(session: ChatSession, trimmed: string): void {
  const agentName = trimmed.slice(7).trim();
  if (agentName === "auto") {
    session.unpinAgent();
    p.log.info("Agent unpinned — auto-routing enabled.");
    return;
  }
  try {
    session.pinAgent(agentName);
    p.log.info(`Agent pinned to ${pc.cyan(agentName)}`);
  } catch (err) {
    p.log.error((err as Error).message);
  }
}

function handleStatusCommand(session: ChatSession, ctx: CLIContext): void {
  const barState = buildStatusBarState(session, ctx, false);
  console.log(renderHeader(barState));
}

async function handleModelCommand(ctx: CLIContext): Promise<void> {
  const provider = ctx.getProvider();
  if (!provider.listModels) {
    p.log.warn("Current provider does not support model listing.");
    return;
  }

  const s = p.spinner();
  s.start("Fetching available models...");

  try {
    const models = await provider.listModels();
    s.stop(`${models.length} models available`);

    if (models.length === 0) {
      p.log.info("No models returned by provider.");
      return;
    }

    const selected = await p.select({
      message: "Select a model:",
      options: models.slice(0, 20).map((m) => ({ value: m, label: m })),
    });

    if (p.isCancel(selected)) return;

    // Update model in context for subsequent commands
    ctx.globalOpts.model = selected as string;
    process.env.DOJOPS_MODEL = selected as string;
    p.log.success(`Model switched to ${pc.yellow(selected as string)}`);
  } catch (err) {
    s.stop("Error");
    p.log.error(formatError(err));
  }
}

async function handleProviderCommand(
  trimmed: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
  docAugmenter: DocAugmenter | undefined,
): Promise<void> {
  const providerArg = trimmed.slice(10).trim(); // "/provider ".length === 10

  if (!providerArg) {
    // Show interactive picker
    const selected = await p.select({
      message: "Select a provider:",
      options: VALID_PROVIDERS.map((v) => ({ value: v, label: v })),
    });
    if (p.isCancel(selected)) return;
    return switchProvider(selected as string, session, rootDir, ctx, docAugmenter);
  }

  // Direct name
  if (!VALID_PROVIDERS.includes(providerArg as (typeof VALID_PROVIDERS)[number])) {
    p.log.error(`Unknown provider "${providerArg}". Available: ${VALID_PROVIDERS.join(", ")}`);
    return;
  }
  return switchProvider(providerArg, session, rootDir, ctx, docAugmenter);
}

function switchProvider(
  providerName: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
  docAugmenter: DocAugmenter | undefined,
): void {
  try {
    const apiKey = resolveToken(providerName, ctx.config);
    const ollamaHost =
      providerName === "ollama" ? resolveOllamaHost(undefined, ctx.config) : undefined;
    const ollamaTls =
      providerName === "ollama" ? resolveOllamaTls(undefined, ctx.config) : undefined;

    const newProvider = createProvider({
      provider: providerName,
      model: ctx.globalOpts.model || undefined,
      apiKey,
      ollamaHost,
      ollamaTlsRejectUnauthorized: ollamaTls === false ? false : undefined,
    });

    const { router } = createRouter(newProvider, rootDir, docAugmenter);

    session.setProvider(newProvider);
    session.setRouter(router);

    // Update context so status bar and subsequent commands reflect the change
    ctx.globalOpts.provider = providerName;
    process.env.DOJOPS_PROVIDER = providerName;

    // Reset model — new provider may not support the old model
    ctx.globalOpts.model = undefined;
    delete process.env.DOJOPS_MODEL;

    const msgCount = session.messages.length;
    p.log.success(
      `Switched to ${pc.bold(providerName)}` +
        (msgCount > 0 ? pc.dim(` — ${msgCount} messages preserved`) : ""),
    );
  } catch (err) {
    p.log.error(`Failed to switch provider: ${formatError(err)}`);
  }
}

async function handleVoiceCommand(
  session: ChatSession,
  ctx: CLIContext,
  voiceConfig: VoiceConfig | undefined,
): Promise<void> {
  if (!voiceConfig) {
    try {
      const { resolveVoiceConfig } = await import("../voice");
      voiceConfig = resolveVoiceConfig();
    } catch (err) {
      p.log.error((err as Error).message);
      return;
    }
  }

  p.log.info(`${pc.cyan("Recording...")} Speak now (press Enter to stop, max 30s)`);

  try {
    const { voiceInput } = await import("../voice");
    const text = await voiceInput(voiceConfig);

    if (!text) {
      p.log.warn("No speech detected.");
      return;
    }

    p.log.info(`${pc.dim("Transcribed:")} ${text}`);

    // Send the transcribed text as a message
    await handleSendMessage(session, text, ctx);
  } catch (err) {
    p.log.error(`Voice input failed: ${formatError(err)}`);
  }
}

function handleSessionsCommand(rootDir: string): void {
  const sessions = listChatSessions(rootDir);
  if (sessions.length === 0) {
    p.log.info("No saved sessions.");
    return;
  }

  const lines = sessions.slice(0, 15).map((s, i) => {
    const name = s.name ? pc.cyan(s.name) : pc.dim(s.id.slice(0, 12));
    const msgs = `${s.metadata.messageCount} msgs`;
    const time = pc.dim(new Date(s.updatedAt).toLocaleDateString());
    const agent = s.metadata.lastAgentUsed ? pc.magenta(s.metadata.lastAgentUsed) : "";
    const marker = i === 0 ? pc.green(" (latest)") : "";
    return `  ${name}  ${msgs}  ${agent}  ${time}${marker}`;
  });

  p.log.info(`Sessions (${sessions.length}):\n${lines.join("\n")}`);
  p.log.info(pc.dim("Resume with: dojops chat --resume --session <name|id>"));
}

function logCommandError(err: unknown): void {
  p.log.error(formatError(err));
}

async function handlePlanCommand(
  trimmed: string,
  rootDir: string,
  session: ChatSession,
  ctx: CLIContext,
): Promise<void> {
  const goal = trimmed.slice(6).trim();
  if (!goal) {
    p.log.warn("Usage: /plan <goal>");
    return;
  }
  saveChatSession(rootDir, session.getState());
  try {
    const { planCommand } = await import("./plan");
    await planCommand([goal], ctx);
  } catch (err) {
    logCommandError(err);
  }
}

async function handleApplyCommand(
  trimmed: string,
  rootDir: string,
  session: ChatSession,
  ctx: CLIContext,
): Promise<void> {
  const planId = trimmed.slice(7).trim() || undefined;
  saveChatSession(rootDir, session.getState());
  try {
    const { applyCommand } = await import("./apply");
    const applyArgs: string[] = [];
    if (planId) applyArgs.push(planId);
    await applyCommand(applyArgs, ctx);
  } catch (err) {
    logCommandError(err);
  }
}

async function handleScanCommand(
  trimmed: string,
  rootDir: string,
  session: ChatSession,
  ctx: CLIContext,
): Promise<void> {
  const scanArgs = trimmed.slice(6).trim().split(/\s+/).filter(Boolean);
  saveChatSession(rootDir, session.getState());
  try {
    const { scanCommand } = await import("./scan");
    await scanCommand(scanArgs, ctx);
  } catch (err) {
    logCommandError(err);
  }
}

async function handleAutoCommand(
  trimmed: string,
  rootDir: string,
  session: ChatSession,
  ctx: CLIContext,
): Promise<void> {
  const autoPrompt = trimmed.slice(6).trim();
  if (!autoPrompt) {
    p.log.warn("Usage: /auto <task description>");
    return;
  }
  saveChatSession(rootDir, session.getState());
  try {
    const { autoCommand } = await import("./auto");
    await autoCommand([autoPrompt], ctx);
  } catch (err) {
    logCommandError(err);
  }
}

// ── Phase line helpers ───────────────────────────────────────────

function writePhaseLine(line: string): void {
  if (process.stdout.isTTY) process.stdout.write(`\r\x1b[K${line}`);
}

function clearPhaseLine(): void {
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
}

// ── Streaming message handler ───────────────────────────────────

async function handleSendMessage(
  session: ChatSession,
  trimmed: string,
  ctx: CLIContext,
): Promise<void> {
  const model = ctx.globalOpts.model ?? process.env.DOJOPS_MODEL ?? "(default)";
  const provider = ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";

  try {
    const startTime = Date.now();
    let firstChunk = true;

    // Show initial routing phase
    writePhaseLine(renderPhaseIndicator({ phase: "routing" }));

    const progress: ChatProgressCallbacks = {
      onPhase: (phase, detail) => {
        if (phase === "done") return;
        writePhaseLine(renderPhaseIndicator({ phase, detail, provider, model }));
      },
      onCompaction: (info) => {
        // Print compaction notice as a permanent line (not overwritten)
        clearPhaseLine();
        process.stdout.write(`${renderCompactionNotice(info)}\n`);
      },
    };

    const result = await session.sendStream(
      trimmed,
      (chunk: string) => {
        if (firstChunk) {
          clearPhaseLine();
          process.stdout.write("\n");
          firstChunk = false;
        }
        process.stdout.write(chunk);
      },
      progress,
    );

    // If no chunks came through (empty response), clear phase line
    if (firstChunk) {
      clearPhaseLine();
      process.stdout.write(`${pc.green("●")} ${pc.magenta(result.agent)} ${pc.dim("responded")}\n`);
    } else {
      process.stdout.write("\n");
    }

    const durationMs = Date.now() - startTime;

    // Show per-turn stats
    const turnStats: TurnStats = {
      agent: result.agent,
      durationMs,
      usage: result.usage,
      sessionTokens: result.sessionTokens,
      model,
    };
    process.stdout.write(`\n${renderTurnStats(turnStats)}\n`);

    // Context warning for large sessions
    if (result.sessionTokens > 100_000) {
      p.log.warn(
        pc.yellow(
          `Context: ~${Math.round(result.sessionTokens / 1000)}K tokens. Consider /clear or start a new session.`,
        ),
      );
    }
  } catch (err) {
    clearPhaseLine();
    p.log.error(formatError(err));
  }
}

// ── Help ────────────────────────────────────────────────────────

const HELP_ENTRIES: Array<{ cmd: string; args?: string; desc: string }> = [
  { cmd: "/help", desc: "Show this help message" },
  { cmd: "/exit", desc: "Save session and exit chat" },
  { cmd: "/agent", args: "<name>", desc: "Pin routing to a specific agent (use 'auto' to unpin)" },
  { cmd: "/model", desc: "Switch LLM model (interactive picker)" },
  { cmd: "/provider", args: "[name]", desc: "Switch LLM provider mid-session (preserves history)" },
  { cmd: "/compress", desc: "Summarize conversation to free context window" },
  { cmd: "/sessions", desc: "List saved chat sessions" },
  { cmd: "/status", desc: "Show current session status bar" },
  { cmd: "/history", desc: "Show recent messages in this session" },
  { cmd: "/clear", desc: "Clear all messages (keeps session)" },
  { cmd: "/save", desc: "Save the current session to disk" },
  { cmd: "/plan", args: "<goal>", desc: "Decompose a goal into a task plan" },
  { cmd: "/apply", args: "[plan-id]", desc: "Execute a saved plan" },
  { cmd: "/scan", args: "[type]", desc: "Run security/dependency scanners" },
  { cmd: "/auto", args: "<prompt>", desc: "Run autonomous agent (iterative tool-use)" },
  { cmd: "/checkpoint", args: "[name]", desc: "Create a git-based checkpoint of current state" },
  { cmd: "/restore", args: "<id|name>", desc: "Restore files from a checkpoint" },
  { cmd: "/rewind", args: "[n] [--code]", desc: "Undo last n turns (--code also restores files)" },
  { cmd: "/voice", desc: "Push-to-talk voice input (requires whisper.cpp + sox)" },
  { cmd: "/config", desc: "Configure LLM provider and API keys" },
  { cmd: "/init", desc: "Initialize .dojops/ project in current directory" },
  { cmd: "/verify-connexion", desc: "Test connection to the configured LLM provider" },
  { cmd: "!", args: "<command>", desc: "Run a shell command (e.g. !git status)" },
];

function handleHelpCommand(): void {
  const width = getTermWidth();
  const divider = pc.dim("─".repeat(Math.min(width, 80)));

  console.log(`\n${divider}`);
  console.log(`${pc.bold(pc.cyan("  DojOps Chat Commands"))}\n`);

  for (const entry of HELP_ENTRIES) {
    const cmdStr = pc.cyan(entry.cmd) + (entry.args ? ` ${pc.dim(entry.args)}` : "");
    const padding = " ".repeat(Math.max(1, 28 - entry.cmd.length - (entry.args?.length ?? 0)));
    console.log(`  ${cmdStr}${padding}${pc.dim(entry.desc)}`);
  }

  console.log(`\n${pc.dim("  Anything else is sent as a message to the AI agent.")}`);
  console.log(`\n  ${pc.dim("Use @path/to/file to inject file contents inline.")}`);
  console.log(`  ${pc.dim("Use !command to run shell commands inline.")}`);
  console.log(divider);
}

// ── Setup commands (no provider needed) ─────────────────────────

async function handleChatConfigCommand(
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
  docAugmenter: DocAugmenter | undefined,
): Promise<void> {
  try {
    const { configCommand } = await import("./config-cmd");
    await configCommand([], ctx);

    // After config, try to activate the provider if it wasn't available before
    if (!session.hasProvider()) {
      try {
        const provider = ctx.getProvider();
        const skipCustomConfigs = await resolveTrustCheck(rootDir, ctx.globalOpts.nonInteractive);
        const { router } = createRouter(provider, rootDir, docAugmenter, skipCustomConfigs);
        session.setProvider(provider);
        session.setRouter(router);
        p.log.success("Provider activated — you can now send messages.");
      } catch {
        p.log.info(
          pc.dim("Provider not yet available. Use /provider to switch, or re-run /config."),
        );
      }
    }
  } catch (err) {
    p.log.error(`Config failed: ${formatError(err)}`);
  }
}

async function handleChatInitCommand(rootDir: string, ctx: CLIContext): Promise<void> {
  try {
    const { initCommand } = await import("./init");
    await initCommand([], ctx);
  } catch (err) {
    p.log.error(`Init failed: ${formatError(err)}`);
  }
}

async function handleVerifyConnexionCommand(ctx: CLIContext): Promise<void> {
  const providerName = ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER;
  if (!providerName) {
    p.log.warn("No provider configured. Run /config first.");
    return;
  }

  const s = p.spinner();
  s.start(`Testing connection to ${providerName}...`);

  try {
    const provider = ctx.getProvider();
    const response = await provider.generate({
      prompt: "Reply with only the word: OK",
      messages: [{ role: "user", content: "Reply with only the word: OK" }],
    });
    if (response.content) {
      s.stop(pc.green(`Connection to ${pc.bold(providerName)} successful`));
      p.log.info(pc.dim(`Response: "${response.content.slice(0, 50).trim()}"`));
    } else {
      s.stop(pc.yellow("Connected but received empty response."));
    }
  } catch (err) {
    s.stop(pc.red(`Connection to ${providerName} failed`));
    p.log.error(formatError(err));
    p.log.info(pc.dim("Check your API key with /config, or try /provider to switch providers."));
  }
}

// ── Slash command router ────────────────────────────────────────

async function handleCompressCommand(session: ChatSession): Promise<void> {
  const s = p.spinner();
  s.start("Compressing conversation...");
  try {
    const info = await session.compress();
    if (info) {
      s.stop("Conversation compressed.");
      p.log.success(
        `Summarized ${info.messagesSummarized} messages, kept ${info.messagesRetained} recent.`,
      );
    } else {
      s.stop("Nothing to compress (fewer than 4 messages).");
    }
  } catch (err) {
    s.stop("Compression failed.");
    p.log.error(formatError(err));
  }
}

async function handleCheckpointCommand(trimmed: string, rootDir: string): Promise<void> {
  const name = trimmed.slice(12).trim() || undefined;
  try {
    const { createCheckpoint } = await import("@dojops/executor");
    const entry = createCheckpoint(rootDir, name);
    if (entry) {
      const nameLabel = name ? ` (${pc.bold(name)})` : "";
      p.log.success(`Checkpoint ${pc.cyan(entry.id)}${nameLabel} created`);
      if (entry.filesTracked.length > 0) {
        p.log.info(pc.dim(`Files: ${entry.filesTracked.join(", ")}`));
      }
    } else {
      p.log.info("No changes to checkpoint.");
    }
  } catch (err) {
    p.log.error(`Checkpoint failed: ${formatError(err)}`);
  }
}

async function handleRestoreCommand(trimmed: string, rootDir: string): Promise<void> {
  const idOrName = trimmed.slice(9).trim();
  if (!idOrName) {
    p.log.warn("Usage: /restore <id|name>");
    return;
  }
  try {
    const { restoreCheckpoint } = await import("@dojops/executor");
    const entry = restoreCheckpoint(rootDir, idOrName);
    if (entry) {
      const restoreLabel = entry.name ? ` (${entry.name})` : "";
      p.log.success(`Restored checkpoint ${pc.cyan(entry.id)}${restoreLabel}`);
    } else {
      p.log.warn(`Checkpoint "${idOrName}" not found.`);
    }
  } catch (err) {
    p.log.error(`Restore failed: ${formatError(err)}`);
  }
}

async function handleRewindCommand(
  trimmed: string,
  session: ChatSession,
  rootDir: string,
): Promise<void> {
  const parts = trimmed.slice(7).trim().split(/\s+/);
  const withCode = parts.includes("--code");
  const nStr = parts.find((pt) => /^\d+$/.test(pt));
  const n = nStr ? Number.parseInt(nStr, 10) : 1;
  const result = session.rewind(n);
  if (result.removedTurns === 0) {
    p.log.info("Nothing to rewind.");
  } else {
    p.log.success(
      `Rewound ${result.removedTurns} turn${result.removedTurns > 1 ? "s" : ""} (${result.removedMessages.length} messages removed)`,
    );
  }
  if (!withCode) return;
  try {
    const { listCheckpoints, restoreCheckpoint } = await import("@dojops/executor");
    const checkpoints = listCheckpoints(rootDir);
    if (checkpoints.length > 0) {
      const latest = checkpoints[0];
      restoreCheckpoint(rootDir, latest.id);
      p.log.success(`Files restored from checkpoint ${pc.cyan(latest.id)}`);
    } else {
      p.log.info(pc.dim("No checkpoints available for file restoration."));
    }
  } catch (err) {
    p.log.warn(`File restore failed: ${formatError(err)}`);
  }
}

function handleSimpleSlashCommand(
  trimmed: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
): boolean {
  if (trimmed === "/help") {
    handleHelpCommand();
    return true;
  }
  if (trimmed === "/history") {
    handleHistoryCommand(session);
    return true;
  }
  if (trimmed === "/clear") {
    session.clearMessages();
    p.log.success("Session messages cleared.");
    return true;
  }
  if (trimmed === "/save") {
    saveChatSession(rootDir, session.getState());
    p.log.success(`Session saved: ${session.id}`);
    return true;
  }
  if (trimmed === "/status") {
    handleStatusCommand(session, ctx);
    return true;
  }
  if (trimmed === "/sessions") {
    handleSessionsCommand(rootDir);
    return true;
  }
  if (trimmed.startsWith("/agent ")) {
    handleAgentCommand(session, trimmed);
    return true;
  }
  return false;
}

async function handleAsyncSlashCommand(
  trimmed: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
  docAugmenter?: DocAugmenter,
  voiceConfig?: VoiceConfig,
): Promise<boolean> {
  // Setup commands — no provider needed
  if (trimmed === "/config") {
    await handleChatConfigCommand(session, rootDir, ctx, docAugmenter);
    return true;
  }
  if (trimmed === "/init") {
    await handleChatInitCommand(rootDir, ctx);
    return true;
  }
  if (trimmed === "/verify-connexion") {
    await handleVerifyConnexionCommand(ctx);
    return true;
  }
  // Provider-dependent commands
  if (trimmed === "/model") {
    await handleModelCommand(ctx);
    return true;
  }
  if (trimmed === "/provider" || trimmed.startsWith("/provider ")) {
    await handleProviderCommand(trimmed, session, rootDir, ctx, docAugmenter);
    return true;
  }
  if (trimmed === "/compress") {
    await handleCompressCommand(session);
    return true;
  }
  if (trimmed.startsWith("/plan ")) {
    await handlePlanCommand(trimmed, rootDir, session, ctx);
    return true;
  }
  if (trimmed === "/apply" || trimmed.startsWith("/apply ")) {
    await handleApplyCommand(trimmed, rootDir, session, ctx);
    return true;
  }
  if (trimmed === "/scan" || trimmed.startsWith("/scan ")) {
    await handleScanCommand(trimmed, rootDir, session, ctx);
    return true;
  }
  if (trimmed.startsWith("/auto ")) {
    await handleAutoCommand(trimmed, rootDir, session, ctx);
    return true;
  }
  if (trimmed === "/checkpoint" || trimmed.startsWith("/checkpoint ")) {
    await handleCheckpointCommand(trimmed, rootDir);
    return true;
  }
  if (trimmed.startsWith("/restore ")) {
    await handleRestoreCommand(trimmed, rootDir);
    return true;
  }
  if (trimmed === "/rewind" || trimmed.startsWith("/rewind ")) {
    await handleRewindCommand(trimmed, session, rootDir);
    return true;
  }
  if (trimmed === "/voice") {
    await handleVoiceCommand(session, ctx, voiceConfig);
    return true;
  }
  return false;
}

async function handleSlashCommand(
  trimmed: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
  docAugmenter?: DocAugmenter,
  voiceConfig?: VoiceConfig,
): Promise<boolean> {
  if (handleSimpleSlashCommand(trimmed, session, rootDir, ctx)) return true;
  return handleAsyncSlashCommand(trimmed, session, rootDir, ctx, docAugmenter, voiceConfig);
}

// ── Interactive loop ────────────────────────────────────────────

function showGoodbye(session: ChatSession): void {
  const state = session.getState();
  const msgCount = state.metadata.messageCount;
  const tokens = state.metadata.totalTokensEstimate;
  const width = getTermWidth();
  const divider = pc.dim("─".repeat(Math.min(width, 80)));

  console.log(`\n${divider}`);
  console.log(`${pc.cyan("Session saved")} ${pc.dim(state.name ?? state.id)}`);

  const stats: string[] = [];
  if (msgCount > 0) stats.push(`${msgCount} messages`);
  if (tokens > 0) stats.push(`~${Math.round(tokens / 1000)}K tokens`);
  if (state.metadata.lastAgentUsed) stats.push(`last agent: ${state.metadata.lastAgentUsed}`);
  if (stats.length > 0) console.log(pc.dim(stats.join(" · ")));

  console.log(pc.dim("Resume with: dojops chat --resume"));
  console.log(divider);
  p.outro(pc.dim("Goodbye!"));
}

function isExitInput(input: unknown): boolean {
  return p.isCancel(input) || input === "/exit";
}

function handleShellPassthrough(command: string, cwd: string): void {
  try {
    const output = execFileSync("/bin/sh", ["-c", command], {
      cwd,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    process.stdout.write(`\n${pc.dim("$")} ${pc.cyan(command)}\n`);
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    process.stdout.write(`\n${pc.dim("$")} ${pc.cyan(command)}\n`);
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stdout.write(pc.red(e.stderr));
    p.log.warn(`Exit code: ${e.status ?? "unknown"}`);
  }
}

async function processLoopInput(
  input: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
  docAugmenter?: DocAugmenter,
  voiceConfig?: VoiceConfig,
): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("!") && trimmed.length > 1) {
    const command = trimmed.slice(1).trim();
    if (command) handleShellPassthrough(command, ctx.cwd);
    return;
  }

  const handled = await handleSlashCommand(
    trimmed,
    session,
    rootDir,
    ctx,
    docAugmenter,
    voiceConfig,
  );
  if (handled) return;

  if (trimmed.startsWith("/")) {
    const cmd = trimmed.split(/\s/)[0];
    p.log.warn(`Unknown command ${pc.cyan(cmd)}. Type ${pc.cyan("/help")} for available commands.`);
    return;
  }

  if (!session.hasProvider()) {
    p.log.warn(`No LLM provider configured. Run ${pc.cyan("/config")} to set up a provider first.`);
    return;
  }

  const expanded = expandFileReferences(trimmed, ctx.cwd);
  await handleSendMessage(session, expanded, ctx);
}

async function runInteractiveLoop(
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
  docAugmenter?: DocAugmenter,
  voiceConfig?: VoiceConfig,
): Promise<void> {
  const saveAndExit = () => {
    saveChatSession(rootDir, session.getState());
    showGoodbye(session);
    process.exit(ExitCode.SUCCESS);
  };
  process.on("SIGINT", saveAndExit);

  // Detect git branch once at session start
  const gitBranch = detectGitBranch(rootDir);

  while (true) {
    // Render context bar before each prompt (branch + context %)
    const ctxBar: ContextBarState = {
      branch: gitBranch,
      tokenEstimate: session.getState().metadata.totalTokensEstimate,
    };
    console.log(renderContextBar(ctxBar));

    const input = await p.text({
      message: pc.cyan("You"),
      placeholder: "Type a message or /command...",
    });

    if (isExitInput(input)) {
      saveChatSession(rootDir, session.getState());
      showGoodbye(session);
      break;
    }

    await processLoopInput(input as string, session, rootDir, ctx, docAugmenter, voiceConfig);
  }

  process.off("SIGINT", saveAndExit);
  saveChatSession(rootDir, session.getState());
  // Force exit — Ollama's axios keep-alive connections prevent natural shutdown
  process.exit(ExitCode.SUCCESS);
}

// ── Export / format helpers ──────────────────────────────────────

/** @internal exported for testing */
export function getRoleLabel(role: string): string {
  if (role === "user") return "**You**";
  if (role === "assistant") return "**Agent**";
  return "**System**";
}

/** @internal exported for testing */
export function formatSessionAsMarkdown(session: ChatSessionState): string {
  const lines: string[] = [
    `# Chat Session: ${session.name ?? session.id}`,
    "",
    `- **ID:** ${session.id}`,
    `- **Created:** ${session.createdAt}`,
    `- **Updated:** ${session.updatedAt}`,
    `- **Mode:** ${session.mode}`,
  ];
  if (session.pinnedAgent) lines.push(`- **Agent:** ${session.pinnedAgent}`);
  lines.push(`- **Messages:** ${session.metadata.messageCount}`, "", "---", "");

  for (const msg of session.messages) {
    const role = getRoleLabel(msg.role);
    const time = new Date(msg.timestamp).toLocaleString();
    lines.push(`### ${role} — ${time}`, "", msg.content, "");
  }
  return lines.join("\n");
}

// ── Chat export ─────────────────────────────────────────────────

async function chatExportCommand(args: string[], ctx: CLIContext): Promise<void> {
  const rootDir = findProjectRoot(ctx.cwd);
  if (!rootDir) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No .dojops/ project found. Run `dojops init` first.",
    );
  }

  const sessions = listChatSessions(rootDir);
  if (sessions.length === 0) {
    p.log.info("No chat sessions found.");
    return;
  }

  const format = extractFlagValue(args, "--format") ?? "markdown";
  const outputPath = extractFlagValue(args, "--output");
  // Session ID is the first positional arg after "export" (skip flags)
  const sessionId = args
    .slice(1)
    .find((a) => !a.startsWith("-") && a !== format && a !== outputPath);

  const toExport = sessionId
    ? sessions.filter((s) => s.id === sessionId || s.name === sessionId)
    : sessions;

  if (toExport.length === 0) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Session "${sessionId}" not found.`);
  }

  let content: string;
  if (format === "json") {
    content = JSON.stringify(toExport.length === 1 ? toExport[0] : toExport, null, 2);
  } else {
    content = toExport.map(formatSessionAsMarkdown).join("\n\n---\n\n");
  }

  if (outputPath) {
    fs.writeFileSync(outputPath, content, "utf-8");
    p.log.success(`Exported ${toExport.length} session(s) to ${pc.underline(outputPath)}`);
  } else {
    process.stdout.write(content);
    if (!content.endsWith("\n")) process.stdout.write("\n");
  }
}

// ── Trust check helper ───────────────────────────────────────────

interface TrustConfigs {
  agents: string[];
  mcpServers: string[];
  skills: string[];
  envPassthrough: string[];
}

function logUntrustedConfigs(cfgs: TrustConfigs): void {
  p.log.warn("This workspace has custom configs that haven't been trusted:");
  if (cfgs.agents.length > 0) p.log.info(`  Agents: ${cfgs.agents.join(", ")}`);
  if (cfgs.mcpServers.length > 0) p.log.info(`  MCP servers: ${cfgs.mcpServers.join(", ")}`);
  if (cfgs.skills.length > 0) p.log.info(`  Skills: ${cfgs.skills.join(", ")}`);
  if (cfgs.envPassthrough.length > 0)
    p.log.info(`  MCP servers request access to env vars: ${cfgs.envPassthrough.join(", ")}`);
}

async function resolveTrustCheck(rootDir: string, nonInteractive: boolean): Promise<boolean> {
  const { isFolderTrusted, trustFolder } = await import("../trust");
  const trustCheck = isFolderTrusted(rootDir);
  if (trustCheck.trusted) return false;

  const cfgs = trustCheck.configs;
  const hasConfigs = cfgs.agents.length > 0 || cfgs.mcpServers.length > 0 || cfgs.skills.length > 0;
  if (!hasConfigs || nonInteractive) return false;

  logUntrustedConfigs(cfgs);
  const trustDecision = await p.confirm({ message: "Trust this workspace?" });
  if (p.isCancel(trustDecision) || !trustDecision) {
    p.log.info(pc.dim("Skipping custom agents/MCP/skills for this session."));
    return true;
  }
  trustFolder(rootDir);
  p.log.success("Workspace trusted.");
  return false;
}

// ── Main entry point ────────────────────────────────────────────

export async function chatCommand(args: string[], ctx: CLIContext): Promise<void> {
  if (args[0] === "export") {
    return chatExportCommand(args, ctx);
  }

  const sessionName = extractFlagValue(args, "--session");
  const resumeFlag = hasFlag(args, "--resume");
  const deterministic = hasFlag(args, "--deterministic");
  const voiceFlag = hasFlag(args, "--voice");
  const agentFlag = ctx.globalOpts.agent ?? extractFlagValue(args, "--agent");
  const messageFlag = extractFlagValue(args, "--message") ?? extractFlagValue(args, "-m");

  // Allow chat to start without a .dojops/ project — needed for /config and /init
  const rootDir = findProjectRoot(ctx.cwd) ?? ctx.cwd;

  let voiceConfig: VoiceConfig | undefined;
  if (voiceFlag) {
    const { resolveVoiceConfig } = await import("../voice");
    voiceConfig = resolveVoiceConfig();
    p.log.info(`${pc.cyan("Voice mode enabled")} — use /voice for push-to-talk`);
  }

  if (!ctx.globalOpts.model) {
    const { loadConfig } = await import("../config");
    const config = loadConfig();
    if (config.modelRouting?.enabled && ctx.globalOpts.verbose) {
      p.log.info(pc.dim("Model routing enabled — model may vary per message complexity."));
    }
  }

  // Defer provider creation — chat must work without a configured provider
  // so users can run /config, /init, /verify-connexion right after installation.
  let provider: ReturnType<typeof ctx.getProvider> | undefined;
  let router: ReturnType<typeof createRouter>["router"] | undefined;
  const docAugmenter = await loadDocAugmenter();

  try {
    provider = ctx.getProvider();
    const skipCustomConfigs = await resolveTrustCheck(rootDir, ctx.globalOpts.nonInteractive);
    const routerResult = createRouter(provider, rootDir, docAugmenter, skipCustomConfigs);
    router = routerResult.router;
  } catch {
    // Provider not configured — chat will work for local commands
  }

  const state = resolveSessionState(rootDir, resumeFlag, sessionName, deterministic);
  const mode: SessionMode = deterministic ? "DETERMINISTIC" : "INTERACTIVE";

  const contextInfo = buildSessionContext(rootDir);

  const session = new ChatSession({ provider, router, state, mode, projectContext: contextInfo });

  if (agentFlag) validateAgentFlag(session, agentFlag);

  if (messageFlag) {
    if (!session.hasProvider()) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        "No LLM provider configured. Run `dojops config` to set up a provider first.",
      );
    }
    await handleSingleMessage(session, messageFlag, rootDir, ctx);
    return;
  }

  showWelcome(session, ctx, contextInfo);
  await runInteractiveLoop(session, rootDir, ctx, docAugmenter, voiceConfig);
}
