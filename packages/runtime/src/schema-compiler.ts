import { z } from "zod";
import { InputFieldDef } from "./spec";

// ── ReDoS guard ──────────────────────────────────────────────

/**
 * Validates and constructs a RegExp from a pattern string.
 * Rejects patterns with nested quantifiers (common ReDoS vectors).
 */
function hasNestedQuantifiers(pattern: string): boolean {
  // Check for adjacent quantifiers like a++, a**, a*+, a{2}+
  for (let i = 1; i < pattern.length; i++) {
    const prev = pattern[i - 1];
    const cur = pattern[i];
    if (
      (prev === "+" || prev === "*" || prev === "}") &&
      (cur === "+" || cur === "*" || cur === "{")
    ) {
      return true;
    }
    // Also check for optional marker: a+?+ or a*?*
    if (
      i >= 2 &&
      pattern[i - 1] === "?" &&
      (pattern[i - 2] === "+" || pattern[i - 2] === "*") &&
      (cur === "+" || cur === "*" || cur === "{")
    ) {
      return true;
    }
  }
  // Check for grouped quantifiers like (a+)+, (a*)* via depth tracking
  let depth = 0;
  let groupHasQuantifier = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "(" && pattern[i - 1] !== "\\") {
      depth++;
      groupHasQuantifier = false;
    } else if (pattern[i] === ")" && pattern[i - 1] !== "\\") {
      if (groupHasQuantifier && i + 1 < pattern.length) {
        const next = pattern[i + 1];
        if (next === "+" || next === "*" || next === "{") return true;
      }
      depth--;
    } else if (depth > 0 && (pattern[i] === "+" || pattern[i] === "*")) {
      groupHasQuantifier = true;
    }
  }
  return false;
}

function safeRegex(pattern: string): RegExp {
  if (hasNestedQuantifiers(pattern)) {
    throw new Error(`Potentially unsafe regex pattern rejected: "${pattern}"`);
  }
  try {
    return new RegExp(pattern); // NOSONAR — S5852: pattern validated by nested quantifier guard above
  } catch {
    throw new Error(`Invalid regex pattern: "${pattern}"`);
  }
}

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

// ── Input field type compilers ────────────────────────────────

function compileStringField(field: InputFieldDef): z.ZodType {
  let s = z.string();
  if (field.minLength !== undefined) s = s.min(field.minLength);
  if (field.maxLength !== undefined) s = s.max(field.maxLength);
  if (field.pattern !== undefined) s = s.regex(safeRegex(field.pattern));
  return s;
}

function compileNumberField(field: InputFieldDef, isInteger: boolean): z.ZodType {
  let n = isInteger ? z.number().int() : z.number();
  if (field.min !== undefined) n = n.min(field.min);
  if (field.max !== undefined) n = n.max(field.max);
  return n;
}

function compileEnumField(field: InputFieldDef): z.ZodType {
  const values = field.values ?? [];
  return values.length === 0 ? z.string() : z.enum(values as [string, ...string[]]);
}

function compileArrayField(field: InputFieldDef): z.ZodType {
  const itemSchema = field.items ? compileInputField(field.items) : z.unknown();
  let arr = z.array(itemSchema);
  if (field.minItems !== undefined) arr = arr.min(field.minItems);
  if (field.maxItems !== undefined) arr = arr.max(field.maxItems);
  return arr;
}

function compileObjectField(field: InputFieldDef): z.ZodType {
  if (!field.properties) return z.record(z.string(), z.unknown());
  const shape: Record<string, z.ZodType> = {};
  for (const [key, propDef] of Object.entries(field.properties)) {
    shape[key] = compileInputField(propDef);
  }
  return z.object(shape);
}

/** Dispatch map for input field type → Zod compiler. */
const inputFieldCompilers: Record<string, (field: InputFieldDef) => z.ZodType> = {
  string: compileStringField,
  number: (f) => compileNumberField(f, false),
  integer: (f) => compileNumberField(f, true),
  boolean: () => z.boolean(),
  enum: compileEnumField,
  array: compileArrayField,
  object: compileObjectField,
};

/** Apply meta (description, default, optional) to a compiled schema. */
function applyFieldMeta(schema: z.ZodType, field: InputFieldDef): z.ZodType {
  let result = schema;
  if (field.description) result = result.describe(field.description);
  if (field.default !== undefined) result = result.default(field.default);
  if (!field.required && field.default === undefined) result = result.optional();
  return result;
}

