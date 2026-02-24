import { LLMProvider } from "@dojops/core";
import { DojOpsConfig } from "./config";

export type OutputFormat = "table" | "json" | "yaml";

export interface GlobalOptions {
  profile?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  output: OutputFormat;
  nonInteractive: boolean;
  verbose: boolean;
  debug: boolean;
  quiet: boolean;
  noColor: boolean;
}

export interface CLIContext {
  globalOpts: GlobalOptions;
  config: DojOpsConfig;
  cwd: string;
  /** Lazy provider creation — avoids API key requirement for non-LLM commands */
  getProvider(): LLMProvider;
}

export type CommandHandler = (args: string[], ctx: CLIContext) => Promise<void>;

export const DEFAULT_GLOBAL_OPTIONS: GlobalOptions = {
  output: "table",
  nonInteractive: false,
  verbose: false,
  debug: false,
  quiet: false,
  noColor: false,
};
