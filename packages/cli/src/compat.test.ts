import { describe, it, expect } from "vitest";
import { remapLegacyArgs } from "./compat";

describe("remapLegacyArgs", () => {
  it("maps --plan to plan command", () => {
    expect(remapLegacyArgs(["--plan", "Create CI"])).toEqual(["plan", "Create CI"]);
  });

  it("maps --execute to plan --execute", () => {
    expect(remapLegacyArgs(["--execute", "Create CI"])).toEqual(["plan", "--execute", "Create CI"]);
  });

  it("maps --plan with --execute preserved", () => {
    expect(remapLegacyArgs(["--plan", "--execute", "Create CI"])).toEqual([
      "plan",
      "--execute",
      "Create CI",
    ]);
  });

  it("maps --debug-ci to debug ci", () => {
    expect(remapLegacyArgs(["--debug-ci", "ERROR: tsc failed"])).toEqual([
      "debug",
      "ci",
      "ERROR: tsc failed",
    ]);
  });

  it("maps --diff to analyze diff", () => {
    expect(remapLegacyArgs(["--diff", "terraform output"])).toEqual([
      "analyze",
      "diff",
      "terraform output",
    ]);
  });

  it("maps login to auth login", () => {
    expect(remapLegacyArgs(["login", "--token", "abc"])).toEqual([
      "auth",
      "login",
      "--token",
      "abc",
    ]);
  });

  it("maps config --show to config show", () => {
    expect(remapLegacyArgs(["config", "--show"])).toEqual(["config", "show"]);
  });

  it("passes through new-style commands unchanged", () => {
    expect(remapLegacyArgs(["plan", "Create CI"])).toEqual(["plan", "Create CI"]);
    expect(remapLegacyArgs(["debug", "ci", "log"])).toEqual(["debug", "ci", "log"]);
    expect(remapLegacyArgs(["serve"])).toEqual(["serve"]);
  });

  it("passes through prompt-only usage unchanged", () => {
    expect(remapLegacyArgs(["Create a Terraform config"])).toEqual(["Create a Terraform config"]);
  });
});
