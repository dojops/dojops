/**
 * Simple syntax highlighting for code blocks in LLM responses.
 *
 * Detects fenced code blocks (```lang ... ```) and applies keyword
 * coloring using picocolors. No external dependencies.
 */
import pc from "picocolors";

const FENCE_RE = /^```(\w*)$/;

const KEYWORD_SETS: Record<string, string[]> = {
  typescript: [
    "import",
    "export",
    "from",
    "const",
    "let",
    "var",
    "function",
    "async",
    "await",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "interface",
    "type",
    "extends",
    "implements",
    "new",
    "throw",
    "try",
    "catch",
    "finally",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "yield",
    "true",
    "false",
    "null",
    "undefined",
    "typeof",
    "instanceof",
  ],
  python: [
    "import",
    "from",
    "def",
    "class",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "with",
    "as",
    "try",
    "except",
    "finally",
    "raise",
    "yield",
    "async",
    "await",
    "True",
    "False",
    "None",
    "and",
    "or",
    "not",
    "in",
    "is",
    "lambda",
    "pass",
    "break",
    "continue",
  ],
  bash: [
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "do",
    "done",
    "while",
    "case",
    "esac",
    "function",
    "return",
    "exit",
    "export",
    "source",
    "local",
    "echo",
    "cd",
    "mkdir",
    "rm",
    "cp",
    "mv",
    "chmod",
    "chown",
    "sudo",
    "apt",
    "npm",
    "pnpm",
    "yarn",
    "docker",
    "git",
  ],
  go: [
    "package",
    "import",
    "func",
    "return",
    "if",
    "else",
    "for",
    "range",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "go",
    "defer",
    "chan",
    "select",
    "type",
    "struct",
    "interface",
    "map",
    "var",
    "const",
    "true",
    "false",
    "nil",
    "error",
  ],
  yaml: ["true", "false", "null", "yes", "no"],
};

// Language aliases
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  jsx: "typescript",
  javascript: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  hcl: "bash",
  terraform: "bash",
  tf: "bash",
  dockerfile: "bash",
  makefile: "bash",
  yml: "yaml",
  json: "yaml",
  toml: "yaml",
  golang: "go",
};

function resolveLanguage(lang: string): string {
  return LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
}

/** Highlight keywords in a single code line. */
function highlightLine(line: string, keywords: Set<string>): string {
  // Highlight comments
  const commentIdx = line.indexOf("//");
  const hashIdx = line.trimStart().startsWith("#") ? line.indexOf("#") : -1;
  if (commentIdx >= 0 && (hashIdx < 0 || commentIdx < hashIdx)) {
    return line.slice(0, commentIdx) + pc.dim(line.slice(commentIdx));
  }
  if (hashIdx >= 0) {
    return line.slice(0, hashIdx) + pc.dim(line.slice(hashIdx));
  }

  // Highlight strings
  let result = line;
  result = result.replace(/(["'`])(?:(?!\1).)*?\1/g, (m) => pc.green(m));

  // Highlight keywords (word boundaries)
  for (const kw of keywords) {
    const re = new RegExp(`\\b(${kw})\\b`, "g");
    result = result.replace(re, pc.cyan("$1"));
  }

  // Highlight numbers
  result = result.replace(/\b(\d+(?:\.\d+)?)\b/g, pc.yellow("$1"));

  return result;
}

/**
 * Highlight code blocks in a full LLM response.
 * Adds color to fenced code blocks, dims the fence markers.
 */
export function highlightCodeBlocks(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inBlock = false;
  let keywords = new Set<string>();

  for (const line of lines) {
    const fenceMatch = FENCE_RE.exec(line.trim());

    if (fenceMatch && !inBlock) {
      // Opening fence
      inBlock = true;
      const lang = resolveLanguage(fenceMatch[1] || "");
      keywords = new Set(KEYWORD_SETS[lang] ?? []);
      result.push(pc.dim(line));
      continue;
    }

    if (line.trim() === "```" && inBlock) {
      // Closing fence
      inBlock = false;
      keywords = new Set();
      result.push(pc.dim(line));
      continue;
    }

    if (inBlock && keywords.size > 0) {
      result.push(highlightLine(line, keywords));
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}
