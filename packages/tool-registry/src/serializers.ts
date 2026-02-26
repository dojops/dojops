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

    // Placeholder formats — pass through strings, warn on structured data
    case "hcl":
    case "ini":
    case "toml":
      if (typeof data === "string") return data;
      console.warn(
        `[dojops] Warning: ${format} serializer received structured data but native ${format} serialization is not yet implemented. Falling back to JSON output.`,
      );
      return JSON.stringify(data, null, 2) + "\n";

    default:
      throw new Error(`Unknown serializer format: ${format}`);
  }
}
