import * as yaml from "js-yaml";

/**
 * Serialize structured data to a file format string.
 *
 * Supports: yaml, json, raw.
 * hcl, ini, toml fall back to raw passthrough for v1.
 */
export function serialize(data: unknown, format: string): string {
  switch (format) {
    case "yaml":
      return yaml.dump(data, { lineWidth: 120, noRefs: true });

    case "json":
      return JSON.stringify(data, null, 2) + "\n";

    case "raw":
      if (typeof data === "string") return data;
      return JSON.stringify(data, null, 2) + "\n";

    // Placeholder formats — pass through raw strings only
    case "hcl":
    case "ini":
    case "toml":
      if (typeof data === "string") return data;
      throw new Error(
        `Serializer "${format}" does not support structured data in v1. Plugin must return a raw string for this format.`,
      );

    default:
      throw new Error(`Unknown serializer format: ${format}`);
  }
}
