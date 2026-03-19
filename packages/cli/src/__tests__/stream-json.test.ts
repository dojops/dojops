import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitStreamEvent, StreamEvent } from "../stream-json";

describe("emitStreamEvent", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("writes JSON + newline to stdout", () => {
    const event: StreamEvent = { type: "chunk", content: "hello" };
    emitStreamEvent(event);

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/\n$/);
  });

  it("emits valid JSON for init event", () => {
    const event: StreamEvent = {
      type: "init",
      provider: "openai",
      model: "gpt-4",
      timestamp: "2026-01-01T00:00:00Z",
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("init");
    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toBe("gpt-4");
    expect(parsed.timestamp).toBe("2026-01-01T00:00:00Z");
  });

  it("emits valid JSON for chunk event", () => {
    const event: StreamEvent = { type: "chunk", content: "terraform {" };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("chunk");
    expect(parsed.content).toBe("terraform {");
  });

  it("emits valid JSON for tool_use event", () => {
    const event: StreamEvent = {
      type: "tool_use",
      name: "file_write",
      arguments: { path: "main.tf", content: "resource {}" },
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("tool_use");
    expect(parsed.name).toBe("file_write");
    expect(parsed.arguments.path).toBe("main.tf");
  });

  it("emits valid JSON for tool_result event", () => {
    const event: StreamEvent = {
      type: "tool_result",
      name: "file_write",
      output: "File written successfully",
      isError: false,
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("tool_result");
    expect(parsed.name).toBe("file_write");
    expect(parsed.isError).toBe(false);
  });

  it("emits valid JSON for tool_result with error", () => {
    const event: StreamEvent = {
      type: "tool_result",
      name: "exec",
      output: "Permission denied",
      isError: true,
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("tool_result");
    expect(parsed.isError).toBe(true);
  });

  it("emits valid JSON for result event", () => {
    const event: StreamEvent = {
      type: "result",
      content: "Generated Terraform config",
      stats: { tokens: 500, duration: 1200 },
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("result");
    expect(parsed.content).toBe("Generated Terraform config");
    expect(parsed.stats).toEqual({ tokens: 500, duration: 1200 });
  });

  it("emits valid JSON for result event without stats", () => {
    const event: StreamEvent = {
      type: "result",
      content: "Done",
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("result");
    expect(parsed.stats).toBeUndefined();
  });

  it("emits valid JSON for error event", () => {
    const event: StreamEvent = { type: "error", message: "API key missing" };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("error");
    expect(parsed.message).toBe("API key missing");
  });

  it("handles special characters in content", () => {
    const event: StreamEvent = {
      type: "chunk",
      content: 'line1\nline2\ttab\r\n"quoted"',
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.content).toBe('line1\nline2\ttab\r\n"quoted"');
  });

  it("each event is a single line (no embedded newlines in JSON)", () => {
    const event: StreamEvent = {
      type: "result",
      content: "multi\nline\ncontent",
    };
    emitStreamEvent(event);

    const output = writeSpy.mock.calls[0][0] as string;
    // The output should be exactly one JSON line + trailing newline
    const lines = output.split("\n");
    expect(lines).toHaveLength(2); // JSON line + empty after trailing newline
    expect(lines[1]).toBe("");
  });
});
