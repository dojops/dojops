import { describe, it, expect, vi } from "vitest";
import { CoordinatorAgent } from "../coordinator-agent";
import type { LLMProvider, LLMToolResponse, ToolCall } from "@dojops/core";

function makeProvider(responses: LLMToolResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "test",
    generate: vi.fn(async () => ({ content: "unused" })),
    generateWithTools: vi.fn(async () => {
      const resp = responses[callIndex] ?? {
        content: "done",
        toolCalls: [],
        stopReason: "end_turn" as const,
      };
      callIndex++;
      return { stopReason: "end_turn" as const, toolCalls: [], ...resp };
    }),
  };
}

function makeToolExecutor() {
  return {
    execute: vi.fn(async (call: ToolCall) => ({
      callId: call.id ?? "tc-1",
      output: `result for ${call.name}`,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("CoordinatorAgent", () => {
  describe("run", () => {
    it("spawns workers and synthesizes results", async () => {
      // Coordinator and workers share the same mock provider.
      // Response order: coordinator spawn → worker1 → worker2 → coordinator check → coordinator synthesize
      const provider = makeProvider([
        // 1. Coordinator spawns two workers
        {
          content: "I'll break this into two tasks.",
          toolCalls: [
            {
              id: "tc-1",
              name: "spawn_worker",
              arguments: {
                task_id: "worker-1",
                description: "Create Terraform config",
              },
            },
            {
              id: "tc-2",
              name: "spawn_worker",
              arguments: {
                task_id: "worker-2",
                description: "Create Kubernetes manifest",
                depends_on: [],
              },
            },
          ],
        },
        // 2. Worker 1 runs (no tool calls → completes immediately)
        { content: "Terraform config created.", toolCalls: [], stopReason: "end_turn" as const },
        // 3. Worker 2 runs (no tool calls → completes immediately)
        { content: "K8s manifest created.", toolCalls: [], stopReason: "end_turn" as const },
        // 4. Coordinator checks workers
        {
          content: "Let me check progress.",
          toolCalls: [
            {
              id: "tc-3",
              name: "check_workers",
              arguments: {},
            },
          ],
        },
        // 5. Coordinator synthesizes
        {
          content: "All done.",
          toolCalls: [
            {
              id: "tc-4",
              name: "synthesize",
              arguments: {
                summary: "Created Terraform config and Kubernetes manifest successfully.",
              },
            },
          ],
        },
      ]);

      const coordinator = new CoordinatorAgent({
        provider,
        toolExecutor: makeToolExecutor(),
        tools: [],
        maxIterations: 5,
      });

      const result = await coordinator.run("Create infrastructure for a web app");

      expect(result.success).toBe(true);
      expect(result.summary).toContain("Created Terraform config");
      expect(result.workers).toHaveLength(2);
      expect(result.iterations).toBeLessThanOrEqual(5);
    });

    it("handles worker dependencies", async () => {
      // Response order: coordinator spawn → setup worker → coordinator check → deploy worker → coordinator synthesize
      const provider = makeProvider([
        // 1. Coordinator spawns two workers (deploy depends on setup)
        {
          content: "Sequential tasks.",
          toolCalls: [
            {
              id: "tc-1",
              name: "spawn_worker",
              arguments: {
                task_id: "setup",
                description: "Set up project",
              },
            },
            {
              id: "tc-2",
              name: "spawn_worker",
              arguments: {
                task_id: "deploy",
                description: "Deploy to staging",
                depends_on: ["setup"],
              },
            },
          ],
        },
        // 2. Setup worker runs (no deps, ready immediately)
        { content: "Project set up.", toolCalls: [], stopReason: "end_turn" as const },
        // 3. Coordinator checks workers (deploy now unblocked after setup completed)
        {
          content: "Checking.",
          toolCalls: [{ id: "tc-3", name: "check_workers", arguments: {} }],
        },
        // 4. Deploy worker runs (setup is completed, dep satisfied)
        { content: "Deployed to staging.", toolCalls: [], stopReason: "end_turn" as const },
        // 5. Coordinator synthesizes
        {
          content: "Done.",
          toolCalls: [
            {
              id: "tc-4",
              name: "synthesize",
              arguments: { summary: "Setup and deploy complete." },
            },
          ],
        },
      ]);

      const coordinator = new CoordinatorAgent({
        provider,
        toolExecutor: makeToolExecutor(),
        tools: [],
      });

      const result = await coordinator.run("Set up and deploy");

      expect(result.success).toBe(true);
      expect(result.workers.find((w) => w.id === "setup")).toBeDefined();
      expect(result.workers.find((w) => w.id === "deploy")).toBeDefined();
    });

    it("returns fallback summary when synthesize is not called", async () => {
      const provider = makeProvider([
        // LLM just talks without calling synthesize
        { content: "I'm not sure what to do." },
      ]);

      const coordinator = new CoordinatorAgent({
        provider,
        toolExecutor: makeToolExecutor(),
        tools: [],
        maxIterations: 2,
      });

      const result = await coordinator.run("Do something complex");

      expect(result.success).toBe(false);
      expect(result.summary).toContain("No workers completed");
    });

    it("prevents duplicate worker IDs", async () => {
      const provider = makeProvider([
        {
          content: "Spawning workers.",
          toolCalls: [
            {
              id: "tc-1",
              name: "spawn_worker",
              arguments: { task_id: "w1", description: "Task A" },
            },
            {
              id: "tc-2",
              name: "spawn_worker",
              arguments: { task_id: "w1", description: "Task B (duplicate)" },
            },
          ],
        },
        { content: "Done." },
      ]);

      const coordinator = new CoordinatorAgent({
        provider,
        toolExecutor: makeToolExecutor(),
        tools: [],
      });

      const result = await coordinator.run("Test duplicates");
      // Only one worker should exist
      expect(result.workers).toHaveLength(1);
    });

    it("sends messages to workers", async () => {
      // Response order: coordinator spawn+message → worker runs → coordinator synthesize
      const provider = makeProvider([
        // 1. Coordinator spawns worker and sends message
        {
          content: "Spawn and message.",
          toolCalls: [
            {
              id: "tc-1",
              name: "spawn_worker",
              arguments: { task_id: "w1", description: "Worker 1" },
            },
            {
              id: "tc-2",
              name: "send_message",
              arguments: { to: "w1", message: "Use TypeScript strict mode" },
            },
          ],
        },
        // 2. Worker runs
        { content: "Worker done.", toolCalls: [], stopReason: "end_turn" as const },
        // 3. Coordinator synthesizes
        {
          content: "Synthesize.",
          toolCalls: [
            {
              id: "tc-3",
              name: "synthesize",
              arguments: { summary: "Done with message." },
            },
          ],
        },
      ]);

      const coordinator = new CoordinatorAgent({
        provider,
        toolExecutor: makeToolExecutor(),
        tools: [],
      });

      const result = await coordinator.run("Test messaging");
      expect(result.success).toBe(true);
    });
  });
});
