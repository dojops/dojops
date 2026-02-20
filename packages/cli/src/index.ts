#!/usr/bin/env node

import "dotenv/config";
import { LLMProvider } from "@oda/core";
import {
  createProvider,
  createTools,
  createRouter,
  createDebugger,
  createDiffAnalyzer,
} from "@oda/api";
import { decompose, PlannerExecutor } from "@oda/planner";
import {
  SafeExecutor,
  AutoApproveHandler,
  CallbackApprovalHandler,
  ApprovalRequest,
} from "@oda/executor";

function cliApprovalHandler(): CallbackApprovalHandler {
  return new CallbackApprovalHandler(async (request: ApprovalRequest) => {
    console.log(`\n--- Approval Required ---`);
    console.log(`Task:    ${request.taskId}`);
    console.log(`Tool:    ${request.toolName}`);
    console.log(`Summary: ${request.preview.summary}`);
    if (request.preview.filesCreated.length > 0) {
      console.log(`Creates: ${request.preview.filesCreated.join(", ")}`);
    }
    if (request.preview.filesModified.length > 0) {
      console.log(`Modifies: ${request.preview.filesModified.join(", ")}`);
    }
    console.log(`--- Auto-approving (use --deny to block) ---\n`);
    return "approved";
  });
}

async function runPlan(
  prompt: string,
  provider: LLMProvider,
  execute: boolean,
  autoApprove: boolean,
) {
  const tools = createTools(provider);

  console.log("Decomposing goal into tasks...\n");
  const graph = await decompose(prompt, provider, tools);

  console.log(`Goal: ${graph.goal}`);
  console.log(`Tasks (${graph.tasks.length}):`);
  for (const task of graph.tasks) {
    const deps = task.dependsOn.length ? ` (after: ${task.dependsOn.join(", ")})` : "";
    console.log(`  [${task.id}] ${task.tool}: ${task.description}${deps}`);
  }
  console.log();

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
        console.log(`> Running ${id}: ${desc}`);
      },
      taskEnd(id, status, error) {
        if (error) {
          console.log(`  ${id}: ${status} - ${error}`);
        } else {
          console.log(`  ${id}: ${status}`);
        }
      },
    });

    const planResult = await executor.execute(graph);

    console.log(`\nExecuting approved tasks...`);
    for (const taskResult of planResult.results) {
      if (taskResult.status !== "completed") continue;

      const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);
      if (!taskNode) continue;

      const tool = toolMap.get(taskNode.tool);
      if (!tool?.execute) continue;

      const execResult = await safeExecutor.executeTask(taskResult.taskId, tool, taskNode.input);

      console.log(
        `  [${execResult.taskId}] ${execResult.status} (approval: ${execResult.approval})`,
      );
      if (execResult.error) {
        console.log(`    Error: ${execResult.error}`);
      }
    }

    const auditLog = safeExecutor.getAuditLog();
    if (auditLog.length > 0) {
      console.log(`\nAudit log: ${auditLog.length} entries`);
    }

    console.log(`\nPlan ${planResult.success ? "succeeded" : "failed"}.`);
  } else {
    const executor = new PlannerExecutor(tools, {
      taskStart(id, desc) {
        console.log(`> Running ${id}: ${desc}`);
      },
      taskEnd(id, status, error) {
        if (error) {
          console.log(`  ${id}: ${status} - ${error}`);
        } else {
          console.log(`  ${id}: ${status}`);
        }
      },
    });

    const result = await executor.execute(graph);

    console.log(`\nPlan ${result.success ? "succeeded" : "failed"}.`);
    for (const r of result.results) {
      console.log(`  [${r.taskId}] ${r.status}${r.error ? `: ${r.error}` : ""}`);
    }
  }
}

async function runDebugCI(logContent: string, provider: LLMProvider) {
  const debugger_ = createDebugger(provider);

  console.log("Analyzing CI log...\n");
  const diagnosis = await debugger_.diagnose(logContent);

  console.log(`Error Type:  ${diagnosis.errorType}`);
  console.log(`Summary:     ${diagnosis.summary}`);
  console.log(`Root Cause:  ${diagnosis.rootCause}`);
  console.log(`Confidence:  ${(diagnosis.confidence * 100).toFixed(0)}%`);

  if (diagnosis.affectedFiles.length > 0) {
    console.log(`\nAffected Files:`);
    for (const f of diagnosis.affectedFiles) {
      console.log(`  - ${f}`);
    }
  }

  if (diagnosis.suggestedFixes.length > 0) {
    console.log(`\nSuggested Fixes:`);
    for (const fix of diagnosis.suggestedFixes) {
      console.log(`  [${(fix.confidence * 100).toFixed(0)}%] ${fix.description}`);
      if (fix.command) console.log(`       $ ${fix.command}`);
      if (fix.file) console.log(`       File: ${fix.file}`);
    }
  }
}

