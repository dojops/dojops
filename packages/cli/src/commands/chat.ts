import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@dojops/api";
import {
  ChatSession,
  buildSessionContext,
  saveSession as saveChatSession,
  listSessions as listChatSessions,
  generateSessionId,
} from "@dojops/session";
import type { ChatSessionState, SessionMode } from "@dojops/session";
import { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import { extractFlagValue, hasFlag } from "../parser";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";

type DocAugmenter = { augmentPrompt(s: string, kw: string[], q: string): Promise<string> };

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

async function sendSingleMessage(
  session: ChatSession,
  messageFlag: string,
  isStructuredOutput: boolean,
): Promise<void> {
  const s = p.spinner();
  if (!isStructuredOutput) s.start("Thinking...");
  try {
    const result = await session.send(messageFlag);
    if (!isStructuredOutput) {
      const agentLabel = `${pc.green("Agent")} ${pc.dim("(" + result.agent + ")")}`;
      s.stop(agentLabel);
    }
    displaySingleResult(result, isStructuredOutput);
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
  p.log.message(result.content);
}

async function handleSingleMessage(
  session: ChatSession,
  messageFlag: string,
  rootDir: string,
  ctx: CLIContext,
): Promise<void> {
  const isStructuredOutput = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
  await sendSingleMessage(session, messageFlag, isStructuredOutput);
  saveChatSession(rootDir, session.getState());
  if (ctx.globalOpts.output !== "json") {
    p.log.info(pc.dim(`Session: ${session.id}`));
  }
}

function showWelcome(session: ChatSession, contextInfo: unknown): void {
  const sessionState = session.getState();
  const modeLabel =
    sessionState.mode === "DETERMINISTIC" ? pc.yellow("DETERMINISTIC") : pc.green("INTERACTIVE");
  const pinnedLabel = sessionState.pinnedAgent
    ? pc.cyan(sessionState.pinnedAgent)
    : pc.dim("auto-route");
  const msgCount = sessionState.messages.length;

  p.intro(pc.bold(pc.cyan("DojOps Interactive Chat")));
  p.log.info(
    [
      `Session: ${pc.cyan(session.id)}`,
      `Mode:    ${modeLabel}`,
      `Agent:   ${pinnedLabel}`,
      msgCount > 0 ? `History: ${msgCount} messages` : "",
      contextInfo ? `Context: ${pc.dim("project context loaded")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  p.log.info(
    pc.dim("Commands: /exit, /agent <name>, /history, /clear, /save, /plan <goal>, /apply, /scan"),
  );
}

function handleHistoryCommand(session: ChatSession): void {
  const msgs = session.messages;
  if (msgs.length === 0) {
    p.log.info("No messages in this session.");
    return;
  }
  for (const msg of msgs.slice(-20)) {
    const role = msg.role === "user" ? pc.cyan("You") : pc.green("Agent");
    const time = pc.dim(new Date(msg.timestamp).toLocaleTimeString());
    p.log.message(`${role} ${time}\n${msg.content}`);
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

async function handleSendMessage(session: ChatSession, trimmed: string): Promise<void> {
  const s = p.spinner();
  s.start("Thinking...");
  try {
    const result = await session.send(trimmed);
    const agentLabel = `${pc.green("Agent")} ${pc.dim("(" + result.agent + ")")}`;
    s.stop(agentLabel);
    p.log.message(result.content);
    showContextWarning(session);
  } catch (err) {
    s.stop("Error");
    p.log.error(formatError(err));
  }
}

function showContextWarning(session: ChatSession): void {
  const sessionState = session.getState();
  const totalChars = sessionState.messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  if (estimatedTokens > 100_000) {
    p.log.warn(
      pc.yellow(
        `Context size: ~${Math.round(estimatedTokens / 1000)}K tokens. Consider starting a new session (/exit) to avoid degraded responses.`,
      ),
    );
  } else if (estimatedTokens > 50_000) {
    p.log.info(pc.dim(`Context: ~${Math.round(estimatedTokens / 1000)}K tokens`));
  }
}

async function handleSlashCommand(
  trimmed: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
): Promise<boolean> {
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
  if (trimmed.startsWith("/agent ")) {
    handleAgentCommand(session, trimmed);
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
  return false;
}

function isExitInput(input: unknown): boolean {
  return p.isCancel(input) || input === "/exit";
}

async function processLoopInput(
  input: string,
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;

  const handled = await handleSlashCommand(trimmed, session, rootDir, ctx);
  if (!handled) {
    await handleSendMessage(session, trimmed);
  }
}

async function runInteractiveLoop(
  session: ChatSession,
  rootDir: string,
  ctx: CLIContext,
): Promise<void> {
  const saveAndExit = () => {
    saveChatSession(rootDir, session.getState());
    p.log.success(`\nSession saved: ${session.id}`);
    process.exit(ExitCode.SUCCESS);
  };
  process.on("SIGINT", saveAndExit);

  while (true) {
    const input = await p.text({
      message: pc.cyan("You"),
      placeholder: "Type a message or /command...",
    });

    if (isExitInput(input)) {
      saveChatSession(rootDir, session.getState());
      p.log.success(`Session saved: ${session.id}`);
      break;
    }

    await processLoopInput(input as string, session, rootDir, ctx);
  }

  process.off("SIGINT", saveAndExit);
  saveChatSession(rootDir, session.getState());
  p.outro("Chat session ended.");
  // Force exit — Ollama's axios keep-alive connections prevent natural shutdown
  process.exit(ExitCode.SUCCESS);
}

function formatSessionAsMarkdown(session: ChatSessionState): string {
  const lines: string[] = [];
  lines.push(`# Chat Session: ${session.name ?? session.id}`);
  lines.push("");
  lines.push(`- **ID:** ${session.id}`);
  lines.push(`- **Created:** ${session.createdAt}`);
  lines.push(`- **Updated:** ${session.updatedAt}`);
  lines.push(`- **Mode:** ${session.mode}`);
  if (session.pinnedAgent) lines.push(`- **Agent:** ${session.pinnedAgent}`);
  lines.push(`- **Messages:** ${session.metadata.messageCount}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of session.messages) {
    const role =
      msg.role === "user" ? "**You**" : msg.role === "assistant" ? "**Agent**" : "**System**";
    const time = new Date(msg.timestamp).toLocaleString();
    lines.push(`### ${role} — ${time}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }
  return lines.join("\n");
}

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

  const sessionId = args[1];
  const format = extractFlagValue(args, "--format") ?? "markdown";
  const outputPath = extractFlagValue(args, "--output");

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

export async function chatCommand(args: string[], ctx: CLIContext): Promise<void> {
  if (args[0] === "export") {
    return chatExportCommand(args, ctx);
  }

  const sessionName = extractFlagValue(args, "--session");
  const resumeFlag = hasFlag(args, "--resume");
  const deterministic = hasFlag(args, "--deterministic");
  const agentFlag = ctx.globalOpts.agent ?? extractFlagValue(args, "--agent");
  const messageFlag = extractFlagValue(args, "--message") ?? extractFlagValue(args, "-m");

  const rootDir = findProjectRoot(ctx.cwd);
  if (!rootDir) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No .dojops/ project found. Run `dojops init` first.",
    );
  }

  const provider = ctx.getProvider();
  const docAugmenter = await loadDocAugmenter();
  const { router } = createRouter(provider, rootDir, docAugmenter);

  const state = resolveSessionState(rootDir, resumeFlag, sessionName, deterministic);
  const mode: SessionMode = deterministic ? "DETERMINISTIC" : "INTERACTIVE";

  const session = new ChatSession({ provider, router, state, mode });

  if (agentFlag) validateAgentFlag(session, agentFlag);

  const contextInfo = buildSessionContext(rootDir);

  if (messageFlag) {
    await handleSingleMessage(session, messageFlag, rootDir, ctx);
    return;
  }

  showWelcome(session, contextInfo);
  await runInteractiveLoop(session, rootDir, ctx);
}
