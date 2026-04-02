import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskTree } from "../tui/task-tree";

const writeMock = vi.fn();
const originalWrite = process.stdout.write;
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  vi.useFakeTimers();
  process.stdout.write = writeMock as unknown as typeof process.stdout.write;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  delete process.env.CI;
  delete process.env.NO_COLOR;
  writeMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  process.stdout.write = originalWrite;
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
});

describe("TaskTree", () => {
  it("adds tasks and renders tree structure", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "Generate Dockerfile", "docker");
    tree.addTask("t2", "Create CI pipeline", "ci-expert");
    tree.addTask("t3", "Write README");
    tree.start();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("├─");
    expect(output).toContain("└─");
    expect(output).toContain("Generate Dockerfile");
    expect(output).toContain("Write README");

    tree.dispose();
  });

  it("uses different tree connectors for last item", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "First");
    tree.addTask("t2", "Last");
    tree.start();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("├─");
    expect(output).toContain("└─");

    tree.dispose();
  });

  it("shows status icons", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "Done task");
    tree.addTask("t2", "Failed task");
    tree.addTask("t3", "Pending task");

    tree.updateTask("t1", "completed");
    tree.updateTask("t2", "failed");
    tree.start();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("✗");
    expect(output).toContain("▫");

    tree.dispose();
  });

  it("increments tool and token counts", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "Working", "agent");
    tree.updateTask("t1", "running");
    tree.incrementTools("t1");
    tree.incrementTools("t1");
    tree.incrementTools("t1");
    tree.incrementTokens("t1", 1500);
    tree.start();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("3 tools");
    expect(output).toContain("1.5K tokens");

    tree.dispose();
  });

  it("tracks task count", () => {
    const tree = new TaskTree();
    expect(tree.taskCount).toBe(0);

    tree.addTask("t1", "First");
    expect(tree.taskCount).toBe(1);

    tree.addTask("t2", "Second");
    expect(tree.taskCount).toBe(2);

    tree.dispose();
  });

  it("does not add duplicate task IDs", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "First");
    tree.addTask("t1", "Duplicate");
    expect(tree.taskCount).toBe(1);

    tree.dispose();
  });

  it("stop prints final static tree", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "Task");
    tree.updateTask("t1", "completed");
    tree.start();
    writeMock.mockClear();

    tree.stop();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("Task");

    tree.dispose();
  });

  it("dispose prevents further rendering", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "Task");
    tree.start();
    tree.dispose();
    writeMock.mockClear();

    vi.advanceTimersByTime(200);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("assigns different colors to different agents", () => {
    const tree = new TaskTree();
    tree.addTask("t1", "Task 1", "agent-a");
    tree.addTask("t2", "Task 2", "agent-b");
    tree.start();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("@agent-a");
    expect(output).toContain("@agent-b");

    tree.dispose();
  });
});
