import { MarkdownSections } from "./spec";

export interface PromptContext {
  existingContent?: string;
  input?: Record<string, unknown>;
}

/**
 * Compile markdown sections into an optimized LLM system prompt.
 *
 * In update mode (existingContent present), uses ## Update Prompt if available,
 * otherwise falls back to ## Prompt with a generic update suffix.
 *
 * Appends ## Constraints as numbered rules and ## Examples as structured examples.
 */
export function compilePrompt(sections: MarkdownSections, context: PromptContext): string {
  const parts: string[] = [];

  // 1. Main prompt section
  const isUpdate = !!context.existingContent;

  if (isUpdate && sections.updatePrompt) {
    let prompt = sections.updatePrompt;
    prompt = substituteVariables(prompt, context);
    parts.push(prompt);
  } else if (isUpdate) {
    // Fallback: use Prompt section + generic update suffix
    let prompt = substituteVariables(sections.prompt, context);
    prompt +=
      "\n\nYou are UPDATING an existing configuration.\n" +
      "Preserve ALL existing content unless explicitly asked to remove it.\n" +
      "Merge new content with existing.\n\n" +
      "--- EXISTING CONFIGURATION ---\n" +
      (context.existingContent ?? "") +
      "\n--- END EXISTING CONFIGURATION ---";
    parts.push(prompt);
  } else {
    parts.push(substituteVariables(sections.prompt, context));
  }

  // 2. Constraints section
  if (sections.constraints) {
    const constraintLines = sections.constraints
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0);

    if (constraintLines.length > 0) {
      parts.push("\nCONSTRAINTS:");
      constraintLines.forEach((line, i) => {
        parts.push(`${i + 1}. ${line}`);
      });
    }
  }

  // 3. Examples section
  if (sections.examples) {
    parts.push("\nEXAMPLES:");
    parts.push(sections.examples);
  }

  return parts.join("\n");
}

/**
 * Substitute `{variableName}` placeholders in a prompt string
 * with values from the context.
 */
function substituteVariables(prompt: string, context: PromptContext): string {
  let result = prompt;

  // Substitute {existingContent} if present
  if (context.existingContent !== undefined) {
    result = result.replace(/\{existingContent\}/g, context.existingContent);
  }

  // Substitute {key} from input values
  if (context.input) {
    for (const [key, value] of Object.entries(context.input)) {
      if (typeof value === "string") {
        result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
      }
    }
  }

  return result;
}
