import { describe, it, expect, vi } from "vitest";
import { ModuleRegistry } from "../registry";
import { DevOpsModule } from "@dojops/sdk";
import { z } from "zod";

function createMockModule(name: string, description = "desc"): DevOpsModule {
  return {
    name,
    description,
    inputSchema: z.object({ input: z.string() }),
    validate: vi.fn().mockReturnValue({ valid: true }),
    generate: vi.fn().mockResolvedValue({ success: true, data: {} }),
  };
}

describe("ModuleRegistry", () => {
  it("returns all modules", () => {
    const builtIn = [createMockModule("module-a"), createMockModule("module-b")];
    const registry = new ModuleRegistry(builtIn);

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it("get returns module by name", () => {
    const registry = new ModuleRegistry([createMockModule("my-module")]);

    expect(registry.get("my-module")).toBeDefined();
    expect(registry.get("my-module")!.name).toBe("my-module");
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("has returns true for existing modules", () => {
    const registry = new ModuleRegistry([createMockModule("module-a")]);

    expect(registry.has("module-a")).toBe(true);
    expect(registry.has("module-b")).toBe(false);
  });

  it("getBuiltIn returns only built-in modules", () => {
    const builtIn = [createMockModule("built-in-a"), createMockModule("built-in-b")];
    const registry = new ModuleRegistry(builtIn);

    const result = registry.getBuiltIn();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("built-in-a");
  });

  it("getBuiltIn returns a copy (not internal array)", () => {
    const builtIn = [createMockModule("module-a")];
    const registry = new ModuleRegistry(builtIn);

    const result1 = registry.getBuiltIn();
    const result2 = registry.getBuiltIn();
    expect(result1).not.toBe(result2);
    expect(result1).toEqual(result2);
  });

  it("handles empty registry", () => {
    const registry = new ModuleRegistry([]);

    expect(registry.getAll()).toHaveLength(0);
    expect(registry.size).toBe(0);
    expect(registry.get("anything")).toBeUndefined();
    expect(registry.has("anything")).toBe(false);
  });

  it("preserves insertion order", () => {
    const builtIn = [
      createMockModule("alpha"),
      createMockModule("beta"),
      createMockModule("gamma"),
    ];
    const registry = new ModuleRegistry(builtIn);

    const names = registry.getAll().map((t) => t.name);
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  it("later module overrides earlier module with same name", () => {
    const modules = [createMockModule("shared", "first"), createMockModule("shared", "second")];
    const registry = new ModuleRegistry(modules);

    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get("shared")!.description).toBe("second");
  });

  describe("getModuleMetadata", () => {
    it("returns built-in for a built-in module", () => {
      const registry = new ModuleRegistry([createMockModule("terraform")]);
      const meta = registry.getModuleMetadata("terraform");

      expect(meta).toEqual({ toolType: "built-in" });
    });

    it("returns undefined for nonexistent module", () => {
      const registry = new ModuleRegistry([createMockModule("module-a")]);
      expect(registry.getModuleMetadata("nonexistent")).toBeUndefined();
    });

    it("returns DopsRuntime metadata when available", () => {
      const mod = createMockModule("my-module");
      Object.defineProperty(mod, "moduleHash", { value: "abc123" });
      Object.defineProperty(mod, "metadata", {
        value: {
          toolType: "built-in",
          toolVersion: "1.0.0",
          toolHash: "abc123",
          toolSource: "built-in",
          systemPromptHash: "hash456",
        },
      });
      const registry = new ModuleRegistry([mod]);
      const meta = registry.getModuleMetadata("my-module");

      expect(meta).toEqual({
        toolType: "built-in",
        toolVersion: "1.0.0",
        toolHash: "abc123",
        toolSource: "built-in",
        systemPromptHash: "hash456",
      });
    });
  });
});
