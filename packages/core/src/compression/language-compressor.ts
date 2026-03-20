/**
 * Language-aware context compression.
 *
 * Strips function/method bodies while preserving imports, type declarations,
 * and signatures. Achieves ~70% token reduction on source files sent to LLM
 * during `dojops check` and `dojops init`.
 *
 * Supported languages: TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin.
 * Config files (JSON, YAML, TOML, Markdown) pass through unchanged.
 */

// ── Language detection ─────────────────────────────────────────────

type Language = "typescript" | "python" | "go" | "rust" | "java" | "config" | "unknown";

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "java",
  ".scala": "java",
  ".groovy": "java",
};

const CONFIG_EXTS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".md",
  ".mdx",
  ".ini",
  ".cfg",
  ".env",
  ".lock",
  ".csv",
]);

function detectLanguage(filePath: string): Language {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (CONFIG_EXTS.has(ext)) return "config";
  return EXT_MAP[ext] ?? "unknown";
}

// ── Compression result ─────────────────────────────────────────────

export interface LanguageCompressResult {
  /** Compressed content */
  output: string;
  /** Detected language */
  language: Language;
  /** Original character count */
  originalLength: number;
  /** Compressed character count */
  compressedLength: number;
  /** Compression ratio (0-1, lower = more compressed) */
  ratio: number;
}

// ── Core compressor ────────────────────────────────────────────────

/**
 * Compress source code by stripping function bodies and keeping
 * imports, type declarations, and signatures only.
 *
 * Config files and unknown languages are returned unchanged.
 */
export function compressSourceCode(content: string, filePath: string): LanguageCompressResult {
  const language = detectLanguage(filePath);
  const originalLength = content.length;

  // Config and unknown files pass through
  if (language === "config" || language === "unknown") {
    return {
      output: content,
      language,
      originalLength,
      compressedLength: originalLength,
      ratio: 1,
    };
  }

  const compressed = compressByLanguage(content, language);

  return {
    output: compressed,
    language,
    originalLength,
    compressedLength: compressed.length,
    ratio: originalLength > 0 ? compressed.length / originalLength : 1,
  };
}

function compressByLanguage(content: string, language: Language): string {
  switch (language) {
    case "typescript":
      return compressTypeScript(content);
    case "python":
      return compressPython(content);
    case "go":
      return compressGo(content);
    case "rust":
      return compressRust(content);
    case "java":
      return compressJava(content);
    default:
      return content;
  }
}

// ── TypeScript / JavaScript ────────────────────────────────────────

/** State shared across TS compression helpers. */
interface TSCompressState {
  lines: string[];
  result: string[];
  inBody: boolean;
  bodyStartDepth: number;
  index: number;
}

/** Collect lines for a multi-line type/interface/enum block. */
function collectTypeBlock(state: TSCompressState, line: string): void {
  const openCount = countChar(line, "{");
  const closeCount = countChar(line, "}");
  if (openCount <= closeCount) return;

  let typeDepth = openCount - closeCount;
  state.index++;
  while (state.index < state.lines.length && typeDepth > 0) {
    state.result.push(state.lines[state.index]);
    typeDepth +=
      countChar(state.lines[state.index], "{") - countChar(state.lines[state.index], "}");
    state.index++;
  }
  state.index--; // Will be incremented by loop
}

/** Look ahead from a function signature to find the opening brace on a subsequent line. */
function lookAheadForBrace(state: TSCompressState): void {
  let j = state.index + 1;
  while (j < state.lines.length) {
    const nextTrimmed = state.lines[j].trimStart();
    if (nextTrimmed === "" || nextTrimmed.startsWith("//")) {
      j++;
      continue;
    }
    if (isSignatureContinuation(nextTrimmed)) {
      state.result.push(state.lines[j]);
      j++;
      continue;
    }
    if (nextTrimmed === "{" || nextTrimmed.startsWith("{")) {
      state.inBody = true;
      state.bodyStartDepth = countChar(state.lines[j], "{") - countChar(state.lines[j], "}");
      if (state.bodyStartDepth <= 0) state.inBody = false;
      state.result.push(getIndent(state.lines[j]) + "  // ... (body omitted)");
      state.index = j;
      break;
    }
    if (nextTrimmed.startsWith(":") || nextTrimmed.startsWith("=>")) {
      state.result.push(state.lines[j]);
      j++;
      continue;
    }
    break;
  }
}

/** Check if a line is a continuation of a multi-line signature. */
function isSignatureContinuation(nextTrimmed: string): boolean {
  return nextTrimmed.startsWith(")") || nextTrimmed.includes(",") || nextTrimmed.startsWith("|");
}

