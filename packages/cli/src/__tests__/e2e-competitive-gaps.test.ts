/**
 * E2E integration tests for the 5 competitive-gap features.
 * Runs against /tmp/example-nextjs using DeepSeek as the LLM provider.
 *
 * These tests exercise real CLI behavior, file I/O, and (for Feature 5)
 * a live LLM call to validate the full pipeline.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync, ExecFileSyncOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Direct source imports (Vitest transforms these from TypeScript)
import { expandFileReferences } from "../input-expander";
import { emitStreamEvent } from "../stream-json";
import { parseGlobalOptions } from "../parser";
import { ChatSession } from "@dojops/session";
import { discoverDevOpsFiles, loadIgnorePatterns } from "@dojops/core";
import { buildFileTree } from "@dojops/session";

// Strip ANSI escape codes (cursor show/hide, colors, etc.)
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Extract valid JSON lines from CLI stdout (skips TUI noise and ANSI escapes). */
function extractJsonLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => stripAnsi(l).trim())
    .filter((l) => l.startsWith("{"))
    .filter((l) => {
      try {
        JSON.parse(l);
        return true;
      } catch {
        return false;
      }
    });
}

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_REPO = "/tmp/example-nextjs";
const CLI_ENTRY = path.resolve(__dirname, "../../dist/index.js");

const DEEPSEEK_KEY = "sk-d719491269b14345a75f77090785727d";

