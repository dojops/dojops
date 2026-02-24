import { Router } from "express";
import { LLMProvider, AgentRouter } from "@dojops/core";
import { ChatSession } from "@dojops/session";
import type { ChatSessionState } from "@dojops/session";
import { HistoryStore } from "../store";
import { ChatRequestSchema, ChatSessionRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

export function createChatRouter(
  provider: LLMProvider,
  agentRouter: AgentRouter,
  store: HistoryStore,
): Router {
  const router = Router();

  // In-memory session store for API sessions
  const sessions = new Map<string, ChatSession>();

  function getOrCreateSession(
    sessionId?: string,
    agent?: string,
    mode?: "INTERACTIVE" | "DETERMINISTIC",
  ): ChatSession {
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (agent) session.pinAgent(agent);
      return session;
    }

    const session = new ChatSession({
      provider,
      router: agentRouter,
      mode: mode ?? "INTERACTIVE",
    });
    if (agent) session.pinAgent(agent);
    sessions.set(session.id, session);
    return session;
  }

  // POST / — Send a message
  router.post("/", validateBody(ChatRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { sessionId, message, agent } = req.body;
      const session = getOrCreateSession(sessionId, agent);

      const result = await session.send(message);

      const response = {
        content: result.content,
        agent: result.agent,
        sessionId: session.id,
      };

      store.add({
        type: "chat",
        request: { sessionId: session.id, message },
        response,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json(response);
    } catch (err) {
      store.add({
        type: "chat",
        request: req.body,
        response: null,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  });

  // POST /sessions — Create a new session
  router.post("/sessions", validateBody(ChatSessionRequestSchema), (req, res) => {
    const { name, mode } = req.body;
    const session = new ChatSession({
      provider,
      router: agentRouter,
      mode: mode ?? "INTERACTIVE",
    });
    sessions.set(session.id, session);
    const state = session.getState();
    if (name) {
      (state as ChatSessionState).name = name;
    }
    res.status(201).json(state);
  });

  // GET /sessions — List all sessions
  router.get("/sessions", (_req, res) => {
    const list: ChatSessionState[] = [];
    for (const session of sessions.values()) {
      list.push(session.getState());
    }
    list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json(list);
  });

  // GET /sessions/:id — Get session state
  router.get("/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session.getState());
  });

  // DELETE /sessions/:id — Delete session
  router.delete("/sessions/:id", (req, res) => {
    const deleted = sessions.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
