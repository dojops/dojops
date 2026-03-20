import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot, initProject } from "../state";
import { encrypt, decrypt, isEncrypted } from "../vault";

const SECRETS_FILENAME = "secrets.json";

function secretsPath(rootDir: string): string {
  return path.join(rootDir, ".dojops", SECRETS_FILENAME);
}

function loadSecrets(rootDir: string): Record<string, string> {
  const fp = secretsPath(rootDir);
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return {};
  }
}

function saveSecrets(rootDir: string, secrets: Record<string, string>): void {
  const dir = path.join(rootDir, ".dojops");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(secretsPath(rootDir), JSON.stringify(secrets, null, 2), {
    encoding: "utf-8",
    mode: 0o600, // NOSONAR — restrictive permissions for secrets
  });
}

function handleSet(args: string[], rootDir: string, ctx: CLIContext): void {
  const name = args[0];
  const value = args.slice(1).join(" ");
  if (!name || !value) {
    throw new Error("Usage: dojops secrets set <name> <value>");
  }

  const secrets = loadSecrets(rootDir);
  secrets[name] = encrypt(value);
  saveSecrets(rootDir, secrets);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ name, stored: true }));
    return;
  }
  p.log.success(`Secret ${pc.cyan(name)} stored (AES-256-GCM encrypted)`);
}

function handleList(rootDir: string, ctx: CLIContext): void {
  const secrets = loadSecrets(rootDir);
  const names = Object.keys(secrets);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ secrets: names }));
    return;
  }

  if (names.length === 0) {
    p.log.info("No secrets stored. Use `dojops secrets set <name> <value>` to add one.");
    return;
  }

  const lines = names.map((name) => {
    const encrypted = isEncrypted(secrets[name]);
    const status = encrypted ? pc.green("encrypted") : pc.yellow("plaintext");
    return `  ${pc.cyan(name)}  ${pc.dim(status)}`;
  });
  p.note(lines.join("\n"), `Secrets (${names.length})`);
}

function handleGet(args: string[], rootDir: string, ctx: CLIContext): void {
  const name = args[0];
  if (!name) {
    throw new Error("Usage: dojops secrets get <name>");
  }

  const secrets = loadSecrets(rootDir);
  if (!(name in secrets)) {
    throw new Error(`Secret "${name}" not found.`);
  }

  const value = decrypt(secrets[name]);
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ name, value }));
    return;
  }
  // Show masked by default; raw output shows the full value
  if (ctx.globalOpts.raw) {
    process.stdout.write(value + "\n");
  } else {
    const masked = value.slice(0, 4) + "…" + value.slice(-4);
    p.log.info(`${pc.cyan(name)} = ${pc.dim(masked)}`);
    p.log.info(pc.dim("Use --raw to show the full value."));
  }
}

function handleRemove(args: string[], rootDir: string, ctx: CLIContext): void {
  const name = args[0];
  if (!name) {
    throw new Error("Usage: dojops secrets remove <name>");
  }

  const secrets = loadSecrets(rootDir);
  if (!(name in secrets)) {
    p.log.info(`Secret "${name}" not found.`);
    return;
  }

  delete secrets[name];
  saveSecrets(rootDir, secrets);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ name, removed: true }));
    return;
  }
  p.log.success(`Removed secret ${pc.cyan(name)}`);
}

export async function secretsCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot() ?? ctx.cwd;
  if (!findProjectRoot()) initProject(root);

  const sub = args[0] ?? "list";
  const rest = args.slice(1);

  switch (sub) {
    case "set":
      handleSet(rest, root, ctx);
      break;
    case "get":
      handleGet(rest, root, ctx);
      break;
    case "list":
      handleList(root, ctx);
      break;
    case "remove":
    case "rm":
      handleRemove(rest, root, ctx);
      break;
    default:
      throw new Error(`Unknown secrets subcommand: "${sub}". Available: set, get, list, remove`);
  }
}
