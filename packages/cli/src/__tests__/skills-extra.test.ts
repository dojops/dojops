import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExitCode, CLIError } from "../exit-codes";
import { CLIContext } from "../types";

const { mockLog, mockSpinner } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockSpinner: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  spinner: vi.fn(() => mockSpinner),
  note: vi.fn(),
}));

vi.mock("@dojops/skill-registry", () => ({
  discoverUserDopsFiles: vi.fn(() => []),
}));

vi.mock("@dojops/runtime", () => ({
  parseDopsFile: vi.fn(),
}));

vi.mock("../state", () => ({
  findProjectRoot: vi.fn(() => null),
}));

vi.mock("../offline", () => ({
  exportSkillBundle: vi.fn(),
  importSkillBundle: vi.fn(),
}));

import {
  skillsUpdateCommand,
  skillsExportCommand,
  skillsImportCommand,
} from "../commands/skills-extra";
import { exportSkillBundle, importSkillBundle } from "../offline";
import { discoverUserDopsFiles } from "@dojops/skill-registry";
import { parseDopsFile } from "@dojops/runtime";

function makeCtx(overrides?: Partial<CLIContext["globalOpts"]>): CLIContext {
  return {
    globalOpts: {
      output: "table",
      raw: false,
      nonInteractive: false,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      dryRun: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("not implemented");
    },
  };
}

describe("skillsUpdateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof skillsUpdateCommand).toBe("function");
  });

  it("reports no skills when none are installed", async () => {
    vi.mocked(discoverUserDopsFiles).mockReturnValue([]);

    await skillsUpdateCommand([], makeCtx());

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("No custom skills"));
  });

  it("outputs empty JSON when no skills installed and --output=json", async () => {
    vi.mocked(discoverUserDopsFiles).mockReturnValue([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await skillsUpdateCommand([], makeCtx({ output: "json" }));

    expect(consoleSpy).toHaveBeenCalledWith("[]");
    consoleSpy.mockRestore();
  });

  it("throws CLIError when targeting a skill name that is not installed", async () => {
    vi.mocked(discoverUserDopsFiles).mockReturnValue([
      { filePath: "/skills/my-skill.dops", location: "project" },
    ] as ReturnType<typeof discoverUserDopsFiles>);
    vi.mocked(parseDopsFile).mockReturnValue({
      frontmatter: { meta: { name: "my-skill", version: "1.0.0" } },
    } as ReturnType<typeof parseDopsFile>);

    await expect(skillsUpdateCommand(["nonexistent"], makeCtx())).rejects.toThrow(CLIError);

    try {
      await skillsUpdateCommand(["nonexistent"], makeCtx());
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.VALIDATION_ERROR);
      expect((e as CLIError).message).toContain("nonexistent");
    }
  });
});

describe("skillsExportCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof skillsExportCommand).toBe("function");
  });

  it("throws CLIError when no export path is given", async () => {
    await expect(skillsExportCommand([], makeCtx())).rejects.toThrow(CLIError);

    try {
      await skillsExportCommand([], makeCtx());
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.VALIDATION_ERROR);
      expect((e as CLIError).message).toContain("Export path required");
    }
  });

  it("calls exportSkillBundle with the resolved path", async () => {
    vi.mocked(exportSkillBundle).mockReturnValue({ count: 3 });

    await skillsExportCommand(["/tmp/export"], makeCtx());

    expect(exportSkillBundle).toHaveBeenCalledWith(
      expect.stringContaining("export"),
      expect.any(String),
    );
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("3 skill(s)"));
  });

  it("throws CLIError when exportSkillBundle fails", async () => {
    vi.mocked(exportSkillBundle).mockImplementation(() => {
      throw new Error("disk full");
    });

    await expect(skillsExportCommand(["/tmp/export"], makeCtx())).rejects.toThrow(CLIError);
  });
});

describe("skillsImportCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof skillsImportCommand).toBe("function");
  });

  it("throws CLIError when no import path is given", async () => {
    await expect(skillsImportCommand([], makeCtx())).rejects.toThrow(CLIError);

    try {
      await skillsImportCommand([], makeCtx());
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.VALIDATION_ERROR);
      expect((e as CLIError).message).toContain("Import path required");
    }
  });

  it("calls importSkillBundle with the resolved path", async () => {
    vi.mocked(importSkillBundle).mockReturnValue({ count: 5 });

    await skillsImportCommand(["/tmp/import"], makeCtx());

    expect(importSkillBundle).toHaveBeenCalledWith(expect.stringContaining("import"));
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("5 skill(s)"));
  });

  it("throws CLIError when importSkillBundle fails", async () => {
    vi.mocked(importSkillBundle).mockImplementation(() => {
      throw new Error("path not found");
    });

    await expect(skillsImportCommand(["/tmp/import"], makeCtx())).rejects.toThrow(CLIError);
  });
});
