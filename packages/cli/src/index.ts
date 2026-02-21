#!/usr/bin/env node

// Suppress punycode deprecation warning from transitive dependencies (openai → tr46 → whatwg-url)
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
  if (typeof warning === "string" && warning.includes("punycode")) return;
  if (warning instanceof Error && warning.message.includes("punycode")) return;
  (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...args);
};

import "dotenv/config";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { LLMProvider } from "@odaops/core";
import {
  createProvider,
  createTools,
  createRouter,
  createDebugger,
  createDiffAnalyzer,
} from "@odaops/api";
import { decompose, PlannerExecutor } from "@odaops/planner";
import {
  SafeExecutor,
  AutoApproveHandler,
  CallbackApprovalHandler,
  ApprovalRequest,
} from "@odaops/executor";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  resolveProvider,
  resolveModel,
  resolveToken,
  parseFlagValue,
  validateProvider,
  VALID_PROVIDERS,
  OdaConfig,
} from "./config";

// ── Formatting helpers ─────────────────────────────────────────────

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return pc.green("*");
    case "failed":
      return pc.red("x");
    case "skipped":
      return pc.yellow("-");
    default:
      return pc.dim("?");
  }
}

function statusText(status: string): string {
  switch (status) {
    case "completed":
      return pc.green(status);
    case "failed":
      return pc.red(status);
    case "skipped":
      return pc.yellow(status);
    default:
      return pc.dim(status);
  }
}

function formatOutput(content: string): string {
  const lines = content.split("\n");
  const preview = lines.slice(0, 20);
  const formatted = preview.map((l) => `    ${pc.dim(l)}`).join("\n");
  if (lines.length > 20) {
    return `${formatted}\n    ${pc.dim(`... (${lines.length - 20} more lines)`)}`;
  }
  return formatted;
}

function getOutputFileName(tool: string): string {
  switch (tool) {
    case "github-actions":
      return ".github/workflows/ci.yml";
    case "kubernetes":
      return "manifests.yml";
    case "ansible":
      return "playbook.yml";
    default:
      return "output.yml";
  }
}

function formatConfidence(confidence: number): string {
  const pct = (confidence * 100).toFixed(0);
  if (confidence >= 0.8) return pc.green(`${pct}%`);
  if (confidence >= 0.5) return pc.yellow(`${pct}%`);
  return pc.red(`${pct}%`);
}

function riskColor(level: string): string {
  switch (level) {
    case "low":
      return pc.green(level);
    case "medium":
      return pc.yellow(level);
    case "high":
    case "critical":
      return pc.red(level);
    default:
      return level;
  }
}

function changeColor(action: string): string {
  switch (action) {
    case "CREATE":
      return pc.green(action);
    case "UPDATE":
    case "MODIFY":
      return pc.yellow(action);
    case "DELETE":
    case "DESTROY":
      return pc.red(action);
    default:
      return action;
  }
}

function maskToken(token: string | undefined): string {
  if (!token) return pc.dim("(not set)");
  if (token.length <= 6) return "***";
  return token.slice(0, 3) + "***" + token.slice(-3);
}

// ── Approval ───────────────────────────────────────────────────────

