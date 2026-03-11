import { readdirSync } from "fs";
import { join, basename, extname } from "path";

const PROVIDERS = ["openai", "anthropic", "ollama", "deepseek", "gemini", "github-copilot"];

/** Aliases: canonical module name → additional completion names. */
const MODULE_ALIASES: Record<string, string[]> = {
  kubernetes: ["k8s"],
};

/** List built-in .dops module names from the runtime modules/ directory. */
function getBuiltInModuleNames(): string[] {
  try {
    // require.resolve('@dojops/runtime') returns dist/index.js; go up to package root then into modules/
    const modulesDir = join(require.resolve("@dojops/runtime"), "..", "..", "modules");
    const names: string[] = [];
    for (const f of readdirSync(modulesDir)) {
      if (!f.endsWith(".dops")) continue;
      const name = basename(f, ".dops");
      names.push(name);
      const aliases = MODULE_ALIASES[name];
      if (aliases) names.push(...aliases);
    }
    return names;
  } catch {
    return [];
  }
}

/** List user-installed module names from .dojops/modules/ in cwd. */
function getUserModuleNames(): string[] {
  try {
    const userDir = join(process.cwd(), ".dojops", "modules");
    return readdirSync(userDir)
      .filter((f) => f.endsWith(".dops"))
      .map((f) => basename(f, ".dops"));
  } catch {
    return [];
  }
}

/** List built-in specialist agent names. */
function getAgentNames(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ALL_SPECIALIST_CONFIGS } = require("@dojops/core");
    const names: string[] = ALL_SPECIALIST_CONFIGS.map((c: { name: string }) => c.name);
    // Also check for custom agents in .dojops/agents/
    try {
      const agentsDir = join(process.cwd(), ".dojops", "agents");
      const custom = readdirSync(agentsDir)
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .map((f) => basename(f, extname(f)));
      names.push(...custom);
    } catch {
      // no custom agents dir — expected
    }
    return [...new Set(names)];
  } catch {
    return [];
  }
}

/**
 * Handle --get-completions <type>.
 * Prints newline-separated values to stdout and exits with code 0.
 */
export function handleGetCompletions(type: string): never {
  let values: string[] = [];

  switch (type) {
    case "providers":
      values = PROVIDERS;
      break;
    case "modules":
      values = [...getBuiltInModuleNames(), ...getUserModuleNames()];
      break;
    case "agents":
      values = getAgentNames();
      break;
    // Unknown type: print nothing, exit 0
  }

  if (values.length > 0) {
    process.stdout.write(values.join("\n") + "\n");
  }
  process.exit(0);
}
