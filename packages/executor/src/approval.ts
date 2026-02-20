import { ToolOutput } from "@oda/sdk";
import { ApprovalDecision, ApprovalRequest, ExecutionPreview } from "./types";

export interface ApprovalHandler {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export class AutoApproveHandler implements ApprovalHandler {
  async requestApproval(): Promise<ApprovalDecision> {
    return "approved";
  }
}

export class AutoDenyHandler implements ApprovalHandler {
  async requestApproval(): Promise<ApprovalDecision> {
    return "denied";
  }
}

export class CallbackApprovalHandler implements ApprovalHandler {
  constructor(private callback: (request: ApprovalRequest) => Promise<ApprovalDecision>) {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    return this.callback(request);
  }
}

export function buildPreview(toolOutput: ToolOutput, toolName: string): ExecutionPreview {
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  const summaryParts: string[] = [`Tool "${toolName}" wants to execute.`];

  if (toolOutput.data && typeof toolOutput.data === "object") {
    const data = toolOutput.data as Record<string, unknown>;

    if ("yaml" in data && typeof data.yaml === "string") {
      summaryParts.push(`Will generate YAML output (${data.yaml.length} chars).`);
    }
    if ("hcl" in data && typeof data.hcl === "string") {
      summaryParts.push(`Will generate HCL output (${data.hcl.length} chars).`);
    }
    if ("projectType" in data) {
      const pt = data.projectType as Record<string, unknown>;
      summaryParts.push(`Detected project type: ${pt.type ?? "unknown"}.`);
    }
    if ("templates" in data && typeof data.templates === "object") {
      const templates = data.templates as Record<string, string>;
      filesCreated.push(...Object.keys(templates).map((k) => `templates/${k}`));
    }
    if ("chartYaml" in data) filesCreated.push("Chart.yaml");
    if ("valuesYaml" in data) filesCreated.push("values.yaml");
  }

  return {
    filesCreated,
    filesModified,
    summary: summaryParts.join(" "),
  };
}
