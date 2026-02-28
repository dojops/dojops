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
export function parseAgentReadme(content: string, dirName: string): CustomAgentConfig | null {
  if (!content || !content.trim()) return null;

  const sections = new Map<string, string>();

  // Split by ## headings and extract content under each
  const lines = content.split("\n");
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        sections.set(currentSection, currentContent.join("\n").trim());
      }
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  // Save last section
  if (currentSection) {
    sections.set(currentSection, currentContent.join("\n").trim());
  }

  // Check all required sections exist and are non-empty
  for (const section of REQUIRED_SECTIONS) {
    const value = sections.get(section);
    if (!value || !value.trim()) return null;
  }

  const domain = sections.get("Domain")!.trim();
  const description = sections.get("Description")!.trim();
  const systemPrompt = sections.get("System Prompt")!.trim();
  const keywordsRaw = sections.get("Keywords")!.trim();

  const keywords = keywordsRaw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) return null;

  // Validate system prompt for injection patterns (A4)
  const promptValidation = validateSystemPrompt(systemPrompt);
  if (!promptValidation.safe) {
    for (const warning of promptValidation.warnings) {
      console.warn(`[agent-parser] Agent "${dirName}": ${warning}`);
    }
  }

  return {
    name: dirName,
    domain,
    description,
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

  if (!config.name || !config.name.trim()) {
    errors.push("name is required");
  }
  if (!config.domain || !config.domain.trim()) {
    errors.push("domain is required");
  }
  if (!config.description || !config.description.trim()) {
    errors.push("description is required");
  }
  if (!config.systemPrompt || !config.systemPrompt.trim()) {
    errors.push("systemPrompt is required");
  }
  if (!config.keywords || config.keywords.length === 0) {
    errors.push("at least one keyword is required");
  }

  return { valid: errors.length === 0, errors };
}
