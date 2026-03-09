import type { LLMProvider } from "../llm/provider";

/** Verification issue shape (mirrors @dojops/sdk VerificationIssue to avoid cross-dependency). */
interface VerificationIssue {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  rule?: string;
}

/** Verification result shape (mirrors @dojops/sdk VerificationResult). */
interface VerificationResult {
  passed: boolean;
  tool: string;
  issues: VerificationIssue[];
}

export interface CritiqueResult {
  issues: CritiqueIssue[];
  repairInstructions: string;
}

export interface CritiqueIssue {
  severity: "error" | "warning" | "info";
  category: "correctness" | "best-practice" | "security" | "structure";
  message: string;
  suggestion?: string;
}

/**
 * Critic agent that analyzes generated DevOps configurations.
 * Used in the self-repair loop: generate → verify → critique → repair → verify.
 */
export class CriticAgent {
  constructor(private readonly provider: LLMProvider) {}

  /**
   * Analyze generated content against verification results and produce
   * structured repair instructions for the next generation attempt.
   */
  async critique(
    generatedContent: string,
    verificationResult: VerificationResult,
    toolName: string,
    originalPrompt?: string,
  ): Promise<CritiqueResult> {
    const verificationErrors = verificationResult.issues
      .filter((i) => i.severity === "error" || i.severity === "warning")
      .map(
        (i) =>
          `[${i.severity.toUpperCase()}] ${i.message}${i.line ? ` (line ${i.line})` : ""}${i.rule ? ` [${i.rule}]` : ""}`,
      )
      .join("\n");

    const contentPreview =
      generatedContent.length > 8000
        ? generatedContent.slice(0, 8000) + "\n... (truncated)"
        : generatedContent;

    const system = `You are a DevOps configuration critic. Analyze the generated configuration that failed validation and produce precise repair instructions.

Your job is NOT to generate fixed content — only to diagnose the issues and describe exactly what needs to change.

Respond with JSON:
{
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "category": "correctness" | "best-practice" | "security" | "structure",
      "message": "what is wrong",
      "suggestion": "how to fix it"
    }
  ],
  "repairInstructions": "Precise, actionable instructions for the generator to fix all issues. Reference specific lines/sections."
}`;

    const prompt = `## Tool: ${toolName}
${originalPrompt ? `\n## Original Request\n${originalPrompt}\n` : ""}
## Generated Content (that failed validation)

\`\`\`
${contentPreview}
\`\`\`

## Verification Errors

${verificationErrors || "No specific errors — verification reported general failure."}

Analyze the content, identify all issues (including ones the verifier may have missed), and provide repair instructions.`;

    try {
      const response = await this.provider.generate({
        system,
        prompt,
      });

      return this.parseCritiqueResponse(response.content, verificationResult);
    } catch {
      // If critic LLM call fails, fall back to verification-only feedback
      return this.fallbackCritique(verificationResult);
    }
  }

  private parseCritiqueResponse(
    content: string,
    verificationResult: VerificationResult,
  ): CritiqueResult {
    try {
      // Strip markdown code fences if present
      let cleaned = content.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }

      const parsed = JSON.parse(cleaned);
      if (parsed.issues && parsed.repairInstructions) {
        return {
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          repairInstructions:
            typeof parsed.repairInstructions === "string" ? parsed.repairInstructions : "",
        };
      }
    } catch {
      // Parse failed — use fallback
    }
    return this.fallbackCritique(verificationResult);
  }

  private fallbackCritique(verificationResult: VerificationResult): CritiqueResult {
    const issues: CritiqueIssue[] = verificationResult.issues
      .filter((i) => i.severity === "error" || i.severity === "warning")
      .map((i) => ({
        severity: i.severity as "error" | "warning",
        category: "correctness" as const,
        message: i.message,
      }));

    const repairInstructions = verificationResult.issues
      .filter((i) => i.severity === "error")
      .map((i) => `- Fix: ${i.message}`)
      .join("\n");

    return { issues, repairInstructions: repairInstructions || "Fix all verification errors." };
  }
}
