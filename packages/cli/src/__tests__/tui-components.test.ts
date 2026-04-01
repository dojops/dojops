import { describe, it, expect } from "vitest";
import {
  renderToolCallPanel,
  renderMessageBubble,
  renderApprovalDialog,
  renderProgressBar,
  renderIterationIndicator,
} from "../tui/components";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, "");
}

describe("renderToolCallPanel", () => {
  it("returns empty string for no tools", () => {
    expect(renderToolCallPanel([])).toBe("");
  });

  it("renders tool calls with status icons", () => {
    const panel = renderToolCallPanel([
      { name: "read_file", status: "success", durationMs: 12 },
      { name: "write_file", status: "running" },
      { name: "search_files", status: "error" },
    ]);

    const plain = strip(panel);
    expect(plain).toContain("Tool Calls");
    expect(plain).toContain("(3)");
    expect(plain).toContain("read_file");
    expect(plain).toContain("12ms");
    expect(plain).toContain("write_file");
    expect(plain).toContain("search_files");
  });

  it("includes output preview when provided", () => {
    const panel = renderToolCallPanel([
      { name: "read_file", status: "success", outputPreview: "const x = 42;" },
    ]);

    const plain = strip(panel);
    expect(plain).toContain("const x = 42;");
  });
});

describe("renderMessageBubble", () => {
  it("renders user message with role indicator", () => {
    const bubble = renderMessageBubble({
      role: "user",
      content: "Create a Terraform config",
    });

    const plain = strip(bubble);
    expect(plain).toContain("You");
    expect(plain).toContain("Create a Terraform config");
  });

  it("renders assistant message with agent name", () => {
    const bubble = renderMessageBubble({
      role: "assistant",
      content: "Here is the config...",
      agent: "terraform",
    });

    const plain = strip(bubble);
    expect(plain).toContain("DojOps");
    expect(plain).toContain("(terraform)");
    expect(plain).toContain("Here is the config...");
  });

  it("includes token count when provided", () => {
    const bubble = renderMessageBubble({
      role: "assistant",
      content: "Response",
      tokenCount: 1500,
    });

    const plain = strip(bubble);
    expect(plain).toContain("[1500 tokens]");
  });
});

describe("renderApprovalDialog", () => {
  it("renders approval dialog with file details", () => {
    const dialog = renderApprovalDialog({
      taskId: "task-1",
      skillName: "terraform",
      summary: "Generate S3 bucket configuration",
      filesCreated: ["main.tf", "variables.tf"],
      filesModified: ["outputs.tf"],
      risk: "low",
    });

    const plain = strip(dialog);
    expect(plain).toContain("Approval Required");
    expect(plain).toContain("LOW RISK");
    expect(plain).toContain("terraform");
    expect(plain).toContain("main.tf");
    expect(plain).toContain("variables.tf");
    expect(plain).toContain("outputs.tf");
    expect(plain).toContain("Creates 2 file(s)");
    expect(plain).toContain("Modifies 1 file(s)");
  });

  it("truncates long file lists", () => {
    const dialog = renderApprovalDialog({
      taskId: "task-1",
      skillName: "k8s",
      summary: "Generate deployment manifests",
      filesCreated: ["a.yaml", "b.yaml", "c.yaml", "d.yaml", "e.yaml", "f.yaml", "g.yaml"],
      filesModified: [],
      risk: "medium",
    });

    const plain = strip(dialog);
    expect(plain).toContain("Creates 7 file(s)");
    expect(plain).toContain("... and 2 more");
  });

  it("renders high risk with appropriate label", () => {
    const dialog = renderApprovalDialog({
      taskId: "task-1",
      skillName: "exec",
      summary: "Execute destructive command",
      filesCreated: [],
      filesModified: ["production.yml"],
      risk: "high",
    });

    const plain = strip(dialog);
    expect(plain).toContain("HIGH RISK");
  });
});

describe("renderProgressBar", () => {
  it("renders a progress bar at 50%", () => {
    const bar = renderProgressBar({
      label: "Tokens",
      current: 50000,
      total: 100000,
    });

    const plain = strip(bar);
    expect(plain).toContain("Tokens");
    expect(plain).toContain("50%");
    expect(plain).toContain("50000/100000");
  });

  it("clamps to 100%", () => {
    const bar = renderProgressBar({
      label: "Budget",
      current: 150,
      total: 100,
    });

    const plain = strip(bar);
    expect(plain).toContain("100%");
  });

  it("handles zero total", () => {
    const bar = renderProgressBar({
      label: "Empty",
      current: 0,
      total: 0,
    });

    // NaN case — should handle gracefully
    const plain = strip(bar);
    expect(plain).toContain("Empty");
  });
});

describe("renderIterationIndicator", () => {
  it("renders iteration info", () => {
    const indicator = renderIterationIndicator({
      iteration: 3,
      maxIterations: 10,
      phase: "generating",
      agent: "terraform",
      tokensUsed: 12500,
    });

    const plain = strip(indicator);
    expect(plain).toContain("[3/10]");
    expect(plain).toContain("generating");
    expect(plain).toContain("terraform");
    expect(plain).toContain("12,500 tokens");
  });
});
