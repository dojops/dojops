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

function compressTypeScript(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inBody = false;
  let bodyStartDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Always keep: imports, exports of types, type/interface/enum declarations, comments at top level
    if (!inBody) {
      if (isTypeScriptKeepLine(trimmed)) {
        result.push(line);
        // Track braces in type/interface/enum blocks (keep full content)
        if (isTypeDeclarationStart(trimmed)) {
          const openCount = countChar(line, "{");
          const closeCount = countChar(line, "}");
          if (openCount > closeCount) {
            // Multi-line type — keep all lines until balanced
            let typeDepth = openCount - closeCount;
            i++;
            while (i < lines.length && typeDepth > 0) {
              result.push(lines[i]);
              typeDepth += countChar(lines[i], "{") - countChar(lines[i], "}");
              i++;
            }
            i--; // Will be incremented by loop
          }
        }
        continue;
      }

      // Function/method/arrow declaration — keep signature, skip body
      if (isFunctionSignature(trimmed)) {
        result.push(line);
        const openBraces = countChar(line, "{");
        const closeBraces = countChar(line, "}");
        if (openBraces > closeBraces) {
          inBody = true;
          bodyStartDepth = openBraces - closeBraces;
          result.push(getIndent(line) + "  // ... (body omitted)");
        } else if (openBraces === 0 && !trimmed.endsWith(";")) {
          // Signature spans multiple lines or body starts on next line
          // Look ahead for opening brace
          let j = i + 1;
          while (j < lines.length) {
            const nextTrimmed = lines[j].trimStart();
            if (nextTrimmed === "" || nextTrimmed.startsWith("//")) {
              j++;
              continue;
            }
            // Parameters continuing on next line
            if (
              nextTrimmed.startsWith(")") ||
              nextTrimmed.includes(",") ||
              nextTrimmed.startsWith("|")
            ) {
              result.push(lines[j]);
              j++;
              continue;
            }
            if (nextTrimmed === "{" || nextTrimmed.startsWith("{")) {
              inBody = true;
              bodyStartDepth = countChar(lines[j], "{") - countChar(lines[j], "}");
              if (bodyStartDepth <= 0) inBody = false;
              result.push(getIndent(lines[j]) + "  // ... (body omitted)");
              i = j;
              break;
            }
            // Return type annotation
            if (nextTrimmed.startsWith(":") || nextTrimmed.startsWith("=>")) {
              result.push(lines[j]);
              j++;
              continue;
            }
            break;
          }
        }
        continue;
      }

      // Class declaration — keep, enter body tracking
      if (/^(?:export\s+)?(?:abstract\s+)?class\s/.test(trimmed)) {
        result.push(line);
        if (countChar(line, "{") === 0) {
          // Opening brace on next line
          if (i + 1 < lines.length) {
            i++;
            result.push(lines[i]);
          }
        }
        // Don't skip class body — we want method signatures inside
        continue;
      }

      // Anything else at top level: keep (decorators, exports, consts without bodies, etc.)
      result.push(line);
      continue;
    }

    // Inside a function body — skip lines until braces balance
    if (inBody) {
      bodyStartDepth += countChar(line, "{") - countChar(line, "}");
      if (bodyStartDepth <= 0) {
        result.push(line); // Closing brace
        inBody = false;
        bodyStartDepth = 0;
      }
    }
  }

  return result.join("\n");
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
    /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\(|<)/.test(trimmed) ||
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

function compressPython(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // If we're skipping a function body
    if (skipIndent >= 0) {
      if (trimmed === "" || indent > skipIndent) {
        continue; // Still inside the body
      }
      skipIndent = -1; // Exited body
    }

    // Always keep: imports, type hints, class declarations, decorators, module-level assignments
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("from ") ||
      trimmed.startsWith("class ") ||
      trimmed.startsWith("@") ||
      trimmed.startsWith("#") ||
      trimmed === "" ||
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''")
    ) {
      result.push(line);
      // Keep class docstrings
      if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        const quote = trimmed.slice(0, 3);
        if (!trimmed.slice(3).includes(quote)) {
          // Multi-line docstring
          i++;
          while (i < lines.length && !lines[i].includes(quote)) {
            result.push(lines[i]);
            i++;
          }
          if (i < lines.length) result.push(lines[i]);
        }
      }
      continue;
    }

    // Function/method definition — keep signature + docstring, skip body
    if (/^(?:async\s+)?def\s/.test(trimmed)) {
      result.push(line);
      // Handle multi-line signature
      let sigLine = line;
      while (!sigLine.includes(":") || sigLine.trimEnd().endsWith("\\")) {
        i++;
        if (i >= lines.length) break;
        result.push(lines[i]);
        sigLine = lines[i];
      }
      // Check for docstring
      if (i + 1 < lines.length) {
        const nextTrimmed = lines[i + 1].trimStart();
        if (nextTrimmed.startsWith('"""') || nextTrimmed.startsWith("'''")) {
          i++;
          result.push(lines[i]);
          const quote = nextTrimmed.slice(0, 3);
          if (!nextTrimmed.slice(3).includes(quote)) {
            // Multi-line docstring
            i++;
            while (i < lines.length && !lines[i].includes(quote)) {
              result.push(lines[i]);
              i++;
            }
            if (i < lines.length) result.push(lines[i]);
          }
        }
      }
      result.push(getIndent(line) + "    # ... (body omitted)");
      skipIndent = indent;
      continue;
    }

    // Module-level code — keep
    if (indent === 0) {
      result.push(line);
      continue;
    }

    // Inside a class but not a method — keep (class variables, etc.)
    result.push(line);
  }

  return result.join("\n");
}

