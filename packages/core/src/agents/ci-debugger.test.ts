import { describe, it, expect, vi } from "vitest";
import { CIDebugger, CIDiagnosis, CIDiagnosisSchema } from "./ci-debugger";
import { LLMProvider, LLMResponse } from "../llm/provider";

function mockProvider(diagnosis: CIDiagnosis): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(diagnosis),
      parsed: diagnosis,
    } satisfies LLMResponse),
  };
}

const buildFailureDiagnosis: CIDiagnosis = {
  errorType: "build",
  summary: "TypeScript compilation failed due to type error",
  rootCause: "Property 'foo' does not exist on type 'Bar'",
  suggestedFixes: [
    {
      description: "Add 'foo' property to the Bar interface",
      file: "src/types.ts",
      confidence: 0.9,
    },
  ],
  affectedFiles: ["src/types.ts", "src/main.ts"],
  confidence: 0.95,
};

const testFailureDiagnosis: CIDiagnosis = {
  errorType: "test",
  summary: "Unit test assertion failure in auth module",
  rootCause: "Expected token format changed after API update",
  suggestedFixes: [
    {
      description: "Update test assertion to match new token format",
      file: "src/auth.test.ts",
      confidence: 0.85,
    },
    {
      description: "Run tests with updated fixtures",
      command: "npm test -- --update-snapshots",
      confidence: 0.6,
    },
  ],
  affectedFiles: ["src/auth.test.ts"],
  confidence: 0.8,
};

describe("CIDebugger", () => {
  it("diagnoses a build failure from CI log", async () => {
    const provider = mockProvider(buildFailureDiagnosis);
    const debugger_ = new CIDebugger(provider);

    const result = await debugger_.diagnose(
      "ERROR: src/main.ts(5,3): error TS2339: Property 'foo' does not exist on type 'Bar'.",
    );

    expect(result.errorType).toBe("build");
    expect(result.rootCause).toContain("foo");
    expect(result.suggestedFixes).toHaveLength(1);
    expect(result.affectedFiles).toContain("src/types.ts");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("diagnoses a test failure", async () => {
    const provider = mockProvider(testFailureDiagnosis);
    const debugger_ = new CIDebugger(provider);

    const result = await debugger_.diagnose(
      "FAIL src/auth.test.ts\n  Expected: 'Bearer abc'\n  Received: 'Bearer xyz-v2'",
    );

    expect(result.errorType).toBe("test");
    expect(result.suggestedFixes.length).toBeGreaterThanOrEqual(1);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("passes schema to provider for structured output", async () => {
    const provider = mockProvider(buildFailureDiagnosis);
    const debugger_ = new CIDebugger(provider);

    await debugger_.diagnose("some log");

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: CIDiagnosisSchema,
      }),
    );
  });

  it("diagnoses multiple logs sequentially", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify(buildFailureDiagnosis),
          parsed: buildFailureDiagnosis,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(testFailureDiagnosis),
          parsed: testFailureDiagnosis,
        }),
    };
    const debugger_ = new CIDebugger(provider);

    const results = await debugger_.diagnoseMultiple([
      { name: "build", content: "build log" },
      { name: "test", content: "test log" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("build");
    expect(results[0].diagnosis.errorType).toBe("build");
    expect(results[1].name).toBe("test");
    expect(results[1].diagnosis.errorType).toBe("test");
  });

  it("falls back to parsing content when parsed is not set", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify(buildFailureDiagnosis),
      }),
    };
    const debugger_ = new CIDebugger(provider);

    const result = await debugger_.diagnose("error log");

    expect(result.errorType).toBe("build");
    expect(result.confidence).toBe(0.95);
  });
});

describe("CIDebugger.diagnoseMultiple edge cases", () => {
  it("handles empty logs array", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify(buildFailureDiagnosis),
        parsed: buildFailureDiagnosis,
      }),
    };
    const debugger_ = new CIDebugger(provider);

    const results = await debugger_.diagnoseMultiple([]);

    expect(results).toEqual([]);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("processes logs in correct chunk sizes", async () => {
    // diagnoseMultiple processes in chunks of 3 (CONCURRENCY = 3)
    // With 7 logs, expect 3 chunks: [0,1,2], [3,4,5], [6]
    const diagnosisVariants: CIDiagnosis[] = Array.from({ length: 7 }, (_, i) => ({
      errorType: "build" as const,
      summary: `Failure ${i}`,
      rootCause: `Root cause ${i}`,
      suggestedFixes: [],
      affectedFiles: [],
      confidence: 0.9,
    }));

    let callIndex = 0;
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockImplementation(() => {
        const diagnosis = diagnosisVariants[callIndex++];
        return Promise.resolve({
          content: JSON.stringify(diagnosis),
          parsed: diagnosis,
        });
      }),
    };
    const debugger_ = new CIDebugger(provider);

    const logs = Array.from({ length: 7 }, (_, i) => ({
      name: `log-${i}`,
      content: `error log ${i}`,
    }));

    const results = await debugger_.diagnoseMultiple(logs);

    expect(results).toHaveLength(7);
    expect(provider.generate).toHaveBeenCalledTimes(7);
    // Verify all logs were processed and results are in order
    for (let i = 0; i < 7; i++) {
      expect(results[i].name).toBe(`log-${i}`);
      expect(results[i].diagnosis.summary).toBe(`Failure ${i}`);
    }
  });

  it("returns partial results when one log in a chunk throws", async () => {
    // Promise.allSettled preserves partial results from the chunk (A11)
    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error("LLM provider rate limited"));
        }
        return Promise.resolve({
          content: JSON.stringify(buildFailureDiagnosis),
          parsed: buildFailureDiagnosis,
        });
      }),
    };
    const debugger_ = new CIDebugger(provider);

    const logs = [
      { name: "log-0", content: "error 0" },
      { name: "log-1", content: "error 1" },
      { name: "log-2", content: "error 2" },
    ];

    // All three logs are in the same chunk (CONCURRENCY = 3),
    // Promise.allSettled keeps the 2 successful results
    const results = await debugger_.diagnoseMultiple(logs);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("log-0");
    expect(results[1].name).toBe("log-2");
  });
});