async function runDiff(diffContent: string, provider: LLMProvider) {
  const analyzer = createDiffAnalyzer(provider);

  console.log("Analyzing infrastructure diff...\n");
  const analysis = await analyzer.analyze(diffContent);

  console.log(`Summary:     ${analysis.summary}`);
  console.log(`Risk Level:  ${analysis.riskLevel}`);
  console.log(`Cost Impact: ${analysis.costImpact.direction} — ${analysis.costImpact.details}`);
  console.log(`Rollback:    ${analysis.rollbackComplexity}`);
  console.log(`Confidence:  ${(analysis.confidence * 100).toFixed(0)}%`);

  if (analysis.changes.length > 0) {
    console.log(`\nChanges (${analysis.changes.length}):`);
    for (const change of analysis.changes) {
      const detail = change.attribute ? ` (${change.attribute})` : "";
      console.log(`  ${change.action.toUpperCase()} ${change.resource}${detail}`);
    }
  }

  if (analysis.riskFactors.length > 0) {
    console.log(`\nRisk Factors:`);
    for (const r of analysis.riskFactors) {
      console.log(`  - ${r}`);
    }
  }

  if (analysis.securityImpact.length > 0) {
    console.log(`\nSecurity Impact:`);
    for (const s of analysis.securityImpact) {
      console.log(`  - ${s}`);
    }
  }

  if (analysis.recommendations.length > 0) {
    console.log(`\nRecommendations:`);
    for (const rec of analysis.recommendations) {
      console.log(`  - ${rec}`);
    }
  }
}

async function runServe(args: string[]) {
  const portArg = args.find((a) => a.startsWith("--port="));
  const port = portArg
    ? parseInt(portArg.split("=")[1], 10)
    : parseInt(process.env.ODA_API_PORT ?? "3000", 10);

  const { createApp, HistoryStore } = await import("@oda/api");

  const provider = createProvider();
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
    console.log(`ODA API server running on http://localhost:${port}`);
    console.log(`Provider: ${provider.name}`);
    console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);
    console.log(`Dashboard: http://localhost:${port}`);
  });
}

function printHelp() {
  console.log("Usage: oda [command] [options] <prompt>");
  console.log();
  console.log("Commands:");
  console.log("  serve          Start API server + web dashboard");
  console.log("  <prompt>       Run agent on prompt (default)");
  console.log();
  console.log("Options:");
  console.log("  --plan         Decompose into task graph and run generate phase");
  console.log("  --execute      Also run execute phase with approval workflow");
  console.log("  --yes          Auto-approve all execution (skip approval prompts)");
  console.log("  --debug-ci     Analyze CI log output and diagnose failures");
  console.log("  --diff         Analyze infrastructure diff for risk and impact");
  console.log("  --port=N       Port for serve command (default: 3000)");
  console.log("  --help         Show this help message");
  console.log();
  console.log("Examples:");
  console.log('  oda "Create a Terraform config for S3"');
  console.log('  oda --plan "Set up CI/CD for a Node.js app"');
  console.log('  oda --execute --yes "Create CI for Node app"');
  console.log('  oda --debug-ci "ERROR: tsc failed..."');
  console.log('  oda --diff "terraform plan output..."');
  console.log("  oda serve");
  console.log("  oda serve --port=8080");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // Serve subcommand
  if (args[0] === "serve") {
    await runServe(args.slice(1));
    return;
  }

  const provider = createProvider();

  const planMode = args.includes("--plan");
  const executeMode = args.includes("--execute");
  const autoApprove = args.includes("--yes");
  const debugCI = args.includes("--debug-ci");
  const diffMode = args.includes("--diff");
  const flags = ["--plan", "--execute", "--yes", "--debug-ci", "--diff"];
  const prompt = args.filter((a) => !flags.includes(a)).join(" ");

  if (!prompt) {
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
    const route = router.route(prompt);

    if (route.confidence > 0) {
      console.log(`[Routed to ${route.agent.name} — ${route.reason}]\n`);
    }

    const result = await route.agent.run({ prompt });
    console.log(result.content);
  }
}

main();