function cliApprovalHandler(): CallbackApprovalHandler {
  return new CallbackApprovalHandler(async (request: ApprovalRequest) => {
    const body = [
      `${pc.bold("Task:")}    ${request.taskId}`,
      `${pc.bold("Tool:")}    ${request.toolName}`,
      `${pc.bold("Summary:")} ${request.preview.summary}`,
      ...(request.preview.filesCreated.length > 0
        ? [`${pc.bold("Creates:")} ${request.preview.filesCreated.join(", ")}`]
        : []),
      ...(request.preview.filesModified.length > 0
        ? [`${pc.bold("Modifies:")} ${request.preview.filesModified.join(", ")}`]
        : []),
    ];
    p.note(body.join("\n"), pc.yellow("Approval Required"));

    const approved = await p.confirm({ message: "Approve this execution?" });
    if (p.isCancel(approved)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    return approved ? "approved" : "denied";
  });
}

// ── Subcommands ────────────────────────────────────────────────────

function runLogin(args: string[]): void {
  const token = parseFlagValue(args, "--token");
  if (!token) {
    p.log.warn('Tip: Use "oda config" for interactive setup, or provide --token:');
    p.log.info(`  ${pc.dim("$")} oda login --token <API_KEY>`);
    p.log.info(`  ${pc.dim("$")} oda config`);
    process.exit(1);
  }

  const config = loadConfig();
  const providerFlag = parseFlagValue(args, "--provider");
  const provider = providerFlag ?? config.defaultProvider ?? "openai";

  try {
    validateProvider(provider);
  } catch (err) {
    p.log.error((err as Error).message);
    process.exit(1);
  }

  if (provider === "ollama") {
    p.log.error("Ollama runs locally and does not require an API token.");
    p.log.info(
      pc.dim("Just set ODA_PROVIDER=ollama or run: oda login --provider openai --token <KEY>"),
    );
    process.exit(1);
  }

  config.tokens = config.tokens ?? {};
  config.tokens[provider] = token;

  // Set default provider on first login
  if (!config.defaultProvider) {
    config.defaultProvider = provider;
  }

  saveConfig(config);

  p.log.success("Token saved successfully.");

  const noteLines = [
    `${pc.bold("Provider:")} ${provider}`,
    `${pc.bold("Config:")}   ${pc.dim(getConfigPath())}`,
    ...(config.defaultProvider === provider ? [`${pc.bold("Default:")}  ${pc.cyan("yes")}`] : []),
  ];
  p.note(noteLines.join("\n"), "Saved");
  p.log.info(pc.dim('You can now run: oda "your prompt here"'));
}

function showConfig(config: OdaConfig): void {
  const lines = [
    `${pc.bold("Provider:")}  ${config.defaultProvider ?? pc.dim("(not set)")}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:    ${maskToken(config.tokens?.openai)}`,
    `  anthropic: ${maskToken(config.tokens?.anthropic)}`,
    `  ollama:    ${pc.dim("(no token needed)")}`,
  ];
  p.note(lines.join("\n"), `Configuration ${pc.dim(`(${getConfigPath()})`)}`);
}

async function runConfig(args: string[]): Promise<void> {
  // Mode C: --show
  if (args.includes("--show")) {
    const config = loadConfig();
    showConfig(config);
    return;
  }

  const providerFlag = parseFlagValue(args, "--provider");
  const tokenFlag = parseFlagValue(args, "--token");
  const modelFlag = parseFlagValue(args, "--model");

  // Mode B: direct flags
  if (providerFlag || tokenFlag || modelFlag) {
    const config = loadConfig();

    if (providerFlag) {
      try {
        validateProvider(providerFlag);
      } catch (err) {
        p.log.error((err as Error).message);
        process.exit(1);
      }
      config.defaultProvider = providerFlag;
    }

    if (tokenFlag) {
      const provider = providerFlag ?? config.defaultProvider ?? "openai";
      if (provider === "ollama") {
        p.log.error("Ollama runs locally and does not require an API token.");
        process.exit(1);
      }
      config.tokens = config.tokens ?? {};
      config.tokens[provider] = tokenFlag;
    }

    if (modelFlag) {
      config.defaultModel = modelFlag;
    }

    saveConfig(config);
    p.log.success("Configuration saved.");
    showConfig(config);
    return;
  }

  // Mode A: interactive
  const config = loadConfig();

  p.intro(pc.bgCyan(pc.black(" oda config ")));

  if (config.defaultProvider || config.defaultModel || config.tokens) {
    showConfig(config);
  }

  const modelSuggestions: Record<string, string> = {
    openai: "e.g. gpt-4o, gpt-4o-mini",
    anthropic: "e.g. claude-sonnet-4-5-20250929",
    ollama: "e.g. llama3, mistral, codellama",
  };

  const answers = await p.group(
    {
      provider: () =>
        p.select({
          message: "Select your LLM provider:",
          options: VALID_PROVIDERS.map((v) => ({ value: v, label: v })),
          initialValue: config.defaultProvider ?? "openai",
        }),
      token: ({ results }) => {
        if (results.provider === "ollama") return Promise.resolve("");
        const currentToken = config.tokens?.[results.provider!];
        const hint = currentToken ? ` [current: ${maskToken(currentToken)}]` : "";
        return p.password({
          message: `API key for ${results.provider}${hint}:`,
        });
      },
      model: ({ results }) =>
        p.text({
          message: "Default model (press Enter to skip):",
          placeholder: modelSuggestions[results.provider!] ?? "",
          defaultValue: config.defaultModel ?? "",
        }),
    },
    {
      onCancel: () => {
        p.cancel("Cancelled.");
        process.exit(0);
      },
    },
  );

  config.defaultProvider = answers.provider as string;
  if (answers.token) {
    config.tokens = config.tokens ?? {};
    config.tokens[answers.provider as string] = answers.token as string;
  }
  if (answers.model) {
    config.defaultModel = answers.model as string;
  }

  saveConfig(config);
  p.log.success("Configuration saved.");
  showConfig(config);
}

async function runPlan(
  prompt: string,
  provider: LLMProvider,
  execute: boolean,
  autoApprove: boolean,
) {
  const tools = createTools(provider);

  const s = p.spinner();
  s.start("Decomposing goal into tasks...");
  const graph = await decompose(prompt, provider, tools);
  s.stop("Tasks decomposed.");

  // Display task graph
  const taskLines = graph.tasks.map((task) => {
    const deps = task.dependsOn.length ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    return `  ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`;
  });
  p.note(taskLines.join("\n"), `${graph.goal} ${pc.dim(`(${graph.tasks.length} tasks)`)}`);

  if (execute) {
    const safeExecutor = new SafeExecutor({
      policy: {
        allowWrite: true,
        requireApproval: !autoApprove,
        timeoutMs: 60_000,
      },
      approvalHandler: autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    });

    const toolMap = new Map(tools.map((t) => [t.name, t]));

    const executor = new PlannerExecutor(tools, {
      taskStart(id, desc) {
        p.log.step(`Running ${pc.blue(id)}: ${desc}`);
      },
      taskEnd(id, status, error) {
        if (error) {
          p.log.error(`${pc.blue(id)}: ${statusText(status)} - ${pc.red(error)}`);
        } else {
          p.log.success(`${pc.blue(id)}: ${statusText(status)}`);
        }
      },
    });

    const planResult = await executor.execute(graph);

    p.log.step("Executing approved tasks...");
    for (const taskResult of planResult.results) {
      if (taskResult.status !== "completed") continue;

      const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);
      if (!taskNode) continue;

      const tool = toolMap.get(taskNode.tool);
      if (!tool?.execute) continue;

      const execResult = await safeExecutor.executeTask(taskResult.taskId, tool, taskNode.input);

      const approval =
        execResult.approval === "approved"
          ? pc.green(execResult.approval)
          : pc.yellow(execResult.approval);
      const icon = statusIcon(execResult.status);
      p.log.message(
        `${icon} ${pc.blue(execResult.taskId)} ${statusText(execResult.status)} (approval: ${approval})`,
      );
      if (execResult.error) {
        p.log.error(`${pc.red("Error:")} ${execResult.error}`);
      }
    }

    const auditLog = safeExecutor.getAuditLog();
    if (auditLog.length > 0) {
      p.log.info(pc.dim(`Audit log: ${auditLog.length} entries`));
    }

    if (planResult.success) {
      p.log.success(pc.bold("Plan succeeded."));
    } else {
      p.log.error(pc.bold("Plan failed."));
    }
  } else {
    const executor = new PlannerExecutor(tools, {
      taskStart(id, desc) {
        p.log.step(`Running ${pc.blue(id)}: ${desc}`);
      },
      taskEnd(id, status, error) {
        if (error) {
          p.log.error(`${pc.blue(id)}: ${statusText(status)} - ${pc.red(error)}`);
        } else {
          p.log.success(`${pc.blue(id)}: ${statusText(status)}`);
        }
      },
    });

    const result = await executor.execute(graph);

    if (result.success) {
      p.log.success(pc.bold("Plan succeeded."));
    } else {
      p.log.error(pc.bold("Plan failed."));
    }
    for (const r of result.results) {
      const errMsg = r.error ? `: ${pc.red(r.error)}` : "";
      p.log.message(
        `${statusIcon(r.status)} ${pc.blue(r.taskId)} ${statusText(r.status)}${errMsg}`,
      );
    }

    // Print generated output for completed tasks
    const completedResults = result.results.filter((r) => r.status === "completed" && r.output);
    if (completedResults.length > 0) {
      for (const r of completedResults) {
        const task = graph.tasks.find((t) => t.id === r.taskId);
        const data = r.output as Record<string, unknown>;
        const input = task?.input as Record<string, string> | undefined;
        const basePath = input?.projectPath ?? input?.outputPath ?? ".";
        const outputLines: string[] = [];

        outputLines.push(pc.bold(`[${r.taskId}] ${task?.tool ?? "unknown"}`));

        if (data.hcl) {
          outputLines.push(`  ${pc.green("Would write:")} ${pc.underline(`${basePath}/main.tf`)}`);
          outputLines.push(formatOutput(data.hcl as string));
        }
        if (data.yaml) {
          const fileName = getOutputFileName(task?.tool ?? "");
          outputLines.push(
            `  ${pc.green("Would write:")} ${pc.underline(`${basePath}/${fileName}`)}`,
          );
          outputLines.push(formatOutput(data.yaml as string));
        }
        if (data.chartYaml) {
          outputLines.push(
            `  ${pc.green("Would write:")} ${pc.underline(`${basePath}/Chart.yaml`)}`,
          );
          outputLines.push(formatOutput(data.chartYaml as string));
        }
        if (data.valuesYaml) {
          outputLines.push(
            `  ${pc.green("Would write:")} ${pc.underline(`${basePath}/values.yaml`)}`,
          );
          outputLines.push(formatOutput(data.valuesYaml as string));
        }

        p.note(outputLines.join("\n"), "Generated Output");
      }
      p.log.info(pc.dim("To write these files to disk, use --execute instead of --plan"));
    }
  }
}