/** Handle a function/method/arrow declaration line. */
function handleFunctionSignature(state: TSCompressState, line: string, trimmed: string): void {
  state.result.push(line);
  const openBraces = countChar(line, "{");
  const closeBraces = countChar(line, "}");

  if (openBraces > closeBraces) {
    state.inBody = true;
    state.bodyStartDepth = openBraces - closeBraces;
    state.result.push(getIndent(line) + "  // ... (body omitted)");
  } else if (openBraces === 0 && !trimmed.endsWith(";")) {
    lookAheadForBrace(state);
  }
}

/** Handle a class declaration line. */
function handleClassDeclaration(state: TSCompressState, line: string): void {
  state.result.push(line);
  if (countChar(line, "{") === 0 && state.index + 1 < state.lines.length) {
    state.index++;
    state.result.push(state.lines[state.index]);
  }
}

/** Process a line that is inside a function body (skipping until braces balance). */
function processBodyLine(state: TSCompressState, line: string): void {
  state.bodyStartDepth += countChar(line, "{") - countChar(line, "}");
  if (state.bodyStartDepth <= 0) {
    state.result.push(line); // Closing brace
    state.inBody = false;
    state.bodyStartDepth = 0;
  }
}

function compressTypeScript(content: string): string {
  const state: TSCompressState = {
    lines: content.split("\n"),
    result: [],
    inBody: false,
    bodyStartDepth: 0,
    index: 0,
  };

  for (state.index = 0; state.index < state.lines.length; state.index++) {
    const line = state.lines[state.index];
    const trimmed = line.trimStart();

    if (state.inBody) {
      processBodyLine(state, line);
      continue;
    }

    if (isTypeScriptKeepLine(trimmed)) {
      state.result.push(line);
      if (isTypeDeclarationStart(trimmed)) {
        collectTypeBlock(state, line);
      }
      continue;
    }

    if (isFunctionSignature(trimmed)) {
      handleFunctionSignature(state, line, trimmed);
      continue;
    }

    if (/^(?:export\s+)?(?:abstract\s+)?class\s/.test(trimmed)) {
      handleClassDeclaration(state, line);
      continue;
    }

    // Anything else at top level: keep (decorators, exports, consts without bodies, etc.)
    state.result.push(line);
  }

  return state.result.join("\n");
}

function isTypeScriptKeepLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("import ") ||
    trimmed.startsWith("import{") ||
    trimmed.startsWith("export type ") ||
    trimmed.startsWith("export interface ") ||
    trimmed.startsWith("export enum ") ||
    trimmed.startsWith("export default ") ||
    trimmed.startsWith("export {") ||
    trimmed.startsWith("export * ") ||
    trimmed.startsWith("type ") ||
    trimmed.startsWith("interface ") ||
    trimmed.startsWith("enum ") ||
    trimmed.startsWith("declare ") ||
    trimmed.startsWith("/// ") ||
    trimmed.startsWith("// @") ||
    trimmed.startsWith('"use ') ||
    trimmed === "" ||
    isTypeDeclarationStart(trimmed)
  );
}

function isTypeDeclarationStart(trimmed: string): boolean {
  return /^(?:export\s+)?(?:type|interface|enum)\s/.test(trimmed);
}

