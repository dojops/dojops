import * as yaml from "js-yaml";

export interface SerializerOptions {
  mapAttributes?: string[];
  keyOrder?: string[];
  sortKeys?: boolean | ((a: string, b: string) => number);
  lineWidth?: number;
  noRefs?: boolean;
  indent?: number;
  multiDocument?: boolean;
}

/**
 * Unified serializer: converts structured data to a file-format string.
 */
export function serialize(data: unknown, format: string, options?: SerializerOptions): string {
  switch (format) {
    case "yaml":
      return serializeYaml(data, options);

    case "json":
      return serializeJson(data, options);

    case "hcl":
      return serializeHcl(data, options);

    case "raw":
      if (typeof data === "string") return data;
      return JSON.stringify(data, null, 2) + "\n";

    case "ini":
    case "toml":
      if (typeof data === "string") return data;
      throw new Error(
        `Serializer "${format}" does not support structured data. Tool must return a raw string.`,
      );

    default:
      throw new Error(`Unknown serializer format: ${format}`);
  }
}

// ── YAML Serializer ──────────────────────────────────

function serializeYaml(data: unknown, options?: SerializerOptions): string {
  if (options?.multiDocument && Array.isArray(data)) {
    return data.map((item) => serializeSingleYaml(item, options)).join("---\n");
  }
  return serializeSingleYaml(data, options);
}

function serializeSingleYaml(data: unknown, options?: SerializerOptions): string {
  const sortKeys = buildYamlSortKeys(options);

  return yaml.dump(data, {
    lineWidth: options?.lineWidth ?? 120,
    noRefs: options?.noRefs ?? true,
    sortKeys,
  });
}

function buildYamlSortKeys(
  options?: SerializerOptions,
): boolean | ((a: string, b: string) => number) {
  if (!options) return true;

  // If a custom sort function is provided, use it
  if (typeof options.sortKeys === "function") return options.sortKeys;

  // If keyOrder is provided, build a custom sort function
  if (options.keyOrder && options.keyOrder.length > 0) {
    const order = options.keyOrder;
    return (a: string, b: string): number => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    };
  }

  // Default: alphabetical sort
  return options.sortKeys ?? true;
}

// ── JSON Serializer ──────────────────────────────────

function serializeJson(data: unknown, options?: SerializerOptions): string {
  const indent = options?.indent ?? 2;
  return JSON.stringify(data, null, indent) + "\n";
}

// ── HCL Serializer (with mapAttributes support) ──────

const DEFAULT_MAP_ATTRIBUTES = new Set([
  "tags",
  "labels",
  "annotations",
  "metadata",
  "variables",
  "environment",
  "default_tags",
]);

function serializeHcl(data: unknown, options?: SerializerOptions): string {
  if (typeof data === "string") return data;
  if (typeof data !== "object" || data === null) {
    throw new Error(`Serializer "hcl" requires a string or object, got ${typeof data}`);
  }

  const mapAttrs = options?.mapAttributes ? new Set(options.mapAttributes) : DEFAULT_MAP_ATTRIBUTES;

  const lines: string[] = [];
  serializeHclEntries(data as Record<string, unknown>, 0, lines, mapAttrs);
  return lines.join("\n") + "\n";
}

function serializeHclEntries(
  obj: Record<string, unknown>,
  indent: number,
  lines: string[],
  mapAttrs: Set<string>,
): void {
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      if (mapAttrs.has(key)) {
        lines.push(`${pad}${key} = ${hclMap(value as Record<string, unknown>, indent, mapAttrs)}`);
      } else {
        lines.push(`${pad}${key} {`);
        serializeHclEntries(value as Record<string, unknown>, indent + 1, lines, mapAttrs);
        lines.push(`${pad}}`);
        lines.push("");
      }
    } else {
      lines.push(`${pad}${key} = ${hclValue(value, indent, mapAttrs)}`);
    }
  }
}

function hclValue(v: unknown, indent: number, mapAttrs: Set<string>): string {
  if (typeof v === "string") return `"${escapeHclString(v)}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[${v.map((item) => hclValue(item, indent, mapAttrs)).join(", ")}]`;
  }
  if (typeof v === "object") {
    return hclBlock(v as Record<string, unknown>, indent, mapAttrs);
  }
  return JSON.stringify(v);
}

function hclBlock(obj: Record<string, unknown>, indent: number, mapAttrs: Set<string>): string {
  const pad = " ".repeat(indent * 2);
  const lines: string[] = ["{"];
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      if (mapAttrs.has(key)) {
        lines.push(
          `${pad}  ${key} = ${hclMap(val as Record<string, unknown>, indent + 1, mapAttrs)}`,
        );
      } else {
        lines.push(
          `${pad}  ${key} ${hclBlock(val as Record<string, unknown>, indent + 1, mapAttrs)}`,
        );
      }
    } else {
      lines.push(`${pad}  ${key} = ${hclValue(val, indent + 1, mapAttrs)}`);
    }
  }
  lines.push(`${pad}}`);
  return lines.join("\n");
}

function hclMap(obj: Record<string, unknown>, indent: number, mapAttrs: Set<string>): string {
  const pad = " ".repeat(indent * 2);
  const entries = Object.entries(obj);
  if (entries.length === 0) return "{}";
  const lines: string[] = ["{"];
  for (const [key, val] of entries) {
    lines.push(`${pad}  ${key} = ${hclValue(val, indent + 1, mapAttrs)}`);
  }
  lines.push(`${pad}}`);
  return lines.join("\n");
}

function escapeHclString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
