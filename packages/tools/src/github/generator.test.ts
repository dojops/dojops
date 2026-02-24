import { describe, it, expect, vi } from "vitest";
import { LLMProvider } from "@dojops/core";
import { generateWorkflow, workflowToYaml } from "./generator";
import { Workflow } from "./schemas";

const mockWorkflow: Workflow = {
  name: "CI",
  on: { push: { branches: ["main"] } },
  jobs: {
    build: {
      "runs-on": "ubuntu-latest",
      steps: [
        { name: "Checkout", uses: "actions/checkout@v4" },
        { name: "Test", run: "npm test" },
      ],
    },
  },
};

function mockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(mockWorkflow),
      parsed: mockWorkflow,
    }),
  };
}

describe("generateWorkflow", () => {
  it("calls provider with structured schema and returns parsed workflow", async () => {
    const provider = mockProvider();
    const result = await generateWorkflow({ type: "node" }, "main", "20", provider);

    expect(result).toEqual(mockWorkflow);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.schema).toBeDefined();
    expect(call.prompt).toContain("node");
  });

  it("includes node version for node projects", async () => {
    const provider = mockProvider();
    await generateWorkflow({ type: "node" }, "main", "18", provider);

    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("Node version: 18");
  });
});

describe("workflowToYaml", () => {
  it("serializes workflow to YAML string", () => {
    const yaml = workflowToYaml(mockWorkflow);
    expect(yaml).toContain("name: CI");
    expect(yaml).toContain("runs-on: ubuntu-latest");
    expect(yaml).toContain("npm test");
  });
});
