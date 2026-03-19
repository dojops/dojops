import { describe, it, expect } from "vitest";

// Fresh import per test — the registry is module-level state, so we
// re-import via dynamic import after resetting the module registry.
// However the simpler approach: test the public API directly.

import { resolveCommand, registerCommand, registerSubcommand } from "../commands/index";

describe("command registry", () => {
  // Note: these tests operate on the shared registry. They register
  // test-only commands that don't collide with real ones.

  describe("registerSubcommand preserves parent handler", () => {
    it("falls back to parent handler for unregistered subcommands", async () => {
      const parentCalls: string[][] = [];
      const subCalls: string[][] = [];

      registerCommand("test-parent", async (args) => {
        parentCalls.push(args);
      });
      registerSubcommand("test-parent", "special", async (args) => {
        subCalls.push(args);
      });

      // Explicit subcommand routes to sub handler
      const specialRes = resolveCommand(["test-parent", "special"], ["extra"]);
      expect(specialRes).not.toBeNull();
      await specialRes!.handler(specialRes!.remaining, {} as never);
      expect(subCalls).toHaveLength(1);
      expect(subCalls[0]).toEqual(["extra"]);

      // Unknown subcommand falls back to parent handler with sub as arg
      const listRes = resolveCommand(["test-parent", "list"], ["rest"]);
      expect(listRes).not.toBeNull();
      await listRes!.handler(listRes!.remaining, {} as never);
      expect(parentCalls).toHaveLength(1);
      expect(parentCalls[0]).toEqual(["list", "rest"]);
    });

    it("parent with no args falls back to default handler", async () => {
      const calls: string[][] = [];
      registerCommand("test-noarg", async (args) => {
        calls.push(args);
      });
      registerSubcommand("test-noarg", "sub1", async () => {});

      // No subcommand at all — should fall back to parent
      const res = resolveCommand(["test-noarg"], []);
      expect(res).not.toBeNull();
      await res!.handler(res!.remaining, {} as never);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([]);
    });
  });
});
