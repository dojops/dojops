import { describe, it, expect } from "vitest";
import { AgentCoordinator } from "../coordinator";
import { ResultAggregator } from "../aggregator";

describe("AgentCoordinator", () => {
  describe("shared context", () => {
    it("set and get store and retrieve values", () => {
      const coord = new AgentCoordinator();
      coord.set("naming-convention", "kebab-case", "t1");

      expect(coord.get("naming-convention")).toBe("kebab-case");
    });

    it("get returns undefined for unknown keys", () => {
      const coord = new AgentCoordinator();
      expect(coord.get("nonexistent")).toBeUndefined();
    });

    it("getAll returns all entries with metadata", () => {
      const coord = new AgentCoordinator();
      coord.set("region", "us-east-1", "t1");
      coord.set("vpc", "vpc-123", "t2");

      const all = coord.getAll();
      expect(all.size).toBe(2);
      expect(all.get("region")!.source).toBe("t1");
      expect(all.get("vpc")!.source).toBe("t2");
      expect(all.get("region")!.timestamp).toBeGreaterThan(0);
    });

    it("set overwrites existing value", () => {
      const coord = new AgentCoordinator();
      coord.set("region", "us-east-1", "t1");
      coord.set("region", "eu-west-1", "t2");

      expect(coord.get("region")).toBe("eu-west-1");
      expect(coord.getAll().get("region")!.source).toBe("t2");
    });
  });

  describe("message passing", () => {
    it("send to specific task delivers to inbox", () => {
      const coord = new AgentCoordinator();
      coord.register("t2");
      coord.send({ from: "t1", to: "t2", type: "info", payload: "hello" });

      const messages = coord.drain("t2");
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe("t1");
      expect(messages[0].payload).toBe("hello");
    });

    it("send creates inbox if not registered", () => {
      const coord = new AgentCoordinator();
      coord.send({ from: "t1", to: "t3", type: "info", payload: "data" });

      const messages = coord.drain("t3");
      expect(messages).toHaveLength(1);
    });

    it("broadcast delivers to all registered inboxes", () => {
      const coord = new AgentCoordinator();
      coord.register("t1");
      coord.register("t2");
      coord.register("t3");

      coord.send({ from: "t0", to: "*", type: "info", payload: "broadcast" });

      expect(coord.drain("t1")).toHaveLength(1);
      expect(coord.drain("t2")).toHaveLength(1);
      expect(coord.drain("t3")).toHaveLength(1);
    });

    it("drain returns and clears messages", () => {
      const coord = new AgentCoordinator();
      coord.send({ from: "t1", to: "t2", type: "info", payload: "msg1" });
      coord.send({ from: "t1", to: "t2", type: "info", payload: "msg2" });

      const first = coord.drain("t2");
      expect(first).toHaveLength(2);

      const second = coord.drain("t2");
      expect(second).toHaveLength(0);
    });

    it("drain returns empty array for unregistered task", () => {
      const coord = new AgentCoordinator();
      expect(coord.drain("unknown")).toEqual([]);
    });
  });

  describe("handoffs", () => {
    it("requestHandoff and drainHandoffs round-trip", () => {
      const coord = new AgentCoordinator();
      coord.requestHandoff({
        from: "t1",
        to: "t2",
        reason: "Terraform discovered VPC config",
        partialOutput: { vpcId: "vpc-123" },
      });

      const handoffs = coord.drainHandoffs("t2");
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0].from).toBe("t1");
      expect(handoffs[0].reason).toContain("VPC");
      expect((handoffs[0].partialOutput as Record<string, string>).vpcId).toBe("vpc-123");
    });

    it("drainHandoffs only returns targeted handoffs", () => {
      const coord = new AgentCoordinator();
      coord.requestHandoff({ from: "t1", to: "t2", reason: "for t2", partialOutput: {} });
      coord.requestHandoff({ from: "t1", to: "t3", reason: "for t3", partialOutput: {} });

      const t2Handoffs = coord.drainHandoffs("t2");
      expect(t2Handoffs).toHaveLength(1);
      expect(t2Handoffs[0].reason).toBe("for t2");

      const t3Handoffs = coord.drainHandoffs("t3");
      expect(t3Handoffs).toHaveLength(1);
    });

    it("drainHandoffs removes matched handoffs", () => {
      const coord = new AgentCoordinator();
      coord.requestHandoff({ from: "t1", to: "t2", reason: "test", partialOutput: {} });

      coord.drainHandoffs("t2");
      expect(coord.drainHandoffs("t2")).toHaveLength(0);
    });
  });

  describe("snapshot", () => {
    it("reports correct counts", () => {
      const coord = new AgentCoordinator();
      coord.set("key1", "val1", "t1");
      coord.set("key2", "val2", "t2");
      coord.send({ from: "t1", to: "t2", type: "info", payload: "msg" });
      coord.send({ from: "t1", to: "t3", type: "info", payload: "msg" });
      coord.requestHandoff({ from: "t1", to: "t2", reason: "test", partialOutput: {} });

      const snap = coord.snapshot();
      expect(snap.contextKeys).toEqual(["key1", "key2"]);
      expect(snap.pendingMessages).toBe(2);
      expect(snap.pendingHandoffs).toBe(1);
    });

    it("reports zero counts when empty", () => {
      const coord = new AgentCoordinator();
      const snap = coord.snapshot();
      expect(snap.contextKeys).toEqual([]);
      expect(snap.pendingMessages).toBe(0);
      expect(snap.pendingHandoffs).toBe(0);
    });
  });
});

