import { describe, it, expect } from "vitest";
import { resolveToolDefinitions, buildDynamicToolSet, TOOL_NAMES } from "../../llm/dynamic-tools";
import type { DynamicToolDefinition, ToolPromptContext } from "../../llm/dynamic-tools";

function makeTool(
  name: string,
  opts: { readOnly?: boolean; prompt?: (ctx: ToolPromptContext) => string } = {},
): DynamicToolDefinition {
  return {
    name,
    description: `Static description for ${name}`,
    parameters: { type: "object", properties: {}, required: [] },
    readOnly: opts.readOnly,
    prompt: opts.prompt,
  };
}

describe("TOOL_NAMES", () => {
  it("defines all 8 tool name constants", () => {
    expect(TOOL_NAMES.READ_FILE).toBe("read_file");
    expect(TOOL_NAMES.WRITE_FILE).toBe("write_file");
    expect(TOOL_NAMES.EDIT_FILE).toBe("edit_file");
    expect(TOOL_NAMES.RUN_COMMAND).toBe("run_command");
    expect(TOOL_NAMES.RUN_SKILL).toBe("run_skill");
    expect(TOOL_NAMES.SEARCH_FILES).toBe("search_files");
    expect(TOOL_NAMES.SEARCH_SKILLS).toBe("search_skills");
    expect(TOOL_NAMES.DONE).toBe("done");
  });
});

describe("resolveToolDefinitions", () => {
  it("uses static description when no prompt() method", () => {
    const tools = [makeTool("read_file")];
    const resolved = resolveToolDefinitions(tools);
    expect(resolved[0].description).toBe("Static description for read_file");
  });

  it("uses prompt() output when provided", () => {
    const tools = [
      makeTool("read_file", {
        prompt: () => "Dynamic description for read_file",
      }),
    ];
    const resolved = resolveToolDefinitions(tools);
    expect(resolved[0].description).toBe("Dynamic description for read_file");
  });

  it("passes context to prompt()", () => {
    const tools = [
      makeTool("run_command", {
        prompt: (ctx) => `Run command in ${ctx.cwd ?? "unknown"} on ${ctx.platform ?? "unknown"}`,
      }),
    ];
    const resolved = resolveToolDefinitions(tools, {
      cwd: "/home/user/project",
      platform: "linux",
    });
    expect(resolved[0].description).toContain("/home/user/project");
    expect(resolved[0].description).toContain("linux");
  });

  it("injects availableTools into context", () => {
    let receivedTools: string[] = [];
    const tools = [
      makeTool("read_file", {
        prompt: (ctx) => {
          receivedTools = ctx.availableTools ?? [];
          return "ok";
        },
      }),
      makeTool("write_file"),
    ];
    resolveToolDefinitions(tools);
    expect(receivedTools).toContain("read_file");
    expect(receivedTools).toContain("write_file");
  });

  it("preserves name and parameters", () => {
    const tools = [makeTool("search_files", { prompt: () => "custom desc" })];
    const resolved = resolveToolDefinitions(tools);
    expect(resolved[0].name).toBe("search_files");
    expect(resolved[0].parameters).toBeDefined();
  });

  it("adapts description based on sandbox config", () => {
    const tools = [
      makeTool("run_command", {
        prompt: (ctx) =>
          ctx.sandboxEnabled
            ? "Run a sandboxed shell command (restricted paths)"
            : "Run a shell command with full access",
      }),
    ];

    const sandboxed = resolveToolDefinitions(tools, { sandboxEnabled: true });
    expect(sandboxed[0].description).toContain("sandboxed");

    const unsandboxed = resolveToolDefinitions(tools, { sandboxEnabled: false });
    expect(unsandboxed[0].description).toContain("full access");
  });

  it("includes loaded skills in run_skill description", () => {
    const tools = [
      makeTool("run_skill", {
        prompt: (ctx) => {
          const skills = ctx.loadedSkills ?? [];
          return skills.length > 0
            ? `Run a skill. Available: ${skills.join(", ")}`
            : "Run a DojOps skill (none loaded)";
        },
      }),
    ];

    const resolved = resolveToolDefinitions(tools, {
      loadedSkills: ["terraform", "dockerfile", "k8s"],
    });
    expect(resolved[0].description).toContain("terraform");
    expect(resolved[0].description).toContain("dockerfile");
  });
});

describe("buildDynamicToolSet", () => {
  it("returns all tools in normal mode", () => {
    const tools = [
      makeTool("read_file", { readOnly: true }),
      makeTool("write_file", { readOnly: false }),
      makeTool("done"),
    ];

    const result = buildDynamicToolSet(tools);
    expect(result).toHaveLength(3);
  });

  it("filters to read-only + done in plan mode", () => {
    const tools = [
      makeTool("read_file", { readOnly: true }),
      makeTool("search_files", { readOnly: true }),
      makeTool("write_file", { readOnly: false }),
      makeTool("run_command"),
      makeTool("done"),
    ];

    const result = buildDynamicToolSet(tools, { planModeActive: true });
    const names = result.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("search_files");
    expect(names).toContain("done");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("run_command");
  });

  it("includes done even without readOnly flag in plan mode", () => {
    const tools = [makeTool("done")]; // readOnly undefined
    const result = buildDynamicToolSet(tools, { planModeActive: true });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("done");
  });
});
