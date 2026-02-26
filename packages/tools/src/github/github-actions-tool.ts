import * as fs from "fs";
import * as path from "path";
import {
  BaseTool,
  ToolOutput,
  readExistingConfig,
  backupFile,
  atomicWriteFileSync,
} from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import type { VerificationResult } from "@dojops/sdk";
import { GitHubActionsInputSchema, GitHubActionsInput } from "./schemas";
import { detectProjectType } from "./detector";
import { generateWorkflow, workflowToYaml } from "./generator";
import { verifyGitHubActions } from "./verifier";

export class GitHubActionsTool extends BaseTool<GitHubActionsInput> {
  name = "github-actions";
  description = "Generates GitHub Actions CI/CD workflow files based on project type";
  inputSchema = GitHubActionsInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: GitHubActionsInput): Promise<ToolOutput> {
    const projectType = detectProjectType(input.projectPath);

    if (projectType.type === "unknown") {
      return {
        success: false,
        error: `Could not detect project type at ${input.projectPath}`,
      };
    }

    const existingContent =
      input.existingContent ??
      readExistingConfig(path.join(input.projectPath, ".github", "workflows", "ci.yml"));
    const isUpdate = !!existingContent;

    try {
      const workflow = await generateWorkflow(
        projectType,
        input.defaultBranch,
        input.nodeVersion,
        this.provider,
        existingContent ?? undefined,
      );

      const yamlContent = workflowToYaml(workflow);

      return {
        success: true,
        data: {
          projectType,
          workflow,
          yaml: yamlContent,
          isUpdate,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async verify(data: unknown): Promise<VerificationResult> {
    const record = data as Record<string, unknown>;
    const yamlContent = record.yaml as string;
    if (!yamlContent) {
      return { passed: true, tool: "github-actions-lint", issues: [] };
    }
    return verifyGitHubActions(yamlContent);
  }

  async execute(input: GitHubActionsInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { yaml: string; isUpdate: boolean };
    const workflowDir = path.join(input.projectPath, ".github", "workflows");
    const filePath = path.join(workflowDir, "ci.yml");

    if (data.isUpdate) {
      backupFile(filePath);
    }

    fs.mkdirSync(workflowDir, { recursive: true });
    atomicWriteFileSync(filePath, data.yaml);

    const filesWritten = [filePath];
    return { ...result, filesWritten, filesModified: data.isUpdate ? [filePath] : [] };
  }
}
