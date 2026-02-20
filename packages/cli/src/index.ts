#!/usr/bin/env node

import "dotenv/config";
import {
  DevOpsAgent,
  OpenAIProvider,
  OllamaProvider,
  AnthropicProvider,
  LLMProvider,
} from "@oda/core";
import { decompose, PlannerExecutor } from "@oda/planner";
import {
  GitHubActionsTool,
  TerraformTool,
  KubernetesTool,
  HelmTool,
  AnsibleTool,
} from "@oda/tools";
import {
  SafeExecutor,
  AutoApproveHandler,
  CallbackApprovalHandler,
  ApprovalRequest,
} from "@oda/executor";

function createProvider(): LLMProvider {
  const providerName = process.env.ODA_PROVIDER ?? "openai";

  if (providerName === "ollama") {
    return new OllamaProvider();
  } else if (providerName === "anthropic") {
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
  } else {
    return new OpenAIProvider(process.env.OPENAI_API_KEY!);
  }
}

function createTools(provider: LLMProvider) {
  return [
    new GitHubActionsTool(provider),
    new TerraformTool(provider),
    new KubernetesTool(provider),
    new HelmTool(provider),
    new AnsibleTool(provider),
  ];
}

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

async function main() {
  const provider = createProvider();
  const args = process.argv.slice(2);

  const planMode = args.includes("--plan");
  const executeMode = args.includes("--execute");
  const autoApprove = args.includes("--yes");
  const flags = ["--plan", "--execute", "--yes"];
  const prompt = args.filter((a) => !flags.includes(a)).join(" ");

  if (!prompt) {
    console.log("Usage: oda [--plan] [--execute] [--yes] <prompt>");
    console.log("  --plan     Decompose into task graph and run generate phase");
    console.log("  --execute  Also run execute phase with approval workflow");
    console.log("  --yes      Auto-approve all execution (skip approval prompts)");
    process.exit(1);
  }

  if (planMode || executeMode) {
    await runPlan(prompt, provider, executeMode, autoApprove);
  } else {
    const agent = new DevOpsAgent(provider);
    const result = await agent.run(prompt);
    console.log(result.content);
  }
}

main();
