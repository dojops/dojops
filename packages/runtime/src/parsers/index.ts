import type { VerificationIssue } from "@dojops/sdk";
import { parseTerraformJson } from "./terraform-json";
import { parseHadolintJson } from "./hadolint-json";
import { parseKubectlStderr } from "./kubectl-stderr";
import { parseHelmLint } from "./helm-lint";
import { parseNginxStderr } from "./nginx-stderr";
import { parseGenericStderr } from "./generic-stderr";
import { parseGenericJson } from "./generic-json";
import { parsePromtool } from "./promtool";
import { parseSystemdAnalyze } from "./systemd-analyze";
import { parseMakeDryrun } from "./make-dryrun";
import { parseAnsibleSyntax } from "./ansible-syntax";
import { parseDockerComposeConfig } from "./docker-compose-config";
import { parseActionlint } from "./actionlint";
import { parsePackerValidate } from "./packer-validate";

export type VerificationParser = (
  output: string,
  severityMapping?: SeverityMapping,
) => VerificationIssue[];

export interface SeverityMapping {
  error?: string[];
  warning?: string[];
  info?: string[];
}

const PARSERS: Record<string, VerificationParser> = {
  "terraform-json": parseTerraformJson,
  "hadolint-json": parseHadolintJson,
  "kubectl-stderr": parseKubectlStderr,
  "helm-lint": parseHelmLint,
  "nginx-stderr": parseNginxStderr,
  "generic-stderr": parseGenericStderr,
  "generic-json": parseGenericJson,
  promtool: parsePromtool,
  "systemd-analyze": parseSystemdAnalyze,
  "make-dryrun": parseMakeDryrun,
  "ansible-syntax": parseAnsibleSyntax,
  "docker-compose-config": parseDockerComposeConfig,
  actionlint: parseActionlint,
  "packer-validate": parsePackerValidate,
};

export function getParser(name: string): VerificationParser | undefined {
  return PARSERS[name];
}

export function getAvailableParsers(): string[] {
  return Object.keys(PARSERS);
}
