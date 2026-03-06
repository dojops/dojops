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
 */
/** Try to find existing content via a glob pattern in a directory. */
function detectGlobContent(dir: string, globPattern: string): string | null {
  try {
    if (!fs.existsSync(dir)) return null;
    for (const file of fs.readdirSync(dir)) {
      if (!matchGlob(file, globPattern)) continue;
      const content = readExistingConfig(path.join(dir, file));
      if (content) return content;
    }
  } catch {
    // Unreadable directory
  }
  return null;
}

export function detectExistingContent(detectionPaths: string[], basePath: string): string | null {
  for (const pattern of detectionPaths) {
    if (pattern.includes("*")) {
      const result = detectGlobContent(
        path.dirname(path.join(basePath, pattern)),
        path.basename(pattern),
      );
      if (result) return result;
    } else {
      const content = readExistingConfig(path.join(basePath, pattern));
      if (content) return content;
    }
  }
  return null;
}

/**
 * Resolve template variables in file path: `{varName}` → value
 */
export function resolveFilePath(templatePath: string, input: Record<string, unknown>): string {
  let resolved = templatePath;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      resolved = resolved.replace(new RegExp(`\\{${key}\\}`, "g"), value); // NOSONAR - dynamic regex
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
    return val == null ? "" : String(val);
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
      expanded = expanded.replace(new RegExp(`\\{${key}\\}`, "g"), value); // NOSONAR - dynamic regex
    }
  }
  return path.normalize(expanded).replaceAll("\\", "/");
}

/** Test if a normalized path matches a single expanded scope pattern. */
function matchesSinglePattern(normalizedResolved: string, normalizedExpanded: string): boolean {
  if (normalizedResolved === normalizedExpanded) return true;

  if (normalizedExpanded.endsWith("/**")) {
    const prefix = normalizedExpanded.slice(0, -3);
    return normalizedResolved.startsWith(prefix + "/") || normalizedResolved === prefix;
  }

  if (normalizedExpanded.includes("*")) {
    const regexStr =
      "^" +
      normalizedExpanded.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`).replaceAll("*", "[^/]*") +
      "$"; // NOSONAR - escape-for-regex pattern
    return new RegExp(regexStr).test(normalizedResolved);
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
