import { HookEngine } from "./engine";
import { loadHookConfig } from "./loader";

/**
 * Initialize a HookEngine from the project's .dojops/hooks.json.
 * Returns an engine with no hooks if the config file doesn't exist.
 */
export function initHookEngine(projectDir: string): HookEngine {
  const config = loadHookConfig(projectDir);
  return new HookEngine(config);
}
