import { validateSystemPrompt } from "./prompt-validator";

export interface CustomAgentConfig {
  name: string;
  domain: string;
  description: string;
  systemPrompt: string;
  keywords: string[];
}

const REQUIRED_SECTIONS = ["Domain", "Description", "System Prompt", "Keywords"] as const;

/**
 * Parses a structured README.md into a CustomAgentConfig.
 * Returns null if the content is empty or missing required sections.
 */
/** Parse markdown content into a map of ## heading -> body text. */
function parseMarkdownSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split("\n");
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = /^##\s+(.+)$/.exec(line); // NOSONAR - safe: anchored pattern on single line
    if (headingMatch) {
      if (currentSection) sections.set(currentSection, currentContent.join("\n").trim());
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  if (currentSection) sections.set(currentSection, currentContent.join("\n").trim());
  return sections;
}

export function parseAgentReadme(content: string, dirName: string): CustomAgentConfig | null {
  if (!content?.trim()) return null;

  const sections = parseMarkdownSections(content);

  // Check all required sections exist and are non-empty
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.get(section)?.trim()) return null;
  }

  const systemPrompt = sections.get("System Prompt")!.trim();
  const keywords = sections
    .get("Keywords")!
    .trim()
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) return null;

  const promptValidation = validateSystemPrompt(systemPrompt);
  if (!promptValidation.safe) {
    for (const warning of promptValidation.warnings) {
      console.warn(`[agent-parser] Agent "${dirName}" rejected: ${warning}`);
    }
    return null;
  }

  return {
    name: dirName,
    domain: sections.get("Domain")!.trim(),
    description: sections.get("Description")!.trim(),
    systemPrompt,
    keywords,
  };
}

/**
 * Validates a CustomAgentConfig for completeness.
 */
export function validateAgentConfig(config: CustomAgentConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.name?.trim()) {
    errors.push("name is required");
  }
  if (!config.domain?.trim()) {
    errors.push("domain is required");
  }
  if (!config.description?.trim()) {
    errors.push("description is required");
  }
  if (!config.systemPrompt?.trim()) {
    errors.push("systemPrompt is required");
  }
  if (!config.keywords || config.keywords.length === 0) {
    errors.push("at least one keyword is required");
  }

  return { valid: errors.length === 0, errors };
}
