import type { ToolDefinition } from "./tool-types";

export const READ_FILE_TOOL: ToolDefinition = {
  name: "read_file",
  description:
    "Read a file's contents. Use this to understand existing code, configs, or project structure before making changes.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path to read" },
      offset: {
        type: "number",
        description:
          "Line number to start reading from (1-based). Omit to read from the beginning.",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read. Omit to read the entire file.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

export const WRITE_FILE_TOOL: ToolDefinition = {
  name: "write_file",
  description:
    "Create a new file or completely overwrite an existing file. Use edit_file for partial changes to existing files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to create or overwrite" },
      content: { type: "string", description: "The full content to write to the file" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

export const EDIT_FILE_TOOL: ToolDefinition = {
  name: "edit_file",
  description:
    "Replace a specific string in an existing file. The old_string must be an exact, unique match in the file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to edit" },
      old_string: {
        type: "string",
        description: "The exact text to find and replace (must be unique in the file)",
      },
      new_string: { type: "string", description: "The replacement text" },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
};

export const RUN_COMMAND_TOOL: ToolDefinition = {
  name: "run_command",
  description:
    "Execute a shell command and return its stdout/stderr. Use for build, test, lint, git, or other CLI operations.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      cwd: {
        type: "string",
        description: "Working directory for the command. Defaults to project root.",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds. Defaults to policy timeout (30s).",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

export const RUN_SKILL_TOOL: ToolDefinition = {
  name: "run_skill",
  description:
    "Run a DojOps skill (.dops file) to generate DevOps configurations. Use for Terraform, Dockerfile, CI/CD, K8s, etc.",
  parameters: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description: "Skill name (e.g. 'terraform', 'dockerfile', 'github-actions')",
      },
      input: {
        type: "object",
        description: "Input parameters for the skill, matching its input schema",
        additionalProperties: true,
      },
    },
    required: ["skill", "input"],
    additionalProperties: false,
  },
};

export const SEARCH_FILES_TOOL: ToolDefinition = {
  name: "search_files",
  description:
    "Search for files by name pattern or content. Use to discover project structure and find relevant code.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match file names (e.g. '**/*.ts', 'src/**/*.yaml')",
      },
      content_pattern: {
        type: "string",
        description: "Regex pattern to search within file contents (e.g. 'export class', 'TODO')",
      },
      path: { type: "string", description: "Directory to search in. Defaults to project root." },
    },
    additionalProperties: false,
  },
};

export const DONE_TOOL: ToolDefinition = {
  name: "done",
  description: "Signal that the task is complete. Provide a summary of what was accomplished.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "A concise summary of what was done and any important notes",
      },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

/** All 7 agent tools, ready to pass to LLM providers. */
export const AGENT_TOOLS: ToolDefinition[] = [
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  RUN_COMMAND_TOOL,
  RUN_SKILL_TOOL,
  SEARCH_FILES_TOOL,
  DONE_TOOL,
];
