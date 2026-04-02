import { describe, it, expect } from "vitest";
import { PermissionGate } from "../permission-gate";

describe("PermissionGate — denial tracking", () => {
  describe("denial counter", () => {
    it("increments on each denial from a deny rule", () => {
      const gate = new PermissionGate({
        mode: "interactive",
        rules: [{ tool: "run_command", action: "deny", reason: "blocked" }],
      });

      gate.check("run_command");
      expect(gate.getDenialInfo()).toEqual([{ tool: "run_command", count: 1 }]);

      gate.check("run_command");
      expect(gate.getDenialInfo()).toEqual([{ tool: "run_command", count: 2 }]);
    });

    it("increments on each denial from plan-only mode", () => {
      const gate = new PermissionGate({ mode: "plan-only" });

      gate.check("write_file");
      gate.check("write_file");
      expect(gate.getDenialInfo()).toEqual([{ tool: "write_file", count: 2 }]);
    });

    it("resets on a successful allow", () => {
      const gate = new PermissionGate({ mode: "interactive" });

      // Deny via external recording
      gate.recordExternalDenial("write_file");
      gate.recordExternalDenial("write_file");
      expect(gate.getDenialInfo()).toEqual([{ tool: "write_file", count: 2 }]);

      // Allow resets the counter
      gate.check("write_file"); // interactive mode allows write tools
      expect(gate.getDenialInfo()).toEqual([]);
    });

    it("resets via recordExternalAllow", () => {
      const gate = new PermissionGate({ mode: "plan-only" });

      gate.check("write_file"); // denied
      gate.check("write_file"); // denied
      expect(gate.getDenialInfo()).toEqual([{ tool: "write_file", count: 2 }]);

      gate.recordExternalAllow("write_file");
      expect(gate.getDenialInfo()).toEqual([]);
      expect(gate.isAutoBlocked("write_file")).toBe(false);
    });
  });

  describe("auto-block threshold", () => {
    it("auto-blocks after 3 consecutive denials", () => {
      const gate = new PermissionGate({
        mode: "interactive",
        rules: [{ tool: "run_command", action: "deny" }],
      });

      // First 3 denials build up the counter
      gate.check("run_command"); // count=1
      expect(gate.isAutoBlocked("run_command")).toBe(false);

      gate.check("run_command"); // count=2
      expect(gate.isAutoBlocked("run_command")).toBe(false);

      gate.check("run_command"); // count=3
      expect(gate.isAutoBlocked("run_command")).toBe(true);
    });

    it("returns auto-block deny reason on subsequent checks", () => {
      const gate = new PermissionGate({
        mode: "interactive",
        rules: [{ tool: "run_command", action: "deny" }],
      });

      // Build up to threshold
      gate.check("run_command");
      gate.check("run_command");
      gate.check("run_command");

      // 4th check should be auto-blocked (not hitting the rule)
      const decision = gate.check("run_command");
      expect(decision.action).toBe("deny");
      expect(decision.reason).toContain("auto-blocked");
      expect(decision.reason).toContain("3 consecutive denials");
    });

    it("isAutoBlocked returns false before threshold", () => {
      const gate = new PermissionGate({ mode: "plan-only" });

      expect(gate.isAutoBlocked("write_file")).toBe(false);
      gate.check("write_file");
      expect(gate.isAutoBlocked("write_file")).toBe(false);
      gate.check("write_file");
      expect(gate.isAutoBlocked("write_file")).toBe(false);
    });

    it("auto-block does not affect tools that have not been denied", () => {
      const gate = new PermissionGate({
        mode: "interactive",
        rules: [{ tool: "run_command", action: "deny" }],
      });

      gate.check("run_command");
      gate.check("run_command");
      gate.check("run_command");

      expect(gate.isAutoBlocked("run_command")).toBe(true);
      expect(gate.isAutoBlocked("write_file")).toBe(false);
      expect(gate.isAutoBlocked("read_file")).toBe(false);
    });
  });

  describe("independent counters per tool", () => {
    it("tracks different tools independently", () => {
      const gate = new PermissionGate({
        mode: "plan-only",
      });

      gate.check("write_file"); // denied
      gate.check("run_command"); // denied
      gate.check("write_file"); // denied

      const info = gate.getDenialInfo();
      expect(info).toContainEqual({ tool: "write_file", count: 2 });
      expect(info).toContainEqual({ tool: "run_command", count: 1 });
    });

    it("resetting one tool does not affect another", () => {
      const gate = new PermissionGate({ mode: "plan-only" });

      gate.check("write_file"); // denied
      gate.check("run_command"); // denied

      gate.recordExternalAllow("write_file");

      expect(gate.isAutoBlocked("write_file")).toBe(false);
      expect(gate.getDenialInfo()).toEqual([{ tool: "run_command", count: 1 }]);
    });
  });

  describe("recordExternalDenial", () => {
    it("increments denial count and returns whether threshold reached", () => {
      const gate = new PermissionGate({ mode: "auto-approve" });

      expect(gate.recordExternalDenial("write_file")).toBe(false); // 1
      expect(gate.recordExternalDenial("write_file")).toBe(false); // 2
      expect(gate.recordExternalDenial("write_file")).toBe(true); // 3 = threshold
    });

    it("auto-blocks the tool after threshold via external denials", () => {
      const gate = new PermissionGate({ mode: "auto-approve" });

      gate.recordExternalDenial("write_file");
      gate.recordExternalDenial("write_file");
      gate.recordExternalDenial("write_file");

      // Even in auto-approve mode, auto-block overrides
      const decision = gate.check("write_file");
      expect(decision.action).toBe("deny");
      expect(decision.reason).toContain("auto-blocked");
    });
  });

  describe("getDenialInfo", () => {
    it("returns empty array when no denials", () => {
      const gate = new PermissionGate({ mode: "auto-approve" });
      expect(gate.getDenialInfo()).toEqual([]);
    });

    it("returns all tools with non-zero denial counts", () => {
      const gate = new PermissionGate({ mode: "plan-only" });

      gate.check("write_file");
      gate.check("edit_file");
      gate.check("write_file");

      const info = gate.getDenialInfo();
      expect(info).toHaveLength(2);
      expect(info).toContainEqual({ tool: "write_file", count: 2 });
      expect(info).toContainEqual({ tool: "edit_file", count: 1 });
    });

    it("excludes tools with zero denials (after reset)", () => {
      const gate = new PermissionGate({ mode: "plan-only" });

      gate.check("write_file");
      gate.recordExternalAllow("write_file");

      expect(gate.getDenialInfo()).toEqual([]);
    });
  });

  describe("enforce with denial tracking", () => {
    it("throws with auto-block reason after threshold", async () => {
      const gate = new PermissionGate({
        mode: "interactive",
        rules: [{ tool: "dangerous_tool", action: "deny" }],
      });

      // Build up denials — enforce throws on deny, but the tracking still happens
      for (let i = 0; i < 3; i++) {
        try {
          await gate.enforce("dangerous_tool");
        } catch {
          // expected
        }
      }

      // Now auto-blocked
      expect(gate.isAutoBlocked("dangerous_tool")).toBe(true);

      try {
        await gate.enforce("dangerous_tool");
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("auto-blocked");
      }
    });
  });

  describe("ask decisions do not affect denial count", () => {
    it("ask via strict mode does not increment denial count", () => {
      const gate = new PermissionGate({ mode: "strict" });

      // write_file in strict mode returns "ask", not "deny"
      gate.check("write_file");
      gate.check("write_file");
      gate.check("write_file");

      expect(gate.getDenialInfo()).toEqual([]);
      expect(gate.isAutoBlocked("write_file")).toBe(false);
    });
  });
});