describe("ResultAggregator", () => {
  it("merge strategy combines objects", () => {
    const agg = new ResultAggregator([{ pattern: /^infra-/, strategy: "merge" }]);

    const result = agg.aggregate([
      { taskId: "infra-vpc", output: { vpc: "vpc-123" } },
      { taskId: "infra-subnet", output: { subnet: "sub-456" } },
    ]);

    expect(result.size).toBe(1);
    const merged = result.get("^infra-") as Record<string, string>;
    expect(merged.vpc).toBe("vpc-123");
    expect(merged.subnet).toBe("sub-456");
  });

  it("concat strategy produces array", () => {
    const agg = new ResultAggregator([{ pattern: /^log-/, strategy: "concat" }]);

    const result = agg.aggregate([
      { taskId: "log-app", output: "app logs" },
      { taskId: "log-system", output: "system logs" },
    ]);

    expect(result.size).toBe(1);
    const concatenated = result.get("^log-") as string[];
    expect(concatenated).toEqual(["app logs", "system logs"]);
  });

  it("best strategy picks highest score", () => {
    const agg = new ResultAggregator([
      { pattern: /^candidate-/, strategy: "best", scoreKey: "quality" },
    ]);

    const result = agg.aggregate([
      { taskId: "candidate-a", output: { quality: 0.7, content: "A" } },
      { taskId: "candidate-b", output: { quality: 0.9, content: "B" } },
      { taskId: "candidate-c", output: { quality: 0.8, content: "C" } },
    ]);

    expect(result.size).toBe(1);
    const best = result.get("^candidate-") as Record<string, unknown>;
    expect(best.content).toBe("B");
  });

  it("unmatched tasks are not aggregated", () => {
    const agg = new ResultAggregator([{ pattern: /^infra-/, strategy: "merge" }]);

    const result = agg.aggregate([
      { taskId: "infra-vpc", output: { vpc: "vpc-123" } },
      { taskId: "ci-pipeline", output: { pipeline: "ok" } },
    ]);

    expect(result.size).toBe(1);
    expect(result.has("^infra-")).toBe(true);
  });

  it("empty results produce empty map", () => {
    const agg = new ResultAggregator([{ pattern: /^infra-/, strategy: "merge" }]);

    const result = agg.aggregate([]);
    expect(result.size).toBe(0);
  });

  it("best strategy defaults to score key", () => {
    const agg = new ResultAggregator([{ pattern: /^opt-/, strategy: "best" }]);

    const result = agg.aggregate([
      { taskId: "opt-1", output: { score: 5 } },
      { taskId: "opt-2", output: { score: 10 } },
    ]);

    const best = result.get("^opt-") as Record<string, number>;
    expect(best.score).toBe(10);
  });
});
