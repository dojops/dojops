import type { ToolDefinition } from "./tool-types";

/**
 * Runtime context passed to dynamic tool prompt generators.
 * Each tool uses whatever subset is relevant to generate its description.
 */
export interface ToolPromptContext {
  /** Active LLM provider name (e.g. "openai", "anthropic", "ollama"). */
  providerName?: string;
  /** Working directory for the agent. */
  cwd?: string;
  /** Whether sandboxed execution is enabled. */
  sandboxEnabled?: boolean;
  /** List of loaded skill names. */
  loadedSkills?: string[];
  /** Whether plan mode is active. */
  planModeActive?: boolean;
  /** Platform (e.g. "linux", "darwin", "win32"). */
  platform?: string;
  /** Tool names available in this session (for cross-references). */
  availableTools?: string[];
}

/**
 * A tool definition with a dynamic prompt generator.
 * The `prompt()` method produces a context-aware description that replaces
 * the static `description` field when the tool set is built for the LLM.
 */
export interface DynamicToolDefinition extends ToolDefinition {
  /**
   * Generate a context-aware description for this tool.
   * Falls back to the static `description` if not provided.
   */
  prompt?: (ctx: ToolPromptContext) => string;
  /** Whether this tool only reads state (safe for concurrent execution). */
  readOnly?: boolean;
}

// ── Tool name constants ─────────────────────────────────────────────
// Cross-reference tools by constant rather than hardcoded strings.

export const TOOL_NAMES = {
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  EDIT_FILE: "edit_file",
  RUN_COMMAND: "run_command",
  RUN_SKILL: "run_skill",
  SEARCH_FILES: "search_files",
  SEARCH_SKILLS: "search_skills",
  DONE: "done",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ── Builder ─────────────────────────────────────────────────────────

/**
 * Resolve dynamic tool definitions into standard ToolDefinitions
 * by calling each tool's prompt() with the current context.
 */
export function resolveToolDefinitions(
  tools: DynamicToolDefinition[],
  ctx: ToolPromptContext = {},
): ToolDefinition[] {
  // Inject available tool names for cross-referencing
  const ctxWithNames: ToolPromptContext = {
    ...ctx,
    availableTools: tools.map((t) => t.name),
  };

  return tools.map((tool) => {
    const description = tool.prompt ? tool.prompt(ctxWithNames) : tool.description;
    return {
      name: tool.name,
      description,
      parameters: tool.parameters,
    };
  });
}

/**
 * Build a ToolDefinition[] from DynamicToolDefinitions,
 * filtering by read-only flag when in plan mode.
 */
export function buildDynamicToolSet(
  tools: DynamicToolDefinition[],
  ctx: ToolPromptContext = {},
): ToolDefinition[] {
  let filtered = tools;

  // In plan mode, only allow read-only tools
  if (ctx.planModeActive) {
    filtered = tools.filter((t) => t.readOnly === true || t.name === TOOL_NAMES.DONE);
  }

  return resolveToolDefinitions(filtered, ctx);
}