function isFunctionSignature(trimmed: string): boolean {
  return (
    /^(?:export\s+)?(?:async\s+)?function[\s*]/.test(trimmed) ||
    /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?[(<]/.test(trimmed) ||
    /^(?:public|private|protected|static|async|get|set|readonly)\s/.test(trimmed) ||
    /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\w+\s*=>/.test(trimmed) ||
    (/^\w+\s*\(/.test(trimmed) &&
      !trimmed.startsWith("if") &&
      !trimmed.startsWith("for") &&
      !trimmed.startsWith("while") &&
      !trimmed.startsWith("switch") &&
      !trimmed.startsWith("return") &&
      !trimmed.startsWith("throw") &&
      !trimmed.startsWith("console"))
  );
}

// ── Python ─────────────────────────────────────────────────────────

/** State shared across Python compression helpers. */
interface PythonCompressState {
  lines: string[];
  result: string[];
  skipIndent: number;
  index: number;
}

/** Collect lines for a multi-line docstring (""" or '''). */
function collectDocstring(state: PythonCompressState, quote: string): void {
  state.index++;
  while (state.index < state.lines.length && !state.lines[state.index].includes(quote)) {
    state.result.push(state.lines[state.index]);
    state.index++;
  }
  if (state.index < state.lines.length) state.result.push(state.lines[state.index]);
}

/** Handle a Python import, class, decorator, comment, or docstring line. */
function handlePythonKeepLine(state: PythonCompressState, line: string, trimmed: string): void {
  state.result.push(line);
  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
    const quote = trimmed.slice(0, 3);
    if (!trimmed.slice(3).includes(quote)) {
      collectDocstring(state, quote);
    }
  }
}

/** Collect a multi-line function signature. */
function collectPythonSignature(state: PythonCompressState): void {
  let sigLine = state.lines[state.index];
  while (!sigLine.includes(":") || sigLine.trimEnd().endsWith("\\")) {
    state.index++;
    if (state.index >= state.lines.length) break;
    state.result.push(state.lines[state.index]);
    sigLine = state.lines[state.index];
  }
}

/** Collect a function's docstring if present. */
function collectFunctionDocstring(state: PythonCompressState): void {
  if (state.index + 1 >= state.lines.length) return;
  const nextTrimmed = state.lines[state.index + 1].trimStart();
  if (!nextTrimmed.startsWith('"""') && !nextTrimmed.startsWith("'''")) return;

  state.index++;
  state.result.push(state.lines[state.index]);
  const quote = nextTrimmed.slice(0, 3);
  if (!nextTrimmed.slice(3).includes(quote)) {
    collectDocstring(state, quote);
  }
}

/** Handle a Python function/method definition. */
function handlePythonFunction(state: PythonCompressState, line: string, indent: number): void {
  state.result.push(line);
  collectPythonSignature(state);
  collectFunctionDocstring(state);
  state.result.push(getIndent(line) + "    # ... (body omitted)");
  state.skipIndent = indent;
}

function compressPython(content: string): string {
  const state: PythonCompressState = {
    lines: content.split("\n"),
    result: [],
    skipIndent: -1,
    index: 0,
  };

  for (state.index = 0; state.index < state.lines.length; state.index++) {
    const line = state.lines[state.index];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // If we're skipping a function body
    if (state.skipIndent >= 0) {
      if (trimmed === "" || indent > state.skipIndent) {
        continue; // Still inside the body
      }
      state.skipIndent = -1; // Exited body
    }

    if (isPythonKeepLine(trimmed)) {
      handlePythonKeepLine(state, line, trimmed);
      continue;
    }

    if (/^(?:async\s+)?def\s/.test(trimmed)) {
      handlePythonFunction(state, line, indent);
      continue;
    }

    // Module-level code or inside a class — keep
    state.result.push(line);
  }

  return state.result.join("\n");
}

/** Check if a Python line should always be kept. */
function isPythonKeepLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("import ") ||
    trimmed.startsWith("from ") ||
    trimmed.startsWith("class ") ||
    trimmed.startsWith("@") ||
    trimmed.startsWith("#") ||
    trimmed === "" ||
    trimmed.startsWith('"""') ||
    trimmed.startsWith("'''")
  );
}

// ── Go ─────────────────────────────────────────────────────────────

/** State shared across Go compression helpers. */
interface GoCompressState {
  lines: string[];
  result: string[];
  braceDepth: number;
  inBody: boolean;
  index: number;
}

/** Collect lines for a parenthesized block (import/var/const). */
function collectParenBlock(state: GoCompressState): void {
  state.index++;
  while (
    state.index < state.lines.length &&
    !state.lines[state.index].trimStart().startsWith(")")
  ) {
    state.result.push(state.lines[state.index]);
    state.index++;
  }
  if (state.index < state.lines.length) state.result.push(state.lines[state.index]);
}

/** Handle a Go function signature: keep the signature, skip the body. */
function handleGoFunction(state: GoCompressState, line: string): void {
  state.result.push(line);
  const openBraces = countChar(line, "{");
  const closeBraces = countChar(line, "}");

  if (openBraces > closeBraces) {
    state.inBody = true;
    state.braceDepth = openBraces - closeBraces;
    state.result.push("\t// ... (body omitted)");
  } else if (openBraces === 0) {
    if (state.index + 1 < state.lines.length && state.lines[state.index + 1].trimStart() === "{") {
      state.index++;
      state.inBody = true;
      state.braceDepth = 1;
      state.result.push("\t// ... (body omitted)");
    }
  }
}

