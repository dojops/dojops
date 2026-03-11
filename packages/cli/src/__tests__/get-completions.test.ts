import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleGetCompletions } from "../completions/get-completions";

describe("handleGetCompletions", () => {
  let output: string[];
  let exitCode: number | undefined;

  beforeEach(() => {
    output = [];
    exitCode = undefined;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output.push(chunk.toString());
      return true;
    });
    vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns provider names for 'providers'", () => {
    try {
      handleGetCompletions("providers");
    } catch {
      /* exit mock */
    }
    const result = output.join("");
    expect(result).toContain("openai");
    expect(result).toContain("anthropic");
    expect(result).toContain("ollama");
    expect(result).toContain("deepseek");
    expect(result).toContain("gemini");
    expect(result).toContain("github-copilot");
    expect(exitCode).toBe(0);
  });

  it("returns module names for 'modules'", () => {
    try {
      handleGetCompletions("modules");
    } catch {
      /* exit mock */
    }
    const result = output.join("");
    expect(result).toContain("github-actions");
    expect(result).toContain("terraform");
    expect(result).toContain("k8s");
    expect(exitCode).toBe(0);
  });

  it("returns agent names for 'agents'", () => {
    try {
      handleGetCompletions("agents");
    } catch {
      /* exit mock */
    }
    const result = output.join("");
    // Should contain at least one built-in agent name
    expect(result.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  });

  it("returns nothing for unknown type", () => {
    try {
      handleGetCompletions("unknown");
    } catch {
      /* exit mock */
    }
    expect(output.join("")).toBe("");
    expect(exitCode).toBe(0);
  });
});
