import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────────────────

export type PlanStatus = "drafting" | "pending_approval" | "approved" | "rejected";

export interface PlanFile {
  /** Slug-based filename (without extension). */
  id: string;
  /** Absolute path to the plan file. */
  filePath: string;
  /** Plan title (from first heading or filename). */
  title: string;
  status: PlanStatus;
  /** Full markdown content of the plan. */
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanModeState {
  /** Whether plan mode is currently active. */
  active: boolean;
  /** The plan being drafted (null when not in plan mode). */
  currentPlanId: string | null;
  /** Tools that are allowed in plan mode (read-only). */
  allowedTools: readonly string[];
}

export interface PlanManagerOptions {
  /** Directory where plan files are stored. Defaults to `~/.dojops/plans/`. */
  plansDir?: string;
}

// ── Constants ────────────────────────────────────────────────────────

/** Tools permitted in plan mode — read-only exploration only. */
const PLAN_MODE_TOOLS: readonly string[] = [
  "read_file",
  "search_files",
  "list_files",
  "search_skills",
  "run_command", // allowed but only non-destructive commands (enforced externally)
] as const;

const STATUS_MARKER_RE = /^<!--\s*status:\s*(drafting|pending_approval|approved|rejected)\s*-->$/m;
// NOSONAR — bounded markdown title regex on internal plan files; no backtracking risk (`.+` anchored to `$` with `m` flag)
const TITLE_RE = /^#\s+(.+)$/m; // NOSONAR

// ── PlanManager ──────────────────────────────────────────────────────

/**
 * Manages plan mode lifecycle: entering read-only exploration, writing plan
 * files, approval workflow, and resuming from approved plans.
 *
 * Plan files are stored as markdown at `~/.dojops/plans/<slug>.md` with a
 * status marker comment. The PermissionGate (P8) enforces tool restrictions
 * when plan mode is active.
 */
export class PlanManager {
  readonly plansDir: string;
  private state: PlanModeState;

  constructor(opts: PlanManagerOptions = {}) {
    this.plansDir = opts.plansDir ?? path.join(homedir(), ".dojops", "plans");
    this.state = {
      active: false,
      currentPlanId: null,
      allowedTools: PLAN_MODE_TOOLS,
    };
  }

  /** Get current plan mode state. */
  getState(): Readonly<PlanModeState> {
    return { ...this.state };
  }

  /** Whether plan mode is currently active. */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * Enter plan mode. Creates a new plan file in drafting state.
   * Returns the plan ID for the new plan.
   */
  enter(title: string): string {
    if (this.state.active) {
      throw new PlanModeError("Already in plan mode");
    }

    this.ensureDir();
    const id = toSlug(title);
    const filePath = path.join(this.plansDir, `${id}.md`);

    const now = new Date().toISOString();
    const content = [
      `<!-- status: drafting -->`,
      `# ${title}`,
      "",
      `*Created: ${now}*`,
      "",
      "## Exploration notes",
      "",
      "",
      "## Plan",
      "",
      "",
    ].join("\n");

    fs.writeFileSync(filePath, content, "utf-8");

    this.state = {
      active: true,
      currentPlanId: id,
      allowedTools: PLAN_MODE_TOOLS,
    };

    return id;
  }

  /**
   * Exit plan mode and move the current plan to pending_approval.
   * Returns the plan file for review.
   */
  exit(): PlanFile {
    if (!this.state.active || !this.state.currentPlanId) {
      throw new PlanModeError("Not in plan mode");
    }

    const plan = this.load(this.state.currentPlanId);
    if (!plan) {
      throw new PlanModeError(`Plan '${this.state.currentPlanId}' not found`);
    }

    this.updateStatus(plan.id, "pending_approval");
    const updated = this.load(plan.id)!;

    this.state = {
      active: false,
      currentPlanId: null,
      allowedTools: PLAN_MODE_TOOLS,
    };

    return updated;
  }

  /** Update the plan content (only while in plan mode and drafting). */
  updateContent(planId: string, content: string): void {
    const plan = this.load(planId);
    if (!plan) throw new PlanModeError(`Plan '${planId}' not found`);
    if (plan.status !== "drafting") {
      throw new PlanModeError(`Cannot update plan in '${plan.status}' state`);
    }

    // Preserve the status marker, replace the rest
    const withMarker = `<!-- status: drafting -->\n${content}`;
    fs.writeFileSync(plan.filePath, withMarker, "utf-8");
  }

  /** Approve a pending plan. Returns the updated plan. */
  approve(planId: string): PlanFile {
    const plan = this.load(planId);
    if (!plan) throw new PlanModeError(`Plan '${planId}' not found`);
    if (plan.status !== "pending_approval") {
      throw new PlanModeError(`Cannot approve plan in '${plan.status}' state`);
    }
    this.updateStatus(planId, "approved");
    return this.load(planId)!;
  }

  /** Reject a pending plan. Returns the updated plan. */
  reject(planId: string): PlanFile {
    const plan = this.load(planId);
    if (!plan) throw new PlanModeError(`Plan '${planId}' not found`);
    if (plan.status !== "pending_approval") {
      throw new PlanModeError(`Cannot reject plan in '${plan.status}' state`);
    }
    this.updateStatus(planId, "rejected");
    return this.load(planId)!;
  }

  /** Load a plan by ID. Returns null if not found. */
  load(planId: string): PlanFile | null {
    const filePath = path.join(this.plansDir, `${planId}.md`);
    if (!fs.existsSync(filePath)) return null;
    return this.parseFile(filePath, planId);
  }

  /** List all plan files, sorted by most recent first. */
  list(): PlanFile[] {
    if (!fs.existsSync(this.plansDir)) return [];

    const files = fs.readdirSync(this.plansDir).filter((f) => f.endsWith(".md"));
    const plans: PlanFile[] = [];

    for (const file of files) {
      const id = file.replace(/\.md$/, "");
      const plan = this.parseFile(path.join(this.plansDir, file), id);
      if (plan) plans.push(plan);
    }

    return plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** List plans filtered by status. */
  listByStatus(status: PlanStatus): PlanFile[] {
    return this.list().filter((p) => p.status === status);
  }

  /** Delete a plan file. */
  delete(planId: string): boolean {
    const filePath = path.join(this.plansDir, `${planId}.md`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private ensureDir(): void {
    if (!fs.existsSync(this.plansDir)) {
      fs.mkdirSync(this.plansDir, { recursive: true });
    }
  }

  private updateStatus(planId: string, status: PlanStatus): void {
    const filePath = path.join(this.plansDir, `${planId}.md`);
    let content = fs.readFileSync(filePath, "utf-8");

    if (STATUS_MARKER_RE.test(content)) {
      content = content.replace(STATUS_MARKER_RE, `<!-- status: ${status} -->`);
    } else {
      content = `<!-- status: ${status} -->\n${content}`;
    }

    fs.writeFileSync(filePath, content, "utf-8");
  }

  private parseFile(filePath: string, id: string): PlanFile | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const stat = fs.statSync(filePath);

      // Extract status from marker comment
      const statusMatch = STATUS_MARKER_RE.exec(content);
      const status = (statusMatch?.[1] as PlanStatus) ?? "drafting";

      // Extract title from first heading
      const titleMatch = TITLE_RE.exec(content);
      const title = titleMatch?.[1] ?? id;

      return {
        id,
        filePath,
        title,
        status,
        content,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }
}

// ── Errors ───────────────────────────────────────────────────────────

export class PlanModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanModeError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function homedir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") // NOSONAR: two independent anchored alternatives (^-+ and -+$) with no overlapping quantifiers; linear runtime
    .slice(0, 60);
}
