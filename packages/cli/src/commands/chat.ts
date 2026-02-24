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

export async function chatCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sessionName = extractFlagValue(args, "--session");
  const resumeFlag = hasFlag(args, "--resume");
  const deterministic = hasFlag(args, "--deterministic");
  const agentFlag = extractFlagValue(args, "--agent");

  const rootDir = findProjectRoot(ctx.cwd);
  if (!rootDir) {
    p.log.error("No .dojops/ project found. Run `dojops init` first.");
    process.exit(1);
  }

  const provider = ctx.getProvider();
  const router = createRouter(provider);

  // Load or create session
  let state: ChatSessionState | undefined;

  if (resumeFlag) {
    const sessions = listChatSessions(rootDir);
    if (sessions.length > 0) {
      state = sessions[0];
      p.log.info(`Resuming session ${pc.cyan(state.id)}`);
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

    // Send message
    const s = p.spinner();
    s.start("Thinking...");
    try {
      const result = await session.send(trimmed);

      // Check for bridge command
      if (result.agent === "bridge" && result.content.startsWith("__bridge__:")) {
        s.stop("Delegating to command...");
        const [, command, cmdArgs] = result.content.split(":");
        p.log.info(
          `Bridging to ${pc.cyan(`dojops ${command}`)}${cmdArgs ? ` with: ${cmdArgs}` : ""}`,
        );
        p.log.info(pc.dim(`Run: dojops ${command} ${cmdArgs ?? ""}`.trim()));
        continue;
      }

      s.stop(`${pc.green("Agent")} ${pc.dim(`(${result.agent})`)}`);
      p.log.message(result.content);
    } catch (err) {
      s.stop("Error");
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }

  // Save on exit
  saveChatSession(rootDir, session.getState());
  p.outro("Chat session ended.");
}
