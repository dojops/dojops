import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { LLMProvider, AgentRouter } from "@dojops/core";
import { ChatSession, cleanExpiredSessions } from "@dojops/session";
import type { ChatSessionState } from "@dojops/session";
import { HistoryStore, logRouteError, toErrorMessage } from "../store";
import { ChatRequestSchema, ChatSessionRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

// ── Session ID validation (A6: path traversal prevention) ────────

const SESSION_ID_PATTERN = /^chat-[a-f0-9]{8,16}$/;
function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

// ── Disk persistence helpers ──────────────────────────────────────

function sessionsDir(rootDir: string): string {
  return path.join(rootDir, ".dojops", "sessions");
}

function persistSession(rootDir: string | undefined, session: ChatSession): void {
  if (!rootDir) return;
  try {
    const dir = sessionsDir(rootDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${session.id}.json`);
    const tmpFile = file + ".tmp";
    const state = session.getState();
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2) + "\n");
    fs.renameSync(tmpFile, file);
  } catch {
    // Disk persistence is best-effort — never fail the request
  }
}

function loadSessionFromDisk(rootDir: string, sessionId: string): ChatSessionState | null {
  if (!isValidSessionId(sessionId)) return null;
  try {
    const file = path.join(sessionsDir(rootDir), `${sessionId}.json`);
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ChatSessionState;
  } catch {
    return null;
  }
}

function deleteSessionFromDisk(rootDir: string | undefined, sessionId: string): void {
  if (!rootDir) return;
  if (!isValidSessionId(sessionId)) return;
  try {
    const file = path.join(sessionsDir(rootDir), `${sessionId}.json`);
    fs.unlinkSync(file);
  } catch {
    // Best-effort
  }
}

function loadAllSessionsFromDisk(
  rootDir: string,
  provider: LLMProvider,
  agentRouter: AgentRouter,
  cache: Map<string, ChatSession>,
  maxSessions: number,
): void {
  try {
    const dir = sessionsDir(rootDir);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as ChatSessionState;
        if (!isValidSessionId(data.id)) continue;
        if (cache.has(data.id)) continue;
        if (cache.size >= maxSessions) break;
        const session = new ChatSession({
          provider,
          router: agentRouter,
          state: data,
          mode: data.mode ?? "INTERACTIVE",
        });
        cache.set(data.id, session);
      } catch {
        // Skip corrupt files
      }
    }
  } catch {
    // Best-effort
  }
}

export function createChatRouter(
  provider: LLMProvider,
  agentRouter: AgentRouter,
  store: HistoryStore,
  rootDir?: string,
): Router {
  const router = Router();

  // In-memory session store for API sessions (capped to prevent memory exhaustion)
  const MAX_SESSIONS = 500;
  const sessions = new Map<string, ChatSession>();

  // Hydrate cache from disk on startup
  if (rootDir) {
    loadAllSessionsFromDisk(rootDir, provider, agentRouter, sessions, MAX_SESSIONS);
  }

  /** Restore a session from disk into the in-memory cache. */
  function restoreFromDisk(sessionId: string): ChatSession | null {
    if (!rootDir) return null;
    const diskState = loadSessionFromDisk(rootDir, sessionId);
    if (!diskState) return null;
    const session = new ChatSession({
      provider,
      router: agentRouter,
      state: diskState,
      mode: diskState.mode ?? "INTERACTIVE",
    });
    sessions.set(session.id, session);
    return session;
  }

  /** Evict oldest session if at capacity. */
  function evictIfFull(): void {
    if (sessions.size < MAX_SESSIONS) return;
    const oldestKey = sessions.keys().next().value;
    if (oldestKey) sessions.delete(oldestKey);
  }

  function getOrCreateSession(
    sessionId?: string,
    agent?: string,
    mode?: "INTERACTIVE" | "DETERMINISTIC",
  ): ChatSession {
    // Try in-memory cache first
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (agent) session.pinAgent(agent);
      return session;
    }

    // Cache miss — try loading from disk
    if (sessionId) {
      const restored = restoreFromDisk(sessionId);
      if (restored) {
        if (agent) restored.pinAgent(agent);
        return restored;
      }
      const sanitized = sessionId.replace(/[\r\n\t]/g, "").slice(0, 64); // NOSONAR - character class
      console.warn(`[chat] Session "${sanitized}" not found, creating new session`);
    }

    evictIfFull();
    const session = new ChatSession({
      provider,
      router: agentRouter,
      mode: mode ?? "INTERACTIVE",
    });
    if (agent) session.pinAgent(agent);
    sessions.set(session.id, session);
    persistSession(rootDir, session);
    return session;
  }

  // POST / — Send a message (UX #11: proper error handling for session.send())
  router.post("/", validateBody(ChatRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { sessionId, message, agent } = req.body;
      const session = getOrCreateSession(sessionId, agent);

      let result;
      try {
        result = await session.send(message);
      } catch (sendErr) {
        // Return 500 with error message rather than crashing the route
        logRouteError(store, "chat", { sessionId: session.id, message }, start, sendErr);
        res.status(500).json({
          error: toErrorMessage(sendErr),
          sessionId: session.id,
        });
        return;
      }
      persistSession(rootDir, session);

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
      logRouteError(store, "chat", req.body, start, err);
      next(err);
    }
  });

  // POST /sessions — Create a new session (A28: error handling)
  router.post("/sessions", validateBody(ChatSessionRequestSchema), (req, res, next) => {
    try {
      // Evict oldest session if at capacity
      if (sessions.size >= MAX_SESSIONS) {
        const oldestKey = sessions.keys().next().value;
        if (oldestKey) sessions.delete(oldestKey);
      }

      const { name, mode } = req.body;
      const session = new ChatSession({
        provider,
        router: agentRouter,
        mode: mode ?? "INTERACTIVE",
      });
      if (name) session.setName(name);
      sessions.set(session.id, session);
      persistSession(rootDir, session);
      res.status(201).json(session.getState());
    } catch (err) {
      next(err);
    }
  });

  // GET /sessions — List all sessions (A28: error handling)
  // E-4: Lazy cleanup of expired sessions on list
  let lastCleanup = 0;
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  /** Evict expired sessions from in-memory cache. */
  function evictExpiredSessions(): void {
    const now = Date.now();
    const ttl = process.env.DOJOPS_SESSION_TTL_MS
      ? Number.parseInt(process.env.DOJOPS_SESSION_TTL_MS, 10)
      : 7 * 24 * 60 * 60 * 1000;
    for (const [id, session] of sessions) {
      const updatedAt = new Date(session.getState().updatedAt).getTime();
      if (Number.isFinite(updatedAt) && now - updatedAt > ttl) {
        sessions.delete(id);
      }
    }
  }

  router.get("/sessions", (_req, res, next) => {
    try {
      const now = Date.now();
      if (rootDir && now - lastCleanup > CLEANUP_INTERVAL_MS) {
        const deleted = cleanExpiredSessions(rootDir);
        if (deleted > 0) evictExpiredSessions();
        lastCleanup = now;
      }

      const list: ChatSessionState[] = [];
      for (const session of sessions.values()) {
        list.push(session.getState());
      }
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  // GET /sessions/:id — Get session state (A6: validate session ID)
  // UX #6: Return generic "Session not found" instead of leaking ID format details
  router.get("/sessions/:id", (req, res) => {
    if (!isValidSessionId(req.params.id)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    let session = sessions.get(req.params.id);
    if (!session && rootDir) {
      const diskState = loadSessionFromDisk(rootDir, req.params.id);
      if (diskState) {
        session = new ChatSession({
          provider,
          router: agentRouter,
          state: diskState,
          mode: diskState.mode ?? "INTERACTIVE",
        });
        sessions.set(session.id, session);
      }
    }
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session.getState());
  });

  // DELETE /sessions/:id — Delete session (A6: validate session ID)
  // UX #6: Return generic "Session not found" instead of leaking ID format details
  router.delete("/sessions/:id", (req, res) => {
    if (!isValidSessionId(req.params.id)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const deleted = sessions.delete(req.params.id);
    deleteSessionFromDisk(rootDir, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
