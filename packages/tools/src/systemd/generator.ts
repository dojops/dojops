import { LLMProvider } from "@dojops/core";
import { SystemdConfig, SystemdConfigSchema, SystemdInput } from "./schemas";

export async function generateSystemdConfig(
  input: SystemdInput,
  provider: LLMProvider,
): Promise<SystemdConfig> {
  const response = await provider.generate({
    system: `You are a Linux systemd expert. Generate a systemd service unit configuration as structured JSON.
Respond with valid JSON matching the required structure.`,
    prompt: `Generate a systemd service unit for: ${input.serviceName}
ExecStart: ${input.execStart}
User: ${input.user}
${input.description ? `Description: ${input.description}` : ""}
${input.workingDirectory ? `WorkingDirectory: ${input.workingDirectory}` : ""}
Configure appropriate restart behavior, logging to journal, and standard dependencies.`,
    schema: SystemdConfigSchema,
  });

  return response.parsed as SystemdConfig;
}

export function systemdConfigToString(config: SystemdConfig): string {
  const lines: string[] = [];

  // [Unit] section
  lines.push("[Unit]");
  lines.push(`Description=${config.unit.Description}`);
  for (const after of config.unit.After) {
    lines.push(`After=${after}`);
  }
  for (const wants of config.unit.Wants) {
    lines.push(`Wants=${wants}`);
  }

  // [Service] section
  lines.push("");
  lines.push("[Service]");
  lines.push(`Type=${config.service.Type}`);
  lines.push(`ExecStart=${config.service.ExecStart}`);
  lines.push(`Restart=${config.service.Restart}`);
  lines.push(`RestartSec=${config.service.RestartSec}`);
  lines.push(`User=${config.service.User}`);
  if (config.service.WorkingDirectory) {
    lines.push(`WorkingDirectory=${config.service.WorkingDirectory}`);
  }
  for (const env of config.service.Environment) {
    lines.push(`Environment=${env}`);
  }
  lines.push(`StandardOutput=${config.service.StandardOutput}`);
  lines.push(`StandardError=${config.service.StandardError}`);

  // [Install] section
  lines.push("");
  lines.push("[Install]");
  for (const wantedBy of config.install.WantedBy) {
    lines.push(`WantedBy=${wantedBy}`);
  }

  return lines.join("\n") + "\n";
}
