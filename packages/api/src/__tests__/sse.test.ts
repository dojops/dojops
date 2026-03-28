import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initSSE, wantsSSE } from "../sse";

function createMockResponse() {
  const chunks: string[] = [];
  let ended = false;
  let headStatus: number | undefined;
  let headHeaders: Record<string, string> | undefined;

  return {
    res: {
      writeHead(status: number, headers: Record<string, string>) {
        headStatus = status;
        headHeaders = headers;
      },
      write(data: string) {
        chunks.push(data);
      },
      end() {
        ended = true;
      },
    } as never,
    get chunks() {
      return chunks;
    },
    get ended() {
      return ended;
    },
    get headStatus() {
      return headStatus;
    },
    get headHeaders() {
      return headHeaders;
    },
  };
}

describe("initSSE", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets correct SSE headers", () => {
    const mock = createMockResponse();
    const sse = initSSE(mock.res);

    expect(mock.headStatus).toBe(200);
    expect(mock.headHeaders).toEqual({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    sse.done(); // clean up heartbeat interval
  });

  it("send() writes event and data lines", () => {
    const mock = createMockResponse();
    const sse = initSSE(mock.res);

    sse.send("chunk", { content: "hello" });

    expect(mock.chunks).toHaveLength(1);
    expect(mock.chunks[0]).toBe('event: chunk\ndata: {"content":"hello"}\n\n');

    sse.done(); // clean up heartbeat interval
  });

  it("done() writes [DONE] sentinel and ends response", () => {
    const mock = createMockResponse();
    const sse = initSSE(mock.res);

    sse.done();

    expect(mock.chunks).toContain("data: [DONE]\n\n");
    expect(mock.ended).toBe(true);
  });

  it("error() writes error event and ends response", () => {
    const mock = createMockResponse();
    const sse = initSSE(mock.res);

    sse.error("something broke");

    expect(mock.chunks).toHaveLength(1);
    expect(mock.chunks[0]).toBe('event: error\ndata: {"error":"something broke"}\n\n');
    expect(mock.ended).toBe(true);
  });

  it("send() serializes nested objects", () => {
    const mock = createMockResponse();
    const sse = initSSE(mock.res);

    sse.send("agent", { name: "k8s", domain: "kubernetes", confidence: 0.95 });

    expect(mock.chunks[0]).toBe(
      'event: agent\ndata: {"name":"k8s","domain":"kubernetes","confidence":0.95}\n\n',
    );

    sse.done(); // clean up heartbeat interval
  });

  it("supports multiple send() calls in sequence", () => {
    const mock = createMockResponse();
    const sse = initSSE(mock.res);

    sse.send("chunk", { content: "a" });
    sse.send("chunk", { content: "b" });
    sse.send("chunk", { content: "c" });
    sse.done();

    expect(mock.chunks).toHaveLength(4);
    expect(mock.ended).toBe(true);
  });

  it("sends heartbeat comments every 15 seconds", () => {
    const mock = createMockResponse();
    const sse = initSSE(mock.res);

    // No heartbeat yet
    expect(mock.chunks).toHaveLength(0);

    // Advance 15 seconds
    vi.advanceTimersByTime(15_000);
    expect(mock.chunks).toHaveLength(1);
    expect(mock.chunks[0]).toBe(": heartbeat\n\n");

    // Advance another 15 seconds
    vi.advanceTimersByTime(15_000);
    expect(mock.chunks).toHaveLength(2);
    expect(mock.chunks[1]).toBe(": heartbeat\n\n");

    sse.done(); // clean up heartbeat interval

    // No more heartbeats after done()
    vi.advanceTimersByTime(15_000);
    // done() added [DONE] chunk, so total is 3 (2 heartbeats + 1 done)
    expect(mock.chunks).toHaveLength(3);
  });
});

describe("wantsSSE", () => {
  it("returns true for text/event-stream Accept header", () => {
    expect(wantsSSE({ headers: { accept: "text/event-stream" } })).toBe(true);
  });

  it("returns true when Accept contains text/event-stream among others", () => {
    expect(wantsSSE({ headers: { accept: "text/event-stream, application/json" } })).toBe(true);
  });

  it("returns false for regular Accept header", () => {
    expect(wantsSSE({ headers: { accept: "application/json" } })).toBe(false);
  });

  it("returns false when no Accept header is present", () => {
    expect(wantsSSE({ headers: {} })).toBe(false);
  });

  it("returns false for undefined Accept header", () => {
    expect(wantsSSE({ headers: { accept: undefined } })).toBe(false);
  });

  it("handles Accept as string array", () => {
    expect(wantsSSE({ headers: { accept: ["text/event-stream"] } })).toBe(true);
  });

  it("returns true when body.stream is true", () => {
    expect(wantsSSE({ headers: {}, body: { stream: true } })).toBe(true);
  });

  it("returns false when body.stream is false", () => {
    expect(wantsSSE({ headers: {}, body: { stream: false } })).toBe(false);
  });

  it("prefers body.stream over Accept header", () => {
    expect(wantsSSE({ headers: { accept: "application/json" }, body: { stream: true } })).toBe(
      true,
    );
  });
});
