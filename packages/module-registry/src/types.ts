export interface ToolManifest {
  spec: number;
  name: string;
  version: string;
  type: "tool";
  description: string;
  inputSchema: string;
  outputSchema?: string;
  tags?: string[];
  generator: {
    strategy: "llm";
    systemPrompt: string;
    updateMode?: boolean;
    existingDelimiter?: string;
    userPromptTemplate?: string;
  };
  files: Array<{
    path: string;
    serializer: "yaml" | "json" | "hcl" | "ini" | "toml" | "raw";
  }>;
  verification?: {
    command: string;
  };
  detector?: {
    path: string | string[];
  };
  permissions?: {
    filesystem?: "project" | "global";
    network?: "none" | "inherit";
    child_process?: "none" | "required";
  };
}

export interface ToolSource {
  type: "built-in" | "custom";
  location?: "global" | "project";
  toolPath?: string;
  toolVersion?: string;
  toolHash?: string;
}

export interface ToolEntry {
  manifest: ToolManifest;
  toolDir: string;
  source: ToolSource;
  inputSchemaRaw: Record<string, unknown>;
  outputSchemaRaw?: Record<string, unknown>;
}

// Backward compatibility aliases
/** @deprecated Use ToolManifest instead */
export type PluginManifest = ToolManifest;
/** @deprecated Use ToolSource instead */
export type PluginSource = ToolSource;
/** @deprecated Use ToolEntry instead */
export type PluginEntry = ToolEntry;
