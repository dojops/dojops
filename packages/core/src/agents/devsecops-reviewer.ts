import { z } from "zod";
import { LLMProvider } from "../llm/provider";
import { parseAndValidate } from "../llm/json-validator";
import { wrapAsData, sanitizeUserInput } from "../llm/sanitizer";

// ── Schemas ──────────────────────────────────────────

export const ReviewFindingSchema = z.object({
  file: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  category: z.enum(["security", "version", "deprecated", "best-practice", "syntax", "performance"]),
  message: z.string(),
  recommendation: z.string(),
  line: z.number().nullable().optional(),
  toolSource: z.string().nullable().optional(),
});

export const ReviewReportSchema = z.object({
  summary: z.string(),
  score: z.number().min(0).max(100),
  findings: z.array(ReviewFindingSchema),
  recommendedActions: z.array(z.string()),
});

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

// ── Input types ──────────────────────────────────────

export interface ToolValidationResult {
  /** Which tool produced this result (e.g. "actionlint", "hadolint") */
  tool: string;
  /** File that was validated */
  file: string;
  /** Whether the tool passed without errors */
  passed: boolean;
  /** Parsed issues from the tool */
  issues: {
    severity: string;
    message: string;
    line?: number;
    rule?: string;
  }[];
  /** Raw tool output for context */
  rawOutput?: string;
}

export interface ReviewInput {
  /** Config files to review (path + content) */
  files: { path: string; content: string }[];
  /** Pre-run tool validation results (actionlint, hadolint, etc.) */
  toolResults: ToolValidationResult[];
  /** Context7 documentation for version/syntax cross-referencing */
  context7Docs?: string;
}

// ── System prompt ────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior DevSecOps engineer performing a thorough review of DevOps configuration files.

You have TWO sources of truth to cross-reference:

1. **Tool validation results** — Real output from linting/validation tools (actionlint, hadolint, shellcheck, yamllint, etc.) that were run against the files. These are GROUND TRUTH — every tool-reported issue must appear in your findings.

2. **Context7 documentation** — Up-to-date documentation for the technologies used. Use this to:
   - Verify that action/tool/image versions are current (not outdated)
   - Identify deprecated syntax, removed features, or breaking changes
   - Validate configuration structure against current specifications
   - Recommend upgrades with specific version numbers from the docs

Your review process:
1. FIRST, include ALL issues from tool validation results (these are verified by real tools)
2. SECOND, cross-reference file contents against Context7 docs for version/deprecation issues
3. THIRD, apply your expertise for security, best practices, and performance issues

Categories for findings:
- **security**: Exposed secrets, overly permissive permissions, missing security controls
- **version**: Outdated action/tool/image versions, unpinned versions
- **deprecated**: Deprecated syntax, removed features, legacy patterns
- **syntax**: Invalid YAML/HCL/JSON, structural errors caught by tools
- **best-practice**: Missing health checks, no caching, anti-patterns
- **performance**: Inefficient builds, unnecessary steps, missing parallelism

Severity levels:
- **critical**: Security vulnerabilities, broken configs that will fail
- **high**: Outdated versions with known CVEs, deprecated features being removed
- **medium**: Best practice violations, minor security concerns
- **low**: Style issues, optimization opportunities
- **info**: Informational notes, suggestions

Assign a maturity score from 0-100:
- 0-25: Critical — broken configs or severe security issues
- 26-50: Basic — functional but significant gaps
- 51-75: Good — solid setup with room for improvement
- 76-100: Excellent — production-ready with best practices

For each finding, include:
- The exact file path
- The severity and category
- A clear, specific message (cite exact versions, line numbers)
- A concrete recommendation with the fix (not vague advice)
- The tool source if the finding came from a validation tool
- Line number if available

End with "recommendedActions" — a prioritized list of the most impactful improvements.

