import { z } from "zod";
import { LLMProvider } from "../llm/provider";
import { parseAndValidate } from "../llm/json-validator";
import { wrapAsData } from "../llm/sanitizer";

const MAX_INPUT_BYTES = 256 * 1024;

export const CIDiagnosisSchema = z.object({
  errorType: z.enum([
    "build",
    "test",
    "lint",
    "dependency",
    "configuration",
    "timeout",
    "permission",
    "network",
    "unknown",
  ]),
  summary: z.string(),
  rootCause: z.string(),
  suggestedFixes: z.array(
    z.object({
      description: z.string(),
      command: z.string().optional(),
      file: z.string().optional(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  affectedFiles: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type CIDiagnosis = z.infer<typeof CIDiagnosisSchema>;

const CI_DEBUGGER_SYSTEM_PROMPT = `You are an expert CI/CD debugger. You analyze CI pipeline logs and produce structured diagnoses.

Given a CI log, identify:
1. The type of error (build, test, lint, dependency, configuration, timeout, permission, network, or unknown)
2. A brief summary of the failure
3. The root cause
4. Suggested fixes with confidence levels and optional commands/files
5. Affected files mentioned in the log
6. Your overall confidence in the diagnosis (0-1)

You MUST respond with valid JSON matching this schema:
{
  "errorType": "build" | "test" | "lint" | "dependency" | "configuration" | "timeout" | "permission" | "network" | "unknown",
  "summary": "string",
  "rootCause": "string",
  "suggestedFixes": [{ "description": "string", "command?": "string", "file?": "string", "confidence": 0-1 }],
  "affectedFiles": ["string"],
  "confidence": 0-1
}

IMPORTANT: Do NOT ask follow-up questions or offer to continue the conversation. This is a single-shot interaction — the user cannot reply. Provide a complete, self-contained response.`;

export class CIDebugger {
  constructor(private readonly provider: LLMProvider) {}

  async diagnose(logContent: string): Promise<CIDiagnosis> {
    let content = logContent;
    const byteLength = Buffer.byteLength(content);
    if (byteLength > MAX_INPUT_BYTES) {
      const truncated = byteLength - MAX_INPUT_BYTES;
      const tail = Buffer.from(content).subarray(-MAX_INPUT_BYTES).toString("utf-8");
      content = `[...truncated ${truncated} bytes]\n${tail}`;
    }

    const wrappedLog = wrapAsData(content, "ci-log");
    const response = await this.provider.generate({
      system: CI_DEBUGGER_SYSTEM_PROMPT,
      prompt: `Analyze this CI log and diagnose the failure:\n\n${wrappedLog}`,
      schema: CIDiagnosisSchema,
    });

    if (response.parsed) {
      return response.parsed as CIDiagnosis;
    }

    return parseAndValidate(response.content, CIDiagnosisSchema);
  }

  async diagnoseMultiple(logs: { name: string; content: string }[]): Promise<
    {
      name: string;
      diagnosis?: CIDiagnosis;
      error?: string;
    }[]
  > {
    // Process in chunks of 3 to avoid overwhelming the LLM provider
    const CONCURRENCY = 3;
    const results: { name: string; diagnosis?: CIDiagnosis; error?: string }[] = [];
    for (let i = 0; i < logs.length; i += CONCURRENCY) {
      const chunk = logs.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (log) => {
          const diagnosis = await this.diagnose(log.content);
          return { name: log.name, diagnosis };
        }),
      );
      for (let idx = 0; idx < settled.length; idx++) {
        const outcome = settled[idx];
        if (outcome.status === "fulfilled") {
          results.push(outcome.value);
        } else {
          // Surface failures so callers know which logs could not be diagnosed
          results.push({
            name: chunk[idx].name,
            error:
              outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          });
        }
      }
    }
    return results;
  }
}
