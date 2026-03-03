import { describe, it, expect } from "vitest";
import { resolveLibraryQuery, TOOL_LIBRARY_MAP, AGENT_LIBRARY_MAP } from "../library-map";

describe("library-map", () => {
  describe("TOOL_LIBRARY_MAP", () => {
    it("contains all 12 built-in tool domains", () => {
      expect(Object.keys(TOOL_LIBRARY_MAP)).toHaveLength(12);
      expect(TOOL_LIBRARY_MAP["github-actions"]).toBe("github actions");
      expect(TOOL_LIBRARY_MAP["terraform"]).toBe("terraform");
      expect(TOOL_LIBRARY_MAP["kubernetes"]).toBe("kubernetes");
      expect(TOOL_LIBRARY_MAP["dockerfile"]).toBe("docker");
    });
  });

  describe("AGENT_LIBRARY_MAP", () => {
    it("maps agent domains to library queries", () => {
      expect(AGENT_LIBRARY_MAP["ci"]).toBe("github actions");
      expect(AGENT_LIBRARY_MAP["docker"]).toBe("docker");
      expect(AGENT_LIBRARY_MAP["monitoring"]).toBe("prometheus");
    });
  });

  describe("resolveLibraryQuery", () => {
    it("resolves tool domain keywords", () => {
      expect(resolveLibraryQuery("github-actions")).toBe("github actions");
      expect(resolveLibraryQuery("terraform")).toBe("terraform");
    });

    it("resolves agent domain keywords", () => {
      expect(resolveLibraryQuery("ci")).toBe("github actions");
      expect(resolveLibraryQuery("monitoring")).toBe("prometheus");
    });

    it("is case-insensitive", () => {
      expect(resolveLibraryQuery("Terraform")).toBe("terraform");
      expect(resolveLibraryQuery("KUBERNETES")).toBe("kubernetes");
    });

    it("returns the keyword itself for unknown domains", () => {
      expect(resolveLibraryQuery("react")).toBe("react");
      expect(resolveLibraryQuery("unknown-tool")).toBe("unknown-tool");
    });

    it("prefers tool map over agent map", () => {
      // "terraform" exists in both maps
      expect(resolveLibraryQuery("terraform")).toBe("terraform");
    });
  });
});
