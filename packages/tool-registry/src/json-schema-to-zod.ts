import { z, ZodTypeAny } from "zod";

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

/**
 * Converts a JSON Schema (subset) to a runtime Zod schema.
 * Supports: string, number, integer, boolean, array, object, enum, default, description, required.
 *
 * The resulting Zod schemas have proper _def.typeName, shape(), description, etc.
 * so that zodSchemaToText() in the planner can walk them correctly.
 */
export function jsonSchemaToZod(schema: JSONSchemaObject): ZodTypeAny {
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum.map(String);
    let result: ZodTypeAny = z.enum(values as [string, ...string[]]);
    if (schema.description) {
      result = result.describe(schema.description);
    }
    if (schema.default !== undefined) {
      result = result.default(schema.default);
    }
    return result;
  }

  switch (schema.type) {
    case "string": {
      let s = z.string();
      if (schema.minLength !== undefined) s = s.min(schema.minLength);
      if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
      if (schema.pattern !== undefined) s = s.regex(new RegExp(schema.pattern));
      let result: ZodTypeAny = s;
      if (schema.description) {
        result = result.describe(schema.description);
      }
      if (schema.default !== undefined) {
        result = (result as z.ZodString).default(schema.default as string);
      }
      return result;
    }

    case "number":
    case "integer": {
      let n = z.number();
      if (schema.type === "integer") n = n.int();
      if (schema.minimum !== undefined) n = n.min(schema.minimum);
      if (schema.maximum !== undefined) n = n.max(schema.maximum);
      let result: ZodTypeAny = n;
      if (schema.description) {
        result = result.describe(schema.description);
      }
      if (schema.default !== undefined) {
        result = (result as z.ZodNumber).default(schema.default as number);
      }
      return result;
    }

    case "boolean": {
      let result: ZodTypeAny = z.boolean();
      if (schema.description) {
        result = result.describe(schema.description);
      }
      if (schema.default !== undefined) {
        result = (result as z.ZodBoolean).default(schema.default as boolean);
      }
      return result;
    }

    case "array": {
      const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
      let result: ZodTypeAny = z.array(itemSchema);
      if (schema.description) {
        result = result.describe(schema.description);
      }
      if (schema.default !== undefined) {
        result = (result as z.ZodArray<ZodTypeAny>).default(schema.default as unknown[]);
      }
      return result;
    }

    case "object": {
      if (!schema.properties) {
        let result: ZodTypeAny = z.record(z.unknown());
        if (schema.description) {
          result = result.describe(schema.description);
        }
        return result;
      }

      const requiredSet = new Set(schema.required ?? []);
      const shape: Record<string, ZodTypeAny> = {};

      for (const [key, propSchema] of Object.entries(schema.properties)) {
        let field = jsonSchemaToZod(propSchema);
        if (!requiredSet.has(key) && propSchema.default === undefined) {
          field = field.optional();
        }
        shape[key] = field;
      }

      let result: ZodTypeAny = z.object(shape);
      if (schema.description) {
        result = result.describe(schema.description);
      }
      return result;
    }

    default: {
      const compositionKeys = ["allOf", "anyOf", "oneOf", "$ref"] as const;
      for (const key of compositionKeys) {
        if (key in schema) {
          throw new Error(
            `jsonSchemaToZod: "${key}" is not supported in plugin schemas. Only primitive types and object/array are supported.`,
          );
        }
      }
      return z.unknown();
    }
  }
}
