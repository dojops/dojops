import { ContextBlock, DopsUpdate, MarkdownSections } from "./spec";

export interface PromptContext {
  existingContent?: string;
  input?: Record<string, unknown>;
  updateConfig?: DopsUpdate;
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
    // Add preserve_structure instruction if configured
    if (context.updateConfig?.strategy === "preserve_structure") {
      prompt +=
        "\n\nIMPORTANT: Preserve the overall structure and organization of the existing configuration.";
    }
    parts.push(prompt);
  } else if (isUpdate) {
    // Fallback: use Prompt section + generic update suffix
    let prompt = substituteVariables(sections.prompt, context);
    const preserveInstruction =
      context.updateConfig?.strategy === "preserve_structure"
        ? "Preserve the overall structure and organization of the existing configuration.\n"
        : "";
    prompt +=
      "\n\nYou are UPDATING an existing configuration.\n" +
      preserveInstruction +
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

/** Maximum length for a single substituted input value (bytes). */
const MAX_INPUT_VALUE_LENGTH = 10_000;

/**
 * Sanitize a user-provided input value before substituting it into a prompt.
 * Strips invisible/control characters (keeping newlines, tabs, spaces) and
 * truncates to MAX_INPUT_VALUE_LENGTH to prevent prompt-size DoS.
 */
function sanitizeInputValue(value: string): string {
  // Strip control chars except \n (0x0A), \t (0x09), \r (0x0D)
  // Also strip zero-width chars (U+200B-U+200D, U+FEFF) and bidi overrides
  const cleaned = value.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
    "",
  );
  if (cleaned.length > MAX_INPUT_VALUE_LENGTH) {
    return cleaned.slice(0, MAX_INPUT_VALUE_LENGTH);
  }
  return cleaned;
}

/**
 * Substitute `{variableName}` placeholders in a prompt string
 * with values from the context.
 */
function substituteVariables(prompt: string, context: PromptContext): string {
  let result = prompt;

  // Substitute existing content under the configured variable name
  // existingContent is trusted (read from filesystem by readExistingConfig), not user-typed
  if (context.existingContent !== undefined) {
    const injectAs = context.updateConfig?.injectAs ?? "existingContent";
    result = result.replace(new RegExp(`\\{${injectAs}\\}`, "g"), context.existingContent);
    // Always substitute {existingContent} as fallback if injectAs differs
    if (injectAs !== "existingContent") {
      result = result.replace(/\{existingContent\}/g, context.existingContent);
    }
  }

  // Substitute {key} from input values — sanitize each value first
  if (context.input) {
    for (const [key, value] of Object.entries(context.input)) {
      if (typeof value === "string") {
        const safe = sanitizeInputValue(value);
        result = result.replace(new RegExp(`\\{${key}\\}`, "g"), safe);
      }
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════
// v2 Prompt Compiler
// ══════════════════════════════════════════════════════

export interface PromptContextV2 {
  existingContent?: string;
  updateConfig?: DopsUpdate;
  context7Docs?: string;
  projectContext?: string;
  contextBlock: ContextBlock;
}

// Note: compilePromptV2 intentionally ignores sections.updatePrompt,
// sections.constraints, and sections.examples — these are v1-only features.
// v2 uses context.bestPractices for constraints, Context7 for examples,
// and the generic update fallback for update mode.

/**
 * Compile markdown sections into an optimized LLM system prompt for v2 modules.
 *
 * v2 only uses ## Prompt + ## Keywords from markdown sections.
 * Constraints belong in context.bestPractices, examples are replaced by Context7 docs,
 * and update mode always uses the generic fallback.
 *
 * Supports v2-specific variables:
 * - {outputGuidance} — from context.outputGuidance
 * - {bestPractices} — numbered list from context.bestPractices
 * - {context7Docs} — fetched docs injected at runtime
 * - {projectContext} — repo scanner context string
 * - {existingContent} — same as v1 (for update mode)
 */
export function compilePromptV2(sections: MarkdownSections, context: PromptContextV2): string {
  const parts: string[] = [];

  // Main prompt section — always use ## Prompt with generic update fallback
  const isUpdate = !!context.existingContent;

  if (isUpdate) {
    let prompt = substituteV2Variables(sections.prompt, context);
    const preserveInstruction =
      context.updateConfig?.strategy === "preserve_structure"
        ? "Preserve the overall structure and organization of the existing configuration.\n"
        : "";
    prompt +=
      "\n\nYou are UPDATING an existing configuration.\n" +
      preserveInstruction +
      "Preserve ALL existing content unless explicitly asked to remove it.\n" +
      "Merge new content with existing.\n\n" +
      "--- EXISTING CONFIGURATION ---\n" +
      (context.existingContent ?? "") +
      "\n--- END EXISTING CONFIGURATION ---";
    parts.push(prompt);
  } else {
    parts.push(substituteV2Variables(sections.prompt, context));
  }

  return parts.join("\n");
}

/**
 * Substitute v2-specific `{variableName}` placeholders in a prompt string.
 */
function substituteV2Variables(prompt: string, context: PromptContextV2): string {
  let result = prompt;

  // {outputGuidance}
  result = result.replace(/\{outputGuidance\}/g, context.contextBlock.outputGuidance);

  // {bestPractices} — numbered list
  const bestPracticesList = context.contextBlock.bestPractices
    .map((bp, i) => `${i + 1}. ${bp}`)
    .join("\n");
  result = result.replace(/\{bestPractices\}/g, bestPracticesList);

  // {context7Docs}
  if (context.context7Docs !== undefined) {
    result = result.replace(/\{context7Docs\}/g, context.context7Docs);
  } else {
    result = result.replace(/\{context7Docs\}/g, "No additional documentation available.");
  }

  // {projectContext}
  if (context.projectContext !== undefined) {
    result = result.replace(/\{projectContext\}/g, context.projectContext);
  } else {
    result = result.replace(/\{projectContext\}/g, "No project context available.");
  }

  // {existingContent} — trusted (read from filesystem)
  if (context.existingContent !== undefined) {
    const injectAs = context.updateConfig?.injectAs ?? "existingContent";
    result = result.replace(new RegExp(`\\{${injectAs}\\}`, "g"), context.existingContent);
    if (injectAs !== "existingContent") {
      result = result.replace(/\{existingContent\}/g, context.existingContent);
    }
  }

  return result;
}
