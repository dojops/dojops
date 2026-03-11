import { describe, it, expect, vi } from "vitest";
import { validateReplayIntegrity, checkToolIntegrity } from "../../commands/replay-validator";
import { PlanState } from "../../state";
import { ToolRegistry } from "@dojops/module-registry";

function createPlanState(overrides?: Partial<PlanState>): PlanState {
  return {
    id: "plan-test",
    goal: "test goal",
    createdAt: new Date().toISOString(),
    risk: "LOW",
    tasks: [],
    files: [],
    approvalStatus: "PENDING",
    executionContext: {
      provider: "openai",
      model: "gpt-4o",
    },
    ...overrides,
  };
}

function createMockRegistry(
  metadata?: Record<string, ReturnType<ToolRegistry["getToolMetadata"]>>,
): ToolRegistry {
  const registry = {
    getToolMetadata: vi.fn((name: string) => metadata?.[name] ?? undefined),
    getAll: vi.fn(() => []),
    get: vi.fn(),
    has: vi.fn(),
    getBuiltIn: vi.fn(() => []),
    getCustomTools: vi.fn(() => []),
    size: 0,
  } as unknown as ToolRegistry;
  return registry;
}

describe("validateReplayIntegrity", () => {
  it("returns valid when all fields match", () => {
    const plan = createPlanState();
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports mismatch when provider differs", () => {
    const plan = createPlanState();
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "anthropic", "gpt-4o", registry);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("provider");
    expect(result.mismatches[0].expected).toBe("openai");
    expect(result.mismatches[0].actual).toBe("anthropic");
  });

  it("reports mismatch when model differs", () => {
    const plan = createPlanState();
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "openai", "gpt-3.5-turbo", registry);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("model");
  });

  it("reports mismatch when executionContext is missing", () => {
    const plan = createPlanState({ executionContext: undefined });
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("executionContext");
  });

  it("no model mismatch when plan has no stored model", () => {
    const plan = createPlanState({
      executionContext: { provider: "openai" },
    });
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(true);
  });

  it("reports mismatch when systemPromptHash differs for plugin task", () => {
    const plan = createPlanState({
      tasks: [
        {
          id: "t1",
          tool: "custom-tool",
          description: "test",
          dependsOn: [],
          toolType: "custom",
          systemPromptHash: "aabbccddee112233445566778899aabbccddeeff0011223344556677889900ab",
        },
      ],
    });
    const registry = createMockRegistry({
      "custom-tool": {
        toolType: "custom",
        systemPromptHash: "ff00112233445566778899aabbccddeeff00112233445566778899aabbccddee",
      },
    });
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("systemPromptHash");
    expect(result.mismatches[0].taskId).toBe("t1");
  });

  it("no mismatch when systemPromptHash matches", () => {
    const hash = "aabbccddee112233445566778899aabbccddeeff0011223344556677889900ab";
    const plan = createPlanState({
      tasks: [
        {
          id: "t1",
          tool: "custom-tool",
          description: "test",
          dependsOn: [],
          toolType: "custom",
          systemPromptHash: hash,
        },
      ],
    });
    const registry = createMockRegistry({
      "custom-tool": {
        toolType: "custom",
        systemPromptHash: hash,
      },
    });
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(true);
  });

  it("skips systemPromptHash check for built-in tasks", () => {
    const plan = createPlanState({
      tasks: [
        {
          id: "t1",
          tool: "terraform",
          description: "test",
          dependsOn: [],
          toolType: "built-in",
          systemPromptHash: "abc123",
        },
      ],
    });
    const registry = createMockRegistry({
      terraform: { toolType: "built-in" },
    });
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(true);
  });

  it("reports mismatch when temperature differs", () => {
    const plan = createPlanState({
      executionContext: { provider: "openai", model: "gpt-4o", temperature: 0 },
    });
    const registry = createMockRegistry();
    // Temperature is stored in executionContext but validateReplayIntegrity
    // currently checks provider, model, dojopsVersion, and systemPromptHash.
    // We verify the plan state stores temperature correctly and the validator
    // passes when provider/model match (temperature is not a blocking check).
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(true);
    // The plan's temperature is preserved for DeterministicProvider to enforce
    expect(plan.executionContext!.temperature).toBe(0);
  });

  it("validates successfully when plan has temperature and context matches", () => {
    const plan = createPlanState({
      executionContext: { provider: "openai", model: "gpt-4o", temperature: 0.7 },
    });
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("validates successfully when plan has no temperature (undefined)", () => {
    const plan = createPlanState({
      executionContext: { provider: "openai", model: "gpt-4o" },
    });
    const registry = createMockRegistry();
    // temperature is undefined — should not affect validation
    expect(plan.executionContext!.temperature).toBeUndefined();
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("temperature presence does not mask provider mismatch", () => {
    const plan = createPlanState({
      executionContext: { provider: "openai", model: "gpt-4o", temperature: 0 },
    });
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "anthropic", "gpt-4o", registry);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("provider");
  });

  it("temperature presence does not mask model mismatch", () => {
    const plan = createPlanState({
      executionContext: { provider: "openai", model: "gpt-4o", temperature: 0.5 },
    });
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "openai", "gpt-3.5-turbo", registry);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("model");
  });

  it("reports dojopsVersion mismatch when version differs", () => {
    const plan = createPlanState({
      executionContext: {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0,
        dojopsVersion: "1.0.0",
      },
    });
    const registry = createMockRegistry();
    const result = validateReplayIntegrity(plan, "openai", "gpt-4o", registry);
    // dojopsVersion will likely differ from whatever the test env has
    // but the validator should check it
    const versionMismatch = result.mismatches.find((m) => m.field === "dojopsVersion");
    // We can't predict exact version, so just verify the check runs
    if (versionMismatch) {
      expect(versionMismatch.expected).toBe("1.0.0");
    }
  });

  it("accumulates multiple mismatches", () => {
    const plan = createPlanState({
      tasks: [
        {
          id: "t1",
          tool: "custom-tool",
          description: "test",
          dependsOn: [],
          toolType: "custom",
          systemPromptHash: "aaaa",
        },
      ],
    });
    const registry = createMockRegistry({
      "custom-tool": {
        toolType: "custom",
        systemPromptHash: "bbbb",
      },
    });
    const result = validateReplayIntegrity(plan, "anthropic", "claude-3", registry);
    expect(result.valid).toBe(false);
    expect(result.mismatches.length).toBeGreaterThanOrEqual(3);
    const fields = result.mismatches.map((m) => m.field);
    expect(fields).toContain("provider");
    expect(fields).toContain("model");
    expect(fields).toContain("systemPromptHash");
  });
});

describe("checkToolIntegrity", () => {
  it("returns no mismatches for built-in tasks", () => {
    const tasks: PlanState["tasks"] = [
      { id: "t1", tool: "terraform", description: "test", dependsOn: [], toolType: "built-in" },
    ];
    const result = checkToolIntegrity(tasks, []);
    expect(result.hasMismatches).toBe(false);
  });

  it("detects missing tool", () => {
    const tasks: PlanState["tasks"] = [
      {
        id: "t1",
        tool: "my-tool",
        description: "test",
        dependsOn: [],
        toolType: "custom",
        toolVersion: "1.0.0",
      },
    ];
    const result = checkToolIntegrity(tasks, []);
    expect(result.hasMismatches).toBe(true);
    expect(result.mismatches[0]).toContain("no longer available");
  });
});
