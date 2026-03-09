import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFileSync, backupFile, readExistingConfig } from "@dojops/sdk";
import { DopsScope, FileSpec } from "./spec";
import { serialize, SerializerOptions } from "./serializer";

export interface WriteResult {
  filesWritten: string[];
  filesModified: string[];
}

/**
 * Write generated output to files according to file specs.
 * Handles serialization, backup, templates, and atomic writes.
 * When `scope` is provided, enforces write boundary — only files matching
 * a declared scope.write pattern (after variable expansion) are allowed.
 */
/** Resolve the content string for a single file spec. */
function resolveFileContent(fileSpec: FileSpec, data: unknown, fileData: unknown): string {
  if (fileSpec.source === "template" && fileSpec.content) {
    return renderTemplate(fileSpec.content, data);
  }
  const options: SerializerOptions = {
    ...fileSpec.options,
    multiDocument: fileSpec.multiDocument,
  };
  return serialize(fileData, fileSpec.format, options);
}

export function writeFiles(
  data: unknown,
  fileSpecs: FileSpec[],
  input: Record<string, unknown>,
  isUpdate: boolean,
  scope?: DopsScope,
): WriteResult {
  const filesWritten: string[] = [];
  const filesModified: string[] = [];

  for (const fileSpec of fileSpecs) {
    const fileData = resolveDataPath(data, fileSpec.dataPath);
    if (fileSpec.conditional && isEmptyData(fileData)) continue;

    const resolvedPath = resolveFilePath(fileSpec.path, input);

    if (scope && !matchesScopePattern(resolvedPath, scope.write, input)) {
      throw new Error(`File path '${resolvedPath}' not in declared write scope`);
    }

    const content = resolveFileContent(fileSpec, data, fileData);
    const exists = fs.existsSync(resolvedPath);

    if (exists && isUpdate) {
      backupFile(resolvedPath);
      filesModified.push(resolvedPath);
    } else {
      filesWritten.push(resolvedPath);
    }

    atomicWriteFileSync(resolvedPath, content);
  }

  return { filesWritten, filesModified };
}

/**
 * Serialize data for a single file spec (without writing to disk).
 * Used by verify() to get the serialized content for binary verification.
 */
export function serializeForFile(data: unknown, fileSpec: FileSpec): string {
  // Resolve dataPath: select sub-field of data if specified
  const fileData = resolveDataPath(data, fileSpec.dataPath);

  if (fileSpec.source === "template" && fileSpec.content) {
    return renderTemplate(fileSpec.content, data);
  }
  const options: SerializerOptions = {
    ...fileSpec.options,
    multiDocument: fileSpec.multiDocument,
  };
  return serialize(fileData, fileSpec.format, options);
}

/**
 * Detect existing content from detection paths.
 * Returns ALL matching files concatenated with path headers so the LLM
 * sees the full project context (e.g. all workflows + composite actions).
 *
 * Supports globs in both directory and filename segments:
 *   ".github/workflows/{star}.yml"       — glob in filename
 *   ".github/actions/{star}/action.yml"  — glob in directory segment
 */

/** Walk a glob pattern split into path segments, collecting matching files. */
function walkGlobSegments(
  segments: string[],
  index: number,
  currentDir: string,
  basePath: string,
): { relPath: string; content: string }[] {
  if (index >= segments.length) return [];

  const segment = segments[index];
  const isLast = index === segments.length - 1;

  if (!segment.includes("*")) {
    // Literal segment — descend or read
    const next = path.join(currentDir, segment);
    if (isLast) {
      const content = readExistingConfig(next);
      if (content) return [{ relPath: path.relative(basePath, next), content }];
      return [];
    }
    return walkGlobSegments(segments, index + 1, next, basePath);
  }

  // Glob segment — enumerate entries in currentDir
  const results: { relPath: string; content: string }[] = [];
  try {
    if (!fs.existsSync(currentDir)) return results;
    for (const entry of fs.readdirSync(currentDir)) {
      if (!matchGlob(entry, segment)) continue;
      const entryPath = path.join(currentDir, entry);
      if (isLast) {
        // File glob — read the file
        const content = readExistingConfig(entryPath);
        if (content) {
          results.push({ relPath: path.relative(basePath, entryPath), content });
        }
      } else {
        // Directory glob — recurse into matching subdirectory
        try {
          const stat = fs.statSync(entryPath);
          if (stat.isDirectory()) {
            results.push(...walkGlobSegments(segments, index + 1, entryPath, basePath));
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    }
  } catch {
    // Unreadable directory
  }
  return results;
}

export function detectExistingContent(detectionPaths: string[], basePath: string): string | null {
  const allMatches: { relPath: string; content: string }[] = [];

  for (const pattern of detectionPaths) {
    if (pattern.includes("*")) {
      const segments = pattern.split("/");
      allMatches.push(...walkGlobSegments(segments, 0, basePath, basePath));
    } else {
      const fullPath = path.join(basePath, pattern);
      const content = readExistingConfig(fullPath);
      if (content) {
        allMatches.push({ relPath: pattern, content });
      }
    }
  }

  if (allMatches.length === 0) return null;
  // Single file: return content directly for backward compatibility
  if (allMatches.length === 1) return allMatches[0].content;
  // Multiple files: concatenate with path headers so the LLM sees all existing configs
  return allMatches.map((m) => `--- ${m.relPath} ---\n${m.content}`).join("\n\n");
}

/**
 * Resolve template variables in file path: `{varName}` → value
 */
export function resolveFilePath(templatePath: string, input: Record<string, unknown>): string {
  let resolved = templatePath;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      resolved = resolved.replaceAll(`{${key}}`, value);
    }
  }

  // Check for unresolved variables
  const unresolved = /\{[^}]+\}/.exec(resolved); // NOSONAR
  if (unresolved) {
    throw new Error(`Unresolved variable in file path: ${unresolved[0]}`);
  }

  // Path traversal check
  const segments = resolved.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(`Path traversal detected in file path: ${resolved}`);
  }

  // Reject absolute paths that were hardcoded in the template (not from variable expansion).
  // Absolute paths produced by expanding {var} placeholders are allowed because
  // tools legitimately receive absolute outputPath values at runtime.
  if (path.isAbsolute(resolved) && path.isAbsolute(templatePath)) {
    throw new Error(`Template contains an absolute path: ${resolved}`);
  }

  return resolved;
}

