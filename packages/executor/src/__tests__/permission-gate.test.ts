import { describe, it, expect, vi } from "vitest";
import { PermissionGate, type PermissionMode, type PermissionRule } from "../permission-gate";
import { PolicyViolationError } from "../policy";

function makeGate(
  mode: PermissionMode,
  rules: PermissionRule[] = [],
  hookEngine?: { emit: ReturnType<typeof vi.fn> },
) {
  return new PermissionGate({ mode, rules, hookEngine });
}

describe("PermissionGate", () => {
  describe("check — per-tool rules (first match wins)", () => {
    it("returns matching rule action", () => {
      const gate = makeGate("interactive", [
        { tool: "write_file", action: "deny", reason: "no writes" },
      ]);
      const decision = gate.check("write_file");
      expect(decision.action).toBe("deny");
      expect(decision.reason).toBe("no writes");
    });

    it("first match wins over later rules", () => {
      const gate = makeGate("interactive", [
        { tool: "write_file", action: "allow" },
        { tool: "write_file", action: "deny" },
      ]);
      expect(gate.check("write_file").action).toBe("allow");
    });

    it("wildcard rule matches all tools", () => {
      const gate = makeGate("interactive", [{ tool: "*", action: "deny" }]);
      expect(gate.check("read_file").action).toBe("deny");
      expect(gate.check("run_command").action).toBe("deny");
    });

    it("prefix wildcard matches tools", () => {
      const gate = makeGate("interactive", [{ tool: "run_*", action: "ask" }]);
      expect(gate.check("run_command").action).toBe("ask");
      expect(gate.check("run_skill").action).toBe("ask");
      expect(gate.check("write_file").action).toBe("allow"); // falls through to mode
    });

    it("provides default reason when rule has none", () => {
      const gate = makeGate("interactive", [{ tool: "write_file", action: "deny" }]);
      expect(gate.check("write_file").reason).toContain("write_file");
    });

    it("rules take priority over mode", () => {
      const gate = makeGate("plan-only", [{ tool: "write_file", action: "allow" }]);
      // plan-only would normally deny write_file, but rule overrides
      expect(gate.check("write_file").action).toBe("allow");
    });
  });

  describe("check — plan-only mode", () => {
    const gate = makeGate("plan-only");

    it("denies write tools", () => {
      for (const tool of ["write_file", "edit_file", "run_command", "run_skill"]) {
        const d = gate.check(tool);
        expect(d.action).toBe("deny");
        expect(d.reason).toContain("plan-only");
      }
    });

    it("allows read-only tools", () => {
      for (const tool of ["read_file", "search_files", "list_files", "search_skills"]) {
        expect(gate.check(tool).action).toBe("allow");
      }
    });

    it("allows unknown tools (not in write set)", () => {
      expect(gate.check("custom_tool").action).toBe("allow");
    });
  });

  describe("check — auto-approve mode", () => {
    const gate = makeGate("auto-approve");

    it("allows everything", () => {
      expect(gate.check("write_file").action).toBe("allow");
      expect(gate.check("run_command").action).toBe("allow");
      expect(gate.check("read_file").action).toBe("allow");
      expect(gate.check("anything").action).toBe("allow");
    });

    it("allows even with HIGH risk", () => {
      expect(gate.check("run_command", {}, "HIGH").action).toBe("allow");
    });
  });

  describe("check — strict mode", () => {
    const gate = makeGate("strict");

    it("allows read-only tools without asking", () => {
      for (const tool of ["read_file", "search_files", "list_files", "search_skills"]) {
        expect(gate.check(tool).action).toBe("allow");
      }
    });

    it("asks for write tools", () => {
      const d = gate.check("write_file");
      expect(d.action).toBe("ask");
      expect(d.reason).toContain("Strict mode");
    });

    it("asks for unknown tools", () => {
      expect(gate.check("custom_tool").action).toBe("ask");
    });
  });

  describe("check — interactive mode (default)", () => {
    const gate = makeGate("interactive");

    it("allows read-only tools", () => {
      expect(gate.check("read_file").action).toBe("allow");
    });

    it("allows low-risk tasks", () => {
      expect(gate.check("write_file", {}, "LOW").action).toBe("allow");
    });

    it("allows medium-risk tasks", () => {
      expect(gate.check("write_file", {}, "MEDIUM").action).toBe("allow");
    });

    it("asks for high-risk tasks", () => {
      const d = gate.check("write_file", {}, "HIGH");
      expect(d.action).toBe("ask");
      expect(d.reason).toContain("High-risk");
    });

    it("asks for critical-risk tasks", () => {
      expect(gate.check("run_command", {}, "CRITICAL").action).toBe("ask");
    });

    it("allows write tools with no risk info", () => {
      // When no risk info is available, write tools default to allow
      expect(gate.check("write_file").action).toBe("allow");
    });

    it("allows non-write, non-read tools with no risk info", () => {
      expect(gate.check("custom_tool").action).toBe("allow");
    });
  });

  describe("enforce", () => {
    it("throws PolicyViolationError on deny", async () => {
      const gate = makeGate("plan-only");

      await expect(gate.enforce("write_file")).rejects.toThrow(PolicyViolationError);
      await expect(gate.enforce("write_file")).rejects.toThrow("plan-only");
    });

    it("returns allow decisions without throwing", async () => {
      const gate = makeGate("auto-approve");
      const decision = await gate.enforce("write_file");
      expect(decision.action).toBe("allow");
    });

    it("emits PreApproval hook on ask decision", async () => {
      const emit = vi.fn().mockResolvedValue([]);
      const gate = makeGate("strict", [], { emit });

      const decision = await gate.enforce("write_file");
      expect(decision.action).toBe("ask");
      expect(emit).toHaveBeenCalledWith(
        "PreApproval",
        expect.objectContaining({ tool: "write_file" }),
      );
    });

    it("does not emit hook on allow decision", async () => {
      const emit = vi.fn().mockResolvedValue([]);
      const gate = makeGate("auto-approve", [], { emit });

      await gate.enforce("write_file");
      expect(emit).not.toHaveBeenCalled();
    });

    it("swallows hook emission errors", async () => {
      const emit = vi.fn().mockRejectedValue(new Error("hook failed"));
      const gate = makeGate("strict", [], { emit });

      // Should not throw despite hook failure
      const decision = await gate.enforce("write_file");
      expect(decision.action).toBe("ask");
    });

    it("includes custom deny reason in error", async () => {
      const gate = makeGate("interactive", [
        { tool: "run_command", action: "deny", reason: "Commands blocked by admin" },
      ]);

      try {
        await gate.enforce("run_command");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).message).toBe("Commands blocked by admin");
      }
    });
  });

  describe("getMode", () => {
    it("returns the configured mode", () => {
      expect(makeGate("plan-only").getMode()).toBe("plan-only");
      expect(makeGate("auto-approve").getMode()).toBe("auto-approve");
      expect(makeGate("strict").getMode()).toBe("strict");
      expect(makeGate("interactive").getMode()).toBe("interactive");
    });
  });

  describe("toPolicyOverrides", () => {
    it("plan-only: disallows writes, requires approval always", () => {
      const overrides = PermissionGate.toPolicyOverrides("plan-only");
      expect(overrides.allowWrite).toBe(false);
      expect(overrides.requireApproval).toBe(true);
      expect(overrides.approvalMode).toBe("always");
    });

    it("auto-approve: allows writes, no approval", () => {
      const overrides = PermissionGate.toPolicyOverrides("auto-approve");
      expect(overrides.allowWrite).toBe(true);
      expect(overrides.requireApproval).toBe(false);
      expect(overrides.approvalMode).toBe("never");
    });

    it("strict: allows writes but requires approval always", () => {
      const overrides = PermissionGate.toPolicyOverrides("strict");
      expect(overrides.allowWrite).toBe(true);
      expect(overrides.requireApproval).toBe(true);
      expect(overrides.approvalMode).toBe("always");
    });

    it("interactive: allows writes with risk-based approval", () => {
      const overrides = PermissionGate.toPolicyOverrides("interactive");
      expect(overrides.allowWrite).toBe(true);
      expect(overrides.requireApproval).toBe(true);
      expect(overrides.approvalMode).toBe("risk-based");
    });
  });
});
