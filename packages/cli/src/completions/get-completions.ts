import { readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";

const PROVIDERS = [
  "openai",
  "anthropic",
  "ollama",
  "deepseek",
  "mistral",
  "gemini",
  "github-copilot",
];

/** Aliases: canonical skill name → additional completion names. */
const SKILL_ALIASES: Record<string, string[]> = {
  kubernetes: ["k8s"],
};

/** List built-in .dops skill names from the runtime skills/ directory. */
function getBuiltInSkillNames(): string[] {
  try {
    // require.resolve('@dojops/runtime') returns dist/index.js; go up to package root then into skills/
    const skillsDir = join(require.resolve("@dojops/runtime"), "..", "..", "skills");
    const names: string[] = [];
    for (const f of readdirSync(skillsDir)) {
      if (!f.endsWith(".dops")) continue;
      const name = basename(f, ".dops");
      names.push(name);
      const aliases = SKILL_ALIASES[name];
      if (aliases) names.push(...aliases);
    }
    return names;
  } catch {
    return [];
  }
}

/** List user-installed skill names from .dojops/skills/ in cwd and ~/.dojops/skills/ globally. */
function getUserSkillNames(): string[] {
  const names: string[] = [];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  // Project-local skills directory
  const projectDir = join(process.cwd(), ".dojops", "skills");
  try {
    names.push(
      ...readdirSync(projectDir)
        .filter((f) => f.endsWith(".dops"))
        .map((f) => basename(f, ".dops")),
    );
  } catch {
    // no project skills dir — expected
  }

  // Global skills directory (~/.dojops/skills/)
  if (home) {
    const globalDir = join(home, ".dojops", "skills");
    try {
      const globalNames = readdirSync(globalDir)
        .filter((f) => f.endsWith(".dops"))
        .map((f) => basename(f, ".dops"));
      names.push(...globalNames);
    } catch {
      // no global skills dir — expected
    }
  }

  return [...new Set(names)];
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
    case "skills":
    case "modules": // deprecated alias
      values = [...getBuiltInSkillNames(), ...getUserSkillNames()];
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
