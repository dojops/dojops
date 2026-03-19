import { LLMProvider, ThinkingLevel } from "@dojops/core";
import { DojOpsConfig } from "./config";

export type OutputFormat = "table" | "json" | "yaml" | "stream-json";

export interface GlobalOptions {
  profile?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  timeout?: number;
  agent?: string;
  skill?: string;
  fallbackProvider?: string;
  /** Read prompt from a file (--file / -f). */
  file?: string;
  /** Reasoning effort: none, low, medium, high */
  thinking?: ThinkingLevel;
  output: OutputFormat;
  raw: boolean;
  nonInteractive: boolean;
  verbose: boolean;
  debug: boolean;
  quiet: boolean;
  noColor: boolean;
  dryRun: boolean;
}

export interface CLIContext {
  globalOpts: GlobalOptions;
  config: DojOpsConfig;
  cwd: string;
  /** Resolved temperature (CLI flag > env > config > undefined) */
  resolvedTemperature?: number;
  /** Lazy provider creation — avoids API key requirement for non-LLM commands */
  getProvider(): LLMProvider;
}

export type CommandHandler = (args: string[], ctx: CLIContext) => Promise<void>;

export const DEFAULT_GLOBAL_OPTIONS: GlobalOptions = {
  output: "table",
  raw: false,
  nonInteractive: false,
  verbose: false,
  debug: false,
  quiet: false,
  noColor: false,
  dryRun: false,
};
