import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyDockerfile } from "./verifier";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdtempSync: vi.fn(() => "/tmp/oda-hadolint-mock"),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { execFileSync } from "node:child_process";

const mockExecFileSync = vi.mocked(execFileSync);

describe("verifyDockerfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed for clean Dockerfile", async () => {
    mockExecFileSync.mockReturnValue(JSON.stringify([]));

    const result = await verifyDockerfile("FROM node:18\nCOPY . .\nRUN npm install");

    expect(result.passed).toBe(true);
    expect(result.tool).toBe("hadolint");
    expect(result.issues).toHaveLength(0);
  });

  it("returns passed with issues for Dockerfile with warnings only", async () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error("exit 1") as Error & { stdout: string };
      err.stdout = JSON.stringify([
        {
          line: 3,
          code: "DL3059",
          message: "Multiple consecutive `RUN` instructions",
          column: 1,
          file: "/tmp/Dockerfile",
          level: "info",
        },
        {
          line: 1,
          code: "DL3006",
          message: "Always tag the version of an image explicitly",
          column: 1,
          file: "/tmp/Dockerfile",
          level: "warning",
        },
      ]);
      throw err;
    });

    const result = await verifyDockerfile("FROM node\nRUN echo a\nRUN echo b");

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].severity).toBe("info");
    expect(result.issues[1].severity).toBe("warning");
    expect(result.issues[1].rule).toBe("DL3006");
    expect(result.issues[1].line).toBe(1);
  });

  it("returns failed for Dockerfile with errors", async () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error("exit 1") as Error & { stdout: string };
      err.stdout = JSON.stringify([
        {
          line: 1,
          code: "DL3007",
          message: "Using the latest tag is error-prone",
          column: 1,
          file: "/tmp/Dockerfile",
          level: "error",
        },
      ]);
      throw err;
    });

    const result = await verifyDockerfile("FROM ubuntu:latest");

    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("error");
  });

  it("returns passed with warning when hadolint is not found", async () => {
    const err = new Error("spawn hadolint ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });

    const result = await verifyDockerfile("FROM node:18");

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("warning");
    expect(result.issues[0].message).toContain("hadolint not found");
  });
});
