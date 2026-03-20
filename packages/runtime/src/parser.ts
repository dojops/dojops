import * as fs from "node:fs";
import * as yaml from "js-yaml";
import { DopsFrontmatterSchema, DopsSkill, DopsValidationResult, MarkdownSections } from "./spec";

const FRONTMATTER_DELIMITER = "---";

/** Maximum .dops file size (1MB) to prevent YAML billion-laughs DoS. */
const MAX_DOPS_FILE_SIZE = 1024 * 1024;

/**
 * Parse a .dops file from disk.
 */
export function parseDopsFile(filePath: string): DopsSkill {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DOPS_FILE_SIZE) {
    throw new Error(
      `DOPS file exceeds maximum size (${stat.size} bytes > ${MAX_DOPS_FILE_SIZE} bytes): ${filePath}`,
    );
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return parseDopsString(content);
}

/**
 * Parse a .dops file from a string. Only v2 format is supported.
 */
export function parseDopsString(content: string): DopsSkill {
  if (content.length > MAX_DOPS_FILE_SIZE) {
    throw new Error(
      `DOPS content exceeds maximum size (${content.length} bytes > ${MAX_DOPS_FILE_SIZE} bytes)`,
    );
  }
  const { frontmatterRaw, body } = splitFrontmatter(content);
  const frontmatterData = parseFrontmatterYaml(frontmatterRaw);
  const sections = parseMarkdownSections(body);

  const version = (frontmatterData as Record<string, unknown>)?.dops;

  if (version !== "v2") {
    throw new Error(
      "Unsupported .dops format. Only v2 is supported. Set 'dops: v2' in frontmatter.",
    );
  }

  const frontmatter = validateFrontmatter(
    DopsFrontmatterSchema,
    frontmatterData,
    "DOPS v2 frontmatter",
  );
  return { frontmatter, sections, raw: content };
}

const KNOWN_VERIFICATION_PARSERS = new Set([
  "terraform-json",
  "hadolint-json",
  "kubectl-stderr",
  "helm-lint",
  "nginx-stderr",
  "promtool",
  "systemd-analyze",
  "make-dryrun",
  "ansible-syntax",
  "docker-compose-config",
  "actionlint",
  "github-actions",
  "gitlab-ci",
  "generic-stderr",
  "generic-json",
  "packer-validate",
]);

/** Validate required sections exist. */
function validateRequiredSections(sections: MarkdownSections, errors: string[]): void {
  if (!sections.prompt || sections.prompt.trim().length === 0) {
    errors.push("Missing required ## Prompt section");
  }
  if (!sections.keywords || sections.keywords.trim().length === 0) {
    errors.push("Missing required ## Keywords section");
  }
}

/** Validate scope write paths for path traversal. */
function validateScopeWritePaths(scope: { write: string[] } | undefined, errors: string[]): void {
  if (!scope) return;
  for (const writePath of scope.write) {
    if (writePath.split(/[/\\]/).includes("..")) {
      errors.push(`Scope write path contains path traversal: '${writePath}'`);
    }
  }
}

/** Validate verification binary parser is known. */
function validateVerificationParser(
  verification: { binary?: { parser: string } } | undefined,
  errors: string[],
): void {
  if (!verification?.binary) return;
  if (!KNOWN_VERIFICATION_PARSERS.has(verification.binary.parser)) {
    errors.push(`Unknown verification parser: '${verification.binary.parser}'`);
  }
}

/**
 * Validate a parsed DOPS module for completeness.
 */
export function validateDopsSkill(module: DopsSkill): DopsValidationResult {
  const errors: string[] = [];

  validateRequiredSections(module.sections, errors);

  for (const file of module.frontmatter.files) {
    if (!file.path || file.path.trim().length === 0) {
      errors.push("File spec has empty path");
    }
  }

  validateScopeWritePaths(module.frontmatter.scope, errors);
  validateVerificationParser(module.frontmatter.verification, errors);

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Split a .dops file content into frontmatter and body.
 */
function splitFrontmatter(content: string): {
  frontmatterRaw: string;
  body: string;
} {
  const trimmed = content.trim();

  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    throw new Error("DOPS file must start with --- frontmatter delimiter");
  }

  // Find the closing --- on its own line (or at end of string)
  const closingPattern = /\n---\s*(?:\n|$)/;
  const remainder = trimmed.slice(FRONTMATTER_DELIMITER.length);
  const match = closingPattern.exec(remainder);

  if (!match) {
    throw new Error("DOPS file missing closing --- frontmatter delimiter");
  }

  const secondDelimiterIndex = FRONTMATTER_DELIMITER.length + match.index;
  const frontmatterRaw = trimmed.slice(FRONTMATTER_DELIMITER.length, secondDelimiterIndex).trim();
  const body = trimmed.slice(secondDelimiterIndex + match[0].length).trim();

  return { frontmatterRaw, body };
}

/**
 * Parse markdown body into named sections by ## headings.
 */
function parseMarkdownSections(body: string): MarkdownSections {
  const sectionMap = new Map<string, string>();
  const lines = body.split("\n");

  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = /^##\s+(.+)$/.exec(line); // NOSONAR - safe: anchored pattern on single line
    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        sectionMap.set(currentSection.toLowerCase(), currentContent.join("\n").trim());
      }
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sectionMap.set(currentSection.toLowerCase(), currentContent.join("\n").trim());
  }

  return {
    prompt: sectionMap.get("prompt") ?? "",
    updatePrompt: sectionMap.get("update prompt"),
    examples: sectionMap.get("examples"),
    constraints: sectionMap.get("constraints"),
    keywords: sectionMap.get("keywords") ?? "",
  };
}

/** Parse frontmatter YAML and throw on invalid YAML. */
function parseFrontmatterYaml(raw: string): unknown {
  try {
    return yaml.load(raw, { maxAliasCount: 100 } as yaml.LoadOptions);
  } catch (err) {
    throw new Error(`Invalid YAML in frontmatter: ${(err as Error).message}`, { cause: err });
  }
}

/** Validate frontmatter data against a Zod schema, throwing with formatted errors. */
function validateFrontmatter<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };
  },
  data: unknown,
  label: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid ${label}:\n  ${errors.join("\n  ")}`);
  }
  return result.data!;
}
