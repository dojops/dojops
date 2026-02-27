import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../registry";
import { CustomTool } from "../custom-tool";
import { DevOpsTool } from "@dojops/sdk";
import { z } from "zod";

function createMockTool(name: string, description = "desc"): DevOpsTool {
  return {
    name,
    description,
    inputSchema: z.object({ input: z.string() }),
    validate: vi.fn().mockReturnValue({ valid: true }),
    generate: vi.fn().mockResolvedValue({ success: true, data: {} }),
  };
}

function createMockCustomTool(
  name: string,
  sourceOverrides?: Partial<{ location: string; toolVersion: string; toolHash: string }>,
): CustomTool {
  const tool = createMockTool(name) as unknown as CustomTool;
  Object.defineProperty(tool, "source", {
    value: {
      type: "custom",
      location: sourceOverrides?.location ?? "project",
      toolVersion: sourceOverrides?.toolVersion,
      toolHash: sourceOverrides?.toolHash,
    },
  });
  return tool;
}

describe("ToolRegistry", () => {
  it("returns all built-in tools when no custom tools", () => {
    const builtIn = [createMockTool("tool-a"), createMockTool("tool-b")];
    const registry = new ToolRegistry(builtIn, []);

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it("returns built-in + custom tools combined", () => {
    const builtIn = [createMockTool("tool-a")];
    const customTools = [createMockCustomTool("tool-b")];
    const registry = new ToolRegistry(builtIn, customTools);

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it("custom tool overrides built-in with same name", () => {
    const builtIn = [createMockTool("shared-tool", "built-in desc")];
    const customTools = [createMockCustomTool("shared-tool")];
    // Override the description for test
    (customTools[0] as unknown as { description: string }).description = "custom desc";
    const registry = new ToolRegistry(builtIn, customTools);

    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get("shared-tool")!.description).toBe("custom desc");
  });

  it("get returns tool by name", () => {
    const registry = new ToolRegistry([createMockTool("my-tool")], []);

    expect(registry.get("my-tool")).toBeDefined();
    expect(registry.get("my-tool")!.name).toBe("my-tool");
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("has returns true for existing tools", () => {
    const registry = new ToolRegistry([createMockTool("tool-a")], []);

    expect(registry.has("tool-a")).toBe(true);
    expect(registry.has("tool-b")).toBe(false);
  });

  it("getBuiltIn returns only built-in tools", () => {
    const builtIn = [createMockTool("built-in-a"), createMockTool("built-in-b")];
    const customTools = [createMockCustomTool("custom-a")];
    const registry = new ToolRegistry(builtIn, customTools);

    const result = registry.getBuiltIn();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("built-in-a");
  });

  it("getCustomTools returns only custom tools", () => {
    const builtIn = [createMockTool("built-in-a")];
    const customTools = [createMockCustomTool("custom-a"), createMockCustomTool("custom-b")];
    const registry = new ToolRegistry(builtIn, customTools);

    const result = registry.getCustomTools();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("custom-a");
  });

  it("getBuiltIn returns a copy (not internal array)", () => {
    const builtIn = [createMockTool("tool-a")];
    const registry = new ToolRegistry(builtIn, []);

    const result1 = registry.getBuiltIn();
    const result2 = registry.getBuiltIn();
    expect(result1).not.toBe(result2);
    expect(result1).toEqual(result2);
  });

  it("handles empty registry", () => {
    const registry = new ToolRegistry([], []);

    expect(registry.getAll()).toHaveLength(0);
    expect(registry.size).toBe(0);
    expect(registry.get("anything")).toBeUndefined();
    expect(registry.has("anything")).toBe(false);
  });

  it("preserves order: built-in first, then custom", () => {
    const builtIn = [createMockTool("alpha"), createMockTool("beta")];
    const customTools = [createMockCustomTool("gamma")];
    const registry = new ToolRegistry(builtIn, customTools);

    const names = registry.getAll().map((t) => t.name);
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  describe("getToolMetadata", () => {
    it("returns built-in for a built-in tool", () => {
      const registry = new ToolRegistry([createMockTool("terraform")], []);
      const meta = registry.getToolMetadata("terraform");

      expect(meta).toEqual({ toolType: "built-in" });
    });

    it("returns custom metadata for a custom tool", () => {
      const custom = createMockCustomTool("my-custom", {
        location: "project",
        toolVersion: "1.2.0",
        toolHash: "abc123def456",
      });
      const registry = new ToolRegistry([], [custom]);
      const meta = registry.getToolMetadata("my-custom");

      expect(meta).toEqual({
        toolType: "custom",
        toolVersion: "1.2.0",
        toolHash: "abc123def456",
        toolSource: "project",
      });
    });

    it("returns undefined for nonexistent tool", () => {
      const registry = new ToolRegistry([createMockTool("tool-a")], []);
      expect(registry.getToolMetadata("nonexistent")).toBeUndefined();
    });

    it("returns custom metadata when custom tool overrides built-in", () => {
      const builtIn = [createMockTool("shared")];
      const custom = createMockCustomTool("shared", {
        location: "global",
        toolVersion: "2.0.0",
        toolHash: "hash999",
      });
      const registry = new ToolRegistry(builtIn, [custom]);
      const meta = registry.getToolMetadata("shared");

      expect(meta).toEqual({
        toolType: "custom",
        toolVersion: "2.0.0",
        toolHash: "hash999",
        toolSource: "global",
      });
    });
  });
});