async function runDebugCI(logContent: string, provider: LLMProvider) {
  const debugger_ = createDebugger(provider);

  const s = p.spinner();
  s.start("Analyzing CI log...");
  const diagnosis = await debugger_.diagnose(logContent);
  s.stop("Analysis complete.");

  const bodyLines = [
    `${pc.bold("Error Type:")}  ${pc.red(diagnosis.errorType)}`,
    `${pc.bold("Summary:")}     ${diagnosis.summary}`,
    `${pc.bold("Root Cause:")}  ${diagnosis.rootCause}`,
    `${pc.bold("Confidence:")}  ${formatConfidence(diagnosis.confidence)}`,
  ];

  if (diagnosis.affectedFiles.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Affected Files:"));
    for (const f of diagnosis.affectedFiles) {
      bodyLines.push(`  ${pc.dim("-")} ${pc.underline(f)}`);
    }
  }

  if (diagnosis.suggestedFixes.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Suggested Fixes:"));
    for (const fix of diagnosis.suggestedFixes) {
      bodyLines.push(`  ${formatConfidence(fix.confidence)} ${fix.description}`);
      if (fix.command) bodyLines.push(`       ${pc.dim("$")} ${pc.cyan(fix.command)}`);
      if (fix.file) bodyLines.push(`       ${pc.dim("File:")} ${pc.underline(fix.file)}`);
    }
  }

  p.note(bodyLines.join("\n"), "CI Diagnosis");
}

