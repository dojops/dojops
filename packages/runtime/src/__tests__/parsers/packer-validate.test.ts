import { describe, it, expect } from "vitest";
import { parsePackerValidate } from "../../parsers/packer-validate";

describe("parsePackerValidate", () => {
  it("returns no issues for success message", () => {
    const issues = parsePackerValidate("The configuration is valid.");
    expect(issues).toHaveLength(0);
  });

  it("returns no issues for empty output", () => {
    expect(parsePackerValidate("")).toHaveLength(0);
  });

  it("detects error lines", () => {
    const output = `Error: 1 error(s) occurred:

* Unknown provisioner type "ansible-local"`;
    const issues = parsePackerValidate(output);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("detects warning lines", () => {
    const issues = parsePackerValidate("Warning: Fixable syntax errors were found.");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("ignores context lines that are not errors or warnings", () => {
    const output = `Initializing plugins...
Installed plugin github.com/hashicorp/qemu v1.1.0
The configuration is valid.`;
    const issues = parsePackerValidate(output);
    expect(issues).toHaveLength(0);
  });

  it("handles multi-error output", () => {
    const output = `Error: 2 error(s) occurred:

* Missing required argument "iso_url"
* Error: Unknown post-processor type "vagrant"`;
    const issues = parsePackerValidate(output);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