/**
 * Compile a single input field DSL definition into Zod.
 */
function compileInputField(field: InputFieldDef): z.ZodType {
  const compiler = inputFieldCompilers[field.type];
  const schema = compiler ? compiler(field) : z.unknown();
  return applyFieldMeta(schema, field);
}

// ── jsonSchemaToZod handler helpers ──────────────────────────

/**
 * Apply description and default to a Zod schema.
 */
function applyMeta(base: z.ZodType, schema: JSONSchemaObject): z.ZodType {
  let result = base;
  if (schema.description) result = result.describe(schema.description);
  if (schema.default !== undefined) result = result.default(schema.default);
  return result;
}

/**
 * Convert an anyOf / oneOf array into a Zod union (or single schema).
 */
function handleUnionSchema(variants: JSONSchemaObject[]): z.ZodType {
  const schemas = variants.map(jsonSchemaToZod);
  if (schemas.length === 1) return schemas[0];
  return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

/**
 * Convert a JSON Schema enum into a Zod enum.
 */
function handleEnumSchema(schema: JSONSchemaObject): z.ZodType {
  const values = (schema.enum as unknown[]).map(String);
  return applyMeta(z.enum(values as [string, ...string[]]), schema);
}

/**
 * Convert a JSON Schema string type into a Zod string.
 */
function handleStringSchema(schema: JSONSchemaObject): z.ZodType {
  let s = z.string();
  if (schema.minLength !== undefined) s = s.min(schema.minLength);
  if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
  if (schema.pattern !== undefined) s = s.regex(safeRegex(schema.pattern));
  if (schema.format === "email") s = s.email();
  if (schema.format === "url" || schema.format === "uri") s = s.url();
  return applyMeta(s, schema);
}

/**
 * Convert a JSON Schema number/integer type into a Zod number.
 */
function handleNumberSchema(schema: JSONSchemaObject): z.ZodType {
  let n = z.number();
  if (schema.type === "integer") n = n.int();
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  return applyMeta(n, schema);
}

/**
 * Convert a JSON Schema boolean type into a Zod boolean.
 */
function handleBooleanSchema(schema: JSONSchemaObject): z.ZodType {
  return applyMeta(z.boolean(), schema);
}

/**
 * Convert a JSON Schema array type into a Zod array.
 */
function handleArraySchema(schema: JSONSchemaObject): z.ZodType {
  const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
  let arr = z.array(itemSchema);
  if (schema.minItems !== undefined) arr = arr.min(schema.minItems);
  if (schema.maxItems !== undefined) arr = arr.max(schema.maxItems);
  return applyMeta(arr, schema);
}

/**
 * Convert a JSON Schema object type into a Zod object or record.
 */
function handleObjectSchema(schema: JSONSchemaObject): z.ZodType {
  if (!schema.properties) {
    return applyMeta(z.record(z.string(), z.unknown()), schema);
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

  return applyMeta(z.object(shape), schema);
}

// ── Type-to-handler dispatch map ─────────────────────────────

const typeHandlers: Record<string, (schema: JSONSchemaObject) => z.ZodType> = {
  string: handleStringSchema,
  number: handleNumberSchema,
  integer: handleNumberSchema,
  boolean: handleBooleanSchema,
  array: handleArraySchema,
  object: handleObjectSchema,
};

/**
 * Enhanced JSON Schema to Zod conversion.
 * Supports: anyOf, oneOf (as z.union), minItems, maxItems, format validation.
 */
export function jsonSchemaToZod(schema: JSONSchemaObject): z.ZodType {
  // Handle anyOf / oneOf as union
  if (schema.anyOf && schema.anyOf.length > 0) return handleUnionSchema(schema.anyOf);
  if (schema.oneOf && schema.oneOf.length > 0) return handleUnionSchema(schema.oneOf);

  // Handle enum (type-independent)
  if (schema.enum && schema.enum.length > 0) return handleEnumSchema(schema);

  // Dispatch by type
  const handler = schema.type ? typeHandlers[schema.type] : undefined;
  if (handler) return handler(schema);

  return z.unknown();
}

/**
 * Compile an output schema (JSON Schema in YAML) to Zod.
 */
export function compileOutputSchema(schema: Record<string, unknown>): z.ZodType {
  return jsonSchemaToZod(schema as JSONSchemaObject);
}