async function runDiff(diffContent: string, provider: LLMProvider) {
  const analyzer = createDiffAnalyzer(provider);

  const s = p.spinner();
  s.start("Analyzing infrastructure diff...");
  const analysis = await analyzer.analyze(diffContent);
  s.stop("Analysis complete.");

  const bodyLines = [
    `${pc.bold("Summary:")}     ${analysis.summary}`,
    `${pc.bold("Risk Level:")}  ${riskColor(analysis.riskLevel)}`,
    `${pc.bold("Cost Impact:")} ${analysis.costImpact.direction} — ${analysis.costImpact.details}`,
    `${pc.bold("Rollback:")}    ${analysis.rollbackComplexity}`,
    `${pc.bold("Confidence:")}  ${formatConfidence(analysis.confidence)}`,
  ];

  if (analysis.changes.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold(`Changes (${analysis.changes.length}):`));
    for (const change of analysis.changes) {
      const detail = change.attribute ? pc.dim(` (${change.attribute})`) : "";
      const action = changeColor(change.action.toUpperCase());
      bodyLines.push(`  ${action} ${change.resource}${detail}`);
    }
  }

  if (analysis.riskFactors.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Risk Factors:"));
    for (const r of analysis.riskFactors) {
      bodyLines.push(`  ${pc.yellow("-")} ${r}`);
    }
  }

  if (analysis.securityImpact.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Security Impact:"));
    for (const s of analysis.securityImpact) {
      bodyLines.push(`  ${pc.red("-")} ${s}`);
    }
  }

  if (analysis.recommendations.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Recommendations:"));
    for (const rec of analysis.recommendations) {
      bodyLines.push(`  ${pc.blue("-")} ${rec}`);
    }
  }

  p.note(bodyLines.join("\n"), "Infrastructure Diff Analysis");
}

