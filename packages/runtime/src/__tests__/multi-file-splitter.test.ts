import { describe, it, expect } from "vitest";
import { splitMultiFileOutput, isMultiFileSkill } from "../multi-file-splitter";

describe("splitMultiFileOutput", () => {
  it("returns single unnamed file when no markers", () => {
    const result = splitMultiFileOutput("apiVersion: apps/v1\nkind: Deployment");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("");
    expect(result[0].content).toContain("apiVersion");
  });

  it("splits files using --- FILE: marker", () => {
    const output = `--- FILE: deployment.yaml ---
apiVersion: apps/v1
kind: Deployment
--- FILE: service.yaml ---
apiVersion: v1
kind: Service`;

    const result = splitMultiFileOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("deployment.yaml");
    expect(result[0].content).toContain("Deployment");
    expect(result[1].path).toBe("service.yaml");
    expect(result[1].content).toContain("Service");
  });

  it("splits files using # FILE: marker", () => {
    const output = `# FILE: values.yaml
replicaCount: 1
# FILE: Chart.yaml
name: myapp
version: 1.0.0`;

    const result = splitMultiFileOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("values.yaml");
    expect(result[1].path).toBe("Chart.yaml");
  });

  it("handles paths with directories", () => {
    const output = `--- FILE: k8s/deployment.yaml ---
content1
--- FILE: k8s/service.yaml ---
content2`;

    const result = splitMultiFileOutput(output);
    expect(result[0].path).toBe("k8s/deployment.yaml");
    expect(result[1].path).toBe("k8s/service.yaml");
  });

  it("handles empty content between markers", () => {
    const output = `--- FILE: empty.yaml ---
--- FILE: filled.yaml ---
content`;

    const result = splitMultiFileOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("filled.yaml");
  });

  it("handles empty input", () => {
    const result = splitMultiFileOutput("");
    expect(result).toEqual([]);
  });

  it("trims whitespace from content", () => {
    const output = `--- FILE: test.yaml ---

  content with spaces

--- FILE: test2.yaml ---
other content`;

    const result = splitMultiFileOutput(output);
    expect(result[0].content).toBe("content with spaces");
  });
});

describe("isMultiFileSkill", () => {
  it("returns false for single-file skills", () => {
    expect(isMultiFileSkill([{ path: "output.yaml" }])).toBe(false);
  });

  it("returns true for multi-file skills", () => {
    expect(isMultiFileSkill([{ path: "a.yaml" }, { path: "b.yaml" }])).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(isMultiFileSkill([])).toBe(false);
  });
});
