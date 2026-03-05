import * as fs from "node:fs";
import * as yaml from "js-yaml";
import {
  DopsFrontmatterSchema,
  DopsFrontmatterV2Schema,
  DopsModule,
  DopsModuleV2,
  DopsModuleAny,
  DopsValidationResult,
  MarkdownSections,
  isV2Module,
} from "./spec";

const FRONTMATTER_DELIMITER = "---";

/**
 * Parse a .dops file from disk.
 */
export function parseDopsFile(filePath: string): DopsModule {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseDopsString(content);
}

/**
 * Parse a .dops file from a string.
 */
export function parseDopsString(content: string): DopsModule {
  const { frontmatterRaw, body } = splitFrontmatter(content);

  // Parse YAML frontmatter
  let frontmatterData: unknown;
  try {
    frontmatterData = yaml.load(frontmatterRaw);
  } catch (err) {
    throw new Error(`Invalid YAML in frontmatter: ${(err as Error).message}`, { cause: err });
  }

  // Validate frontmatter against schema
  const parseResult = DopsFrontmatterSchema.safeParse(frontmatterData);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid DOPS frontmatter:\n  ${errors.join("\n  ")}`);
  }

  // Parse markdown sections
  const sections = parseMarkdownSections(body);

  return {
    frontmatter: parseResult.data,
    sections,
    raw: content,
  };
}

/**
 * Validate a parsed DOPS module for completeness.
 */
export function validateDopsModule(module: DopsModule): DopsValidationResult {
  const errors: string[] = [];

  // Required sections
  if (!module.sections.prompt || module.sections.prompt.trim().length === 0) {
    errors.push("Missing required ## Prompt section");
  }
  if (!module.sections.keywords || module.sections.keywords.trim().length === 0) {
    errors.push("Missing required ## Keywords section");
  }

  // Validate output schema has type
  if (!module.frontmatter.output?.type) {
    errors.push("Output schema must have a 'type' field");
  }

  // Validate files have valid paths
  for (const file of module.frontmatter.files) {
    if (file.source === "template" && !file.content && file.format !== "raw") {
      errors.push(`File '${file.path}': template source requires 'content' field`);
    }
  }

  // Validate scope.write paths do not contain path traversal
  if (module.frontmatter.scope) {
    for (const writePath of module.frontmatter.scope.write) {
      const segments = writePath.split(/[/\\]/);
      if (segments.includes("..")) {
        errors.push(`Scope write path contains path traversal: '${writePath}'`);
      }
    }
  }

  // Validate network must be "none" when risk is declared (v1 constraint)
  if (module.frontmatter.risk && module.frontmatter.permissions?.network === "required") {
    errors.push("network permission must be 'none' for v1 tools");
  }

  // Validate verification binary references a known parser
  if (module.frontmatter.verification?.binary) {
    const knownParsers = [
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
    ];
    if (!knownParsers.includes(module.frontmatter.verification.binary.parser)) {
      errors.push(
        `Unknown verification parser: '${module.frontmatter.verification.binary.parser}'`,
      );
    }
  }

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
    const headingMatch = /^##\s+(.+)$/.exec(line);
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

// ══════════════════════════════════════════════════════
// v2 Version-detecting parsers
// ══════════════════════════════════════════════════════

/**
 * Parse a .dops file from disk, auto-detecting v1 or v2 format.
 */
export function parseDopsFileAny(filePath: string): DopsModuleAny {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseDopsStringAny(content);
}

/**
 * Parse a .dops file from a string, auto-detecting v1 or v2 format.
 */
export function parseDopsStringAny(content: string): DopsModuleAny {
  const { frontmatterRaw, body } = splitFrontmatter(content);

  let frontmatterData: unknown;
  try {
    frontmatterData = yaml.load(frontmatterRaw);
  } catch (err) {
    throw new Error(`Invalid YAML in frontmatter: ${(err as Error).message}`, { cause: err });
  }

  // Detect version from the `dops` field
  const version = (frontmatterData as Record<string, unknown>)?.dops;

  if (version === "v2") {
    const parseResult = DopsFrontmatterV2Schema.safeParse(frontmatterData);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid DOPS v2 frontmatter:\n  ${errors.join("\n  ")}`);
    }
    const sections = parseMarkdownSections(body);
    return { frontmatter: parseResult.data, sections, raw: content } as DopsModuleV2;
  }

  // Default: v1
  const parseResult = DopsFrontmatterSchema.safeParse(frontmatterData);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid DOPS frontmatter:\n  ${errors.join("\n  ")}`);
  }
  const sections = parseMarkdownSections(body);
  return { frontmatter: parseResult.data, sections, raw: content } as DopsModule;
}

/**
 * Validate a parsed v2 DOPS module for completeness.
 */
export function validateDopsModuleV2(module: DopsModuleV2): DopsValidationResult {
  const errors: string[] = [];

  // Required sections
  if (!module.sections.prompt || module.sections.prompt.trim().length === 0) {
    errors.push("Missing required ## Prompt section");
  }
  if (!module.sections.keywords || module.sections.keywords.trim().length === 0) {
    errors.push("Missing required ## Keywords section");
  }

  // Validate files have valid paths
  for (const file of module.frontmatter.files) {
    if (!file.path || file.path.trim().length === 0) {
      errors.push("File spec has empty path");
    }
  }

  // Validate scope.write paths do not contain path traversal
  if (module.frontmatter.scope) {
    for (const writePath of module.frontmatter.scope.write) {
      const segments = writePath.split(/[/\\]/);
      if (segments.includes("..")) {
        errors.push(`Scope write path contains path traversal: '${writePath}'`);
      }
    }
  }

  // Validate verification binary references a known parser
  if (module.frontmatter.verification?.binary) {
    const knownParsers = [
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
    ];
    if (!knownParsers.includes(module.frontmatter.verification.binary.parser)) {
      errors.push(
        `Unknown verification parser: '${module.frontmatter.verification.binary.parser}'`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validate any DOPS module (v1 or v2) for completeness.
 */
export function validateDopsModuleAny(module: DopsModuleAny): DopsValidationResult {
  if (isV2Module(module)) {
    return validateDopsModuleV2(module);
  }
  return validateDopsModule(module);
}
