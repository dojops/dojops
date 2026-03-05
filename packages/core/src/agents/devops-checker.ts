import { z } from "zod";
import { LLMProvider } from "../llm/provider";
import { parseAndValidate } from "../llm/json-validator";
import { wrapAsData, sanitizeUserInput } from "../llm/sanitizer";

export const CheckFindingSchema = z.object({
  file: z.string(),
  category: z.enum(["security", "quality", "best-practice", "performance", "reliability"]),
  severity: z.enum(["info", "warning", "error", "critical"]),
  message: z.string(),
  recommendation: z.string(),
});

export const CheckReportSchema = z.object({
  summary: z.string(),
  score: z.number().min(0).max(100),
  findings: z.array(CheckFindingSchema),
  missingFiles: z.array(z.string()),
});

export type CheckFinding = z.infer<typeof CheckFindingSchema>;
export type CheckReport = z.infer<typeof CheckReportSchema>;

const DEVOPS_CHECKER_SYSTEM_PROMPT = `You are a senior DevOps engineer performing a comprehensive review of a project's DevOps configuration files.

Analyze the provided files for:
1. Security issues (exposed secrets, overly permissive permissions, missing security headers)
2. Quality problems (deprecated syntax, anti-patterns, missing error handling)
3. Best practice violations (missing health checks, no resource limits, no caching)
4. Performance concerns (inefficient builds, missing parallelism, large images)
5. Reliability gaps (no retry logic, missing timeouts, no rollback strategy)

Also identify important DevOps files that are MISSING from the project (e.g. .dockerignore, .gitignore, CODEOWNERS, security policies, CI workflows).

CRITICAL: Your suggestions MUST be relevant to the project's detected languages, frameworks, and infrastructure. Study the Project Context carefully:
- Only suggest tools and files that match the detected languages and tech stack.
- Do NOT suggest Makefile for Java/Kotlin/Scala projects (use Gradle or Maven instead).
- Do NOT suggest npm/yarn configs for Python-only projects.
- Do NOT suggest pip/poetry configs for Node.js-only projects.
- Do NOT suggest Terraform for projects with no infrastructure-as-code.
- Do NOT suggest Kubernetes manifests for projects with no container orchestration.
- Match your recommendations to the project's actual ecosystem and toolchain.

Assign a maturity score from 0-100:
- 0-25: Minimal — missing critical configs
- 26-50: Basic — fundamentals present but gaps
- 51-75: Good — solid setup with room for improvement
- 76-100: Excellent — production-ready with best practices

You MUST respond with valid JSON matching this schema:
{
  "summary": "string (2-3 sentence overview)",
  "score": 0-100,
  "findings": [{ "file": "string", "category": "security|quality|best-practice|performance|reliability", "severity": "info|warning|error|critical", "message": "string", "recommendation": "string" }],
  "missingFiles": ["string (file paths that should exist but don't)"]
}

IMPORTANT: Do NOT ask follow-up questions or offer to continue the conversation. This is a single-shot interaction — the user cannot reply. Provide a complete, self-contained response.`;

export class DevOpsChecker {
  constructor(private readonly provider: LLMProvider) {}

  async check(
    contextJson: string,
    fileContents: { path: string; content: string }[],
  ): Promise<CheckReport> {
    const filesSection = fileContents
      .map((f) => wrapAsData(sanitizeUserInput(f.content), f.path))
      .join("\n\n");

    // Extract key project info for explicit constraint reinforcement
    let projectConstraint = "";
    try {
      const ctx = JSON.parse(contextJson);
      const langs = (ctx.languages ?? []).map((l: { name: string }) => l.name);
      const domains = ctx.relevantDomains ?? [];
      if (langs.length > 0 || domains.length > 0) {
        const parts: string[] = [];
        if (langs.length > 0) parts.push(`Detected languages: ${langs.join(", ")}`);
        if (ctx.primaryLanguage) parts.push(`Primary language: ${ctx.primaryLanguage}`);
        if (domains.length > 0) parts.push(`Relevant domains: ${domains.join(", ")}`);
        projectConstraint = `\n## Project Type Constraints\n${parts.join("\n")}\nOnly suggest tools, files, and practices relevant to this specific tech stack.\n`;
      }
    } catch {
      // contextJson parsing failed — skip constraints
    }

    const prompt = [
      "Review this project's DevOps configuration.\n",
      "## Project Context\n```json",
      contextJson,
      "```\n",
      projectConstraint,
      "## DevOps Files\n",
      filesSection,
    ].join("\n");

    const response = await this.provider.generate({
      system: DEVOPS_CHECKER_SYSTEM_PROMPT,
      prompt,
      schema: CheckReportSchema,
    });

    if (response.parsed) {
      return response.parsed as CheckReport;
    }

    return parseAndValidate(response.content, CheckReportSchema);
  }
}
