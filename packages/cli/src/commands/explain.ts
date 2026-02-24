import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot, loadPlan, getLatestPlan, loadSession } from "../state";

export async function explainCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .dojops/ project found. Run `dojops init` first.");
    process.exit(1);
  }

  const planArg = args.find((a) => !a.startsWith("-"));

  let plan;
  if (planArg === "last" || !planArg) {
    const session = loadSession(root);
    plan = session.currentPlan ? loadPlan(root, session.currentPlan) : getLatestPlan(root);
  } else {
    plan = loadPlan(root, planArg);
  }

  if (!plan) {
    p.log.error("No plan found. Run `dojops plan <prompt>` first.");
    process.exit(1);
  }

  const provider = ctx.getProvider();

  const systemPrompt =
    "You are a DevOps expert. Explain the following infrastructure plan clearly. " +
    "Describe what each task does, why it is needed, any security considerations, " +
    "and best practices applied. Be concise but thorough.";

  const planSummary = plan.tasks
    .map(
      (t) =>
        `- [${t.id}] ${t.tool}: ${t.description} (depends on: ${t.dependsOn.join(", ") || "none"})`,
    )
    .join("\n");

  const prompt = `Plan: ${plan.goal}\n\nTasks:\n${planSummary}`;

  const s = p.spinner();
  s.start("Generating explanation...");
  const result = await provider.generate({
    prompt,
    system: systemPrompt,
  });
  s.stop("Explanation ready.");

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ planId: plan.id, explanation: result.content }));
    return;
  }

  p.note(result.content, `Explanation: ${plan.id}`);
}
