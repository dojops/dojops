import { Router } from "express";
import { createHmac, randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LLMProvider } from "@dojops/core";
import { AGENT_TOOLS } from "@dojops/core";
import type { DevOpsSkill } from "@dojops/sdk";
import { ToolExecutor } from "@dojops/executor";
import { AgentLoop } from "@dojops/session";
import type { HistoryStore } from "../store";
import { AutoRequestSchema } from "../schemas";

// ── G-04: TTL-based eviction + capacity cap ──────────────────────────

const BACKGROUND_RUN_TTL_MS = 60 * 60 * 1000; // 1 hour
const BACKGROUND_RUN_MAX_ENTRIES = 100;

/** In-memory store for background run results (API only). */
const backgroundRuns = new Map<
  string,
  {
    status: "running" | "completed" | "failed";
    result?: unknown;
    error?: string;
    startedAt: string;
    createdAt: number; // monotonic timestamp for TTL eviction
  }
>();

/** Remove entries older than TTL. */
function evictExpiredRuns(): void {
  const now = Date.now();
  for (const [id, run] of backgroundRuns) {
    if (now - run.createdAt > BACKGROUND_RUN_TTL_MS) {
      backgroundRuns.delete(id);
    }
  }
}

// Periodic cleanup every 5 minutes
const cleanupInterval = setInterval(evictExpiredRuns, 5 * 60 * 1000);
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

/** Check if valid IPv4 octets belong to a private/reserved range. */
function isPrivateIpv4(parts: number[]): boolean {
  if (parts[0] === 127) return true; // loopback
  if (parts[0] === 10) return true; // 10.0.0.0/8
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
  if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
  if (parts[0] === 169 && parts[1] === 254) return true; // link-local
  if (parts[0] === 0) return true; // 0.0.0.0/8
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
  return false;
}

/** Check if an IPv6 address belongs to a private/loopback/link-local range. */
function isPrivateIpv6(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  return false;
}

/** Check if an IP address belongs to a private/loopback/link-local range. */
export function isPrivateIp(ip: string): boolean {
  if (isPrivateIpv6(ip)) return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  const isValidIpv4 =
    parts.length === 4 && parts.every((n) => !Number.isNaN(n) && n >= 0 && n <= 255);
  if (isValidIpv4) return isPrivateIpv4(parts);

  return false;
}

/** Block webhook URLs targeting internal/cloud metadata endpoints (SSRF prevention). */
export async function validateWebhookUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook URL must use HTTP(S)");
  }
  const blockedHosts = [
    "169.254.169.254",
    "metadata.google.internal",
    "100.100.100.200",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
  ];
  if (blockedHosts.includes(parsed.hostname)) {
    throw new Error("Webhook URL targets a blocked host");
  }

  // Resolve hostname to IP and check against private ranges to prevent DNS rebinding
  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateIp(address)) {
      throw new Error("Webhook URL resolves to a private/internal IP address");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private/internal")) throw err;
    throw new Error("Webhook URL hostname could not be resolved", { cause: err });
  }
}

/** Deliver webhook notification with HMAC signature for verification. */
async function deliverWebhook(
  url: string,
  payload: Record<string, unknown>,
  apiKey?: string,
): Promise<void> {
  try {
    await validateWebhookUrl(url);
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "DojOps-Webhook/1.0",
    };
    // HMAC-SHA256 signature using API key as secret (if available)
    if (apiKey) {
      const signature = createHmac("sha256", apiKey).update(body).digest("hex");
      headers["X-DojOps-Signature"] = `sha256=${signature}`;
    }
    await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Webhook delivery is best-effort — never fail the run
  }
}

