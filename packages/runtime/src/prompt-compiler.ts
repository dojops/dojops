import { ContextBlock, DopsUpdate, MarkdownSections } from "./spec";

export interface PromptContextV2 {
  existingContent?: string;
  updateConfig?: DopsUpdate;
  context7Docs?: string;
  projectContext?: string;
  contextBlock: ContextBlock;
}

/**
 * Wrap content in XML-like delimiters so the LLM treats it as data, not instructions.
 * Mirrors @dojops/core/sanitizer's wrapAsData but avoids cross-package import.
 */
function wrapAsData(content: string, label: string): string {
  return `<data label="${label}">\n${content}\n</data>`;
}

/**
 * Build a chain-of-thought reasoning section injected into every compiled prompt.
 * Gives the LLM ordered steps to follow before generating output.
 */
function buildReasoningSection(technology: string, isUpdate: boolean): string {
  const steps = isUpdate
    ? [
        `1. **Analyze** the existing ${technology} configuration — identify its structure, patterns, and conventions.`,
        `2. **Identify** what the user wants changed — new additions, modifications, or removals.`,
        `3. **Plan** the minimal set of changes that achieves the goal while preserving existing content.`,
        `4. **Generate** the updated configuration, keeping all unchanged sections intact.`,
        `5. **Verify** the output against the format rules and best practices above before responding.`,
      ]
    : [
        `1. **Analyze** the user's request — identify the concrete deliverables and requirements.`,
        `2. **Detect** the project type and technology stack from the project context.`,
        `3. **Choose** the appropriate ${technology} patterns and structure for this use case.`,
        `4. **Generate** the complete configuration following the output format rules above.`,
        `5. **Verify** the output against the format rules and best practices above before responding.`,
      ];

  return "\n\nBefore generating output, follow these reasoning steps:\n" + steps.join("\n");
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
      buildReasoningSection(context.contextBlock.technology, true) +
      "\n\nYou are UPDATING an existing configuration.\n" +
      preserveInstruction +
      "Preserve ALL existing content unless explicitly asked to remove it.\n" +
      "Merge new content with existing.\n\n" +
      wrapAsData(context.existingContent ?? "", "existing-config");
    parts.push(prompt);
  } else {
    let prompt = substituteV2Variables(sections.prompt, context);
    prompt += buildReasoningSection(context.contextBlock.technology, false);
    parts.push(prompt);
  }

  return parts.join("\n");
}

/**
 * Substitute v2-specific `{variableName}` placeholders in a prompt string.
 */
function substituteV2Variables(prompt: string, context: PromptContextV2): string {
  let result = prompt;

  // Substitute outputGuidance placeholder
  result = result.replaceAll("{outputGuidance}", context.contextBlock.outputGuidance);

  // Substitute bestPractices placeholder with numbered list
  const bestPracticesList = context.contextBlock.bestPractices
    .map((bp, i) => `${i + 1}. ${bp}`)
    .join("\n");
  result = result.replaceAll("{bestPractices}", bestPracticesList);

  // Substitute context7Docs placeholder — wrap as data to prevent injection from external docs
  if (context.context7Docs === undefined) {
    result = result.replaceAll("{context7Docs}", "No additional documentation available.");
  } else {
    result = result.replaceAll(
      "{context7Docs}",
      wrapAsData(context.context7Docs, "reference-docs"),
    );
  }

  // Substitute projectContext placeholder — wrap as data (scanned from filesystem)
  if (context.projectContext === undefined) {
    result = result.replaceAll("{projectContext}", "No project context available.");
  } else {
    result = result.replaceAll(
      "{projectContext}",
      wrapAsData(context.projectContext, "project-context"),
    );
  }

  // {existingContent} — wrap as data so the LLM treats it as content to process, not instructions
  if (context.existingContent !== undefined) {
    const wrapped = wrapAsData(context.existingContent, "existing-config");
    const injectAs = context.updateConfig?.injectAs ?? "existingContent";
    result = result.replaceAll(`{${injectAs}}`, wrapped);
    if (injectAs !== "existingContent") {
      result = result.replaceAll("{existingContent}", wrapped);
    }
  }

  return result;
}
