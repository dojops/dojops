import { describe, it, expect } from "vitest";
import {
  classifyPromptComplexity,
  resolveModelForPrompt,
  type ModelRoutingConfig,
} from "../agents/model-router";

describe("classifyPromptComplexity", () => {
  it("classifies short questions as simple", () => {
    const result = classifyPromptComplexity("What is Terraform?");

    expect(result.level).toBe("simple");
    expect(result.score).toBeLessThan(0.3);
    expect(result.reason).toContain("short prompt");
  });

  it("classifies 'explain' prompts as simple", () => {
    const result = classifyPromptComplexity("Explain how Docker works");

    expect(result.level).toBe("simple");
    expect(result.reason).toContain("simple keywords");
  });

  it("classifies 'help' prompts as simple", () => {
    const result = classifyPromptComplexity("Help me with nginx");

    expect(result.level).toBe("simple");
  });

  it("classifies long generation prompts as complex", () => {
    const longPrompt = [
      "Generate a comprehensive Terraform configuration for AWS",
      "that includes an S3 bucket with versioning, a CloudFront distribution,",
      "Route53 DNS records, ACM certificate, IAM policies for least privilege,",
      "and a DynamoDB table for state locking. First set up the provider block,",
      "then create the networking resources, next configure the storage layer,",
      "and finally set up the CDN with custom domain. Include modules for",
      "reusability and use workspaces for environment separation.",
      "The infrastructure should follow AWS Well-Architected Framework",
      "best practices for security, reliability, and cost optimization.",
      "Also include monitoring with CloudWatch alarms and SNS notifications.",
      "Reference @main.tf and @variables.tf for the existing setup.",
    ].join(" ");

    const result = classifyPromptComplexity(longPrompt);

    expect(result.level).toBe("complex");
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.reason).toContain("generation keywords");
  });

  it("classifies moderate prompts correctly", () => {
    const result = classifyPromptComplexity("Create a Dockerfile for a Node.js application");

    expect(result.level).toBe("moderate");
    expect(result.score).toBeGreaterThanOrEqual(0.3);
    expect(result.score).toBeLessThanOrEqual(0.7);
  });

  it("detects code indicators", () => {
    const result = classifyPromptComplexity(
      "Generate deployment config for my app using .yaml files and .tf modules",
    );

    expect(result.reason).toContain("code references");
  });

  it("detects multi-step instructions", () => {
    const result = classifyPromptComplexity(
      "First create the VPC, then set up the subnets, next configure the security groups, and finally deploy the application",
    );

    expect(result.reason).toContain("multi-step");
  });

  it("detects multiple file references", () => {
    const result = classifyPromptComplexity(
      "Review @main.tf @variables.tf @outputs.tf and suggest improvements",
    );

    expect(result.reason).toContain("file refs");
  });

  it("normalizes score to 0-1 range", () => {
    // Very simple prompt
    const simple = classifyPromptComplexity("What is it?");
    expect(simple.score).toBeGreaterThanOrEqual(0);
    expect(simple.score).toBeLessThanOrEqual(1);

    // Very complex prompt
    const complex = classifyPromptComplexity(
      "Generate and implement a full Kubernetes deployment with Helm charts, " +
        "first create the namespace, then deploy the app, next set up monitoring, " +
        "finally configure autoscaling. Reference @deployment.yaml @service.yaml @ingress.yaml " +
        "@values.yaml @chart.yaml for the existing setup. " +
        Array(80).fill("additional context word").join(" "),
    );
    expect(complex.score).toBeGreaterThanOrEqual(0);
    expect(complex.score).toBeLessThanOrEqual(1);
  });

  it("returns 'baseline' reason when no signals detected", () => {
    // A prompt that dodges all regex patterns: no question starters,
    // no simple/complex keywords, no code indicators, no multi-step,
    // and >= 20 words to avoid the "short prompt" signal
    const filler = Array(20).fill("word").join(" ");
    const result = classifyPromptComplexity(`status of the cluster ${filler} right now`);

    expect(result.reason).toBe("baseline");
  });
});

describe("resolveModelForPrompt", () => {
  it("returns override for matching rule", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [{ match: "simple", model: "gpt-4o-mini" }],
    };

    const result = resolveModelForPrompt("What is Terraform?", config);

    expect(result).not.toBeUndefined();
    expect(result!.model).toBe("gpt-4o-mini");
    expect(result!.reason).toContain("simple routing");
  });

  it("returns undefined when routing disabled", () => {
    const config: ModelRoutingConfig = {
      enabled: false,
      rules: [{ match: "simple", model: "gpt-4o-mini" }],
    };

    const result = resolveModelForPrompt("What is Terraform?", config);

    expect(result).toBeUndefined();
  });

  it("returns undefined when no rules defined", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [],
    };

    const result = resolveModelForPrompt("What is Terraform?", config);

    expect(result).toBeUndefined();
  });

  it("returns undefined when no rule matches", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [{ match: "complex", model: "gpt-4" }],
    };

    // Simple prompt won't match "complex" rule
    const result = resolveModelForPrompt("What is Docker?", config);

    expect(result).toBeUndefined();
  });

  it("first matching rule wins", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [
        { match: "simple", model: "gpt-4o-mini" },
        { match: "simple", model: "gpt-3.5-turbo" },
      ],
    };

    const result = resolveModelForPrompt("What is Terraform?", config);

    expect(result).not.toBeUndefined();
    expect(result!.model).toBe("gpt-4o-mini");
  });

  it("includes provider override when rule specifies it", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [{ match: "simple", model: "llama3", provider: "ollama" }],
    };

    const result = resolveModelForPrompt("What is Terraform?", config);

    expect(result).not.toBeUndefined();
    expect(result!.model).toBe("llama3");
    expect(result!.provider).toBe("ollama");
  });

  it("matches 'code' rule for code indicators", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [{ match: "code", model: "gpt-4" }],
    };

    const result = resolveModelForPrompt("Review this ```typescript code``` block", config);

    expect(result).not.toBeUndefined();
    expect(result!.model).toBe("gpt-4");
    expect(result!.reason).toContain("code routing");
  });

  it("matches 'review' rule for review keywords", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [{ match: "review", model: "claude-3-opus" }],
    };

    const result = resolveModelForPrompt("Review my Terraform config", config);

    expect(result).not.toBeUndefined();
    expect(result!.model).toBe("claude-3-opus");
    expect(result!.reason).toContain("review routing");
  });

  it("matches 'analysis' rule for analysis keywords", () => {
    const config: ModelRoutingConfig = {
      enabled: true,
      rules: [{ match: "analysis", model: "gpt-4-turbo" }],
    };

    const result = resolveModelForPrompt("Analyze my infrastructure costs", config);

    expect(result).not.toBeUndefined();
    expect(result!.model).toBe("gpt-4-turbo");
    expect(result!.reason).toContain("analysis routing");
  });
});
