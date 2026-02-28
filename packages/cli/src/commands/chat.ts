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
import { ExitCode, CLIError } from "../exit-codes";

export async function chatCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sessionName = extractFlagValue(args, "--session");
  const resumeFlag = hasFlag(args, "--resume");
  const deterministic = hasFlag(args, "--deterministic");
  const agentFlag = extractFlagValue(args, "--agent");
  const messageFlag = extractFlagValue(args, "--message") ?? extractFlagValue(args, "-m");

  const rootDir = findProjectRoot(ctx.cwd);
  if (!rootDir) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No .dojops/ project found. Run `dojops init` first.",
    );
  }

  const provider = ctx.getProvider();
  const { router } = createRouter(provider, rootDir);

  // Load or create session
  let state: ChatSessionState | undefined;

  if (resumeFlag) {
    const sessions = listChatSessions(rootDir);
    if (sessionName) {
      // Resume specific session by name or ID
      state = sessions.find((s) => s.name === sessionName || s.id === sessionName) ?? undefined;
      if (!state) {
        throw new CLIError(ExitCode.VALIDATION_ERROR, `Session "${sessionName}" not found.`);
      }
      p.log.info(`Resuming session ${pc.cyan(state.name ?? state.id)}`);
    } else if (sessions.length > 0) {
      state = sessions[0];
      p.log.info(`Resuming session ${pc.cyan(state.id)}`);
    } else {
      p.log.warn("No sessions found to resume.");
    }
  } else if (sessionName) {
    // Look for existing session by name
    const sessions = listChatSessions(rootDir);
    state = sessions.find((s) => s.name === sessionName) ?? undefined;
    if (state) {
      p.log.info(`Resuming session ${pc.cyan(sessionName)} (${state.id})`);
    } else {
      state = {
        id: generateSessionId(),
        name: sessionName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mode: deterministic ? "DETERMINISTIC" : "INTERACTIVE",
        messages: [],
        metadata: { totalTokensEstimate: 0, messageCount: 0 },
      };
    }
  }

  const mode: SessionMode = deterministic ? "DETERMINISTIC" : "INTERACTIVE";

  const session = new ChatSession({
    provider,
    router,
    state,
    mode,
  });

  if (agentFlag) {
    session.pinAgent(agentFlag);
  }

  // Inject project context
  const contextInfo = buildSessionContext(rootDir);

  // Single-message mode: --message / -m flag
  if (messageFlag) {
    const isStructuredOutput = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
    const s = p.spinner();
    if (!isStructuredOutput) s.start("Thinking...");
    try {
      const result = await session.send(messageFlag);
      if (!isStructuredOutput) s.stop(`${pc.green("Agent")} ${pc.dim(`(${result.agent})`)}`);

      if (ctx.globalOpts.output === "json") {
        console.log(JSON.stringify({ agent: result.agent, content: result.content }));
      } else {
        p.log.message(result.content);
      }
    } catch (err) {
      if (!isStructuredOutput) s.stop("Error");
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    saveChatSession(rootDir, session.getState());
    if (ctx.globalOpts.output !== "json") {
      p.log.info(pc.dim(`Session: ${session.id}`));
    }
    return;
  }

  // Welcome message
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

  // Graceful shutdown: save session on SIGINT during LLM call
  const saveAndExit = () => {
    saveChatSession(rootDir, session.getState());
    p.log.success(`\nSession saved: ${session.id}`);
    process.exit(ExitCode.SUCCESS);
  };
  process.on("SIGINT", saveAndExit);

  // REPL loop
  while (true) {
    const input = await p.text({
      message: pc.cyan("You"),
      placeholder: "Type a message or /command...",
    });

    if (p.isCancel(input) || input === "/exit") {
      saveChatSession(rootDir, session.getState());
      p.log.success(`Session saved: ${session.id}`);
      break;
    }

    const trimmed = (input as string).trim();
    if (!trimmed) continue;

    // Handle slash commands
    if (trimmed === "/history") {
      const msgs = session.messages;
      if (msgs.length === 0) {
        p.log.info("No messages in this session.");
      } else {
        for (const msg of msgs.slice(-20)) {
          const role = msg.role === "user" ? pc.cyan("You") : pc.green("Agent");
          const time = pc.dim(new Date(msg.timestamp).toLocaleTimeString());
          p.log.message(`${role} ${time}\n${msg.content}`);
        }
      }
      continue;
    }

    if (trimmed === "/clear") {
      session.clearMessages();
      p.log.success("Session messages cleared.");
      continue;
    }

    if (trimmed === "/save") {
      saveChatSession(rootDir, session.getState());
      p.log.success(`Session saved: ${session.id}`);
      continue;
    }

    if (trimmed.startsWith("/agent ")) {
      const agentName = trimmed.slice(7).trim();
      if (agentName === "auto") {
        session.unpinAgent();
        p.log.info("Agent unpinned — auto-routing enabled.");
      } else {
        session.pinAgent(agentName);
        p.log.info(`Agent pinned to ${pc.cyan(agentName)}`);
      }
      continue;
    }

    if (trimmed.startsWith("/plan ")) {
      const goal = trimmed.slice(6).trim();
      if (!goal) {
        p.log.warn("Usage: /plan <goal>");
        continue;
      }
      saveChatSession(rootDir, session.getState());
      try {
        const { planCommand } = await import("./plan");
        await planCommand([goal], ctx);
      } catch (err) {
        if (err instanceof Error && "exitCode" in err) {
          p.log.error(err.message);
        } else {
          p.log.error(err instanceof Error ? err.message : String(err));
        }
      }
      continue;
    }

    if (trimmed === "/apply" || trimmed.startsWith("/apply ")) {
      const planId = trimmed.slice(7).trim() || undefined;
      saveChatSession(rootDir, session.getState());
      try {
        const { applyCommand } = await import("./apply");
        const applyArgs: string[] = [];
        if (planId) applyArgs.push(planId);
        await applyCommand(applyArgs, ctx);
      } catch (err) {
        if (err instanceof Error && "exitCode" in err) {
          p.log.error(err.message);
        } else {
          p.log.error(err instanceof Error ? err.message : String(err));
        }
      }
      continue;
    }

    if (trimmed === "/scan" || trimmed.startsWith("/scan ")) {
      const scanArgs = trimmed.slice(6).trim().split(/\s+/).filter(Boolean);
      saveChatSession(rootDir, session.getState());
      try {
        const { scanCommand } = await import("./scan");
        await scanCommand(scanArgs, ctx);
      } catch (err) {
        if (err instanceof Error && "exitCode" in err) {
          p.log.error(err.message);
        } else {
          p.log.error(err instanceof Error ? err.message : String(err));
        }
      }
      continue;
    }

    // Send message
    const s = p.spinner();
    s.start("Thinking...");
    try {
      const result = await session.send(trimmed);

      // Security: Never interpret LLM output as executable bridge commands.
      // Bridge commands are only processed from user-typed slash commands
      // (handled above in the slash-command section), never from LLM responses.

      s.stop(`${pc.green("Agent")} ${pc.dim(`(${result.agent})`)}`);
      p.log.message(result.content);
    } catch (err) {
      s.stop("Error");
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }

  // Clean up SIGINT handler before normal exit
  process.off("SIGINT", saveAndExit);

  // Save on exit
  saveChatSession(rootDir, session.getState());
  p.outro("Chat session ended.");
}
