import * as fs from "fs";
import * as yaml from "js-yaml";
import { DopsFrontmatterSchema, DopsModule, DopsValidationResult, MarkdownSections } from "./spec";

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
  if (!module.frontmatter.output || !module.frontmatter.output.type) {
    errors.push("Output schema must have a 'type' field");
  }

  // Validate files have valid paths
  for (const file of module.frontmatter.files) {
    if (file.source === "template" && !file.content && file.format !== "raw") {
      errors.push(`File '${file.path}': template source requires 'content' field`);
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

  // Find the closing ---
  const secondDelimiterIndex = trimmed.indexOf(FRONTMATTER_DELIMITER, FRONTMATTER_DELIMITER.length);

  if (secondDelimiterIndex === -1) {
    throw new Error("DOPS file missing closing --- frontmatter delimiter");
  }

  const frontmatterRaw = trimmed.slice(FRONTMATTER_DELIMITER.length, secondDelimiterIndex).trim();
  const body = trimmed.slice(secondDelimiterIndex + FRONTMATTER_DELIMITER.length).trim();

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
    const headingMatch = line.match(/^##\s+(.+)$/);
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
