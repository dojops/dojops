import { LLMProvider } from "@dojops/core";
import * as yaml from "js-yaml";
import { AnsiblePlaybook, AnsiblePlaybookSchema, AnsibleInput } from "./schemas";

export async function generateAnsiblePlaybook(
  input: AnsibleInput,
  llm: LLMProvider,
): Promise<AnsiblePlaybook> {
  const response = await llm.generate({
    system: `You are an Ansible expert. Generate Ansible playbook tasks as structured JSON.
Target OS: ${input.targetOS}.

You MUST respond with a JSON object matching this exact structure:
{
  "tasks": [
    { "name": "Install packages", "module": "apt", "args": { "name": "nginx", "state": "present" } },
    { "name": "Start service", "module": "service", "args": { "name": "nginx", "state": "started" }, "notify": "Restart nginx" }
  ],
  "handlers": [
    { "name": "Restart nginx", "module": "service", "args": { "name": "nginx", "state": "restarted" } }
  ],
  "variables": { "app_port": 8080 }
}

IMPORTANT:
- "tasks" must be an ARRAY with at least one entry
- Each task needs "name" (string) and "module" (string, e.g. "apt", "yum", "service", "copy", "template")
- "args" is an object of module arguments
- Optional task fields: "when", "notify", "register"
- "handlers" is an array (can be empty), "variables" is an object (can be empty)
- Keep the response concise. Respond with valid JSON only, no markdown`,
    prompt: `Generate an Ansible playbook for: ${input.tasks}`,
    schema: AnsiblePlaybookSchema,
  });

  return response.parsed as AnsiblePlaybook;
}

export function playbookToYaml(playbook: AnsiblePlaybook, input: AnsibleInput): string {
  const play: Record<string, unknown> = {
    name: input.playbookName,
    hosts: input.hosts,
    become: input.becomeRoot,
  };

  if (Object.keys(playbook.variables).length > 0) {
    play.vars = playbook.variables;
  }

  play.tasks = playbook.tasks.map((task) => {
    const entry: Record<string, unknown> = {
      name: task.name,
      [task.module]: task.args,
    };
    if (task.when) entry.when = task.when;
    if (task.notify) entry.notify = task.notify;
    if (task.register) entry.register = task.register;
    return entry;
  });

  if (playbook.handlers.length > 0) {
    play.handlers = playbook.handlers.map((handler) => ({
      name: handler.name,
      [handler.module]: handler.args,
    }));
  }

  return yaml.dump([play], { lineWidth: 120, noRefs: true });
}
