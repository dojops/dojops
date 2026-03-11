import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@dojops/module-registry", () => ({
  createToolRegistry: vi.fn(),
  discoverUserDopsFiles: vi.fn().mockReturnValue([]),
}));

import { outputFormatted } from "../../commands/generate";

describe("outputFormatted", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("parses JSON content and embeds as object in json mode", () => {
    const jsonContent = JSON.stringify({ success: true, data: { generated: "hello" } });
    outputFormatted("json", "module", "makefile", jsonContent);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.module).toBe("makefile");
    expect(output.content).toEqual({ success: true, data: { generated: "hello" } });
    expect(typeof output.content).toBe("object");
  });

  it("keeps plain text content as string in json mode", () => {
    outputFormatted("json", "module", "makefile", "# Makefile\nall: build");

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.module).toBe("makefile");
    expect(output.content).toBe("# Makefile\nall: build");
    expect(typeof output.content).toBe("string");
  });

  it("handles invalid JSON gracefully (falls back to string)", () => {
    outputFormatted("json", "agent", "ops-cortex", "{broken json");

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.agent).toBe("ops-cortex");
    expect(output.content).toBe("{broken json");
  });

  it("outputs YAML format correctly", () => {
    outputFormatted("yaml", "module", "nginx", "server {\n  listen 80;\n}");

    // 3 header lines + 3 content lines (one per line of content)
    expect(consoleSpy).toHaveBeenCalledTimes(6);
    expect(consoleSpy.mock.calls[0][0]).toBe("---");
    expect(consoleSpy.mock.calls[1][0]).toBe("module: nginx");
    expect(consoleSpy.mock.calls[2][0]).toBe("content: |");
    expect(consoleSpy.mock.calls[3][0]).toBe("  server {");
    expect(consoleSpy.mock.calls[4][0]).toBe("    listen 80;");
    expect(consoleSpy.mock.calls[5][0]).toBe("  }");
  });
});
