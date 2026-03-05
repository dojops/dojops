import { z } from "zod";
import { InputFieldDef } from "./spec";

// ── JSON Schema Object (extended from tool-registry) ─

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
  minItems?: number;
  maxItems?: number;
  anyOf?: JSONSchemaObject[];
  oneOf?: JSONSchemaObject[];
  format?: string;
}

/**
 * Compile input DSL fields into a Zod schema.
 * Auto-injects optional `existingContent` field.
 */
export function compileInputSchema(fields: Record<string, InputFieldDef>): z.ZodType {
  const shape: Record<string, z.ZodType> = {};

  for (const [name, field] of Object.entries(fields)) {
    shape[name] = compileInputField(field);
  }

  // Auto-inject existingContent as optional
  shape["existingContent"] = z.string().optional();

  return z.object(shape);
}

/**
 * Compile a single input field DSL definition into Zod.
 */
function compileInputField(field: InputFieldDef): z.ZodType {
  let schema: z.ZodType;

  switch (field.type) {
    case "string": {
      let s = z.string();
      if (field.minLength !== undefined) s = s.min(field.minLength);
      if (field.maxLength !== undefined) s = s.max(field.maxLength);
      if (field.pattern !== undefined) s = s.regex(new RegExp(field.pattern));
      schema = s;
      break;
    }

    case "number": {
      let n = z.number();
      if (field.min !== undefined) n = n.min(field.min);
      if (field.max !== undefined) n = n.max(field.max);
      schema = n;
      break;
    }

    case "integer": {
      let n = z.number().int();
      if (field.min !== undefined) n = n.min(field.min);
      if (field.max !== undefined) n = n.max(field.max);
      schema = n;
      break;
    }

    case "boolean":
      schema = z.boolean();
      break;

    case "enum": {
      const values = field.values ?? [];
      if (values.length === 0) {
        schema = z.string();
      } else {
        schema = z.enum(values as [string, ...string[]]);
      }
      break;
    }

    case "array": {
      const itemDef = field.items;
      const itemSchema = itemDef ? compileInputField(itemDef) : z.unknown();
      let arr = z.array(itemSchema);
      if (field.minItems !== undefined) arr = arr.min(field.minItems);
      if (field.maxItems !== undefined) arr = arr.max(field.maxItems);
      schema = arr;
      break;
    }

    case "object": {
      if (field.properties) {
        const shape: Record<string, z.ZodType> = {};
        for (const [key, propDef] of Object.entries(field.properties)) {
          shape[key] = compileInputField(propDef);
        }
        schema = z.object(shape);
      } else {
        schema = z.record(z.string(), z.unknown());
      }
      break;
    }

    default:
      schema = z.unknown();
  }

  // Apply description
  if (field.description) {
    schema = schema.describe(field.description);
  }

  // Apply default
  if (field.default !== undefined) {
    schema = schema.default(field.default);
  }

  // Make optional if not required (and no default)
  if (!field.required && field.default === undefined) {
    schema = schema.optional();
  }

  return schema;
}

/**
 * Enhanced JSON Schema to Zod conversion.
 * Supports: anyOf, oneOf (as z.union), minItems, maxItems, format validation.
 */
export function jsonSchemaToZod(schema: JSONSchemaObject): z.ZodType {
  // Handle anyOf / oneOf as union
  if (schema.anyOf && schema.anyOf.length > 0) {
    const schemas = schema.anyOf.map(jsonSchemaToZod);
    if (schemas.length === 1) return schemas[0];
    return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  if (schema.oneOf && schema.oneOf.length > 0) {
    const schemas = schema.oneOf.map(jsonSchemaToZod);
    if (schemas.length === 1) return schemas[0];
    return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  // Handle enum
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum.map(String);
    let result: z.ZodType = z.enum(values as [string, ...string[]]);
    if (schema.description) result = result.describe(schema.description);
    if (schema.default !== undefined) result = result.default(schema.default);
    return result;
  }

  switch (schema.type) {
    case "string": {
      let s = z.string();
      if (schema.minLength !== undefined) s = s.min(schema.minLength);
      if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
      if (schema.pattern !== undefined) s = s.regex(new RegExp(schema.pattern));
      if (schema.format === "email") s = s.email();
      if (schema.format === "url" || schema.format === "uri") s = s.url();
      let result: z.ZodType = s;
      if (schema.description) result = result.describe(schema.description);
      if (schema.default !== undefined)
        result = (result as z.ZodString).default(schema.default as string);
      return result;
    }

    case "number":
    case "integer": {
      let n = z.number();
      if (schema.type === "integer") n = n.int();
      if (schema.minimum !== undefined) n = n.min(schema.minimum);
      if (schema.maximum !== undefined) n = n.max(schema.maximum);
      let result: z.ZodType = n;
      if (schema.description) result = result.describe(schema.description);
      if (schema.default !== undefined)
        result = (result as z.ZodNumber).default(schema.default as number);
      return result;
    }

    case "boolean": {
      let result: z.ZodType = z.boolean();
      if (schema.description) result = result.describe(schema.description);
      if (schema.default !== undefined)
        result = (result as z.ZodBoolean).default(schema.default as boolean);
      return result;
    }

    case "array": {
      const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
      let arr = z.array(itemSchema);
      if (schema.minItems !== undefined) arr = arr.min(schema.minItems);
      if (schema.maxItems !== undefined) arr = arr.max(schema.maxItems);
      let result: z.ZodType = arr;
      if (schema.description) result = result.describe(schema.description);
      if (schema.default !== undefined)
        result = (result as z.ZodArray<z.ZodType>).default(schema.default as unknown[]);
      return result;
    }

    case "object": {
      if (!schema.properties) {
        let result: z.ZodType = z.record(z.string(), z.unknown());
        if (schema.description) result = result.describe(schema.description);
        return result;
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

      let result: z.ZodType = z.object(shape);
      if (schema.description) result = result.describe(schema.description);
      return result;
    }

    default:
      return z.unknown();
  }
}

/**
 * Compile an output schema (JSON Schema in YAML) to Zod.
 */
export function compileOutputSchema(schema: Record<string, unknown>): z.ZodType {
  return jsonSchemaToZod(schema as JSONSchemaObject);
}
