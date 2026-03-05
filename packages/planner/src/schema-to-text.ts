import { z } from "zod";

interface JSONSchemaProperty {
  type?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

interface JSONSchemaObject {
  type?: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  enum?: string[];
  items?: JSONSchemaProperty;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * Converts a Zod schema into a human-readable string for LLM prompts.
 * Uses z.toJSONSchema() (Zod 4) to avoid walking internal Zod structures.
 */
export function zodSchemaToText(schema: z.ZodType): string {
  let jsonSchema: JSONSchemaObject;
  try {
    jsonSchema = z.toJSONSchema(schema) as JSONSchemaObject;
  } catch {
    return "(no schema)";
  }

  // Handle object schemas — the main case for tool input schemas
  if (jsonSchema.type === "object" && jsonSchema.properties) {
    const requiredSet = new Set(jsonSchema.required ?? []);
    const lines: string[] = [];

    for (const [key, prop] of Object.entries(jsonSchema.properties)) {
      lines.push(describeField(key, prop, requiredSet.has(key)));
    }

    return lines.join("\n");
  }

  // Fallback for non-object schemas
  return describeTypeFromJsonSchema(jsonSchema);
}

function describeField(name: string, prop: JSONSchemaProperty, isRequired: boolean): string {
  const hasDefault = prop.default !== undefined;
  const typeStr = describeTypeFromJsonSchema(prop);
  const description = prop.description;

  const parts = [name];
  parts.push(` (${typeStr}`);

  if (hasDefault) {
    parts.push(`, optional, default: ${JSON.stringify(prop.default)}`);
  } else if (isRequired) {
    parts.push(", required");
  } else {
    parts.push(", optional");
  }

  parts.push(")");

  if (description) {
    parts.push(` - ${description}`);
  }

  return parts.join("");
}

function describeTypeFromJsonSchema(schema: JSONSchemaProperty): string {
  if (schema.enum) {
    return schema.enum.map((v) => `"${v}"`).join(" | ");
  }

  switch (schema.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      if (schema.items) {
        return `array of ${describeTypeFromJsonSchema(schema.items)}`;
      }
      return "array";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}
