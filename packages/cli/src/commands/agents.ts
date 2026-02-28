import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import * as yaml from "js-yaml";
import { ALL_SPECIALIST_CONFIGS, getInstallCommand } from "@dojops/core";
import type { SpecialistConfig } from "@dojops/core";
import {
  discoverCustomAgents,
  GeneratedAgentSchema,
  formatAgentReadme,
} from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { runPreflight } from "../preflight";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot } from "../state";

export async function agentsCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "info":
      return agentInfo(args.slice(1), ctx);
    case "create":
      return agentCreate(args.slice(1), ctx);
    case "remove":
      return agentRemove(args.slice(1), ctx);
    case "list":
    default:
      return agentList(ctx);
  }
}

function agentList(ctx: CLIContext): void {
  const projectRoot = findProjectRoot() ?? undefined;
  const customAgents = discoverCustomAgents(projectRoot);
  const customNames = new Set(customAgents.map((a) => a.config.name));

  // Merge: built-in + custom (custom can override by name)
  const configMap = new Map<string, { name: string; domain: string; description?: string }>();
  for (const a of ALL_SPECIALIST_CONFIGS) {
    configMap.set(a.name, { name: a.name, domain: a.domain, description: a.description });
  }
  for (const a of customAgents) {
    configMap.set(a.config.name, {
      name: a.config.name,
      domain: a.config.domain,
      description: a.config.description,
    });
  }
  const agents = Array.from(configMap.values());

  if (ctx.globalOpts.output === "json") {
    console.log(
      JSON.stringify(
        agents.map((a) => ({
          name: a.name,
          domain: a.domain,
          description: a.description ?? null,
          type: customNames.has(a.name) ? "custom" : "built-in",
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (ctx.globalOpts.output === "yaml") {
    console.log(
      yaml.dump(
        agents.map((a) => ({
          name: a.name,
          domain: a.domain,
          description: a.description ?? null,
          type: customNames.has(a.name) ? "custom" : "built-in",
        })),
        { lineWidth: 120, noRefs: true },
      ),
    );
    return;
  }

  const lines = agents.map((a) => {
    const badge = customNames.has(a.name) ? ` ${pc.yellow("[custom]")}` : "";
    return `  ${pc.cyan(a.name.padEnd(28))} ${pc.dim(a.domain)}${badge}`;
  });
  p.note(lines.join("\n"), `Specialist Agents (${agents.length})`);
}

function agentInfo(args: string[], ctx: CLIContext): void {
  const name = args[0];
  if (!name) {
    p.log.info(`  ${pc.dim("$")} dojops agents info <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Agent name required.");
  }

  const projectRoot = findProjectRoot() ?? undefined;
  const customAgents = discoverCustomAgents(projectRoot);

  // Merge built-in + custom configs (same pattern as agentList, no LLM needed)
  const configMap = new Map<string, SpecialistConfig>();
  for (const c of ALL_SPECIALIST_CONFIGS) configMap.set(c.name, c);
  const customAgentNames = new Set<string>();
  for (const entry of customAgents) {
    configMap.set(entry.config.name, entry.config);
    customAgentNames.add(entry.config.name);
  }

  const config = [...configMap.values()].find((c) => c.name.toLowerCase() === name.toLowerCase());

  if (!config) {
    const names = [...configMap.keys()].join(", ");
    p.log.info(`Available agents: ${names}`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Agent "${name}" not found.`);
  }

  const isCustom = customAgentNames.has(config.name);
  const deps = config.toolDependencies ?? [];
  const preflight = deps.length > 0 ? runPreflight(config.name, deps) : null;

  // Find source path for custom agents
  let sourcePath: string | undefined;
  if (isCustom) {
    const entry = customAgents.find((a) => a.config.name === config.name);
    if (entry) sourcePath = entry.agentDir;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(
      JSON.stringify(
        {
          name: config.name,
          domain: config.domain,
          description: config.description ?? null,
          type: isCustom ? "custom" : "built-in",
          source: sourcePath ?? null,
          toolDependencies:
            deps.length > 0
              ? preflight!.checks.map((c) => ({
                  name: c.dependency.name,
                  npmPackage: c.dependency.npmPackage,
                  binary: c.dependency.binary ?? null,
                  available: c.available,
                  resolvedPath: c.resolvedPath ?? null,
                }))
              : [],
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines = [
    `${pc.bold("Name:")}        ${config.name}`,
    `${pc.bold("Domain:")}      ${config.domain}`,
    `${pc.bold("Description:")} ${config.description ?? pc.dim("(none)")}`,
    `${pc.bold("Type:")}        ${isCustom ? pc.yellow("custom") : pc.dim("built-in")}`,
  ];

  if (sourcePath) {
    lines.push(`${pc.bold("Source:")}      ${pc.dim(sourcePath)}`);
  }

  if (preflight && preflight.checks.length > 0) {
    lines.push("");
    lines.push(pc.bold("Tool Dependencies:"));
    for (const check of preflight.checks) {
      const icon = check.available ? pc.green("\u2713") : pc.yellow("!");
      const status = check.available
        ? pc.dim(check.resolvedPath ?? "found")
        : `Not found — ${pc.dim(getInstallCommand(check.dependency, "npx"))}`;
      lines.push(`  ${icon} ${pc.bold(check.dependency.name)}  ${status}`);
    }
  }

  p.note(lines.join("\n"), `Agent: ${config.name}`);
}

async function agentCreate(args: string[], ctx: CLIContext): Promise<void> {
  const isManual = args.includes("--manual");
  const isGlobal = args.includes("--global");
  const description = args.filter((a) => !a.startsWith("-")).join(" ");

  if (isManual) {
    return agentCreateManual(ctx, isGlobal);
  }

  if (!description) {
    p.log.info(`  ${pc.dim("$")} dojops agents create "an SRE specialist for incident response"`);
    p.log.info(`  ${pc.dim("$")} dojops agents create --manual`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Description required for LLM-generated agents.");
  }

  return agentCreateLLM(description, ctx, isGlobal);
}

async function agentCreateLLM(
  description: string,
  ctx: CLIContext,
  isGlobal: boolean,
): Promise<void> {
  const provider = ctx.getProvider();

  const isStructured = ctx.globalOpts.output !== "table";
  const s = p.spinner();
  if (!isStructured) s.start("Generating custom agent...");

  const result = await provider.generate({
    prompt: `Create a DojOps specialist agent based on this description: "${description}"

Generate a complete agent definition with:
- name: a short kebab-case identifier (e.g. "sre-specialist", "cost-optimizer")
- domain: one or two words describing the domain (e.g. "site-reliability", "cost-optimization")
- description: one-sentence description of the agent's specialty
- systemPrompt: a detailed system prompt (3-10 paragraphs) that defines the agent's personality, expertise areas, and instructions. Include bullet-pointed specialization areas.
- keywords: 10-20 domain-specific keywords that would match user prompts to this agent`,
    schema: GeneratedAgentSchema,
  });

  if (!isStructured) s.stop("Agent generated.");

  if (!result.parsed) {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      "Failed to generate a valid agent definition from LLM.",
    );
  }

  const agent = result.parsed as {
    name: string;
    domain: string;
    description: string;
    systemPrompt: string;
    keywords: string[];
  };

  // Validate name format (LLM output is untrusted)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(agent.name)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `LLM returned an invalid agent name: "${agent.name}". Must be kebab-case.`,
    );
  }

  // Show preview — wrap long lines to terminal width
  const cols = Math.min(process.stdout.columns || 80, 80) - 6;
  const wrap = (text: string, indent: number): string => {
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > cols - indent) {
        lines.push(cur);
        cur = " ".repeat(indent) + w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    }
    if (cur) lines.push(cur);
    return lines.join("\n");
  };

  const previewLines = [
    `${pc.bold("Name:")}        ${agent.name}`,
    `${pc.bold("Domain:")}      ${agent.domain}`,
    `${pc.bold("Description:")} ${wrap(agent.description, 13)}`,
    `${pc.bold("Keywords:")}    ${wrap(agent.keywords.join(", "), 13)}`,
    "",
    `${pc.bold("System Prompt:")}`,
    pc.dim(
      wrap(agent.systemPrompt.slice(0, 300) + (agent.systemPrompt.length > 300 ? "..." : ""), 0),
    ),
  ];
  p.note(previewLines.join("\n"), "Agent Preview");

  if (!ctx.globalOpts.nonInteractive) {
    const confirmed = await p.confirm({ message: "Create this agent?" });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Cancelled.");
      return;
    }
  }

  writeAgentToDisk(agent.name, formatAgentReadme(agent), isGlobal);
}

async function agentCreateManual(ctx: CLIContext, isGlobal: boolean): Promise<void> {
  const name = await p.text({
    message: "Agent name (kebab-case, e.g. sre-specialist):",
    validate(value) {
      if (!value.trim()) return "Name is required";
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
        return "Must be lowercase kebab-case (e.g. my-agent)";
      }
    },
  });
  if (p.isCancel(name)) return;

  const domain = await p.text({
    message: "Domain (e.g. site-reliability):",
    validate(value) {
      if (!value.trim()) return "Domain is required";
    },
  });
  if (p.isCancel(domain)) return;

  const description = await p.text({
    message: "Description (one sentence):",
    validate(value) {
      if (!value.trim()) return "Description is required";
    },
  });
  if (p.isCancel(description)) return;

  const systemPrompt = await p.text({
    message: "System prompt (agent instructions):",
    validate(value) {
      if (!value.trim()) return "System prompt is required";
    },
  });
  if (p.isCancel(systemPrompt)) return;

  const keywordsRaw = await p.text({
    message: "Keywords (comma-separated):",
    validate(value) {
      if (!value.trim()) return "At least one keyword is required";
    },
  });
  if (p.isCancel(keywordsRaw)) return;

  const agent = {
    name: name as string,
    domain: domain as string,
    description: description as string,
    systemPrompt: systemPrompt as string,
    keywords: (keywordsRaw as string)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  };

  writeAgentToDisk(agent.name, formatAgentReadme(agent), isGlobal);
}

function writeAgentToDisk(name: string, readme: string, isGlobal: boolean): void {
  const base = isGlobal
    ? path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".dojops", "agents", name)
    : path.join(findProjectRoot() ?? process.cwd(), ".dojops", "agents", name);

  fs.mkdirSync(base, { recursive: true });
  const readmePath = path.join(base, "README.md");
  fs.writeFileSync(readmePath, readme, "utf-8");

  p.log.success(`Custom agent created: ${pc.cyan(name)}`);
  p.log.info(`  ${pc.dim(readmePath)}`);
}

async function agentRemove(args: string[], ctx: CLIContext): Promise<void> {
  const name = args.filter((a) => !a.startsWith("-"))[0];
  if (!name) {
    p.log.info(`  ${pc.dim("$")} dojops agents remove <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Agent name required.");
  }

  // Check project dir first, then global
  const projectRoot = findProjectRoot();
  const projectDir = projectRoot ? path.join(projectRoot, ".dojops", "agents", name) : null;
  const globalDir = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "",
    ".dojops",
    "agents",
    name,
  );

  let targetDir: string | null = null;
  if (projectDir && fs.existsSync(projectDir)) {
    targetDir = projectDir;
  } else if (fs.existsSync(globalDir)) {
    targetDir = globalDir;
  }

  if (!targetDir) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Custom agent "${name}" not found.`);
  }

  if (!ctx.globalOpts.nonInteractive && !args.includes("--yes")) {
    const confirmed = await p.confirm({
      message: `Remove custom agent "${name}" from ${targetDir}?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Cancelled.");
      return;
    }
  }

  fs.rmSync(targetDir, { recursive: true });
  p.log.success(`Removed custom agent: ${pc.cyan(name)}`);
}
