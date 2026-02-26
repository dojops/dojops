import { describe, it, expect } from "vitest";
import {
  WorkflowStepSchema,
  WorkflowJobSchema,
  WorkflowSchema,
  GitHubActionsInputSchema,
} from "./schemas";

describe("GitHub Actions schemas", () => {
  describe("WorkflowStepSchema", () => {
    it("accepts step with uses", () => {
      const result = WorkflowStepSchema.safeParse({
        name: "Checkout",
        uses: "actions/checkout@v4",
      });
      expect(result.success).toBe(true);
    });

    it("accepts step with run", () => {
      const result = WorkflowStepSchema.safeParse({ name: "Test", run: "npm test" });
      expect(result.success).toBe(true);
    });

    it("rejects step without name", () => {
      const result = WorkflowStepSchema.safeParse({ uses: "actions/checkout@v4" });
      expect(result.success).toBe(false);
    });
  });

  describe("WorkflowJobSchema", () => {
    it("accepts valid job", () => {
      const result = WorkflowJobSchema.safeParse({
        "runs-on": "ubuntu-latest",
        steps: [{ name: "Checkout", uses: "actions/checkout@v4" }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts reusable workflow job (uses without runs-on)", () => {
      const result = WorkflowJobSchema.safeParse({
        uses: "octo-org/this-repo/.github/workflows/workflow-1.yml@v1",
        with: { config: "production" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("WorkflowSchema", () => {
    it("accepts valid workflow", () => {
      const result = WorkflowSchema.safeParse({
        name: "CI",
        on: { push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [{ name: "Checkout", uses: "actions/checkout@v4" }],
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts string trigger", () => {
      const result = WorkflowSchema.safeParse({
        name: "CI",
        on: "push",
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [{ name: "Test", run: "npm test" }],
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects workflow without name", () => {
      const result = WorkflowSchema.safeParse({
        on: "push",
        jobs: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GitHubActionsInputSchema", () => {
    it("accepts valid input with defaults", () => {
      const result = GitHubActionsInputSchema.safeParse({ projectPath: "/app" });
      expect(result.success).toBe(true);
      expect(result.data?.nodeVersion).toBe("20");
      expect(result.data?.defaultBranch).toBe("main");
    });

    it("accepts custom values", () => {
      const result = GitHubActionsInputSchema.safeParse({
        projectPath: "/app",
        nodeVersion: "18",
        defaultBranch: "develop",
      });
      expect(result.success).toBe(true);
      expect(result.data?.nodeVersion).toBe("18");
    });

    it("rejects missing projectPath", () => {
      const result = GitHubActionsInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
