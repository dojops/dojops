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
import { GitLabCIInputSchema, GitLabCIInput } from "./schemas";
import { detectGitLabProjectType } from "./detector";
import { generateGitLabCI, gitlabCIToYaml } from "./generator";
import { verifyGitLabCI } from "./verifier";

export class GitLabCITool extends BaseTool<GitLabCIInput> {
  name = "gitlab-ci";
  description = "Generates GitLab CI/CD pipeline configuration based on project type";
  inputSchema = GitLabCIInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: GitLabCIInput): Promise<ToolOutput> {
    const projectType = detectGitLabProjectType(input.projectPath);

    if (projectType.type === "unknown") {
      return {
        success: false,
        error: `Could not detect project type at ${input.projectPath}`,
      };
    }

    const existingContent =
      input.existingContent ?? readExistingConfig(path.join(input.projectPath, ".gitlab-ci.yml"));
    const isUpdate = !!existingContent;

    try {
      const config = await generateGitLabCI(
        projectType,
        input.defaultBranch,
        input.nodeVersion,
        this.provider,
        existingContent ?? undefined,
      );

      const yamlContent = gitlabCIToYaml(config);

      return {
        success: true,
        data: {
          projectType,
          config,
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
      return { passed: true, tool: "gitlab-ci-lint", issues: [] };
    }
    return verifyGitLabCI(yamlContent);
  }

  async execute(input: GitLabCIInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { yaml: string; isUpdate: boolean };
    const filePath = path.join(input.projectPath, ".gitlab-ci.yml");

    if (data.isUpdate) {
      backupFile(filePath);
    }

    atomicWriteFileSync(filePath, data.yaml);

    const filesWritten = [filePath];
    return { ...result, filesWritten, filesModified: data.isUpdate ? [filePath] : [] };
  }
}