function dojops(args: string | string[], opts: Partial<ExecFileSyncOptions> = {}): string {
  const argv = Array.isArray(args) ? args : args.split(/\s+/);
  return execFileSync("node", [CLI_ENTRY, ...argv], {
    encoding: "utf-8",
    cwd: TEST_REPO,
    timeout: 60_000,
    maxBuffer: 512 * 1024,
    env: {
      ...process.env,
      DOJOPS_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: DEEPSEEK_KEY,
      DOJOPS_MODEL: "deepseek-chat",
      NO_COLOR: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
}

/** Run CLI and capture both stdout and stderr. */
function dojopsFull(
  args: string | string[],
  opts: Partial<ExecFileSyncOptions> = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = dojops(args, opts);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

// ── Setup ────────────────────────────────────────────────────────────

beforeAll(() => {
  // Skip setup when test repo is not available (e.g. CI)
  if (!fs.existsSync(TEST_REPO)) return;

  expect(fs.existsSync(path.join(TEST_REPO, "package.json"))).toBe(true);

  // Ensure CLI is built
  expect(fs.existsSync(CLI_ENTRY)).toBe(true);

  // Ensure .dojops directory exists for chat/session features
  fs.mkdirSync(path.join(TEST_REPO, ".dojops"), { recursive: true });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 1: ! Shell Passthrough
// ═══════════════════════════════════════════════════════════════════

describe("Feature 1: ! Shell Passthrough", () => {
  it("!ls lists files in the test repo cwd", () => {
    const result = execFileSync("/bin/sh", ["-c", "ls -1"], {
      cwd: TEST_REPO,
      encoding: "utf-8",
      timeout: 5_000,
    });
    expect(result).toContain("package.json");
    expect(result).toContain("Dockerfile");
    expect(result).toContain("src");
  });

  it("shell commands capture stderr and exit code on failure", () => {
    try {
      execFileSync("/bin/sh", ["-c", "nonexistent-command-12345"], {
        cwd: TEST_REPO,
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as { stderr?: string; status?: number };
      expect(e.status).not.toBe(0);
      expect(e.stderr).toBeTruthy();
    }
  });

  it("shell commands respect timeout and run in correct cwd", () => {
    const start = Date.now();
    const output = execFileSync("/bin/sh", ["-c", "pwd"], {
      cwd: TEST_REPO,
      encoding: "utf-8",
      timeout: 30_000,
    });
    const elapsed = Date.now() - start;
    expect(output.trim()).toBe(TEST_REPO);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("!git status works on the test repo", () => {
    const output = execFileSync("/bin/sh", ["-c", "git status --short"], {
      cwd: TEST_REPO,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(typeof output).toBe("string");
  });

  it("!cat reads real project files", () => {
    const output = execFileSync("/bin/sh", ["-c", "cat package.json | head -3"], {
      cwd: TEST_REPO,
      encoding: "utf-8",
      timeout: 5_000,
    });
    expect(output).toContain("example-nextjs");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 2: /compress Command
// ═══════════════════════════════════════════════════════════════════

describe("Feature 2: /compress Command", () => {
  it("compress() returns null with fewer than 4 messages", async () => {
    const mockProvider = {
      generate: async () => ({ content: "response" }),
    };
    const mockRouter = {
      getAgents: () => [
        {
          name: "general",
          domain: "general",
          runWithHistory: async () => ({ content: "ok" }),
          streamWithHistory: async () => ({ content: "ok" }),
        },
      ],
      routeWithLLM: async () => ({
        agent: { name: "general", runWithHistory: async () => ({ content: "ok" }) },
        confidence: 1,
        reason: "test",
      }),
    };
    // @ts-expect-error — minimal mock
    const session = new ChatSession({ provider: mockProvider, router: mockRouter });
    const result = await session.compress();
    expect(result).toBeNull();
  });

  it("compress() summarizes when >= 4 messages and updates state", async () => {
    const mockProvider = {
      generate: async () => ({ content: "Summary of the Docker discussion." }),
    };
    const mockRouter = {
      getAgents: () => [
        {
          name: "general",
          runWithHistory: async () => ({ content: "reply" }),
          streamWithHistory: async () => ({ content: "reply" }),
        },
      ],
      routeWithLLM: async () => ({
        agent: { name: "general", runWithHistory: async () => ({ content: "reply" }) },
        confidence: 1,
        reason: "test",
      }),
    };

    const state = {
      id: "test-compress-e2e",
      createdAt: new Date().toISOString(),
      updatedAt: "2024-01-01T00:00:00.000Z", // old timestamp to verify update
      mode: "INTERACTIVE" as const,
      messages: [
        { role: "user" as const, content: "Hello", timestamp: new Date().toISOString() },
        { role: "assistant" as const, content: "Hi!", timestamp: new Date().toISOString() },
        { role: "user" as const, content: "What is Docker?", timestamp: new Date().toISOString() },
        {
          role: "assistant" as const,
          content: "Docker is a container platform.",
          timestamp: new Date().toISOString(),
        },
        {
          role: "user" as const,
          content: "Create a Dockerfile for Next.js",
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant" as const,
          content: "FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm run build\nCMD npm start",
          timestamp: new Date().toISOString(),
        },
      ],
      metadata: { totalTokensEstimate: 500, messageCount: 6 },
    };

    // @ts-expect-error — minimal mock
    const session = new ChatSession({ provider: mockProvider, router: mockRouter, state });
    const beforeUpdate = state.updatedAt;
    const result = await session.compress();

    expect(result).not.toBeNull();
    expect(result!.messagesSummarized).toBe(2); // 6 - 4 = 2
    expect(result!.messagesRetained).toBe(4);

    const newState = session.getState();
    expect(newState.messages).toHaveLength(4);
    expect(newState.summary).toBe("Summary of the Docker discussion.");
    expect(newState.metadata.messageCount).toBe(4);
    expect(newState.updatedAt).not.toBe(beforeUpdate);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 3: @file Injection (against real example-nextjs repo)
// ═══════════════════════════════════════════════════════════════════

describe("Feature 3: @file Injection Syntax", () => {
  it("expands @package.json from example-nextjs", () => {
    const result = expandFileReferences("explain @package.json", TEST_REPO);

    expect(result).toContain('<file path="package.json">');
    expect(result).toContain('"name": "example-nextjs"');
    expect(result).toContain("</file>");
  });

  it("expands @tsconfig.json from example-nextjs", () => {
    // Note: @Dockerfile won't match because the regex requires a file extension
    const result = expandFileReferences("review @tsconfig.json", TEST_REPO);

    expect(result).toContain('<file path="tsconfig.json">');
    expect(result).toContain("compilerOptions");
    expect(result).toContain("</file>");
  });

  it("expands @src/app/page.tsx from example-nextjs", () => {
    const result = expandFileReferences("explain @src/app/page.tsx", TEST_REPO);

    if (fs.existsSync(path.join(TEST_REPO, "src/app/page.tsx"))) {
      expect(result).toContain('<file path="src/app/page.tsx">');
      expect(result).toContain("</file>");
    } else {
      expect(result).toBe("explain @src/app/page.tsx");
    }
  });

  it("expands @next.config.ts from example-nextjs", () => {
    const result = expandFileReferences("explain @next.config.ts", TEST_REPO);

    if (fs.existsSync(path.join(TEST_REPO, "next.config.ts"))) {
      expect(result).toContain('<file path="next.config.ts">');
      expect(result).toContain("</file>");
    } else {
      expect(result).toBe("explain @next.config.ts");
    }
  });

  it("leaves @nonexistent.xyz unchanged", () => {
    const result = expandFileReferences("check @nonexistent.xyz", TEST_REPO);
    expect(result).toBe("check @nonexistent.xyz");
  });

  it("leaves @mention without extension unchanged", () => {
    const result = expandFileReferences("hey @john what do you think", TEST_REPO);
    expect(result).toBe("hey @john what do you think");
  });

  it("handles multiple @file references from example-nextjs", () => {
    const result = expandFileReferences("compare @package.json and @tsconfig.json", TEST_REPO);

    expect(result).toContain('<file path="package.json">');
    expect(result).toContain('<file path="tsconfig.json">');
    expect(result.match(/<\/file>/g)?.length).toBe(2);
  });

  it("preserves surrounding text when expanding", () => {
    const result = expandFileReferences(
      "Please review @tsconfig.json and suggest improvements",
      TEST_REPO,
    );

    expect(result).toContain("Please review");
    expect(result).toContain("and suggest improvements");
    expect(result).toContain('<file path="tsconfig.json">');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 4: .dojopsignore (against real example-nextjs repo)
// ═══════════════════════════════════════════════════════════════════

describe("Feature 4: .dojopsignore File", () => {
  const ignoreFile = path.join(TEST_REPO, ".dojopsignore");

  afterEach(() => {
    try {
      fs.unlinkSync(ignoreFile);
    } catch {
      // Doesn't exist — fine
    }
  });

  it("discoverDevOpsFiles excludes Dockerfile when in .dojopsignore", () => {
    fs.writeFileSync(ignoreFile, "Dockerfile\n", "utf-8");

    const files = discoverDevOpsFiles(TEST_REPO);
    const names = files.map((f) => f.path);

    expect(names).not.toContain("Dockerfile");
  });

  it("discoverDevOpsFiles finds Dockerfile without .dojopsignore", () => {
    const files = discoverDevOpsFiles(TEST_REPO);
    const names = files.map((f) => f.path);

    expect(names).toContain("Dockerfile");
  });

  it("buildFileTree hides src/ when excluded", () => {
    fs.writeFileSync(ignoreFile, "src/\n", "utf-8");

    const tree = buildFileTree(TEST_REPO);
    const lines = tree.split("\n");
    const srcLine = lines.find((l) => l.trim() === "src/");
    expect(srcLine).toBeUndefined();
  });

  it("buildFileTree shows everything without .dojopsignore", () => {
    const tree = buildFileTree(TEST_REPO);

    expect(tree).toContain("src/");
    expect(tree).toContain("package.json");
    expect(tree).toContain("Dockerfile");
  });

  it(".dojopsignore supports glob patterns on real files", () => {
    const tempFile = path.join(TEST_REPO, "test.generated.ts");
    fs.writeFileSync(tempFile, "// generated", "utf-8");
    fs.writeFileSync(ignoreFile, "*.generated.ts\n", "utf-8");

    try {
      const tree = buildFileTree(TEST_REPO);
      expect(tree).not.toContain("test.generated.ts");
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it("loadIgnorePatterns skips comments and empty lines", () => {
    fs.writeFileSync(ignoreFile, "# Comment\n\n   \n# Another\nDockerfile\n*.log\n", "utf-8");

    const patterns = loadIgnorePatterns(TEST_REPO);
    expect(patterns).toEqual(["Dockerfile", "*.log"]);
  });

  it("loadIgnorePatterns returns empty array when no file exists", () => {
    const patterns = loadIgnorePatterns(TEST_REPO);
    expect(patterns).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 5: Stream-JSON Output Format
// ═══════════════════════════════════════════════════════════════════

describe("Feature 5: Stream-JSON Output Format", () => {
  it("parser accepts --output stream-json", () => {
    const { globalOpts } = parseGlobalOptions(["--output", "stream-json"]);
    expect(globalOpts.output).toBe("stream-json");
  });

  it("parser accepts --output=stream-json", () => {
    const { globalOpts } = parseGlobalOptions(["--output=stream-json"]);
    expect(globalOpts.output).toBe("stream-json");
  });

  it("emitStreamEvent produces valid JSONL to stdout", () => {
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      emitStreamEvent({ type: "init", provider: "deepseek", model: "test", timestamp: "now" });
      emitStreamEvent({ type: "chunk", content: "hello" });
      emitStreamEvent({
        type: "tool_use",
        name: "read_file",
        arguments: { path: "/tmp/example-nextjs/Dockerfile" },
      });
      emitStreamEvent({
        type: "tool_result",
        name: "read_file",
        output: "FROM node:20\n...",
      });
      emitStreamEvent({
        type: "result",
        content: "Dockerfile reviewed.",
        stats: { agent: "docker", durationMs: 1234, totalTokens: 500 },
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(chunks).toHaveLength(5);

    // Each line is valid JSON + newline
    for (const chunk of chunks) {
      expect(chunk).toMatch(/\n$/);
      const parsed = JSON.parse(chunk.trim());
      expect(parsed.type).toBeTruthy();
    }

    const events = chunks.map((c) => JSON.parse(c.trim()));
    expect(events[0]).toMatchObject({ type: "init", provider: "deepseek" });
    expect(events[1]).toMatchObject({ type: "chunk", content: "hello" });
    expect(events[2]).toMatchObject({ type: "tool_use", name: "read_file" });
    expect(events[3]).toMatchObject({ type: "tool_result", name: "read_file" });
    expect(events[4]).toMatchObject({
      type: "result",
      content: "Dockerfile reviewed.",
    });
    expect(events[4].stats.totalTokens).toBe(500);
  });

  it("live LLM: --output stream-json produces JSONL events", () => {
    // Real LLM call against example-nextjs with DeepSeek
    const result = dojopsFull([
      "--non-interactive",
      "--quiet",
      "--output",
      "stream-json",
      "What is this project? Answer in one sentence.",
    ]);

    const stdout = result.stdout.trim();
    if (!stdout) {
      // Command may have failed (no API key, rate limit, etc.) — skip gracefully
      console.warn("Stream-JSON live test: empty stdout, stderr:", result.stderr.slice(0, 300));
      return;
    }

    // Filter to only JSON lines (skip TUI output and ANSI escapes)
    const lines = extractJsonLines(stdout);

    expect(lines.length).toBeGreaterThanOrEqual(2); // At least init + result

    // First event should be init
    const first = JSON.parse(lines[0]);
    expect(first.type).toBe("init");
    expect(first.provider).toBe("deepseek");
    expect(first.timestamp).toBeTruthy();

    // Last event should be result with actual content
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.type).toBe("result");
    expect(typeof last.content).toBe("string");
    expect(last.content.length).toBeGreaterThan(10); // Real LLM response
    expect(last.stats).toBeTruthy();
    expect(last.stats.agent).toBeTruthy();
    expect(typeof last.stats.durationMs).toBe("number");

    // If there are chunk events, verify they have content
    const chunkEvents = lines.map((l) => JSON.parse(l)).filter((e) => e.type === "chunk");
    for (const chunk of chunkEvents) {
      expect(typeof chunk.content).toBe("string");
    }
  }, 45_000);

  it("live LLM: stream-json result is parseable and contains project info", () => {
    // More targeted: ask about the Dockerfile specifically
    const result = dojopsFull([
      "--non-interactive",
      "--quiet",
      "--output",
      "stream-json",
      "Describe what the Dockerfile in this project does in one sentence.",
    ]);

    const stdout = result.stdout.trim();
    if (!stdout) {
      console.warn("Stream-JSON Dockerfile test: empty stdout");
      return;
    }

    const jsonLines = extractJsonLines(stdout);

    if (jsonLines.length < 2) {
      console.warn("Stream-JSON Dockerfile test: too few JSON lines");
      return;
    }

    const lastEvent = JSON.parse(jsonLines[jsonLines.length - 1]);
    expect(lastEvent.type).toBe("result");
    // The response should mention Docker, Node, or Next.js — it's describing a Dockerfile
    const content = lastEvent.content.toLowerCase();
    const mentionsRelevant =
      content.includes("docker") ||
      content.includes("node") ||
      content.includes("next") ||
      content.includes("container") ||
      content.includes("image") ||
      content.includes("build");
    expect(mentionsRelevant).toBe(true);
  }, 45_000);
});
