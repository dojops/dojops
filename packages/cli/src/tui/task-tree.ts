/**
 * Multi-agent progress tree for agent iterations and sub-agent workers.
 *
 * Renders a tree structure with animated status indicators:
 *
 *   ├─ ✓ Generate Dockerfile (@docker) · 3 tools · 1.2K tokens  2.1s
 *   ├─ ▪ Create CI pipeline (@ci-expert) · 1 tool · 450 tokens
 *   └─ ▫ Write README (@general)
 */
import pc from "picocolors";
import { Animator, SPINNER_GLYPHS, cycleGlyph, isTTY, formatDuration } from "./animator";

// ── Types ───────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskNode {
  id: string;
  label: string;
  agent?: string;
  status: TaskStatus;
  toolCount: number;
  tokenCount: number;
  startMs: number;
  endMs?: number;
}

// ── Constants ───────────────────────────────────────────────────────

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "▫",
  running: "▪",
  completed: "✓",
  failed: "✗",
};

const TREE_MID = "├─";
const TREE_END = "└─";

const AGENT_COLORS = [pc.magenta, pc.cyan, pc.yellow, pc.blue, pc.green] as const;

// ── TaskTree ────────────────────────────────────────────────────────

export class TaskTree {
  private readonly animator: Animator;
  private readonly nodes: Map<string, TaskNode> = new Map();
  private readonly order: string[] = []; // insertion order for rendering
  private readonly colorMap: Map<string, (s: string) => string> = new Map();
  private colorIndex = 0;
  private active = false;
  private disposed = false;

  constructor() {
    this.animator = new Animator();
  }

  /** Add a task to the tree. */
  addTask(id: string, label: string, agent?: string): void {
    if (this.nodes.has(id)) return;

    // Assign agent color
    if (agent && !this.colorMap.has(agent)) {
      this.colorMap.set(agent, AGENT_COLORS[this.colorIndex % AGENT_COLORS.length]);
      this.colorIndex++;
    }

    const node: TaskNode = {
      id,
      label,
      agent,
      status: "pending",
      toolCount: 0,
      tokenCount: 0,
      startMs: Date.now(),
    };

    this.nodes.set(id, node);
    this.order.push(id);
  }

  /** Update a task's status. */
  updateTask(id: string, status: TaskStatus): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = status;
    if (status === "running") {
      node.startMs = Date.now();
    }
    if (status === "completed" || status === "failed") {
      node.endMs = Date.now();
    }
  }

  /** Increment tool count for a task. */
  incrementTools(id: string): void {
    const node = this.nodes.get(id);
    if (node) node.toolCount++;
  }

  /** Increment token count for a task. */
  incrementTokens(id: string, count: number): void {
    const node = this.nodes.get(id);
    if (node) node.tokenCount += count;
  }

  /** Begin animated rendering of the tree. */
  start(): void {
    if (this.active || this.disposed) return;
    this.active = true;

    if (!isTTY()) {
      return; // non-TTY: use logLine instead
    }

    this.animator.start(() => this.render());
  }

  /** Stop animation, print final static tree. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.animator.stop();

    // Print final state as static lines
    const lines = this.render();
    if (lines.length > 0) {
      process.stdout.write(lines.join("\n") + "\n");
    }
  }

  /** Log a single task change in non-TTY mode. */
  logLine(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const idx = this.order.indexOf(id);
    const isLast = idx === this.order.length - 1;
    process.stdout.write(this.renderNode(node, isLast, 0) + "\n");
  }

  get taskCount(): number {
    return this.nodes.size;
  }

  /** Clean up. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) {
      this.active = false;
      this.animator.stop();
    }
    this.animator.dispose();
  }

  // ── Private ─────────────────────────────────────────────────────

  private render(): string[] {
    const lines: string[] = [];
    const frame = this.animator.currentFrame;

    for (let i = 0; i < this.order.length; i++) {
      const node = this.nodes.get(this.order[i]);
      if (!node) continue;
      const isLast = i === this.order.length - 1;
      lines.push(this.renderNode(node, isLast, frame));
    }

    return lines;
  }

  private statusIcon(status: TaskStatus, frame: number): string {
    const iconMap: Record<TaskStatus, () => string> = {
      running: () => pc.cyan(cycleGlyph(frame, SPINNER_GLYPHS)),
      completed: () => pc.green(STATUS_ICONS.completed),
      failed: () => pc.red(STATUS_ICONS.failed),
      pending: () => pc.dim(STATUS_ICONS.pending),
    };
    return iconMap[status]();
  }

  private nodeStats(node: TaskNode): string[] {
    const stats: string[] = [];
    if (node.toolCount > 0) {
      stats.push(`${node.toolCount} tool${node.toolCount === 1 ? "" : "s"}`);
    }
    if (node.tokenCount > 0) {
      const count =
        node.tokenCount < 1000
          ? `${node.tokenCount}`
          : `${(node.tokenCount / 1000).toFixed(1).replace(/\.0$/, "")}K`;
      stats.push(`${count} tokens`);
    }
    if (node.endMs && (node.status === "completed" || node.status === "failed")) {
      stats.push(formatDuration(node.endMs - node.startMs));
    } else if (node.status === "running") {
      stats.push(formatDuration(Date.now() - node.startMs));
    }
    return stats;
  }

  private renderNode(node: TaskNode, isLast: boolean, frame: number): string {
    const connector = isLast ? TREE_END : TREE_MID;
    const icon = this.statusIcon(node.status, frame);

    let agentBadge = "";
    if (node.agent) {
      const agentLabel = `(@${node.agent})`;
      const colorFn = this.colorMap.get(node.agent) ?? pc.dim;
      agentBadge = ` ${colorFn(agentLabel)}`;
    }

    const stats = this.nodeStats(node);
    const statsStr = stats.length > 0 ? `${pc.dim(" · ")}${pc.dim(stats.join(" · "))}` : "";

    let label: string;
    if (node.status === "pending") {
      label = pc.dim(node.label);
    } else if (node.status === "failed") {
      label = pc.red(node.label);
    } else {
      label = node.label;
    }

    return `${pc.dim(connector)} ${icon} ${label}${agentBadge}${statsStr}`;
  }
}
