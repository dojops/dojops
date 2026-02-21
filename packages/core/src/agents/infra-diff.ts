import { z } from "zod";
import { LLMProvider } from "../llm/provider";
import { parseAndValidate } from "../llm/json-validator";

export const ResourceChangeSchema = z.object({
  resource: z.string(),
  action: z.enum(["create", "update", "replace", "delete", "no-op"]),
  attribute: z.string().optional(),
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
});

export const InfraDiffAnalysisSchema = z.object({
  summary: z.string(),
  changes: z.array(ResourceChangeSchema),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  riskFactors: z.array(z.string()),
  costImpact: z.object({
    direction: z.enum(["increase", "decrease", "unchanged", "unknown"]),
    details: z.string(),
  }),
  securityImpact: z.array(z.string()),
  rollbackComplexity: z.enum(["trivial", "simple", "moderate", "complex", "impossible"]),
  recommendations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type ResourceChange = z.infer<typeof ResourceChangeSchema>;
export type InfraDiffAnalysis = z.infer<typeof InfraDiffAnalysisSchema>;

const INFRA_DIFF_SYSTEM_PROMPT = `You are an expert infrastructure analyst. You analyze infrastructure diffs (Terraform plans, Kubernetes manifests, CloudFormation changesets) and produce structured impact analyses.

Given an infrastructure diff, analyze:
1. What resources are being created, updated, replaced, or deleted
2. The risk level of the changes (low, medium, high, critical)
3. Risk factors that could cause issues
4. Cost impact direction and details
5. Security implications
6. How complex a rollback would be
7. Recommendations for proceeding

You MUST respond with valid JSON matching this schema:
{
  "summary": "string",
  "changes": [{ "resource": "string", "action": "create|update|replace|delete|no-op", "attribute?": "string", "oldValue?": "string", "newValue?": "string" }],
  "riskLevel": "low|medium|high|critical",
  "riskFactors": ["string"],
  "costImpact": { "direction": "increase|decrease|unchanged|unknown", "details": "string" },
  "securityImpact": ["string"],
  "rollbackComplexity": "trivial|simple|moderate|complex|impossible",
  "recommendations": ["string"],
  "confidence": 0-1
}

IMPORTANT: Do NOT ask follow-up questions or offer to continue the conversation. This is a single-shot interaction — the user cannot reply. Provide a complete, self-contained response.`;

export class InfraDiffAnalyzer {
  constructor(private provider: LLMProvider) {}

  async analyze(diffContent: string): Promise<InfraDiffAnalysis> {
    const response = await this.provider.generate({
      system: INFRA_DIFF_SYSTEM_PROMPT,
      prompt: `Analyze this infrastructure diff and provide an impact assessment:\n\n${diffContent}`,
      schema: InfraDiffAnalysisSchema,
    });

    if (response.parsed) {
      return response.parsed as InfraDiffAnalysis;
    }

    return parseAndValidate(response.content, InfraDiffAnalysisSchema);
  }

  async compare(before: string, after: string): Promise<InfraDiffAnalysis> {
    const response = await this.provider.generate({
      system: INFRA_DIFF_SYSTEM_PROMPT,
      prompt: `Compare these two infrastructure configurations and analyze the differences:\n\n--- BEFORE ---\n${before}\n\n--- AFTER ---\n${after}`,
      schema: InfraDiffAnalysisSchema,
    });

    if (response.parsed) {
      return response.parsed as InfraDiffAnalysis;
    }

    return parseAndValidate(response.content, InfraDiffAnalysisSchema);
  }
}
