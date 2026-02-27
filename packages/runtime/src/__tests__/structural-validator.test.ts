import { describe, it, expect } from "vitest";
import { validateStructure } from "../structural-validator";

describe("validateStructure", () => {
  it("validates required top-level field", () => {
    const issues = validateStructure({ name: "test" }, [
      { path: "name", required: true, message: "Name required" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("reports missing required field", () => {
    const issues = validateStructure({}, [
      { path: "name", required: true, message: "Name required" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe("Name required");
    expect(issues[0].severity).toBe("error");
  });

  it("validates nested path", () => {
    const issues = validateStructure({ provider: { name: "aws" } }, [
      { path: "provider.name", required: true, message: "Provider name required" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("reports missing nested field", () => {
    const issues = validateStructure({ provider: {} }, [
      { path: "provider.name", required: true, message: "Provider name required" },
    ]);
    expect(issues).toHaveLength(1);
  });

  it("validates type checking", () => {
    const issues = validateStructure({ items: [1, 2, 3] }, [
      { path: "items", type: "array", message: "Must be array" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("reports type mismatch", () => {
    const issues = validateStructure({ items: "not-an-array" }, [
      { path: "items", type: "array", message: "Must be array" },
    ]);
    expect(issues).toHaveLength(1);
  });

  it("validates minItems on arrays", () => {
    const issues = validateStructure({ resources: [{ type: "s3" }] }, [
      { path: "resources", type: "array", minItems: 1, message: "Need at least one" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("reports minItems violation", () => {
    const issues = validateStructure({ resources: [] }, [
      { path: "resources", type: "array", minItems: 1, message: "Need at least one" },
    ]);
    expect(issues).toHaveLength(1);
  });

  it("supports wildcard * for array elements", () => {
    const data = {
      resources: [
        { type: "s3", name: "main" },
        { type: "ec2", name: "web" },
      ],
    };
    const issues = validateStructure(data, [
      { path: "resources.*.type", required: true, message: "Each resource needs type" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("reports wildcard violations", () => {
    const data = {
      resources: [
        { type: "s3", name: "main" },
        { name: "web" }, // missing type
      ],
    };
    const issues = validateStructure(data, [
      { path: "resources.*.type", required: true, message: "Each resource needs type" },
    ]);
    expect(issues).toHaveLength(1);
  });

  it("handles requiredUnless", () => {
    // When "uses" is present, "runs-on" is not required
    const data = { uses: "some/workflow@v1" };
    const issues = validateStructure(data, [
      {
        path: "runs-on",
        required: true,
        requiredUnless: "uses",
        message: "runs-on required unless using reusable workflow",
      },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("applies requiredUnless when unless path is absent", () => {
    const data = {};
    const issues = validateStructure(data, [
      {
        path: "runs-on",
        required: true,
        requiredUnless: "uses",
        message: "runs-on required",
      },
    ]);
    expect(issues).toHaveLength(1);
  });

  it("handles multiple rules", () => {
    const data = { name: "test" };
    const issues = validateStructure(data, [
      { path: "name", required: true, message: "Name required" },
      { path: "version", required: true, message: "Version required" },
      { path: "description", required: true, message: "Description required" },
    ]);
    expect(issues).toHaveLength(2);
  });
});
