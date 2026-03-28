import yaml from "js-yaml";
import { RepoContextSchemaV2 } from "../scanner/types";
import type { RepoContext } from "../scanner/types";

export interface DojopsMdParsed {
  /** Parsed RepoContext from YAML frontmatter, or null if parsing failed */
  context: RepoContext | null;
  /** The markdown body (everything after the closing ---) */
  body: string;
  /** The DOJOPS.md format version (from `dojops:` field) */
  formatVersion: number | null;
  /** Raw YAML frontmatter as object (preserves custom user keys) */
  rawFrontmatter: Record<string, unknown> | null;
}

/**
 * Parse a DOJOPS.md string into structured context + markdown body.
 *
 * YAML frontmatter fields are mapped to RepoContextSchemaV2:
 * - `dojops: 1` → format version (stripped before validation)
 * - `version: 2` and `rootPath` are injected automatically
 *
 * Returns null context gracefully if YAML is invalid or missing.
 */
export function parseDojopsMdString(content: string, rootPath?: string): DojopsMdParsed {
  if (!content.startsWith("---")) {
    return { context: null, body: content, formatVersion: null, rawFrontmatter: null };
  }

  // Find the closing --- fence (must be on its own line after the opening)
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { context: null, body: content, formatVersion: null, rawFrontmatter: null };
  }

  const yamlStr = content.slice(4, endIdx); // skip opening "---\n"
  const body = content.slice(endIdx + 4).replace(/^\n+/, ""); // skip closing "\n---"

  let raw: Record<string, unknown>;
  try {
    // SA-03: Limit YAML alias expansion to prevent billion-laughs DoS
    const parsed = yaml.load(yamlStr, { maxAliasCount: 100 } as yaml.LoadOptions);
    if (!parsed || typeof parsed !== "object") {
      return { context: null, body, formatVersion: null, rawFrontmatter: null };
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return { context: null, body, formatVersion: null, rawFrontmatter: null };
  }

  const formatVersion = typeof raw.dojops === "number" ? raw.dojops : null;

  // Build a RepoContext-compatible object: inject required fields, strip format version
  const contextData: Record<string, unknown> = {
    ...raw,
    version: 2,
    rootPath: rootPath ?? ".",
  };
  delete contextData.dojops;

  const result = RepoContextSchemaV2.safeParse(contextData);

  return {
    context: result.success ? (result.data as RepoContext) : null,
    body,
    formatVersion,
    rawFrontmatter: raw,
  };
}

/** Extract the content of the ## Notes section from a DOJOPS.md body. */
export function extractNotesSection(body: string): string {
  const match = /## Notes\s*\n([\s\S]*?)(?=\n## |\s*$)/.exec(body);
  return match ? match[1].trimEnd() : "";
}

/**
 * Extract user-added custom sections from the body.
 * Returns sections that are NOT managed by DojOps (i.e., not Overview,
 * Detected Stack, Suggested Workflows, Notes, or Recent Activity).
 */
export function extractCustomSections(body: string): string {
  const managed = [
    "# DojOps Project Context",
    "## Overview",
    "## Commands",
    "## Code Conventions",
    "## Architecture",
    "## DevOps & Infrastructure",
    "## Key Files",
    "## Detected Stack",
    "## Suggested Workflows",
    "## Notes",
    "## Recent Activity",
  ];
  // Split on headings, keep the heading with its content
  const sections = body.split(/(?=^#{1,2} )/m);
  const custom = sections.filter((s) => {
    const trimmed = s.trim();
    if (!trimmed) return false;
    return !managed.some((m) => trimmed.startsWith(m));
  });
  return custom.join("\n").trim();
}

/** Extract activity entries from between activity markers. */
export function extractActivityEntries(body: string): string[] {
  const match = /<!-- activity-start -->\n([\s\S]*?)\n?<!-- activity-end -->/.exec(body);
  if (!match) return [];
  return match[1].split("\n").filter((l) => l.startsWith("- "));
}
