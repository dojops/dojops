import { describe, it, expect, vi } from "vitest";
import { SpecialistAgent, SpecialistConfig, AgenticToolExecutor } from "../../agents/specialist";
import { AgentRouter } from "../../agents/router";
import { ALL_SPECIALIST_CONFIGS } from "../../agents/specialists";
import { LLMProvider, LLMResponse } from "../../llm/provider";
import { ToolDependency } from "../../agents/tool-deps";
import { AGENT_TOOLS } from "../../llm/tool-defs";
import type { LLMToolResponse, ToolCall, ToolResult } from "../../llm/tool-types";

function mockProvider(response: string): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: response,
      model: "mock-model",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    } satisfies LLMResponse),
  };
}

/** Create a default AgentRouter with a mock provider. */
function createRouter(configs?: SpecialistConfig[]): AgentRouter {
  return new AgentRouter(mockProvider("ok"), configs);
}

/** Route a prompt through a default router and assert the expected domain with positive confidence. */
function expectRouteToDomain(prompt: string, expectedDomain: string): void {
  const router = createRouter();
  const result = router.route(prompt);
  expect(result.agent.domain).toBe(expectedDomain);
  expect(result.confidence).toBeGreaterThan(0);
}

const testConfig: SpecialistConfig = {
  name: "test-specialist",
  domain: "testing",
  description: "A test specialist for unit tests",
  systemPrompt: "You are a test specialist.",
  keywords: ["test", "unit", "integration"],
};

describe("SpecialistAgent", () => {
  it("exposes config properties", () => {
    const provider = mockProvider("ok");
    const agent = new SpecialistAgent(provider, testConfig);

    expect(agent.name).toBe("test-specialist");
    expect(agent.domain).toBe("testing");
    expect(agent.description).toBe("A test specialist for unit tests");
    expect(agent.keywords).toEqual(["test", "unit", "integration"]);
  });

  it("returns undefined description when not set", () => {
    const provider = mockProvider("ok");
    const config: SpecialistConfig = {
      name: "no-desc",
      domain: "testing",
      systemPrompt: "Test.",
      keywords: ["test"],
    };
    const agent = new SpecialistAgent(provider, config);
    expect(agent.description).toBeUndefined();
  });

  it("returns toolDependencies from config", () => {
    const deps: ToolDependency[] = [
      {
        name: "ShellCheck",
        npmPackage: "shellcheck",
        binary: "shellcheck",
        description: "Linter",
        required: false,
      },
    ];
    const provider = mockProvider("ok");
    const agent = new SpecialistAgent(provider, { ...testConfig, toolDependencies: deps });
    expect(agent.toolDependencies).toEqual(deps);
  });

  it("returns empty array when toolDependencies is absent", () => {
    const provider = mockProvider("ok");
    const agent = new SpecialistAgent(provider, testConfig);
    expect(agent.toolDependencies).toEqual([]);
  });

  it("delegates to provider with config systemPrompt", async () => {
    const provider = mockProvider("result");
    const agent = new SpecialistAgent(provider, testConfig);

    const result = await agent.run({ prompt: "run tests" });

    expect(provider.generate).toHaveBeenCalledWith({
      prompt: "run tests",
      system: "You are a test specialist.",
    });
    expect(result.content).toBe("result");
  });
});

