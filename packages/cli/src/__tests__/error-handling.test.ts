import { describe, it, expect } from "vitest";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";

// ── CLIError construction ──────────────────────────────────────────

describe("CLIError — construction and properties", () => {
  it("has exitCode and message", () => {
    const err = new CLIError(ExitCode.GENERAL_ERROR, "Something went wrong");
    expect(err.exitCode).toBe(1);
    expect(err.message).toBe("Something went wrong");
    expect(err.name).toBe("CLIError");
  });

  it("defaults to empty message when none provided", () => {
    const err = new CLIError(ExitCode.VALIDATION_ERROR);
    expect(err.exitCode).toBe(2);
    expect(err.message).toBe("");
  });

  it("extends Error", () => {
    const err = new CLIError(ExitCode.SUCCESS);
    expect(err).toBeInstanceOf(Error);
  });

  it("supports all exit codes", () => {
    const codes: Array<[string, number]> = [
      ["SUCCESS", 0],
      ["GENERAL_ERROR", 1],
      ["VALIDATION_ERROR", 2],
      ["APPROVAL_REQUIRED", 3],
      ["LOCK_CONFLICT", 4],
      ["NO_PROJECT", 5],
      ["SECURITY_ISSUES", 6],
      ["CRITICAL_VULNERABILITIES", 7],
    ];

    for (const [name, code] of codes) {
      const err = new CLIError(code as (typeof ExitCode)[keyof typeof ExitCode], name);
      expect(err.exitCode).toBe(code);
      expect(err.message).toBe(name);
    }
  });
});

// ── toErrorMessage — edge cases ────────────────────────────────────

describe("toErrorMessage — error extraction edge cases", () => {
  it("extracts message from Error", () => {
    expect(toErrorMessage(new Error("test error"))).toBe("test error");
  });

  it("extracts message from CLIError", () => {
    expect(toErrorMessage(new CLIError(ExitCode.GENERAL_ERROR, "CLI failed"))).toBe("CLI failed");
  });

  it("converts string to message", () => {
    expect(toErrorMessage("raw string error")).toBe("raw string error");
  });

  it("converts number to message", () => {
    expect(toErrorMessage(42)).toBe("42");
  });

  it("converts null to message", () => {
    expect(toErrorMessage(null)).toBe("null");
  });

  it("converts undefined to message", () => {
    expect(toErrorMessage(undefined)).toBe("undefined");
  });

  it("converts object to message", () => {
    expect(toErrorMessage({ code: "ERR" })).toBe("[object Object]");
  });

  it("converts boolean to message", () => {
    expect(toErrorMessage(false)).toBe("false");
  });

  it("handles Error with empty message", () => {
    expect(toErrorMessage(new Error(""))).toBe("");
  });

  it("handles nested Error (Error with cause)", () => {
    const cause = new Error("root cause");
    const err = new Error("wrapper", { cause });
    expect(toErrorMessage(err)).toBe("wrapper");
  });

  it("handles TypeError", () => {
    expect(toErrorMessage(new TypeError("Cannot read properties of undefined"))).toBe(
      "Cannot read properties of undefined",
    );
  });

  it("handles RangeError", () => {
    expect(toErrorMessage(new RangeError("Maximum call stack size exceeded"))).toBe(
      "Maximum call stack size exceeded",
    );
  });
});

// ── ExitCode values ────────────────────────────────────────────────

describe("ExitCode — value correctness", () => {
  it("SUCCESS is 0", () => {
    expect(ExitCode.SUCCESS).toBe(0);
  });

  it("GENERAL_ERROR is 1", () => {
    expect(ExitCode.GENERAL_ERROR).toBe(1);
  });

  it("VALIDATION_ERROR is 2", () => {
    expect(ExitCode.VALIDATION_ERROR).toBe(2);
  });

  it("APPROVAL_REQUIRED is 3", () => {
    expect(ExitCode.APPROVAL_REQUIRED).toBe(3);
  });

  it("LOCK_CONFLICT is 4", () => {
    expect(ExitCode.LOCK_CONFLICT).toBe(4);
  });

  it("NO_PROJECT is 5", () => {
    expect(ExitCode.NO_PROJECT).toBe(5);
  });

  it("SECURITY_ISSUES is 6", () => {
    expect(ExitCode.SECURITY_ISSUES).toBe(6);
  });

  it("CRITICAL_VULNERABILITIES is 7", () => {
    expect(ExitCode.CRITICAL_VULNERABILITIES).toBe(7);
  });

  it("all codes are unique", () => {
    const values = Object.values(ExitCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it("all codes are non-negative integers", () => {
    for (const code of Object.values(ExitCode)) {
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── CLIError in control flow patterns ──────────────────────────────

describe("CLIError — control flow patterns", () => {
  it("can be caught and inspected", () => {
    try {
      throw new CLIError(ExitCode.VALIDATION_ERROR, "Missing required argument");
    } catch (e) {
      expect(e).toBeInstanceOf(CLIError);
      expect((e as CLIError).exitCode).toBe(2);
    }
  });

  it("can be re-thrown with different exit code", () => {
    try {
      try {
        throw new CLIError(ExitCode.GENERAL_ERROR, "original");
      } catch (e) {
        throw new CLIError(ExitCode.SECURITY_ISSUES, (e as CLIError).message);
      }
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(6);
      expect((e as CLIError).message).toBe("original");
    }
  });

  it("can wrap unknown errors", () => {
    const unknown: unknown = { status: 500, body: "Internal Server Error" };
    const err = new CLIError(ExitCode.GENERAL_ERROR, toErrorMessage(unknown));
    expect(err.message).toBe("[object Object]");
    expect(err.exitCode).toBe(1);
  });
});
