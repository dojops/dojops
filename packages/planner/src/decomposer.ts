import { LLMProvider } from "@odaops/core";
import { DevOpsTool } from "@odaops/sdk";
import { TaskGraph, TaskGraphSchema } from "./types";
import { zodSchemaToText } from "./schema-to-text";

export async function decompose(
  goal: string,
  provider: LLMProvider,
  tools: DevOpsTool[],
): Promise<TaskGraph> {
  const toolList = tools
    .map((t) => {
      const schemaText = zodSchemaToText(t.inputSchema);
      return `### ${t.name}\n${t.description}\nInput fields:\n${schemaText}`;
    })
    .join("\n\n");

  const response = await provider.generate({
    system: `You are a DevOps task planner. Break down goals into tasks using available tools.

Available tools:

${toolList}

IMPORTANT: Each task's "input" object MUST match the tool's input fields exactly. Use the correct field names, types, and provide all required fields. Do not invent fields that are not listed.

Respond with a JSON object matching this structure:
{
  "goal": "the original goal",
  "tasks": [
    {
      "id": "unique-id",
      "tool": "tool-name",
      "description": "what this task does",
      "dependsOn": ["id-of-dependency"],
      "input": { "key": "value or $ref:task-id for output from another task" }
    }
  ]
}

Do NOT ask follow-up questions. Provide the complete task graph only.`,
    prompt: goal,
    schema: TaskGraphSchema,
  });

  return response.parsed as TaskGraph;
}