async function runServe(
  args: string[],
  providerOpts: { provider: string; model?: string; apiKey?: string },
) {
  const portArg = args.find((a) => a.startsWith("--port="));
  const port = portArg
    ? parseInt(portArg.split("=")[1], 10)
    : parseInt(process.env.ODA_API_PORT ?? "3000", 10);

  const { createApp, HistoryStore } = await import("@odaops/api");

  // Populate env vars so that createProvider() inside the API app also picks up the resolved config
  if (providerOpts.provider) process.env.ODA_PROVIDER = providerOpts.provider;
  if (providerOpts.model) process.env.ODA_MODEL = providerOpts.model;
  if (providerOpts.apiKey) {
    const envVar = providerOpts.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    if (!process.env[envVar]) process.env[envVar] = providerOpts.apiKey;
  }

  const provider = createProvider(providerOpts);
  const tools = createTools(provider);
  const router = createRouter(provider);
  const debugger_ = createDebugger(provider);
  const diffAnalyzer = createDiffAnalyzer(provider);
  const store = new HistoryStore();

  const app = createApp({
    provider,
    tools,
    router,
    debugger: debugger_,
    diffAnalyzer,
    store,
  });

  app.listen(port, () => {
    const noteLines = [
      `${pc.bold("Provider:")}  ${provider.name}`,
      `${pc.bold("Tools:")}     ${tools.map((t) => t.name).join(", ")}`,
      `${pc.bold("Dashboard:")} ${pc.underline(`http://localhost:${port}`)}`,
    ];
    p.note(noteLines.join("\n"), "Server Started");
    p.log.success(`ODA API server running on ${pc.underline(`http://localhost:${port}`)}`);
  });
}

// ── Help ───────────────────────────────────────────────────────────

function printHelp() {
  console.log();
  console.log(`  ${pc.bold(pc.cyan("oda"))} — AI-powered DevOps automation agent`);
  console.log();
  console.log(pc.bold("USAGE"));
  console.log(`  ${pc.dim("$")} oda [command] [options] <prompt>`);
  console.log();
  console.log(pc.bold("COMMANDS"));
  console.log(`  ${pc.cyan("config")}             Configure provider, model, and API tokens`);
  console.log(`  ${pc.cyan("login")}              Authenticate with an LLM provider`);
  console.log(`  ${pc.cyan("serve")}              Start the API server + web dashboard`);
  console.log(
    `  ${pc.cyan("<prompt>")}           Run the agent on a prompt ${pc.dim("(default)")}`,
  );
  console.log();
  console.log(pc.bold("OPTIONS"));
  console.log(`  ${pc.cyan("--provider=NAME")}    LLM provider: openai, anthropic, ollama`);
  console.log(`  ${pc.cyan("--model=NAME")}       LLM model override`);
  console.log(`  ${pc.cyan("--plan")}             Decompose into task graph + generate`);
  console.log(`  ${pc.cyan("--execute")}          Generate + execute with approval workflow`);
  console.log(`  ${pc.cyan("--yes")}              Auto-approve all executions`);
  console.log(`  ${pc.cyan("--debug-ci")}         Diagnose CI/CD log failures`);
  console.log(`  ${pc.cyan("--diff")}             Analyze infrastructure diff for risk`);
  console.log(`  ${pc.cyan("--show")}             Show current configuration`);
  console.log(`  ${pc.cyan("--port=N")}           API server port ${pc.dim("(default: 3000)")}`);
  console.log(`  ${pc.cyan("--help, -h")}         Show this help message`);
  console.log();
  console.log(pc.bold("CONFIG"));
  console.log(`  ${pc.dim("$")} oda config                  Interactive setup`);
  console.log(`  ${pc.dim("$")} oda config --show            Show current configuration`);
  console.log(`  ${pc.dim("$")} oda config --provider anthropic --token <KEY> --model <MODEL>`);
  console.log();
  console.log(pc.bold("LOGIN"));
  console.log(`  ${pc.dim("$")} oda login --token <API_KEY>`);
  console.log(`  ${pc.dim("$")} oda login --token <API_KEY> --provider anthropic`);
  console.log();
  console.log(`  Saves the token to ${pc.dim("~/.oda/config.json")} (file permissions: 0600).`);
  console.log(`  If no --provider is given, saves for the current default provider.`);
  console.log();
  console.log(pc.bold("EXAMPLES"));
  console.log(`  ${pc.dim("$")} oda "Create a Terraform config for S3"`);
  console.log(`  ${pc.dim("$")} oda --provider=anthropic "Create a Terraform config for S3"`);
  console.log(`  ${pc.dim("$")} oda --model=gpt-4o "Create a Terraform config for S3"`);
  console.log(`  ${pc.dim("$")} oda --plan "Set up CI/CD for a Node.js app"`);
  console.log(`  ${pc.dim("$")} oda --execute --yes "Create CI for Node app"`);
  console.log(`  ${pc.dim("$")} oda --debug-ci "ERROR: tsc failed..."`);
  console.log(`  ${pc.dim("$")} oda --diff "terraform plan output..."`);
  console.log(`  ${pc.dim("$")} oda serve`);
  console.log(`  ${pc.dim("$")} oda serve --port=8080`);
  console.log();
  console.log(pc.bold("CONFIGURATION PRECEDENCE"));
  console.log(`  Provider:  CLI --provider  >  $ODA_PROVIDER  >  config  >  openai`);
  console.log(`  Model:     CLI --model     >  $ODA_MODEL     >  config  >  provider default`);
  console.log(`  Token:     $OPENAI_API_KEY / $ANTHROPIC_API_KEY  >  config token`);
  console.log();
  console.log(pc.bold("MODELS"));
  console.log(`  ${pc.dim("OpenAI:")}    gpt-4o, gpt-4o-mini`);
  console.log(`  ${pc.dim("Anthropic:")} claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001`);
  console.log(`  ${pc.dim("Ollama:")}    llama3, mistral, codellama`);
  console.log();
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  // Login subcommand — handle before provider creation
  if (args[0] === "login") {
    runLogin(args.slice(1));
    return;
  }

  // Config subcommand — handle before provider creation
  if (args[0] === "config") {
    await runConfig(args.slice(1));
    return;
  }

  p.intro(pc.bgCyan(pc.black(" oda ")));

  // Load config and resolve provider/model/token
  const config = loadConfig();
  const providerFlag = parseFlagValue(args, "--provider");
  const modelFlag = parseFlagValue(args, "--model");

  let providerName: string;
  try {
    providerName = resolveProvider(providerFlag, config);
  } catch (err) {
    p.log.error((err as Error).message);
    process.exit(1);
  }

  const model = resolveModel(modelFlag, config);
  const apiKey = resolveToken(providerName, config);

  // Serve subcommand
  if (args[0] === "serve") {
    await runServe(args.slice(1), { provider: providerName, model, apiKey });
    return;
  }

  const provider = createProvider({ provider: providerName, model, apiKey });

  const planMode = args.includes("--plan");
  const executeMode = args.includes("--execute");
  const autoApprove = args.includes("--yes");
  const debugCI = args.includes("--debug-ci");
  const diffMode = args.includes("--diff");

  const booleanFlags = new Set(["--plan", "--execute", "--yes", "--debug-ci", "--diff"]);
  const valueFlags = new Set(["--model", "--provider", "--port"]);
  const promptParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (booleanFlags.has(arg)) continue;
    if (valueFlags.has(arg)) {
      i++; // skip the next arg (the value)
      continue;
    }
    // Skip --flag=value forms
    const eqFlag = arg.split("=")[0];
    if (valueFlags.has(eqFlag)) continue;
    promptParts.push(arg);
  }
  const prompt = promptParts.join(" ");

  if (!prompt) {
    p.log.error("No prompt provided.");
    printHelp();
    process.exit(1);
  }

  if (debugCI) {
    await runDebugCI(prompt, provider);
  } else if (diffMode) {
    await runDiff(prompt, provider);
  } else if (planMode || executeMode) {
    await runPlan(prompt, provider, executeMode, autoApprove);
  } else {
    // Multi-agent routing: pick the best specialist for the prompt
    const router = createRouter(provider);

    const s = p.spinner();
    s.start("Routing to specialist agent...");
    const route = router.route(prompt);
    s.stop(
      route.confidence > 0
        ? `Routed to ${pc.bold(route.agent.name)} — ${route.reason}`
        : "Using default agent.",
    );

    const s2 = p.spinner();
    s2.start("Thinking...");
    const result = await route.agent.run({ prompt });
    s2.stop("Done.");

    p.log.message(result.content);
  }

  p.outro("Done.");
}

main();
