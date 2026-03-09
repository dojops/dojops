import { z } from "zod";

export { z } from "zod";

export interface ToolOutput {
  success: boolean;
  data?: unknown;
  error?: string;
  filesWritten?: string[];
  filesModified?: string[];
  filesUnchanged?: string[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface VerificationIssue {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  rule?: string;
}

export interface VerificationResult {
  passed: boolean;
  tool: string;
  issues: VerificationIssue[];
  rawOutput?: string;
}

export interface DevOpsTool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  validate(input: unknown): { valid: boolean; error?: string };
  generate(input: TInput): Promise<ToolOutput>;
  execute?(input: TInput): Promise<ToolOutput>;
  verify?(data: unknown): Promise<VerificationResult>;
}

export abstract class BaseTool<TInput> implements DevOpsTool<TInput> {
  abstract name: string;
  abstract description: string;
  abstract inputSchema: z.ZodType;

  validate(input: unknown): { valid: boolean; error?: string } {
    const result = this.inputSchema.safeParse(input);
    if (result.success) {
      return { valid: true };
    }
    return { valid: false, error: result.error.message };
  }

  abstract generate(input: TInput): Promise<ToolOutput>;
}
