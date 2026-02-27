import { describe, it, expect } from "vitest";
import { parseGenericStderr } from "../../parsers/generic-stderr";
import { parseGenericJson } from "../../parsers/generic-json";
import { parseKubectlStderr } from "../../parsers/kubectl-stderr";
import { parseHelmLint } from "../../parsers/helm-lint";
import { parseNginxStderr } from "../../parsers/nginx-stderr";

describe("parseGenericStderr", () => {
  it("detects error lines", () => {
    const issues = parseGenericStderr("error: something failed\nwarning: check this");
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("error");
    expect(issues[1].severity).toBe("warning");
  });

  it("treats unknown lines as error when nothing else matched", () => {
    const issues = parseGenericStderr("something happened");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("uses custom severity mapping", () => {
    const issues = parseGenericStderr("CRITICAL: disk full", {
      error: ["critical"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });
});

describe("parseGenericJson", () => {
  it("parses array of issues", () => {
    const output = JSON.stringify([
      { severity: "error", message: "Bad config" },
      { severity: "warning", message: "Check this" },
    ]);
    const issues = parseGenericJson(output);
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("error");
  });

  it("parses object with errors field", () => {
    const output = JSON.stringify({ errors: [{ message: "Failed" }] });
    const issues = parseGenericJson(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe("Failed");
  });

  it("handles invalid JSON", () => {
    const issues = parseGenericJson("not json");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });
});

describe("parseKubectlStderr", () => {
  it("parses error lines", () => {
    const issues = parseKubectlStderr(
      "error: unable to recognize: invalid object\nerror: missing field",
    );
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("error");
  });

  it("handles empty output", () => {
    const issues = parseKubectlStderr("");
    expect(issues).toHaveLength(1);
  });
});

describe("parseHelmLint", () => {
  it("parses helm lint output", () => {
    const output =
      "[ERROR] templates/: parse error\n[WARNING] chart: icon recommended\n[INFO] success";
    const issues = parseHelmLint(output);
    expect(issues).toHaveLength(3);
    expect(issues[0].severity).toBe("error");
    expect(issues[1].severity).toBe("warning");
    expect(issues[2].severity).toBe("info");
  });
});

describe("parseNginxStderr", () => {
  it("parses nginx error output", () => {
    const output =
      "nginx: [emerg] unexpected end of file\nnginx: configuration file test is successful";
    const issues = parseNginxStderr(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });
});
