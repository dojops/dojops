import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";

// ── Mocks ────────────────────────────────────────────────────────────

const { mockLog, mockNote } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  mockNote: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  note: mockNote,
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
}));

vi.mock("../../state", () => ({
  findProjectRoot: vi.fn(() => null),
}));

vi.mock("../../offline", () => ({
  isOfflineMode: vi.fn(() => false),
  findCachedSkill: vi.fn(() => null),
  ensureSkillCache: vi.fn(),
  listCachedSkills: vi.fn(() => []),
  exportSkillBundle: vi.fn(),
  importSkillBundle: vi.fn(),
}));

vi.mock("../../skill-manifest", () => ({
  recordInstall: vi.fn(),
  loadManifest: vi.fn(() => null),
}));

import { skillsValidateCommand } from "../../commands/skills";
import { CLIError } from "../../exit-codes";
import type { CLIContext } from "../../types";

const SKILLS_DIR = path.resolve(__dirname, "../../../../runtime/skills");

function makeCtx(): CLIContext {
  return {
    globalOpts: {
      output: "table",
      raw: false,
      nonInteractive: true,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      dryRun: false,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("not implemented");
    },
  };
}

// ── Validation tests using real .dops files ──────────────────────────

describe("skillsValidateCommand with real built-in skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no argument provided", async () => {
    await expect(skillsValidateCommand([], makeCtx())).rejects.toThrow(CLIError);
  });

  it("validates terraform.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "terraform.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("terraform"));
  });

  it("validates github-actions.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "github-actions.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("github-actions"));
  });

  it("validates kubernetes.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "kubernetes.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("kubernetes"));
  });

  it("validates helm.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "helm.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("helm"));
  });

  it("validates ansible.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "ansible.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("ansible"));
  });

  it("validates dockerfile.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "dockerfile.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("dockerfile"));
  });

  it("validates systemd.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "systemd.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("systemd"));
  });

  it("validates packer.dops successfully", async () => {
    const dopsPath = path.join(SKILLS_DIR, "packer.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("packer"));
  });

  it("reports structural rules count for kubernetes", async () => {
    const dopsPath = path.join(SKILLS_DIR, "kubernetes.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Structural rules"));
  });

  it("reports binary verifier for terraform", async () => {
    const dopsPath = path.join(SKILLS_DIR, "terraform.dops");
    await skillsValidateCommand([dopsPath], makeCtx());
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Binary verifier"));
  });

  it("throws for nonexistent .dops file", async () => {
    await expect(skillsValidateCommand(["/tmp/nonexistent.dops"], makeCtx())).rejects.toThrow(
      CLIError,
    );
  });

  it("throws for invalid skill name (no .dops file found)", async () => {
    await expect(skillsValidateCommand(["completely-unknown-skill"], makeCtx())).rejects.toThrow(
      CLIError,
    );
  });
});

// ── Skills list tests ────────────────────────────────────────────────

describe("skillsListCommand output format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("outputs valid JSON array for --output json", async () => {
    const { skillsListCommand } = await import("../../commands/skills");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const jsonCtx = {
      ...makeCtx(),
      globalOpts: { ...makeCtx().globalOpts, output: "json" as const },
    };
    await skillsListCommand([], jsonCtx);

    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(Array.isArray(output)).toBe(true);
    spy.mockRestore();
  });
});