describe("AgentRouter", () => {
  it("routes to the correct specialist by keyword match", () => {
    const router = createRouter();
    const result = router.route("Deploy a terraform infrastructure stack");
    expect(result.agent.domain).toBe("infrastructure");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reason).toContain("terraform");
  });

  it("routes kubernetes-related prompts to container-orchestration specialist", () => {
    const router = createRouter();
    const result = router.route("Create a kubernetes deployment with 3 pods");
    expect(result.agent.domain).toBe("container-orchestration");
    expect(result.reason).toContain("kubernetes");
  });

  it("routes CI/CD prompts to cicd specialist", () => {
    const router = createRouter();
    const result = router.route("Set up a CI pipeline with github actions");
    expect(result.agent.domain).toBe("ci-cd");
  });

  it("routes security prompts to security auditor", () => {
    const router = createRouter();
    const result = router.route("Run a security audit and vulnerability scan");
    expect(result.agent.domain).toBe("security");
  });

  it("falls back to OpsCortex when no keywords match", () => {
    const router = createRouter();
    const result = router.route("Do something completely unrelated to anything");
    expect(result.agent.domain).toBe("orchestration");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("ops-cortex");
  });

  it("picks the highest-confidence match when multiple specialists match", () => {
    const router = createRouter();
    // "security scan" matches security specialist strongly
    const result = router.route("security vulnerability scan audit compliance");
    expect(result.agent.domain).toBe("security");
  });

  it("returns all agents via getAgents()", () => {
    const router = createRouter();
    const agents = router.getAgents();
    expect(agents).toHaveLength(ALL_SPECIALIST_CONFIGS.length);
    expect(agents.map((a) => a.domain)).toContain("orchestration");
    expect(agents.map((a) => a.domain)).toContain("infrastructure");
    expect(agents.map((a) => a.domain)).toContain("container-orchestration");
  });

  it("accepts custom configs", () => {
    const router = createRouter([testConfig]);
    const agents = router.getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("test-specialist");
  });

  // --- New agent routing tests ---

  it("routes observability prompts to observability specialist", () => {
    expectRouteToDomain("Set up prometheus monitoring with grafana dashboards", "observability");
  });

  it("routes docker prompts to containerization specialist", () => {
    expectRouteToDomain(
      "Create a multi-stage dockerfile with alpine base image",
      "containerization",
    );
  });

  it("routes cloud architecture prompts to cloud-architect", () => {
    expectRouteToDomain("Design a serverless lambda architecture on aws", "cloud-architecture");
  });

  it("routes networking prompts to network specialist", () => {
    expectRouteToDomain("Configure dns with route53 and set up a load balancer", "networking");
  });

  it("routes database prompts to database specialist", () => {
    expectRouteToDomain("Set up postgres replication with redis cache", "data-storage");
  });

  it("routes gitops prompts to gitops specialist", () => {
    expectRouteToDomain("Set up argocd with flux for gitops reconciliation", "gitops");
  });

  it("routes compliance prompts to compliance auditor", () => {
    expectRouteToDomain("Audit our infrastructure for soc2 and hipaa compliance", "compliance");
  });

  it("routes CI debugging prompts to ci-debugger specialist", () => {
    expectRouteToDomain("Debug this error: build failed with exit code 1", "ci-debugging");
  });

  it("routes appsec prompts to application-security specialist", () => {
    expectRouteToDomain(
      "Run owasp sast code review to find xss and injection vulnerabilities",
      "application-security",
    );
  });

  it("routes shell scripting prompts to shell-scripting specialist", () => {
    expectRouteToDomain(
      "Write a bash shell script with shellcheck and pipefail",
      "shell-scripting",
    );
  });

  it("routes python prompts to python-scripting specialist", () => {
    expectRouteToDomain(
      "Create a python script with pytest tests and mypy types",
      "python-scripting",
    );
  });

  it("routes to custom agent by keyword match", () => {
    const customConfig: SpecialistConfig = {
      name: "sre-specialist",
      domain: "site-reliability",
      systemPrompt: "You are an SRE specialist.",
      keywords: ["sre", "incident", "reliability", "error budget", "postmortem"],
    };
    const router = createRouter([...ALL_SPECIALIST_CONFIGS, customConfig]);

    const result = router.route("How to set up error budget tracking for SRE incident response");
    expect(result.agent.name).toBe("sre-specialist");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("custom agent can override built-in by name", () => {
    const overrideConfig: SpecialistConfig = {
      name: "terraform-specialist",
      domain: "custom-infra",
      systemPrompt: "You are a custom terraform specialist.",
      keywords: ["terraform", "custom-infra"],
    };
    // Place override last so it replaces the built-in in the map
    const configs = ALL_SPECIALIST_CONFIGS.filter((c) => c.name !== "terraform-specialist");
    configs.push(overrideConfig);
    const router = createRouter(configs);

    const tfAgent = router.getAgents().find((a) => a.name === "terraform-specialist");
    expect(tfAgent).toBeDefined();
    expect(tfAgent!.domain).toBe("custom-infra");
  });

  it("mixes custom and built-in agents in getAgents()", () => {
    const customConfig: SpecialistConfig = {
      name: "custom-agent",
      domain: "custom",
      systemPrompt: "Custom agent.",
      keywords: ["custom"],
    };
    const router = createRouter([...ALL_SPECIALIST_CONFIGS, customConfig]);

    const agents = router.getAgents();
    expect(agents.length).toBe(ALL_SPECIALIST_CONFIGS.length + 1);
    expect(agents.map((a) => a.name)).toContain("custom-agent");
    expect(agents.map((a) => a.name)).toContain("ops-cortex");
  });
});

describe("AgentRouter edge cases", () => {
  const minimalConfigs: SpecialistConfig[] = [
    {
      name: "test-orchestrator",
      domain: "orchestration",
      description: "Orchestrator",
      systemPrompt: "You orchestrate.",
      keywords: ["orchestrate", "manage"],
    },
    {
      name: "test-terraform",
      domain: "terraform",
      description: "Terraform",
      systemPrompt: "You do terraform.",
      keywords: ["terraform", "hcl", "infrastructure"],
    },
    {
      name: "test-kubernetes",
      domain: "kubernetes",
      description: "K8s",
      systemPrompt: "You do k8s.",
      keywords: ["kubernetes", "k8s", "pod", "deployment"],
    },
  ];

  it("routes to fallback with confidence 0 when no keywords match", () => {
    const router = createRouter(minimalConfigs);
    const result = router.route("hello world zzz qqq");

    expect(result.agent.domain).toBe("orchestration");
    expect(result.agent.name).toBe("test-orchestrator");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("No domain match");
    expect(result.reason).toContain("test-orchestrator");
  });

  it("routes to fallback on low confidence match", () => {
    const router = createRouter(minimalConfigs);

    // Only "hcl" matches from terraform's keywords ["terraform", "hcl", "infrastructure"]
    // matchedKeywords.length = 1, matchRatio = 1/3
    // confidence = 1 * 0.3 + (1/3) * 0.1 = ~0.333 which is < 0.4
    const result = router.route("write some hcl code please");

    expect(result.confidence).toBeLessThan(0.4);
    expect(result.agent.domain).toBe("orchestration");
    expect(result.reason).toContain("Low confidence");
    expect(result.reason).toContain("hcl");
  });

  it("routes to fallback on multi-domain ambiguity", () => {
    const router = createRouter(minimalConfigs);

    // "terraform" + "hcl" match terraform (2 of 3 keywords): confidence = 2*0.3 + (2/3)*0.1 = ~0.667
    // "kubernetes" + "deployment" match kubernetes (2 of 4 keywords): confidence = 2*0.3 + (2/4)*0.1 = 0.65
    // Difference: 0.667 - 0.65 = 0.017 < 0.1, different domains -> ambiguity
    const result = router.route("terraform kubernetes deployment hcl");

    expect(result.agent.domain).toBe("orchestration");
    expect(result.reason).toContain("Ambiguous");
    expect(result.reason).toContain("test-terraform");
    expect(result.reason).toContain("test-kubernetes");
  });

  it("routes to correct agent on clear match", () => {
    const router = createRouter(minimalConfigs);

    // "terraform", "infrastructure", "hcl" all match terraform (3 of 3 keywords)
    // confidence = 3*0.3 + (3/3)*0.1 = 1.0 — clear winner, no other agent matches closely
    const result = router.route("deploy terraform infrastructure with hcl");

    expect(result.agent.domain).toBe("terraform");
    expect(result.agent.name).toBe("test-terraform");
    expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    expect(result.reason).toContain("terraform");
  });

  it("throws when no agents configured", () => {
    expect(() => {
      const router = createRouter([]);
      router.route("anything");
    }).toThrow("AgentRouter has no agents configured");
  });
});

describe("Primary keywords boost", () => {
  const configs: SpecialistConfig[] = [
    {
      name: "fallback",
      domain: "orchestration",
      systemPrompt: "Orchestrator.",
      keywords: ["orchestrate"],
    },
    {
      name: "infra-agent",
      domain: "infrastructure",
      systemPrompt: "Infra.",
      keywords: ["terraform", "hcl", "infrastructure", "provider", "module"],
      primaryKeywords: ["terraform", "hcl"],
    },
    {
      name: "k8s-agent",
      domain: "container-orchestration",
      systemPrompt: "K8s.",
      keywords: ["kubernetes", "k8s", "helm", "pod", "deployment"],
      primaryKeywords: ["kubernetes", "k8s"],
    },
  ];

  it("boosts confidence when primary keyword matches", () => {
    const router = createRouter(configs);
    // "terraform hcl" matches 2/5 keywords, both are primary
    // base = 2*0.25 + (2/max(5,10))*0.25 = 0.5 + 0.05 = 0.55
    // primaryBonus = 2 * 0.1 = 0.2
    // total = 0.75
    const result = router.route("terraform hcl query");
    expect(result.confidence).toBeCloseTo(0.75, 4);
    expect(result.agent.domain).toBe("infrastructure");
  });

  it("no boost when matched keywords are not primary", () => {
    const router = createRouter(configs);
    // "infrastructure module" matches 2/5 keywords, none primary, denominator capped at 10
    // base = 2*0.25 + (2/10)*0.25 = 0.55
    // primaryBonus = 0
    const result = router.route("infrastructure module query");
    expect(result.confidence).toBeCloseTo(0.55, 4);
  });

  it("unchanged behavior with no primaryKeywords defined", () => {
    const noPrimaryConfigs: SpecialistConfig[] = [
      {
        name: "fallback",
        domain: "orchestration",
        systemPrompt: "Orchestrator.",
        keywords: ["orchestrate"],
      },
      {
        name: "plain-agent",
        domain: "testing",
        systemPrompt: "Test.",
        keywords: ["alpha", "beta", "gamma"],
      },
    ];
    const router = createRouter(noPrimaryConfigs);
    // "alpha beta" matches 2/3, no primaryKeywords, denominator capped at 10
    // base = 2*0.25 + (2/10)*0.25 = 0.5 + 0.05 = 0.55
    const result = router.route("alpha beta query");
    expect(result.confidence).toBeCloseTo(0.55, 3);
  });
});

describe("Project context biased routing", () => {
  const configs: SpecialistConfig[] = [
    {
      name: "fallback",
      domain: "orchestration",
      systemPrompt: "Orchestrator.",
      keywords: ["orchestrate"],
    },
    {
      name: "infra-agent",
      domain: "infrastructure",
      systemPrompt: "Infra.",
      keywords: ["terraform", "hcl", "infrastructure", "provider", "module"],
    },
    {
      name: "k8s-agent",
      domain: "container-orchestration",
      systemPrompt: "K8s.",
      keywords: ["kubernetes", "k8s", "helm", "pod", "deployment"],
    },
  ];

  it("boosts confidence when agent domain matches project domains", () => {
    const router = createRouter(configs);
    // Without context: "infrastructure module" → 2*0.25 + (2/5)*0.25 = 0.6
    const noCtx = router.route("infrastructure module query");
    // With context: +0.15 boost
    const withCtx = router.route("infrastructure module query", {
      projectDomains: ["infrastructure"],
    });
    expect(withCtx.confidence - noCtx.confidence).toBeCloseTo(0.15, 4);
  });

  it("no boost when project domains do not match agent domain", () => {
    const router = createRouter(configs);
    const noCtx = router.route("terraform hcl query");
    const withCtx = router.route("terraform hcl query", {
      projectDomains: ["container-orchestration"],
    });
    expect(withCtx.confidence).toBeCloseTo(noCtx.confidence, 4);
  });

  it("empty projectDomains produces same result as no options", () => {
    const router = createRouter(configs);
    const noOpts = router.route("kubernetes k8s query");
    const emptyOpts = router.route("kubernetes k8s query", { projectDomains: [] });
    expect(emptyOpts.confidence).toBe(noOpts.confidence);
  });
});

describe("SpecialistAgent retry and timeout", () => {
  it("retries once on transient error", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "retry-mock",
      generate: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("ECONNRESET"));
        }
        return Promise.resolve({
          content: "success",
          model: "mock",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        });
      }),
    };
    const agent = new SpecialistAgent(provider, {
      name: "test",
      domain: "test",
      systemPrompt: "Test.",
      keywords: ["test"],
    });

    const result = await agent.run({ prompt: "hello" });
    expect(result.content).toBe("success");
    expect(callCount).toBe(2);
  });

  it("does not retry on non-transient error", async () => {
    const provider: LLMProvider = {
      name: "fail-mock",
      generate: vi.fn().mockRejectedValue(new Error("Invalid API key")),
    };
    const agent = new SpecialistAgent(provider, {
      name: "test",
      domain: "test",
      systemPrompt: "Test.",
      keywords: ["test"],
    });

    await expect(agent.run({ prompt: "hello" })).rejects.toThrow("Invalid API key");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("times out when provider is too slow", async () => {
    const provider: LLMProvider = {
      name: "slow-mock",
      generate: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  content: "late",
                  model: "mock",
                  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                }),
              5000,
            ),
          ),
      ),
    };
    const agent = new SpecialistAgent(provider, {
      name: "test",
      domain: "test",
      systemPrompt: "Test.",
      keywords: ["test"],
    });

    await expect(agent.run({ prompt: "hello" }, { timeoutMs: 100 })).rejects.toThrow("timed out");
  });
});

