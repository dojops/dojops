import pc from "picocolors";
import * as p from "@clack/prompts";
import { CallbackApprovalHandler, ApprovalRequest } from "@dojops/executor";

export function cliApprovalHandler(): CallbackApprovalHandler {
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