export function createAutoRouter(
  provider: LLMProvider,
  skills: DevOpsSkill[],
  store: HistoryStore,
  rootDir?: string,
): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    // G-02: Auto endpoint ALWAYS requires real authentication (not --unsafe-no-auth)
    if (!res.locals.authenticated || res.locals.noAuthMode) {
      res
        .status(401)
        .json({ error: "Authentication required for /api/auto. Configure DOJOPS_API_KEY." });
      return;
    }

    const parsed = AutoRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { prompt, maxIterations, background, webhookUrl } = parsed.data;
    // G-02: Always use server's own working directory, never client-provided
    const cwd = rootDir ?? process.cwd();

    const skillsMap = new Map(skills.map((s) => [s.name, s]));

    // CS-01: Mirror CLI auto command's denied paths for sensitive directories
    const home = os.homedir();
    const deniedWritePaths = [
      path.join(home, ".ssh"),
      path.join(home, ".gnupg"),
      path.join(home, ".aws"),
      path.join(home, ".config"),
      path.join(cwd, ".env"),
    ];

    const toolExecutor = new ToolExecutor({
      policy: {
        allowWrite: true,
        // G-02: Never allow all paths — always enforce DevOps allowlist
        allowedWritePaths: [cwd],
        deniedWritePaths,
        allowedReadPaths: [cwd],
        enforceDevOpsAllowlist: true,
        allowNetwork: false,
        allowEnvVars: [],
        timeoutMs: 30_000,
        maxFileSizeBytes: 1_048_576,
        requireApproval: false,
        skipVerification: false,
        maxVerifyRetries: 0,
        approvalMode: "risk-based",
        autoApproveRiskLevel: "LOW",
        maxRepairAttempts: 0,
      },
      cwd,
      skills: skillsMap,
    });

    const loop = new AgentLoop({
      provider,
      toolExecutor,
      tools: AGENT_TOOLS,
      systemPrompt: `You are DojOps, an autonomous DevOps AI agent operating in: ${cwd}
Complete the user's task by reading files, making changes, and running commands.

Workflow: For each DevOps config, call run_skill to generate it, then IMMEDIATELY use write_file to save the output.
run_skill returns text — it does NOT create files. You MUST write the result to disk with write_file.

Available skills: ${skills.map((s) => s.name).join(", ")}
Usage: run_skill({ skill: "dockerfile", input: { prompt: "Create Dockerfile for Node.js 20" } })

Rules:
- Do NOT install packages globally (pip install, npm install -g, etc.)
- Do NOT write or modify .env files — blocked by security policy
- Do NOT assume external validation tools are installed — you will get a "[TOOL NOT INSTALLED]" error
- Do NOT use python/pip for YAML validation. Do NOT invent CLI flags (e.g. no "docker build --dry-run").
- If validating: docker-compose → "docker-compose -f <file> config --quiet", terraform → "terraform validate", kubectl → "kubectl apply -f <file> --dry-run=client"
- Complete ALL parts of the request before calling "done". If the user asks for 3 files, create all 3.
- Do NOT call "done" until all requested files have been written to disk with write_file.`,
      maxIterations,
      validateBeforeDone: async () => {
        const allFiles = [...toolExecutor.getFilesWritten(), ...toolExecutor.getFilesModified()];
        if (allFiles.length === 0) {
          return [
            "No files were written to disk. Use write_file to create each requested file before calling done.",
            "If you used run_skill, the output is text — you still need to write it with write_file.",
          ];
        }
        // Verify written files still exist and are non-empty
        const issues: string[] = [];
        for (const filePath of allFiles) {
          try {
            const stat = fs.statSync(filePath);
            if (stat.size === 0) {
              issues.push(`${path.relative(cwd, filePath)}: file is empty`);
            }
          } catch {
            issues.push(`${path.relative(cwd, filePath)}: file no longer exists on disk`);
          }
        }
        return issues;
      },
    });

    const start = Date.now();

    // ── Background mode: return immediately with a run ID ──────────
    if (background) {
      // G-04: Evict expired entries before checking capacity
      evictExpiredRuns();

      // G-04: Reject if at capacity
      if (backgroundRuns.size >= BACKGROUND_RUN_MAX_ENTRIES) {
        res.status(429).json({
          error: "Too many background runs. Please wait for existing runs to complete.",
        });
        return;
      }

      const runId = randomUUID();
      const createdAt = Date.now();
      backgroundRuns.set(runId, {
        status: "running",
        startedAt: new Date().toISOString(),
        createdAt,
      });

      // Fire-and-forget — process continues in background
      loop
        .run(prompt)
        .then(async (result) => {
          store.add({
            type: "auto",
            request: { prompt, maxIterations },
            response: result,
            durationMs: Date.now() - start,
            success: result.success,
          });
          backgroundRuns.set(runId, {
            status: result.success ? "completed" : "failed",
            result,
            startedAt: backgroundRuns.get(runId)?.startedAt ?? new Date().toISOString(),
            createdAt,
          });
          if (webhookUrl) {
            const apiKey = process.env.DOJOPS_API_KEY;
            await deliverWebhook(
              webhookUrl,
              {
                runId,
                status: result.success ? "completed" : "failed",
                summary: result.summary ?? null,
                filesWritten: result.filesWritten ?? [],
                durationMs: Date.now() - start,
                timestamp: new Date().toISOString(),
              },
              apiKey,
            );
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          store.add({
            type: "auto",
            request: { prompt },
            response: null,
            durationMs: Date.now() - start,
            success: false,
            error: message,
          });
          backgroundRuns.set(runId, {
            status: "failed",
            error: message,
            startedAt: backgroundRuns.get(runId)?.startedAt ?? new Date().toISOString(),
            createdAt,
          });
          if (webhookUrl) {
            const apiKey = process.env.DOJOPS_API_KEY;
            deliverWebhook(
              webhookUrl,
              {
                runId,
                status: "failed",
                error: message,
                durationMs: Date.now() - start,
                timestamp: new Date().toISOString(),
              },
              apiKey,
            ).catch(() => {});
          }
        });

      res.status(202).json({ runId, status: "running", webhookUrl: webhookUrl ?? null });
      return;
    }

    // ── Synchronous mode (default) ─────────────────────────────────
    try {
      const result = await loop.run(prompt);

      store.add({
        type: "auto",
        request: { prompt, maxIterations },
        response: result,
        durationMs: Date.now() - start,
        success: result.success,
      });

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[auto] execution error:", message);
      store.add({
        type: "auto",
        request: { prompt },
        response: null,
        durationMs: Date.now() - start,
        success: false,
        error: message,
      });
      res.status(500).json({ error: "Internal execution error" });
    }
  });

  // ── GET /runs/:id — check background run status ─────────────────
  router.get("/runs/:id", (req, res) => {
    // M-5: Require authentication for run status (may contain sensitive paths/outputs)
    if (!res.locals.authenticated) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const run = backgroundRuns.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ runId: req.params.id, ...run });
  });

  return router;
}
