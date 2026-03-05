import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "../../llm/anthropic";
import { CIDebugger, CIDiagnosisSchema } from "../../agents/ci-debugger";
import { InfraDiffAnalyzer, InfraDiffAnalysisSchema } from "../../agents/infra-diff";
import { AgentRouter } from "../../agents/router";

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

function createProvider(): AnthropicProvider {
  return new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? "", MODEL);
}

describe.skipIf(!HAS_KEY)("AnthropicProvider contract tests", () => {
  it("generates plain text response", async () => {
    const provider = createProvider();
    const res = await provider.generate({
      prompt: "Reply with exactly one word: hello",
    });
    expect(res.content).toBeTruthy();
    expect(typeof res.content).toBe("string");
    expect(res.content.length).toBeGreaterThan(0);
  }, 30_000);

  it("generates structured output with Zod schema", async () => {
    const provider = createProvider();
    const schema = z.object({
      answer: z.string(),
      confidence: z.number().min(0).max(1),
    });

    const res = await provider.generate({
      prompt:
        'What is the capital of France? Return JSON with "answer" (string) and "confidence" (0-1).',
      schema,
    });

    expect(res.parsed).toBeDefined();
    const parsed = res.parsed as z.infer<typeof schema>;
    expect(typeof parsed.answer).toBe("string");
    expect(parsed.answer.toLowerCase()).toContain("paris");
    expect(parsed.confidence).toBeGreaterThan(0);
    expect(parsed.confidence).toBeLessThanOrEqual(1);
  }, 30_000);

  it("CIDebugger.diagnose() returns valid CIDiagnosis", async () => {
    const provider = createProvider();
    const debugger_ = new CIDebugger(provider);

    const diagnosis = await debugger_.diagnose(
      `Step 3/8: Run npm test
        npm ERR! Test failed.
        FAIL src/utils.test.ts
          ● add() › should return sum
            expect(received).toBe(expected)
            Expected: 3
            Received: 2
        Tests: 1 failed, 4 passed, 5 total
        Process exited with code 1`,
    );

    const result = CIDiagnosisSchema.safeParse(diagnosis);
    expect(result.success).toBe(true);
    expect(diagnosis.errorType).toBeDefined();
    expect(diagnosis.summary).toBeTruthy();
    expect(diagnosis.rootCause).toBeTruthy();
    expect(Array.isArray(diagnosis.suggestedFixes)).toBe(true);
    expect(diagnosis.confidence).toBeGreaterThan(0);
  }, 30_000);

  it("InfraDiffAnalyzer.analyze() returns valid InfraDiffAnalysis", async () => {
    const provider = createProvider();
    const analyzer = new InfraDiffAnalyzer(provider);

    const analysis = await analyzer.analyze(
      `# aws_s3_bucket.logs will be created
        + resource "aws_s3_bucket" "logs" {
            bucket = "my-app-logs-prod"
            acl    = "private"
          }

        # aws_s3_bucket.data will be destroyed
        - resource "aws_s3_bucket" "data" {
            bucket = "my-app-data-old"
          }`,
    );

    const result = InfraDiffAnalysisSchema.safeParse(analysis);
    expect(result.success).toBe(true);
    expect(analysis.summary).toBeTruthy();
    expect(Array.isArray(analysis.changes)).toBe(true);
    expect(analysis.changes.length).toBeGreaterThan(0);
    expect(["low", "medium", "high", "critical"]).toContain(analysis.riskLevel);
    expect(analysis.confidence).toBeGreaterThan(0);
  }, 30_000);

  it("AgentRouter.route() returns a specialist with confidence", () => {
    const provider = createProvider();
    const router = new AgentRouter(provider);

    const result = router.route("Create a Terraform module for AWS VPC");
    expect(result.agent).toBeDefined();
    expect(result.agent.domain).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeTruthy();
  });
});