// ── Go ─────────────────────────────────────────────────────────────

function compressGo(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let braceDepth = 0;
  let inBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!inBody) {
      // Always keep: package, imports, type declarations, var/const blocks, comments
      if (
        trimmed.startsWith("package ") ||
        trimmed.startsWith("import ") ||
        trimmed.startsWith("import (") ||
        trimmed.startsWith("type ") ||
        trimmed.startsWith("var ") ||
        trimmed.startsWith("const ") ||
        trimmed.startsWith("//") ||
        trimmed === ""
      ) {
        result.push(line);
        // Handle import/var/const blocks
        if (trimmed.endsWith("(")) {
          i++;
          while (i < lines.length && !lines[i].trimStart().startsWith(")")) {
            result.push(lines[i]);
            i++;
          }
          if (i < lines.length) result.push(lines[i]);
        }
        continue;
      }

      // Function signature — keep, skip body
      if (trimmed.startsWith("func ") || trimmed.startsWith("func(")) {
        result.push(line);
        const openBraces = countChar(line, "{");
        const closeBraces = countChar(line, "}");
        if (openBraces > closeBraces) {
          inBody = true;
          braceDepth = openBraces - closeBraces;
          result.push("\t// ... (body omitted)");
        } else if (openBraces === 0) {
          // Opening brace on next line
          if (i + 1 < lines.length && lines[i + 1].trimStart() === "{") {
            i++;
            inBody = true;
            braceDepth = 1;
            result.push("\t// ... (body omitted)");
          }
        }
        continue;
      }

      result.push(line);
      continue;
    }

    // Inside function body
    if (inBody) {
      braceDepth += countChar(line, "{") - countChar(line, "}");
      if (braceDepth <= 0) {
        result.push(line); // Closing brace
        inBody = false;
        braceDepth = 0;
      }
    }
  }

  return result.join("\n");
}

// ── Rust ───────────────────────────────────────────────────────────

function compressRust(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let braceDepth = 0;
  let inBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!inBody) {
      // Always keep: use, mod, pub mod, type aliases, trait defs, struct/enum, attributes, comments
      if (
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
      ) {
        result.push(line);
        // Handle struct/enum blocks — keep full
        if (/^(?:pub\s+)?(?:struct|enum)\s/.test(trimmed) && trimmed.includes("{")) {
          braceDepth = countChar(line, "{") - countChar(line, "}");
          while (braceDepth > 0 && i + 1 < lines.length) {
            i++;
            result.push(lines[i]);
            braceDepth += countChar(lines[i], "{") - countChar(lines[i], "}");
          }
        }
        continue;
      }

      // fn signature — keep, skip body
      if (/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s/.test(trimmed)) {
        result.push(line);
        // Multi-line signature
        let sigLine = line;
        while (!sigLine.includes("{") && i + 1 < lines.length) {
          i++;
          result.push(lines[i]);
          sigLine = lines[i];
        }
        const openBraces = countChar(sigLine, "{");
        const closeBraces = countChar(sigLine, "}");
        if (openBraces > closeBraces) {
          inBody = true;
          braceDepth = openBraces - closeBraces;
          result.push(getIndent(line) + "    // ... (body omitted)");
        }
        continue;
      }

      // impl blocks — keep the block header, enter for method signatures
      if (/^(?:pub\s+)?impl\s/.test(trimmed)) {
        result.push(line);
        continue;
      }

      result.push(line);
      continue;
    }

    // Inside function body
    if (inBody) {
      braceDepth += countChar(line, "{") - countChar(line, "}");
      if (braceDepth <= 0) {
        result.push(line);
        inBody = false;
        braceDepth = 0;
      }
    }
  }

  return result.join("\n");
}

// ── Java / Kotlin / Groovy ─────────────────────────────────────────

function compressJava(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inMethodBody = false;
  let methodDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!inMethodBody) {
      // Always keep: package, imports, annotations, class/interface declarations, comments
      if (
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
      ) {
        result.push(line);
        continue;
      }

      // Field declarations (no braces)
      if (!trimmed.includes("{") && (trimmed.endsWith(";") || trimmed.endsWith(","))) {
        result.push(line);
        continue;
      }

      // Method signature — detect by: has return type + name + parens + brace
      if (isJavaMethodSignature(trimmed)) {
        result.push(line);
        const openBraces = countChar(line, "{");
        const closeBraces = countChar(line, "}");
        if (openBraces > closeBraces) {
          inMethodBody = true;
          methodDepth = openBraces - closeBraces;
          result.push(getIndent(line) + "    // ... (body omitted)");
        } else if (openBraces === 0 && !trimmed.endsWith(";")) {
          // Opening brace on next line
          if (i + 1 < lines.length) {
            const nextTrimmed = lines[i + 1].trimStart();
            if (nextTrimmed === "{" || nextTrimmed.startsWith("{")) {
              i++;
              inMethodBody = true;
              methodDepth = countChar(lines[i], "{") - countChar(lines[i], "}");
              result.push(getIndent(lines[i]) + "    // ... (body omitted)");
            }
          }
        }
        continue;
      }

      result.push(line);
      continue;
    }

    // Inside method body
    if (inMethodBody) {
      methodDepth += countChar(line, "{") - countChar(line, "}");
      if (methodDepth <= 0) {
        result.push(line); // Closing brace
        inMethodBody = false;
        methodDepth = 0;
      }
    }
  }

  return result.join("\n");
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
  for (let i = 0; i < str.length; i++) {
    if (str[i] === char) count++;
  }
  return count;
}

function getIndent(line: string): string {
  const match = line.match(/^(\s*)/);
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
