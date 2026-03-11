import * as yaml from "js-yaml";

/**
 * Serialize structured data to a file format string.
 *
 * Supports: yaml, json, hcl, raw.
 * ini, toml fall back to raw passthrough for v1.
 */
export function serialize(data: unknown, format: string): string {
  switch (format) {
    case "yaml":
      return yaml.dump(data, { lineWidth: 120, noRefs: true });

    case "json":
      return JSON.stringify(data, null, 2) + "\n";

    case "hcl":
      if (typeof data === "string") return data;
      if (typeof data === "object" && data !== null) {
        return serializeHcl(data as Record<string, unknown>);
      }
      throw new Error(`Serializer "hcl" requires a string or object, got ${typeof data}.`);

    case "raw":
      if (typeof data === "string") return data;
      return JSON.stringify(data, null, 2) + "\n";

    // Placeholder formats — pass through raw strings only
    case "ini":
    case "toml":
      if (typeof data === "string") return data;
      throw new Error(
        `Serializer "${format}" does not support structured data. Module must return a raw string for this format.`,
      );

    default:
      throw new Error(`Unknown serializer format: ${format}`);
  }
}

/**
 * Recursive HCL serializer for structured data.
 * Produces HCL-style blocks and key-value assignments.
 */
function serializeHcl(data: Record<string, unknown>): string {
  const lines: string[] = [];
  serializeHclEntries(data, 0, lines);
  return lines.join("\n") + "\n";
}

function serializeHclEntries(obj: Record<string, unknown>, indent: number, lines: string[]): void {
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(`${pad}${key} {`);
      serializeHclEntries(value as Record<string, unknown>, indent + 1, lines);
      lines.push(`${pad}}`, "");
    } else {
      lines.push(`${pad}${key} = ${hclSerializeValue(value)}`);
    }
  }
}

function hclSerializeValue(v: unknown): string {
  if (typeof v === "string") return `"${escapeHclString(v)}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[${v.map((item) => hclSerializeValue(item)).join(", ")}]`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const inner = entries.map(([k, val]) => `${k} = ${hclSerializeValue(val)}`).join(", ");
    return `{ ${inner} }`;
  }
  return JSON.stringify(v);
}

function escapeHclString(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', String.raw`\"`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll("\t", String.raw`\t`);
}
