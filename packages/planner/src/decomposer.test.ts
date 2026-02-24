import { describe, it, expect, vi } from "vitest";
import { LLMProvider } from "@dojops/core";
import { BaseTool, ToolOutput, z } from "@dojops/sdk";
import { decompose } from "./decomposer";
import { TaskGraphSchema } from "./types";

class MockTool extends BaseTool<{ projectPath: string; enabled: boolean }> {
  name = "mock-tool";
  description = "A mock tool for testing";
  inputSchema = z.object({
    projectPath: z.string(),
    enabled: z.boolean().default(true),
  });
  async generate(): Promise<ToolOutput> {
    return { success: true };
  }
}

describe("decompose", () => {
  it("returns a valid TaskGraph from the LLM response", async () => {
    const mockGraph = {
      goal: "deploy app",
      tasks: [
        {
          id: "t1",
          tool: "mock-tool",
          description: "First task",
          dependsOn: [],
          input: { projectPath: "./app", enabled: true },
        },
        {
          id: "t2",
          tool: "mock-tool",
          description: "Second task",
          dependsOn: ["t1"],
          input: { projectPath: "$ref:t1", enabled: false },
        },
      ],
    };

    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify(mockGraph),
        parsed: mockGraph,
      }),
    };

    const result = await decompose("deploy app", provider, [new MockTool()]);

    expect(result.goal).toBe("deploy app");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].id).toBe("t1");
    expect(result.tasks[1].dependsOn).toContain("t1");

    const validation = TaskGraphSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it("passes available tools to the LLM system prompt", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: "{}",
        parsed: {
          goal: "test",
          tasks: [
            {
              id: "t1",
              tool: "mock-tool",
              description: "test",
              dependsOn: [],
              input: { projectPath: "./test" },
            },
          ],
        },
      }),
    };

    await decompose("test", provider, [new MockTool()]);

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.system).toContain("mock-tool");
    expect(call.system).toContain("A mock tool for testing");
  });

  it("includes tool input schema in system prompt", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: "{}",
        parsed: {
          goal: "test",
          tasks: [
            {
              id: "t1",
              tool: "mock-tool",
              description: "test",
              dependsOn: [],
              input: { projectPath: "./test" },
            },
          ],
        },
      }),
    };

    await decompose("test schema", provider, [new MockTool()]);

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.system).toContain("Input fields:");
    expect(call.system).toContain("projectPath (string, required)");
    expect(call.system).toContain("enabled (boolean, optional, default: true)");
    expect(call.system).toContain("MUST match the tool's input fields exactly");
  });

  it("validates LLM-generated inputs against tool schema", async () => {
    const tool = new MockTool();

    // Simulates LLM returning inputs that match the schema
    const validInput = { projectPath: "./infra", enabled: false };
    const validation = tool.validate(validInput);
    expect(validation.valid).toBe(true);

    // Simulates LLM returning inputs that DON'T match (missing required field)
    const invalidInput = { enabled: true };
    const badValidation = tool.validate(invalidInput);
    expect(badValidation.valid).toBe(false);
    expect(badValidation.error).toBeDefined();
  });

  it("includes schema info for terraform-shaped tool", async () => {
    class TerraformLikeTool extends BaseTool<{
      projectPath: string;
      provider: "aws" | "gcp" | "azure";
      resources: string;
      backendType: string;
    }> {
      name = "terraform";
      description = "Generates Terraform configurations";
      inputSchema = z.object({
        projectPath: z.string(),
        provider: z.enum(["aws", "gcp", "azure"]),
        resources: z.string().describe("Description of infrastructure resources to provision"),
        backendType: z.enum(["local", "s3", "gcs", "azurerm"]).default("local"),
      });
      async generate(): Promise<ToolOutput> {
        return { success: true };
      }
    }

    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: "{}",
        parsed: {
          goal: "deploy",
          tasks: [
            {
              id: "t1",
              tool: "terraform",
              description: "create infra",
              dependsOn: [],
              input: { projectPath: "./infra", provider: "aws", resources: "EC2 + RDS" },
            },
          ],
        },
      }),
    };

    await decompose("deploy to AWS", provider, [new TerraformLikeTool()]);

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.system).toContain("### terraform");
    expect(call.system).toContain("projectPath (string, required)");
    expect(call.system).toContain('"aws" | "gcp" | "azure"');
    expect(call.system).toContain("Description of infrastructure resources to provision");
    expect(call.system).toContain("backendType");
  });
});
