import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot, loadPlan, getLatestPlan, loadSession } from "../state";
import { ExitCode, CLIError } from "../exit-codes";

export async function explainCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No .dojops/ project found. Run `dojops init` first.",
    );
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
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No plan found. Run `dojops plan <prompt>` first.",
    );
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

  const isStructured = ctx.globalOpts.output !== "table";
  const s = p.spinner();
  if (!isStructured) s.start("Generating explanation...");
  const result = await provider.generate({
    prompt,
    system: systemPrompt,
  });
  if (!isStructured) s.stop("Explanation ready.");

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ planId: plan.id, explanation: result.content }));
    return;
  }

  p.note(result.content, `Explanation: ${plan.id}`);
}
