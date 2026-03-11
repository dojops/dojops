import { describe, it, expect } from "vitest";
import { GeneratedAgentSchema, formatAgentReadme } from "../agent-schema";
import type { GeneratedAgent } from "../agent-schema";

describe("GeneratedAgentSchema", () => {
  it("validates a correct agent object", () => {
    const result = GeneratedAgentSchema.safeParse({
      name: "sre-specialist",
      domain: "site-reliability",
      description: "Handles SRE tasks",
      systemPrompt: "You are an SRE specialist.",
      keywords: ["monitoring", "alerting", "sla"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects agent missing required fields", () => {
    const result = GeneratedAgentSchema.safeParse({
      name: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("formatAgentReadme", () => {
  it("formats agent as markdown readme", () => {
    const agent: GeneratedAgent = {
      name: "db-specialist",
      domain: "database",
      description: "Handles database operations",
      systemPrompt: "You are a database expert.\n\nYou help with queries.",
      keywords: ["sql", "postgres", "migration"],
    };

    const readme = formatAgentReadme(agent);
    expect(readme).toContain("# db-specialist");
    expect(readme).toContain("## Domain\ndatabase");
    expect(readme).toContain("## Description\nHandles database operations");
    expect(readme).toContain("## System Prompt\nYou are a database expert.");
    expect(readme).toContain("## Keywords\nsql, postgres, migration");
  });
});
