import type { Response } from "express";

/**
 * Initialize SSE headers and return a writer.
 * Sends "event: {name}\ndata: {json}\n\n" for each chunk, ending with "data: [DONE]\n\n".
 */
export function initSSE(res: Response): {
  send(event: string, data: unknown): void;
  done(): void;
  error(message: string): void;
} {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // M-7: Heartbeat keeps the connection alive through proxies (every 15s)
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15_000);

  return {
    send(event: string, data: unknown) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    done() {
      clearInterval(heartbeat);
      res.write("data: [DONE]\n\n");
      res.end();
    },
    error(message: string) {
      clearInterval(heartbeat);
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    },
  };
}

/** Check if client requested streaming via Accept header or request body. */
export function wantsSSE(req: {
  headers: Record<string, string | string[] | undefined>;
  body?: { stream?: boolean };
}): boolean {
  if (req.body?.stream === true) return true;
  const accept = req.headers.accept;
  if (!accept) return false;
  const val = Array.isArray(accept) ? accept[0] : accept;
  return val?.includes("text/event-stream") ?? false;
}