/**
 * Simple template rendering: replaces `{{ .Values.key }}` with data values.
 */
function renderTemplate(template: string, data: unknown): string {
  if (typeof data !== "object" || data === null) return template;
  const obj = data as Record<string, unknown>;

  return template.replaceAll(/\{\{\s*\.Values\.(\w+)\s*\}\}/g, (_match, key: string) => {
    // NOSONAR - capture group regex
    const val = obj[key];
    return val == null ? "" : String(val); // NOSONAR — explicit String() conversion
  });
}

/**
 * Resolve a dot-notation dataPath from a data object.
 * E.g., "values" → data.values, "config.nested" → data.config.nested
 */
function resolveDataPath(data: unknown, dataPath?: string): unknown {
  if (!dataPath) return data;
  if (typeof data !== "object" || data === null) return undefined;

  const parts = dataPath.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Check if data is empty (null, undefined, empty string, empty array).
 */
function isEmptyData(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data === "string" && data.trim() === "") return true;
  if (Array.isArray(data) && data.length === 0) return true;
  return false;
}

/**
 * Simple glob matching for single * patterns.
 */
function matchGlob(filename: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1);
    return filename.endsWith(ext);
  }
  return filename === pattern;
}

/** Expand {var} placeholders in a scope pattern and normalize to forward slashes. */
function expandScopePattern(pattern: string, input: Record<string, unknown>): string {
  let expanded = pattern;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      expanded = expanded.replaceAll(`{${key}}`, value);
    }
  }
  return path.normalize(expanded).replaceAll("\\", "/");
}

/** Match a path against a glob pattern with `*` wildcards (no regex). */
function matchGlobPattern(filePath: string, pattern: string): boolean {
  const parts = pattern.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (i === 0) {
      if (!filePath.startsWith(segment)) return false;
      pos = segment.length;
    } else if (i === parts.length - 1) {
      if (!filePath.endsWith(segment)) return false;
      if (filePath.length - segment.length < pos) return false;
    } else {
      const idx = filePath.indexOf(segment, pos);
      if (idx === -1) return false;
      // Wildcards should not cross directory boundaries
      if (filePath.slice(pos, idx).includes("/")) return false;
      pos = idx + segment.length;
    }
  }
  return true;
}

/** Test if a normalized path matches a single expanded scope pattern. */
function matchesSinglePattern(normalizedResolved: string, normalizedExpanded: string): boolean {
  if (normalizedResolved === normalizedExpanded) return true;

  if (normalizedExpanded.endsWith("/**")) {
    const prefix = normalizedExpanded.slice(0, -3);
    return normalizedResolved.startsWith(prefix + "/") || normalizedResolved === prefix;
  }

  if (normalizedExpanded.includes("*")) {
    return matchGlobPattern(normalizedResolved, normalizedExpanded);
  }

  return false;
}

/**
 * Check if a resolved file path matches at least one scope.write pattern.
 * Scope patterns use the same `{var}` syntax as file paths — variables
 * are expanded before matching. Supports `*` (single segment) and `**`
 * (recursive directory) globs in addition to exact matches.
 */
export function matchesScopePattern(
  resolvedPath: string,
  scopePatterns: string[],
  input: Record<string, unknown>,
): boolean {
  const normalizedResolved = path.normalize(resolvedPath).replaceAll("\\", "/");
  return scopePatterns.some((pattern) =>
    matchesSinglePattern(normalizedResolved, expandScopePattern(pattern, input)),
  );
}
