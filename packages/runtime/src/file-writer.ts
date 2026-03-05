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
    // Resolve dataPath: select sub-field of data if specified
    const fileData = resolveDataPath(data, fileSpec.dataPath);

    // Skip conditional files when data is empty/missing
    if (fileSpec.conditional && isEmptyData(fileData)) {
      continue;
    }

    const resolvedPath = resolveFilePath(fileSpec.path, input);

    // Enforce scope write boundary
    if (scope) {
      if (!matchesScopePattern(resolvedPath, scope.write, input)) {
        throw new Error(`File path '${resolvedPath}' not in declared write scope`);
      }
    }

    // Determine content
    let content: string;
    if (fileSpec.source === "template" && fileSpec.content) {
      content = renderTemplate(fileSpec.content, data);
    } else {
      // LLM source: serialize data with format + options
      const options: SerializerOptions = {
        ...fileSpec.options,
        multiDocument: fileSpec.multiDocument,
      };
      content = serialize(fileData, fileSpec.format, options);
    }

    // Backup existing file if updating
    const exists = fs.existsSync(resolvedPath);
    if (exists && isUpdate) {
      backupFile(resolvedPath);
      filesModified.push(resolvedPath);
    } else {
      filesWritten.push(resolvedPath);
    }

    // Atomic write
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
export function detectExistingContent(detectionPaths: string[], basePath: string): string | null {
  for (const pattern of detectionPaths) {
    // Simple glob: check exact path or basic * matching
    if (pattern.includes("*")) {
      // Check directory for matching files
      const dir = path.dirname(path.join(basePath, pattern));
      const globPattern = path.basename(pattern);
      try {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (matchGlob(file, globPattern)) {
            const content = readExistingConfig(path.join(dir, file));
            if (content) return content;
          }
        }
      } catch {
        continue;
      }
    } else {
      const fullPath = path.join(basePath, pattern);
      const content = readExistingConfig(fullPath);
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
  const unresolved = /\{[^}]+\}/.exec(resolved);
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

  return template.replace(/\{\{\s*\.Values\.(\w+)\s*\}\}/g, (_match, key: string) => { // NOSONAR - capture group regex
    return obj[key] !== undefined ? String(obj[key]) : "";
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
  for (const pattern of scopePatterns) {
    // Expand {var} placeholders in the scope pattern
    let expanded = pattern;
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string") {
        expanded = expanded.replace(new RegExp(`\\{${key}\\}`, "g"), value); // NOSONAR - dynamic regex
      }
    }
    const normalizedExpanded = path.normalize(expanded).replaceAll("\\", "/");

    // Exact match
    if (normalizedResolved === normalizedExpanded) return true;

    // ** recursive directory match (e.g. "k8s/**")
    if (normalizedExpanded.endsWith("/**")) {
      const prefix = normalizedExpanded.slice(0, -3);
      if (normalizedResolved.startsWith(prefix + "/") || normalizedResolved === prefix) return true;
      continue;
    }

    // * wildcard within pattern (e.g. "Dockerfile.*", "*.tf")
    if (normalizedExpanded.includes("*")) {
      const regexStr =
        "^" + normalizedExpanded.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*") + "$"; // NOSONAR - escape-for-regex pattern
      if (new RegExp(regexStr).test(normalizedResolved)) return true;
    }
  }
  return false;
}
