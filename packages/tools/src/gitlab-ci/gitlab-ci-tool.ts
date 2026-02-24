import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput } from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import { GitLabCIInputSchema, GitLabCIInput } from "./schemas";
import { detectGitLabProjectType } from "./detector";
import { generateGitLabCI, gitlabCIToYaml } from "./generator";

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

    try {
      const config = await generateGitLabCI(
        projectType,
        input.defaultBranch,
        input.nodeVersion,
        this.provider,
      );

      const yamlContent = gitlabCIToYaml(config);

      return {
        success: true,
        data: {
          projectType,
          config,
          yaml: yamlContent,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: GitLabCIInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { yaml: string };
    fs.writeFileSync(path.join(input.projectPath, ".gitlab-ci.yml"), data.yaml, "utf-8");

    return result;
  }
}
