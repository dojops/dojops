import { z } from "zod";

export interface JSONSchemaObject {
  type?: string;
  properties?: Record<string, JSONSchemaObject>;
  required?: string[];
  items?: JSONSchemaObject;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

function isQuantifier(ch: string): boolean {
  return ch === "+" || ch === "*" || ch === "{";
}

function hasAdjacentQuantifiers(pattern: string): boolean {
  for (let i = 1; i < pattern.length; i++) {
    const prev = pattern[i - 1];
    const cur = pattern[i];
    if ((prev === "+" || prev === "*" || prev === "}") && isQuantifier(cur)) {
      return true;
    }
    if (
      i >= 2 &&
      prev === "?" &&
      (pattern[i - 2] === "+" || pattern[i - 2] === "*") &&
      isQuantifier(cur)
    ) {
      return true;
    }
  }
  return false;
}

function hasGroupQuantifierNesting(pattern: string): boolean {
  let depth = 0;
  let groupHasQuantifier = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "(" && pattern[i - 1] !== "\\") {
      depth++;
      groupHasQuantifier = false;
    } else if (pattern[i] === ")" && pattern[i - 1] !== "\\") {
      if (groupHasQuantifier && i + 1 < pattern.length && isQuantifier(pattern[i + 1])) {
        return true;
      }
      depth--;
    } else if (depth > 0 && (pattern[i] === "+" || pattern[i] === "*")) {
      groupHasQuantifier = true;
    }
  }
  return false;
}

/** @internal exported for testing */
export function hasNestedQuantifiers(pattern: string): boolean {
  return hasAdjacentQuantifiers(pattern) || hasGroupQuantifierNesting(pattern);
}

/** @internal exported for testing */
export function safeRegex(pattern: string): RegExp {
  if (hasNestedQuantifiers(pattern)) {
    throw new Error(`Potentially unsafe regex pattern rejected: "${pattern}"`);
  }
  try {
    return new RegExp(pattern); // NOSONAR — S5852: pattern validated by hasNestedQuantifiers guard
  } catch {
    throw new Error(`Invalid regex pattern: "${pattern}"`);
  }
}

/** Applies optional description and default to a Zod schema. */
function applyDescriptionAndDefault(
  result: z.ZodType,
  schema: JSONSchemaObject,
  defaultCast?: (result: z.ZodType, value: unknown) => z.ZodType,
): z.ZodType {
  if (schema.description) {
    result = result.describe(schema.description);
  }
  if (schema.default !== undefined && defaultCast) {
    result = defaultCast(result, schema.default);
  }
  return result;
}

function handleEnumType(schema: JSONSchemaObject): z.ZodType {
  const values = schema.enum!.map(String);
  return applyDescriptionAndDefault(z.enum(values as [string, ...string[]]), schema, (r, v) =>
    r.default(v),
  );
}

function handleStringType(schema: JSONSchemaObject): z.ZodType {
  let s = z.string();
  if (schema.minLength !== undefined) s = s.min(schema.minLength);
  if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
  if (schema.pattern !== undefined) s = s.regex(safeRegex(schema.pattern));
  return applyDescriptionAndDefault(s, schema, (r, v) => (r as z.ZodString).default(v as string));
}

function handleNumberType(schema: JSONSchemaObject): z.ZodType {
  let n = z.number();
  if (schema.type === "integer") n = n.int();
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  return applyDescriptionAndDefault(n, schema, (r, v) => (r as z.ZodNumber).default(v as number));
}

function handleBooleanType(schema: JSONSchemaObject): z.ZodType {
  return applyDescriptionAndDefault(z.boolean(), schema, (r, v) =>
    (r as z.ZodBoolean).default(v as boolean),
  );
}

function handleArrayType(schema: JSONSchemaObject): z.ZodType {
  const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
  return applyDescriptionAndDefault(z.array(itemSchema), schema, (r, v) =>
    (r as z.ZodArray<z.ZodType>).default(v as unknown[]),
  );
}

function handleObjectType(schema: JSONSchemaObject): z.ZodType {
  if (!schema.properties) {
    return applyDescriptionAndDefault(z.record(z.string(), z.unknown()), schema);
  }

  const requiredSet = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    let field = jsonSchemaToZod(propSchema);
    if (!requiredSet.has(key) && propSchema.default === undefined) {
      field = field.optional();
    }
    shape[key] = field;
  }

  return applyDescriptionAndDefault(z.object(shape), schema);
}

function handleDefaultType(schema: JSONSchemaObject): z.ZodType {
  const compositionKeys = ["allOf", "anyOf", "oneOf", "$ref"] as const;
  for (const key of compositionKeys) {
    if (key in schema) {
      console.warn("jsonSchemaToZod: unsupported feature: " + key);
      return z.unknown();
    }
  }
  return z.unknown();
}

/** Type-to-handler dispatch map. */
const typeHandlers: Record<string, (schema: JSONSchemaObject) => z.ZodType> = {
  string: handleStringType,
  number: handleNumberType,
  integer: handleNumberType,
  boolean: handleBooleanType,
  array: handleArrayType,
  object: handleObjectType,
};

/**
 * Converts a JSON Schema (subset) to a runtime Zod schema.
 * Supports: string, number, integer, boolean, array, object, enum, default, description, required.
 *
 * The resulting Zod schemas have proper _def.typeName, shape(), description, etc.
 * so that zodSchemaToText() in the planner can walk them correctly.
 */
export function jsonSchemaToZod(schema: JSONSchemaObject): z.ZodType {
  if (schema.enum && schema.enum.length > 0) {
    return handleEnumType(schema);
  }

  const handler = schema.type ? typeHandlers[schema.type] : undefined;
  return handler ? handler(schema) : handleDefaultType(schema);
}