You MUST respond with valid JSON matching this schema:
{
  "summary": "string (2-3 sentence overview with key stats)",
  "score": 0-100,
  "findings": [{ "file": "string", "severity": "critical|high|medium|low|info", "category": "security|version|deprecated|best-practice|syntax|performance", "message": "string", "recommendation": "string", "line": number|null, "toolSource": "string|null" }],
  "recommendedActions": ["string (ordered by priority)"]
}

IMPORTANT: Do NOT ask follow-up questions. This is a single-shot interaction. Provide a complete, self-contained response.`;

// ── Prompt builders ─────────────────────────────────

/** Format file contents as data-wrapped prompt sections. */
function buildFileSection(files: ReviewInput["files"]): string[] {
  const parts: string[] = ["## Configuration Files\n"];
  for (const file of files) {
    parts.push(wrapAsData(sanitizeUserInput(file.content), file.path));
    parts.push("");
  }
  return parts;
}

/** Format a single issue line from a tool result. */
function formatIssueLine(issue: ToolValidationResult["issues"][number]): string {
  const lineInfo = issue.line ? ` (line ${issue.line})` : "";
  const ruleInfo = issue.rule ? ` [${issue.rule}]` : "";
  return `- ${issue.severity}: ${issue.message}${lineInfo}${ruleInfo}`;
}

/** Format a single tool validation result into prompt lines. */
function formatToolResult(result: ToolValidationResult): string[] {
  const parts: string[] = [];
  const status = result.passed ? "PASSED" : "FAILED";
  parts.push(`### ${result.tool} → ${result.file} [${status}]`);

  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      parts.push(formatIssueLine(issue));
    }
  } else if (result.passed) {
    parts.push("No issues found.");
  }

  if (result.rawOutput && !result.passed) {
    parts.push(`\nRaw output:\n\`\`\`\n${result.rawOutput.slice(0, 2000)}\n\`\`\``);
  }
  parts.push("");
  return parts;
}

/** Build the tool validation results section of the prompt. */
function buildToolResultsSection(toolResults: ToolValidationResult[]): string[] {
  if (toolResults.length === 0) {
    return [
      "## Tool Validation Results\n\nNo validation tools were available to run. " +
        "Rely on your expertise and Context7 documentation for the review.\n",
    ];
  }

  const parts: string[] = [
    "## Tool Validation Results\n",
    "The following tools were run against the configuration files. " +
      "Include ALL issues they found in your review.\n",
  ];
  for (const result of toolResults) {
    parts.push(...formatToolResult(result));
  }
  return parts;
}

/** Build the Context7 documentation section of the prompt (if available). */
function buildContext7Section(context7Docs: string | undefined): string[] {
  if (!context7Docs) return [];
  return [
    "## Reference Documentation (from Context7)\n",
    "Use this documentation to verify versions, syntax, and identify deprecated features.\n",
    context7Docs,
    "",
  ];
}

// ── Reviewer class ───────────────────────────────────

export class DevSecOpsReviewer {
  constructor(private readonly provider: LLMProvider) {}

  /**
   * Review DevOps configuration files using tool validation results
   * and Context7 documentation.
   *
   * @param input - Files, tool results, and optional Context7 docs
   * @returns Structured review report with severity-ranked findings
   */
  async review(input: ReviewInput): Promise<ReviewReport> {
    const promptParts: string[] = [
      ...buildFileSection(input.files),
      ...buildToolResultsSection(input.toolResults),
      ...buildContext7Section(input.context7Docs),
      "Review ALL files above. Cross-reference tool results with documentation. " +
        "Report every finding with specific file, line, and fix.",
    ];

    const response = await this.provider.generate({
      system: SYSTEM_PROMPT,
      prompt: promptParts.join("\n"),
      schema: ReviewReportSchema,
    });

    if (response.parsed) {
      return response.parsed as ReviewReport;
    }

    return parseAndValidate(response.content, ReviewReportSchema);
  }
}
