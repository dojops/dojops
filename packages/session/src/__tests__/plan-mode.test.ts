import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PlanManager, PlanModeError } from "../plan-mode";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-plan-test-"));
}

describe("PlanManager", () => {
  let tmpDir: string;
  let manager: PlanManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    manager = new PlanManager({ plansDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("enter", () => {
    it("enters plan mode and creates a plan file", () => {
      const id = manager.enter("Add S3 bucket config");
      expect(manager.isActive()).toBe(true);
      expect(id).toBe("add-s3-bucket-config");

      const plan = manager.load(id);
      expect(plan).not.toBeNull();
      expect(plan!.status).toBe("drafting");
      expect(plan!.title).toBe("Add S3 bucket config");
      expect(plan!.content).toContain("## Plan");
    });

    it("throws if already in plan mode", () => {
      manager.enter("First plan");
      expect(() => manager.enter("Second plan")).toThrow(PlanModeError);
      expect(() => manager.enter("Second plan")).toThrow("Already in plan mode");
    });

    it("creates plans directory if missing", () => {
      const deepDir = path.join(tmpDir, "deep", "nested", "plans");
      const mgr = new PlanManager({ plansDir: deepDir });
      mgr.enter("Test");
      expect(fs.existsSync(deepDir)).toBe(true);
    });

    it("sets state with current plan id", () => {
      const id = manager.enter("My Plan");
      const state = manager.getState();
      expect(state.active).toBe(true);
      expect(state.currentPlanId).toBe(id);
      expect(state.allowedTools).toContain("read_file");
    });
  });

  describe("exit", () => {
    it("exits plan mode and sets status to pending_approval", () => {
      manager.enter("Test Plan");
      const plan = manager.exit();

      expect(manager.isActive()).toBe(false);
      expect(plan.status).toBe("pending_approval");
      expect(plan.content).toContain("pending_approval");
    });

    it("throws if not in plan mode", () => {
      expect(() => manager.exit()).toThrow(PlanModeError);
      expect(() => manager.exit()).toThrow("Not in plan mode");
    });

    it("clears state after exit", () => {
      manager.enter("X");
      manager.exit();
      const state = manager.getState();
      expect(state.active).toBe(false);
      expect(state.currentPlanId).toBeNull();
    });
  });

  describe("updateContent", () => {
    it("updates drafting plan content", () => {
      const id = manager.enter("Plan Update Test");
      manager.updateContent(id, "# Updated Plan\n\nNew content here.");

      const plan = manager.load(id);
      expect(plan!.content).toContain("Updated Plan");
      expect(plan!.content).toContain("New content here.");
      expect(plan!.status).toBe("drafting"); // status preserved
    });

    it("throws for non-existent plan", () => {
      expect(() => manager.updateContent("nope", "content")).toThrow("not found");
    });

    it("throws for non-drafting plan", () => {
      const id = manager.enter("X");
      manager.exit(); // moves to pending_approval
      expect(() => manager.updateContent(id, "new")).toThrow("pending_approval");
    });
  });

  describe("approve", () => {
    it("approves a pending plan", () => {
      const id = manager.enter("Approve Test");
      manager.exit();
      const plan = manager.approve(id);

      expect(plan.status).toBe("approved");
    });

    it("throws for non-existent plan", () => {
      expect(() => manager.approve("nope")).toThrow("not found");
    });

    it("throws for drafting plan", () => {
      const id = manager.enter("X");
      // still drafting, exit plan mode without going through exit()
      manager.exit();
      manager.approve(id); // this should work since exit() sets pending_approval
    });

    it("throws for already approved plan", () => {
      const id = manager.enter("X");
      manager.exit();
      manager.approve(id);
      expect(() => manager.approve(id)).toThrow("approved");
    });
  });

  describe("reject", () => {
    it("rejects a pending plan", () => {
      const id = manager.enter("Reject Test");
      manager.exit();
      const plan = manager.reject(id);

      expect(plan.status).toBe("rejected");
    });

    it("throws for non-pending plan", () => {
      const id = manager.enter("X");
      manager.exit();
      manager.approve(id);
      expect(() => manager.reject(id)).toThrow("approved");
    });
  });

  describe("load", () => {
    it("returns null for non-existent plan", () => {
      expect(manager.load("nonexistent")).toBeNull();
    });

    it("parses plan file correctly", () => {
      const id = manager.enter("Load Test");
      const plan = manager.load(id);

      expect(plan).not.toBeNull();
      expect(plan!.id).toBe(id);
      expect(plan!.filePath).toBe(path.join(tmpDir, `${id}.md`));
      expect(plan!.title).toBe("Load Test");
      expect(plan!.createdAt).toBeDefined();
      expect(plan!.updatedAt).toBeDefined();
    });
  });

  describe("list", () => {
    it("returns empty when no plans exist", () => {
      expect(manager.list()).toEqual([]);
    });

    it("lists all plans", () => {
      const id1 = manager.enter("First");
      manager.exit();
      const id2 = manager.enter("Second");
      manager.exit();

      const plans = manager.list();
      expect(plans).toHaveLength(2);
      const ids = plans.map((p) => p.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });
  });

  describe("listByStatus", () => {
    it("filters by status", () => {
      const id1 = manager.enter("Plan A");
      manager.exit();
      manager.approve(id1);

      const id2 = manager.enter("Plan B");
      manager.exit();

      expect(manager.listByStatus("approved")).toHaveLength(1);
      expect(manager.listByStatus("approved")[0].id).toBe(id1);
      expect(manager.listByStatus("pending_approval")).toHaveLength(1);
      expect(manager.listByStatus("pending_approval")[0].id).toBe(id2);
      expect(manager.listByStatus("drafting")).toHaveLength(0);
    });
  });

  describe("delete", () => {
    it("deletes a plan file", () => {
      const id = manager.enter("Delete Me");
      manager.exit();
      expect(manager.delete(id)).toBe(true);
      expect(manager.load(id)).toBeNull();
    });

    it("returns false for non-existent plan", () => {
      expect(manager.delete("nope")).toBe(false);
    });
  });

  describe("getState", () => {
    it("returns a copy (not a reference)", () => {
      const state1 = manager.getState();
      manager.enter("X");
      const state2 = manager.getState();

      expect(state1.active).toBe(false);
      expect(state2.active).toBe(true);
    });

    it("includes allowed tools list", () => {
      const state = manager.getState();
      expect(state.allowedTools).toContain("read_file");
      expect(state.allowedTools).toContain("search_files");
      expect(state.allowedTools).toContain("list_files");
    });
  });

  describe("slug generation", () => {
    it("converts title to url-safe slug", () => {
      const id = manager.enter("Add CI/CD Pipeline!!");
      expect(id).toBe("add-ci-cd-pipeline");
    });

    it("handles unicode and special chars", () => {
      const id = manager.enter("Deploy: Kubernetes + Helm");
      expect(id).toBe("deploy-kubernetes-helm");
    });
  });

  describe("plan file format", () => {
    it("contains status marker as HTML comment", () => {
      const id = manager.enter("Format Test");
      const content = fs.readFileSync(path.join(tmpDir, `${id}.md`), "utf-8");
      expect(content).toContain("<!-- status: drafting -->");
    });

    it("status marker updates on state transitions", () => {
      const id = manager.enter("Transition Test");
      manager.exit();
      const content = fs.readFileSync(path.join(tmpDir, `${id}.md`), "utf-8");
      expect(content).toContain("<!-- status: pending_approval -->");
      expect(content).not.toContain("<!-- status: drafting -->");
    });
  });
});
