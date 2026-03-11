import { z } from "zod";

export const GeneratedAgentSchema = z.object({
  name: z.string().describe("Short kebab-case name, e.g. sre-specialist"),
  domain: z.string().describe("One or two word domain, e.g. site-reliability"),
  description: z.string().describe("One-sentence description"),
  systemPrompt: z.string().describe("Detailed system prompt (3-10 paragraphs)"),
  keywords: z.array(z.string()).describe("10-20 domain-specific keywords for routing"),
});

export type GeneratedAgent = z.infer<typeof GeneratedAgentSchema>;

/**
 * Formats a GeneratedAgent as a README.md string.
 */
export function formatAgentReadme(agent: GeneratedAgent): string {
  const keywordsLine = agent.keywords.join(", ");
  return `# ${agent.name}

## Domain
${agent.domain}

## Description
${agent.description}

## System Prompt
${agent.systemPrompt}

## Keywords
${keywordsLine}
`;
}