function compressGo(content: string): string {
  const state: GoCompressState = {
    lines: content.split("\n"),
    result: [],
    braceDepth: 0,
    inBody: false,
    index: 0,
  };

  for (state.index = 0; state.index < state.lines.length; state.index++) {
    const line = state.lines[state.index];
    const trimmed = line.trimStart();

    if (state.inBody) {
      state.braceDepth += countChar(line, "{") - countChar(line, "}");
      if (state.braceDepth <= 0) {
        state.result.push(line);
        state.inBody = false;
        state.braceDepth = 0;
      }
      continue;
    }

    if (isGoKeepLine(trimmed)) {
      state.result.push(line);
      if (trimmed.endsWith("(")) {
        collectParenBlock(state);
      }
      continue;
    }

    if (trimmed.startsWith("func ") || trimmed.startsWith("func(")) {
      handleGoFunction(state, line);
      continue;
    }

    state.result.push(line);
  }

  return state.result.join("\n");
}

/** Check if a Go line should always be kept. */
function isGoKeepLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("package ") ||
    trimmed.startsWith("import ") ||
    trimmed.startsWith("import (") ||
    trimmed.startsWith("type ") ||
    trimmed.startsWith("var ") ||
    trimmed.startsWith("const ") ||
    trimmed.startsWith("//") ||
    trimmed === ""
  );
}

// ── Rust ───────────────────────────────────────────────────────────

/** State shared across Rust compression helpers. */
interface RustCompressState {
  lines: string[];
  result: string[];
  braceDepth: number;
  inBody: boolean;
  index: number;
}

/** Collect lines for a struct/enum block (keep full content). */
function collectStructEnumBlock(state: RustCompressState, line: string, trimmed: string): void {
  if (!/^(?:pub\s+)?(?:struct|enum)\s/.test(trimmed) || !trimmed.includes("{")) return;
  state.braceDepth = countChar(line, "{") - countChar(line, "}");
  while (state.braceDepth > 0 && state.index + 1 < state.lines.length) {
    state.index++;
    state.result.push(state.lines[state.index]);
    state.braceDepth +=
      countChar(state.lines[state.index], "{") - countChar(state.lines[state.index], "}");
  }
}

/** Handle a Rust fn signature: keep signature, skip body. */
function handleRustFunction(state: RustCompressState, line: string): void {
  state.result.push(line);
  // Multi-line signature
  let sigLine = line;
  while (!sigLine.includes("{") && state.index + 1 < state.lines.length) {
    state.index++;
    state.result.push(state.lines[state.index]);
    sigLine = state.lines[state.index];
  }
  const openBraces = countChar(sigLine, "{");
  const closeBraces = countChar(sigLine, "}");
  if (openBraces > closeBraces) {
    state.inBody = true;
    state.braceDepth = openBraces - closeBraces;
    state.result.push(getIndent(line) + "    // ... (body omitted)");
  }
}

function compressRust(content: string): string {
  const state: RustCompressState = {
    lines: content.split("\n"),
    result: [],
    braceDepth: 0,
    inBody: false,
    index: 0,
  };

  for (state.index = 0; state.index < state.lines.length; state.index++) {
    const line = state.lines[state.index];
    const trimmed = line.trimStart();

    if (state.inBody) {
      state.braceDepth += countChar(line, "{") - countChar(line, "}");
      if (state.braceDepth <= 0) {
        state.result.push(line);
        state.inBody = false;
        state.braceDepth = 0;
      }
      continue;
    }

    if (isRustKeepLine(trimmed)) {
      state.result.push(line);
      collectStructEnumBlock(state, line, trimmed);
      continue;
    }

    if (/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s/.test(trimmed)) {
      handleRustFunction(state, line);
      continue;
    }

    if (/^(?:pub\s+)?impl\s/.test(trimmed)) {
      state.result.push(line);
      continue;
    }

    state.result.push(line);
  }

  return state.result.join("\n");
}

/** Check if a Rust line should always be kept. */
function isRustKeepLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("use ") ||
    trimmed.startsWith("pub use ") ||
    trimmed.startsWith("mod ") ||
    trimmed.startsWith("pub mod ") ||
    trimmed.startsWith("type ") ||
    trimmed.startsWith("pub type ") ||
    trimmed.startsWith("struct ") ||
    trimmed.startsWith("pub struct ") ||
    trimmed.startsWith("enum ") ||
    trimmed.startsWith("pub enum ") ||
    trimmed.startsWith("trait ") ||
    trimmed.startsWith("pub trait ") ||
    trimmed.startsWith("#[") ||
    trimmed.startsWith("///") ||
    trimmed.startsWith("//!") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("const ") ||
    trimmed.startsWith("pub const ") ||
    trimmed.startsWith("static ") ||
    trimmed.startsWith("pub static ") ||
    trimmed === ""
  );
}

// ── Java / Kotlin / Groovy ─────────────────────────────────────────

