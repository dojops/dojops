import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverCustomAgents } from "../agent-loader";

const VALID_README = `# Test Agent

## Domain
testing

## Description
A test agent for unit tests.

## System Prompt
You are a test agent.

## Keywords
test, unit, integration
`;

const INVALID_README = `# Broken Agent

Just some random text without proper sections.
`;

describe("discoverCustomAgents", () => {
  let tmpDir: string;
  let projectDir: string;
  let globalDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-loader-test-"));
    projectDir = path.join(tmpDir, "project");
    globalDir = path.join(tmpDir, "global-home");

    fs.mkdirSync(path.join(projectDir, ".dojops", "agents"), { recursive: true });
    fs.mkdirSync(path.join(globalDir, ".dojops", "agents"), { recursive: true });

    originalHome = process.env.HOME;
    process.env.HOME = globalDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when no agents exist", () => {
    const agents = discoverCustomAgents(projectDir);
    expect(agents).toHaveLength(0);
  });

  it("discovers project agents", () => {
    const agentDir = path.join(projectDir, ".dojops", "agents", "my-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "README.md"), VALID_README);

    const agents = discoverCustomAgents(projectDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].config.name).toBe("my-agent");
    expect(agents[0].location).toBe("project");
  });

  it("discovers global agents", () => {
    const agentDir = path.join(globalDir, ".dojops", "agents", "global-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "README.md"), VALID_README);

    const agents = discoverCustomAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].config.name).toBe("global-agent");
    expect(agents[0].location).toBe("global");
  });

  it("project overrides global by name", () => {
    // Create global agent
    const globalAgentDir = path.join(globalDir, ".dojops", "agents", "shared-agent");
    fs.mkdirSync(globalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(globalAgentDir, "README.md"), VALID_README);

    // Create project agent with same directory name
    const projectAgentDir = path.join(projectDir, ".dojops", "agents", "shared-agent");
    fs.mkdirSync(projectAgentDir, { recursive: true });
    const projectReadme = VALID_README.replace("testing", "project-specific-domain");
    fs.writeFileSync(path.join(projectAgentDir, "README.md"), projectReadme);

    const agents = discoverCustomAgents(projectDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].location).toBe("project");
    expect(agents[0].config.domain).toBe("project-specific-domain");
  });

  it("skips directories without README.md", () => {
    const agentDir = path.join(projectDir, ".dojops", "agents", "no-readme");
    fs.mkdirSync(agentDir, { recursive: true });
    // No README.md written

    const agents = discoverCustomAgents(projectDir);
    expect(agents).toHaveLength(0);
  });

  it("skips unparseable README.md files", () => {
    const agentDir = path.join(projectDir, ".dojops", "agents", "broken-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "README.md"), INVALID_README);

    const agents = discoverCustomAgents(projectDir);
    expect(agents).toHaveLength(0);
  });

  it("handles mixed dirs (some valid, some invalid)", () => {
    // Valid agent
    const validDir = path.join(projectDir, ".dojops", "agents", "valid-agent");
    fs.mkdirSync(validDir, { recursive: true });
    fs.writeFileSync(path.join(validDir, "README.md"), VALID_README);

    // Invalid agent
    const invalidDir = path.join(projectDir, ".dojops", "agents", "invalid-agent");
    fs.mkdirSync(invalidDir, { recursive: true });
    fs.writeFileSync(path.join(invalidDir, "README.md"), INVALID_README);

    // Dir without README
    const emptyDir = path.join(projectDir, ".dojops", "agents", "empty-agent");
    fs.mkdirSync(emptyDir, { recursive: true });

    const agents = discoverCustomAgents(projectDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].config.name).toBe("valid-agent");
  });

  it("discovers both global and project agents", () => {
    const globalAgentDir = path.join(globalDir, ".dojops", "agents", "global-only");
    fs.mkdirSync(globalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(globalAgentDir, "README.md"), VALID_README);

    const projectAgentDir = path.join(projectDir, ".dojops", "agents", "project-only");
    fs.mkdirSync(projectAgentDir, { recursive: true });
    fs.writeFileSync(path.join(projectAgentDir, "README.md"), VALID_README);

    const agents = discoverCustomAgents(projectDir);
    expect(agents).toHaveLength(2);
    const names = agents.map((a) => a.config.name);
    expect(names).toContain("global-only");
    expect(names).toContain("project-only");
  });

  it("returns agentDir path in entries", () => {
    const agentDir = path.join(projectDir, ".dojops", "agents", "path-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "README.md"), VALID_README);

    const agents = discoverCustomAgents(projectDir);
    expect(agents[0].agentDir).toBe(agentDir);
  });
});