describe("SpecialistAgent.runAgentic", () => {
  function mockToolExecutor(results?: Map<string, string>): AgenticToolExecutor {
    const filesWritten: string[] = [];
    const filesModified: string[] = [];
    return {
      execute: vi.fn().mockImplementation(async (call: ToolCall): Promise<ToolResult> => {
        if (call.name === "write_file") filesWritten.push(call.arguments.path as string);
        if (call.name === "edit_file") filesModified.push(call.arguments.path as string);
        const output = results?.get(call.name) ?? `Executed ${call.name}`;
        return { callId: call.id, output, isError: false };
      }),
      getFilesWritten: () => filesWritten,
      getFilesModified: () => filesModified,
    };
  }

  function mockToolCallingProvider(responses: LLMToolResponse[]): LLMProvider {
    let callIndex = 0;
    return {
      name: "mock-tool-provider",
      generate: vi.fn().mockResolvedValue({
        content: "",
        model: "mock",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
      generateWithTools: vi.fn().mockImplementation(async () => {
        const resp = responses[callIndex] ?? responses[responses.length - 1];
        callIndex++;
        return resp;
      }),
    };
  }

  it("completes when LLM calls the done tool", async () => {
    const provider = mockToolCallingProvider([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "main.tf" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      {
        content: "",
        toolCalls: [
          { id: "c2", name: "done", arguments: { summary: "Read the file successfully" } },
        ],
        stopReason: "end_turn",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Read main.tf", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("Read the file successfully");
    expect(result.toolCalls).toHaveLength(2); // read_file + done
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[1].name).toBe("done");
  });

  it("completes when LLM returns end_turn with no tool calls after work", async () => {
    const provider = mockToolCallingProvider([
      {
        content: "",
        toolCalls: [
          { id: "c1", name: "write_file", arguments: { path: "out.tf", content: "resource {}" } },
        ],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      {
        content: "Generated Terraform config.",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Create terraform", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("Generated Terraform config.");
    expect(result.filesWritten).toEqual(["out.tf"]);
  });

  it("stops at max iterations", async () => {
    // Provider always returns a tool call, never done
    const provider = mockToolCallingProvider([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.txt" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
      {
        content: "",
        toolCalls: [{ id: "c2", name: "read_file", arguments: { path: "b.txt" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
      {
        content: "",
        toolCalls: [{ id: "c3", name: "read_file", arguments: { path: "c.txt" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Keep reading", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
      maxIterations: 3,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("maximum iterations");
  });

  it("stops at token budget", async () => {
    const provider = mockToolCallingProvider([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.txt" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 500, completionTokens: 500, totalTokens: 1000 },
      },
    ]);

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Expensive task", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
      maxTotalTokens: 500, // Below the 1000 from first call
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("token budget exhausted");
    expect(result.totalTokens).toBe(1000);
  });

  it("terminates on stale loop (identical tool calls)", async () => {
    const sameCall: LLMToolResponse = {
      content: "",
      toolCalls: [{ id: "cx", name: "read_file", arguments: { path: "same.txt" } }],
      stopReason: "tool_use",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
    const provider = mockToolCallingProvider([sameCall, sameCall, sameCall, sameCall]);

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Stuck task", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
      maxIterations: 10,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("stuck in loop");
  });

  it("fires onToolCall and onToolResult callbacks", async () => {
    const provider = mockToolCallingProvider([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "search_files", arguments: { pattern: "*.tf" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
      {
        content: "",
        toolCalls: [{ id: "c2", name: "done", arguments: { summary: "Found files" } }],
        stopReason: "end_turn",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const toolCallSpy = vi.fn();
    const toolResultSpy = vi.fn();
    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);

    await agent.runAgentic("Find terraform files", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
      onToolCall: toolCallSpy,
      onToolResult: toolResultSpy,
    });

    expect(toolCallSpy).toHaveBeenCalledOnce();
    expect(toolCallSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "search_files" }));
    expect(toolResultSpy).toHaveBeenCalledOnce();
  });

  it("uses prompt-based fallback when generateWithTools is unavailable", async () => {
    // Provider without generateWithTools — only generate
    const provider: LLMProvider = {
      name: "basic-mock",
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: '{"tool_calls":[{"name":"read_file","arguments":{"path":"test.txt"}}]}',
          model: "mock",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        })
        .mockResolvedValueOnce({
          content: '{"tool_calls":[{"name":"done","arguments":{"summary":"Done via fallback"}}]}',
          model: "mock",
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        }),
    };

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Test fallback", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("Done via fallback");
    // The generate call should have the augmented system prompt with tool descriptions
    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toContain("Available Tools");
  });

  it("nudges agent when first iteration has no tool calls", async () => {
    const provider = mockToolCallingProvider([
      {
        content: "Let me think about this...",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      {
        content: "",
        toolCalls: [{ id: "c1", name: "done", arguments: { summary: "Done after nudge" } }],
        stopReason: "end_turn",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Do something", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("Done after nudge");
    // generateWithTools called twice (once for initial, once after nudge)
    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
  });

  it("tracks files written and modified", async () => {
    const provider = mockToolCallingProvider([
      {
        content: "",
        toolCalls: [
          { id: "c1", name: "write_file", arguments: { path: "new.tf", content: "resource {}" } },
        ],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      {
        content: "",
        toolCalls: [
          {
            id: "c2",
            name: "edit_file",
            arguments: { path: "existing.tf", old_string: "old", new_string: "new" },
          },
        ],
        stopReason: "tool_use",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
      {
        content: "",
        toolCalls: [{ id: "c3", name: "done", arguments: { summary: "Created and edited" } }],
        stopReason: "end_turn",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const executor = mockToolExecutor();
    const agent = new SpecialistAgent(provider, testConfig);
    const result = await agent.runAgentic("Create and edit", {
      toolExecutor: executor,
      tools: AGENT_TOOLS,
    });

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual(["new.tf"]);
    expect(result.filesModified).toEqual(["existing.tf"]);
  });
});

describe("SpecialistAgent message sanitization", () => {
  it("filters out oversized messages in runWithHistory", async () => {
    const provider = mockProvider("ok");
    const agent = new SpecialistAgent(provider, {
      name: "test",
      domain: "test",
      systemPrompt: "Test.",
      keywords: ["test"],
    });

    const hugeContent = "x".repeat(200 * 1024); // 200KB > 128KB limit
    await agent.runWithHistory([
      { role: "user", content: "hello" },
      { role: "assistant", content: hugeContent },
      { role: "user", content: "follow up" },
    ]);

    // The oversized message should be filtered out
    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages).toHaveLength(2); // Only the 2 non-oversized messages
    expect(call.messages[0].content).toBe("hello");
    expect(call.messages[1].content).toBe("follow up");
  });
});
