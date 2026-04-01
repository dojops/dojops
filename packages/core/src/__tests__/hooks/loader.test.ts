import { describe, it, expect, vi, afterEach } from "vitest";
import { loadHookConfig } from "../../hooks/loader";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from "node:fs";

const mockExists = vi.mocked(existsSync);
const mockRead = vi.mocked(readFileSync);

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadHookConfig", () => {
  it("returns empty config when file does not exist", () => {
    mockExists.mockReturnValue(false);
    const config = loadHookConfig("/project");
    expect(config.hooks).toEqual([]);
  });

  it("loads valid config", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [
          {
            id: "notify",
            events: ["SessionStart"],
            type: "command",
            command: "echo hello",
          },
        ],
      }),
    );

    const config = loadHookConfig("/project");
    expect(config.hooks).toHaveLength(1);
    expect(config.hooks[0].id).toBe("notify");
    expect(config.hooks[0].events).toEqual(["SessionStart"]);
    expect(config.hooks[0].type).toBe("command");
    expect(config.hooks[0].command).toBe("echo hello");
  });

  it("loads http hooks", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [
          {
            id: "webhook",
            events: ["PostExecute", "ScanComplete"],
            type: "http",
            url: "https://example.com/hook",
            timeoutMs: 5000,
            nonBlocking: false,
          },
        ],
      }),
    );

    const config = loadHookConfig("/project");
    expect(config.hooks[0].url).toBe("https://example.com/hook");
    expect(config.hooks[0].timeoutMs).toBe(5000);
    expect(config.hooks[0].nonBlocking).toBe(false);
  });

  it("throws on invalid JSON", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue("not json{{{");

    expect(() => loadHookConfig("/project")).toThrow("Invalid JSON");
  });

  it("throws when hooks is not an array", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(JSON.stringify({ hooks: "nope" }));

    expect(() => loadHookConfig("/project")).toThrow("'hooks' must be an array");
  });

  it("throws on missing id", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({ hooks: [{ events: ["SessionStart"], type: "command", command: "echo" }] }),
    );

    expect(() => loadHookConfig("/project")).toThrow("'id' is required");
  });

  it("throws on duplicate id", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [
          { id: "x", events: ["SessionStart"], type: "command", command: "echo" },
          { id: "x", events: ["SessionEnd"], type: "command", command: "echo" },
        ],
      }),
    );

    expect(() => loadHookConfig("/project")).toThrow("duplicate hook id");
  });

  it("throws on empty events", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({ hooks: [{ id: "x", events: [], type: "command", command: "echo" }] }),
    );

    expect(() => loadHookConfig("/project")).toThrow("non-empty array");
  });

  it("throws on unknown event", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [{ id: "x", events: ["BogusEvent"], type: "command", command: "echo" }],
      }),
    );

    expect(() => loadHookConfig("/project")).toThrow("unknown event 'BogusEvent'");
  });

  it("throws on invalid type", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [{ id: "x", events: ["SessionStart"], type: "agent", command: "echo" }],
      }),
    );

    expect(() => loadHookConfig("/project")).toThrow("'type' must be 'command' or 'http'");
  });

  it("throws when command hook lacks command field", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [{ id: "x", events: ["SessionStart"], type: "command" }],
      }),
    );

    expect(() => loadHookConfig("/project")).toThrow("'command' is required");
  });

  it("throws when http hook lacks url field", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [{ id: "x", events: ["SessionStart"], type: "http" }],
      }),
    );

    expect(() => loadHookConfig("/project")).toThrow("'url' is required");
  });

  it("handles optional fields", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      JSON.stringify({
        hooks: [
          {
            id: "full",
            name: "Full hook",
            events: ["SessionStart"],
            type: "command",
            command: "echo ok",
            timeoutMs: 3000,
            nonBlocking: true,
            disabled: false,
            cwd: "/tmp",
          },
        ],
      }),
    );

    const config = loadHookConfig("/project");
    const h = config.hooks[0];
    expect(h.name).toBe("Full hook");
    expect(h.timeoutMs).toBe(3000);
    expect(h.nonBlocking).toBe(true);
    expect(h.disabled).toBe(false);
    expect(h.cwd).toBe("/tmp");
  });
});
