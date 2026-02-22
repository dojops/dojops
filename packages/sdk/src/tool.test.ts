import { describe, it, expect } from "vitest";
import { BaseTool, ToolOutput, VerificationResult, z } from "./tool";

const EchoInputSchema = z.object({
  message: z.string().min(1),
});

type EchoInput = z.infer<typeof EchoInputSchema>;

class EchoTool extends BaseTool<EchoInput> {
  name = "echo";
  description = "Echoes the input message";
  inputSchema = EchoInputSchema;

  async generate(input: EchoInput): Promise<ToolOutput> {
    return { success: true, data: { echo: input.message } };
  }
}

describe("BaseTool", () => {
  it("validates correct input", () => {
    const tool = new EchoTool();
    const result = tool.validate({ message: "hello" });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects input with wrong type", () => {
    const tool = new EchoTool();
    const result = tool.validate({ message: 123 });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects input with missing fields", () => {
    const tool = new EchoTool();
    const result = tool.validate({});
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("generates output from valid input", async () => {
    const tool = new EchoTool();
    const output = await tool.generate({ message: "hello" });
    expect(output.success).toBe(true);
    expect(output.data).toEqual({ echo: "hello" });
  });

  it("exposes tool name and description", () => {
    const tool = new EchoTool();
    expect(tool.name).toBe("echo");
    expect(tool.description).toBe("Echoes the input message");
  });

  it("does not have verify by default", () => {
    const tool = new EchoTool();
    expect(tool.verify).toBeUndefined();
  });

  it("supports optional verify method on subclass", async () => {
    class VerifiableEchoTool extends EchoTool {
      async verify(): Promise<VerificationResult> {
        return { passed: true, tool: "echo-verify", issues: [] };
      }
    }

    const tool = new VerifiableEchoTool();
    expect(tool.verify).toBeDefined();
    const result = await tool.verify!({});
    expect(result.passed).toBe(true);
    expect(result.tool).toBe("echo-verify");
    expect(result.issues).toHaveLength(0);
  });
});
