import { describe, it, expect } from "vitest";
import { parseAgentReadme, validateAgentConfig, CustomAgentConfig } from "../agent-parser";

const VALID_README = `# SRE Specialist

## Domain
site-reliability

## Description
SRE specialist for incident response, reliability engineering, and observability.

## System Prompt
You are an SRE specialist. You specialize in:
- Incident response and post-mortems
- SLO/SLI design and error budgets
- Chaos engineering and resilience testing

When asked about infrastructure, focus on reliability patterns.

## Keywords
sre, incident, reliability, error budget, slo, chaos, postmortem, runbook, on-call, resilience
`;

describe("parseAgentReadme", () => {
  it("parses valid README.md with all sections", () => {
    const config = parseAgentReadme(VALID_README, "sre-specialist");
    expect(config).not.toBeNull();
    expect(config!.name).toBe("sre-specialist");
    expect(config!.domain).toBe("site-reliability");
    expect(config!.description).toBe(
      "SRE specialist for incident response, reliability engineering, and observability.",
    );
    expect(config!.systemPrompt).toContain("You are an SRE specialist");
    expect(config!.keywords).toEqual([
      "sre",
      "incident",
      "reliability",
      "error budget",
      "slo",
      "chaos",
      "postmortem",
      "runbook",
      "on-call",
      "resilience",
    ]);
  });

  it("uses directory name as agent name", () => {
    const config = parseAgentReadme(VALID_README, "my-custom-agent");
    expect(config!.name).toBe("my-custom-agent");
  });

  it("returns null for empty content", () => {
    expect(parseAgentReadme("", "test")).toBeNull();
    expect(parseAgentReadme("   ", "test")).toBeNull();
  });

  it("returns null when Domain section is missing", () => {
    const readme = `# Test
## Description
A test agent.
## System Prompt
You are a test agent.
## Keywords
test, agent
`;
    expect(parseAgentReadme(readme, "test")).toBeNull();
  });

  it("returns null when System Prompt section is missing", () => {
    const readme = `# Test
## Domain
testing
## Description
A test agent.
## Keywords
test, agent
`;
    expect(parseAgentReadme(readme, "test")).toBeNull();
  });

  it("returns null when Keywords section is missing", () => {
    const readme = `# Test
## Domain
testing
## Description
A test agent.
## System Prompt
You are a test agent.
`;
    expect(parseAgentReadme(readme, "test")).toBeNull();
  });

  it("returns null when Description section is missing", () => {
    const readme = `# Test
## Domain
testing
## System Prompt
You are a test agent.
## Keywords
test, agent
`;
    expect(parseAgentReadme(readme, "test")).toBeNull();
  });

  it("returns null when a required section is empty", () => {
    const readme = `# Test
## Domain

## Description
A test agent.
## System Prompt
You are a test agent.
## Keywords
test
`;
    expect(parseAgentReadme(readme, "test")).toBeNull();
  });

  it("handles extra whitespace and blank lines between sections", () => {
    const readme = `# Agent

## Domain
   custom-domain

## Description
   A custom agent.

## System Prompt

You are a custom agent.

With multiple paragraphs.

## Keywords
  alpha ,  beta , gamma
`;
    const config = parseAgentReadme(readme, "my-agent");
    expect(config).not.toBeNull();
    expect(config!.domain).toBe("custom-domain");
    expect(config!.description).toBe("A custom agent.");
    expect(config!.systemPrompt).toContain("With multiple paragraphs.");
    expect(config!.keywords).toEqual(["alpha", "beta", "gamma"]);
  });

  it("parses multi-paragraph system prompt", () => {
    const readme = `# Test
## Domain
testing
## Description
A test.
## System Prompt
First paragraph.

Second paragraph with details.

Third paragraph with more details.
## Keywords
test
`;
    const config = parseAgentReadme(readme, "test");
    expect(config!.systemPrompt).toContain("First paragraph.");
    expect(config!.systemPrompt).toContain("Second paragraph with details.");
    expect(config!.systemPrompt).toContain("Third paragraph with more details.");
  });

  it("trims keyword whitespace", () => {
    const readme = `# Test
## Domain
testing
## Description
A test.
## System Prompt
Test prompt.
## Keywords
  foo ,  bar baz ,  qux
`;
    const config = parseAgentReadme(readme, "test");
    expect(config!.keywords).toEqual(["foo", "bar baz", "qux"]);
  });

  it("filters empty keywords from trailing commas", () => {
    const readme = `# Test
## Domain
testing
## Description
A test.
## System Prompt
Test prompt.
## Keywords
foo, bar,,, baz,
`;
    const config = parseAgentReadme(readme, "test");
    expect(config!.keywords).toEqual(["foo", "bar", "baz"]);
  });

  it("returns null when keywords resolve to empty after filtering", () => {
    const readme = `# Test
## Domain
testing
## Description
A test.
## System Prompt
Test prompt.
## Keywords
, , ,
`;
    expect(parseAgentReadme(readme, "test")).toBeNull();
  });

  it("ignores unknown sections", () => {
    const readme = `# Test
## Domain
testing
## Author
Someone
## Description
A test.
## System Prompt
Test prompt.
## Notes
Some notes.
## Keywords
test, example
`;
    const config = parseAgentReadme(readme, "test");
    expect(config).not.toBeNull();
    expect(config!.domain).toBe("testing");
  });
});

describe("validateAgentConfig", () => {
  it("validates a complete config", () => {
    const config: CustomAgentConfig = {
      name: "test",
      domain: "testing",
      description: "A test agent",
      systemPrompt: "You are a test agent.",
      keywords: ["test"],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing name", () => {
    const config: CustomAgentConfig = {
      name: "",
      domain: "testing",
      description: "A test",
      systemPrompt: "Prompt",
      keywords: ["test"],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("name is required");
  });

  it("reports missing domain", () => {
    const config: CustomAgentConfig = {
      name: "test",
      domain: "",
      description: "A test",
      systemPrompt: "Prompt",
      keywords: ["test"],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("domain is required");
  });

  it("reports empty keywords", () => {
    const config: CustomAgentConfig = {
      name: "test",
      domain: "testing",
      description: "A test",
      systemPrompt: "Prompt",
      keywords: [],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("at least one keyword is required");
  });

  it("reports multiple errors at once", () => {
    const config: CustomAgentConfig = {
      name: "",
      domain: "",
      description: "",
      systemPrompt: "",
      keywords: [],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });
});
