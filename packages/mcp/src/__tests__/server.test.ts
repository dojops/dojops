import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDojOpsMcpServer } from "../server";
import { TOOL_DEFINITIONS } from "../server-tools";

// Mock fetch globally for API proxy tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDojOpsMcpServer", () => {
  it("creates a server instance", () => {
    const server = createDojOpsMcpServer();
    expect(server).toBeDefined();
  });
});

describe("TOOL_DEFINITIONS", () => {
  it("defines all expected tools", () => {
    const expectedTools = [
      "generate",
      "plan",
      "scan",
      "debug-ci",
      "diff-analyze",
      "chat",
      "list-agents",
      "list-skills",
      "repo-scan",
    ];

    for (const tool of expectedTools) {
      expect(TOOL_DEFINITIONS).toHaveProperty(tool);
    }
  });

  it("all tools have description and inputSchema", () => {
    for (const [name, def] of Object.entries(TOOL_DEFINITIONS)) {
      expect(def.description, `${name} missing description`).toBeTruthy();
      expect(def.inputSchema, `${name} missing inputSchema`).toBeDefined();
    }
  });

  it("generate tool has required prompt field", () => {
    const schema = TOOL_DEFINITIONS.generate.inputSchema;
    expect(schema.prompt).toBeDefined();
  });

  it("plan tool has required goal field", () => {
    const schema = TOOL_DEFINITIONS.plan.inputSchema;
    expect(schema.goal).toBeDefined();
  });

  it("debug-ci tool has required log field", () => {
    const schema = TOOL_DEFINITIONS["debug-ci"].inputSchema;
    expect(schema.log).toBeDefined();
  });

  it("chat tool has required message field", () => {
    const schema = TOOL_DEFINITIONS.chat.inputSchema;
    expect(schema.message).toBeDefined();
  });

  it("list-agents tool has empty inputSchema", () => {
    const schema = TOOL_DEFINITIONS["list-agents"].inputSchema;
    expect(Object.keys(schema)).toHaveLength(0);
  });
});
