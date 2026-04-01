/**
 * Skill pack manifest (pack.json).
 *
 * A pack bundles .dops skills, agent definitions, and optional hooks
 * into a single installable unit. Packs live at:
 * - Global: ~/.dojops/packs/<name>/
 * - Project: .dojops/packs/<name>/
 */
export interface PackManifest {
  /** Pack format version (currently "1"). */
  packVersion: "1";
  /** Unique pack name (lowercase, kebab-case). */
  name: string;
  /** Human-readable display name. */
  displayName?: string;
  /** Short description of what this pack provides. */
  description: string;
  /** Semver version string. */
  version: string;
  /** Pack author or organization. */
  author?: string;
  /** Minimum DojOps CLI version required. */
  minCliVersion?: string;
  /** Skill files included (relative paths from pack root). */
  skills: string[];
  /** Agent directories included (relative paths from pack root). */
  agents: string[];
  /** Optional hook definitions. */
  hooks?: PackHook[];
  /** SHA-256 hash of the pack archive (set during publish). */
  sha256?: string;
}

export interface PackHook {
  /** Hook event (e.g., "pre-execute", "post-generate"). */
  event: string;
  /** Command to run. */
  command: string;
}

export interface InstalledPack {
  manifest: PackManifest;
  /** Absolute path to the pack directory. */
  packDir: string;
  /** Where the pack was installed from. */
  location: "global" | "project";
}