/** State shared across Java compression helpers. */
interface JavaCompressState {
  lines: string[];
  result: string[];
  inMethodBody: boolean;
  methodDepth: number;
  index: number;
}

/** Handle a Java method signature: keep signature, skip body. */
function handleJavaMethod(state: JavaCompressState, line: string, trimmed: string): void {
  state.result.push(line);
  const openBraces = countChar(line, "{");
  const closeBraces = countChar(line, "}");

  if (openBraces > closeBraces) {
    state.inMethodBody = true;
    state.methodDepth = openBraces - closeBraces;
    state.result.push(getIndent(line) + "    // ... (body omitted)");
  } else if (openBraces === 0 && !trimmed.endsWith(";")) {
    handleJavaMethodNextLineBrace(state);
  }
}

/** Look ahead for opening brace on the next line of a Java method. */
function handleJavaMethodNextLineBrace(state: JavaCompressState): void {
  if (state.index + 1 >= state.lines.length) return;
  const nextTrimmed = state.lines[state.index + 1].trimStart();
  if (nextTrimmed === "{" || nextTrimmed.startsWith("{")) {
    state.index++;
    state.inMethodBody = true;
    state.methodDepth =
      countChar(state.lines[state.index], "{") - countChar(state.lines[state.index], "}");
    state.result.push(getIndent(state.lines[state.index]) + "    // ... (body omitted)");
  }
}

function compressJava(content: string): string {
  const state: JavaCompressState = {
    lines: content.split("\n"),
    result: [],
    inMethodBody: false,
    methodDepth: 0,
    index: 0,
  };

  for (state.index = 0; state.index < state.lines.length; state.index++) {
    const line = state.lines[state.index];
    const trimmed = line.trimStart();

    if (state.inMethodBody) {
      state.methodDepth += countChar(line, "{") - countChar(line, "}");
      if (state.methodDepth <= 0) {
        state.result.push(line);
        state.inMethodBody = false;
        state.methodDepth = 0;
      }
      continue;
    }

    if (isJavaKeepLine(trimmed)) {
      state.result.push(line);
      continue;
    }

    // Field declarations (no braces)
    if (!trimmed.includes("{") && (trimmed.endsWith(";") || trimmed.endsWith(","))) {
      state.result.push(line);
      continue;
    }

    if (isJavaMethodSignature(trimmed)) {
      handleJavaMethod(state, line, trimmed);
      continue;
    }

    state.result.push(line);
  }

  return state.result.join("\n");
}

/** Check if a Java line should always be kept (package, import, annotation, class declaration, etc.). */
function isJavaKeepLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("package ") ||
    trimmed.startsWith("import ") ||
    trimmed.startsWith("@") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("*/") ||
    trimmed === "" ||
    /^(?:public|private|protected|abstract|static|final|sealed|open)?\s*(?:class|interface|enum|record|object)\s/.test(
      trimmed,
    ) ||
    trimmed === "}"
  );
}

function isJavaMethodSignature(trimmed: string): boolean {
  // Matches: [modifiers] returnType methodName(params) [throws ...] {
  // eslint-disable-next-line no-useless-escape
  return /^(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|override|suspend)\s+)*\w[\w<>\[\],?\s]*\s+\w+\s*\(/.test(
    trimmed,
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function countChar(str: string, char: string): number {
  let count = 0;
  for (const ch of str) {
    if (ch === char) count++;
  }
  return count;
}

function getIndent(line: string): string {
  const match = /^(\s*)/.exec(line);
  return match ? match[1] : "";
}

// ── Batch compression ──────────────────────────────────────────────

export interface CompressedFile {
  path: string;
  content: string;
  originalLength: number;
  compressedLength: number;
  language: string;
}

/**
 * Compress an array of file contents using language-aware compression.
 * Returns compressed files and aggregate stats.
 */
export function compressFileContents(files: { path: string; content: string }[]): {
  files: CompressedFile[];
  totalOriginal: number;
  totalCompressed: number;
  ratio: number;
} {
  let totalOriginal = 0;
  let totalCompressed = 0;

  const compressed = files.map((f) => {
    const result = compressSourceCode(f.content, f.path);
    totalOriginal += result.originalLength;
    totalCompressed += result.compressedLength;
    return {
      path: f.path,
      content: result.output,
      originalLength: result.originalLength,
      compressedLength: result.compressedLength,
      language: result.language,
    };
  });

  return {
    files: compressed,
    totalOriginal,
    totalCompressed,
    ratio: totalOriginal > 0 ? totalCompressed / totalOriginal : 1,
  };
}
