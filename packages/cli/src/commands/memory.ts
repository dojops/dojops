import * as p from "@clack/prompts";
import pc from "picocolors";
import { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import {
  addNote,
  listNotes,
  removeNote,
  searchNotes,
  listErrorPatterns,
  loadMemoryConfig,
  saveMemoryConfig,
  NoteRecord,
} from "../memory";
import { extractFlagValue, hasFlag, stripFlags } from "../parser";

function getRoot(): string {
  const root = findProjectRoot();
  if (!root) throw new Error("Not inside a project. Run `dojops init` first.");
  return root;
}

function formatNote(note: NoteRecord): string {
  const cat = note.category === "general" ? "" : pc.dim(` [${note.category}]`);
  const date = note.timestamp.slice(0, 10);
  const idLabel = pc.cyan(`#${note.id}`);
  return `${idLabel} ${pc.dim(date)}${cat}  ${note.content}`;
}

function handleList(args: string[], ctx: CLIContext): void {
  const rootDir = getRoot();
  const category = extractFlagValue(args, "--category");
  const notes = listNotes(rootDir, category);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(notes, null, 2));
    return;
  }

  if (notes.length === 0) {
    p.log.info("No notes stored. Use `dojops memory add <text>` to add one.");
    return;
  }

  const lines = notes.map(formatNote).join("\n");
  p.note(lines, `Notes (${notes.length})`);
}

function handleAdd(args: string[], ctx: CLIContext): void {
  const rootDir = getRoot();
  const category = extractFlagValue(args, "--category") ?? "general";
  const keywords = extractFlagValue(args, "--keywords") ?? "";
  const positional = stripFlags(args, new Set<string>(), new Set(["--category", "--keywords"]));
  const content = positional.join(" ").trim();
  if (!content) {
    throw new Error("Usage: dojops memory add <text> [--category NAME] [--keywords WORDS]");
  }

  const id = addNote(rootDir, content, category, keywords);
  if (id < 0) {
    p.log.error("Failed to save note.");
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ id, category, content, keywords }));
    return;
  }
  const idLabel = pc.cyan(`#${id}`);
  p.log.success(`Saved note ${idLabel} [${category}]`);
}

function handleRemove(args: string[]): void {
  const rootDir = getRoot();
  const idStr = args[0];
  if (!idStr) {
    throw new Error("Usage: dojops memory remove <id>");
  }
  const id = Number(idStr.replace(/^#/, ""));
  if (Number.isNaN(id) || id <= 0) {
    throw new Error(`Invalid note ID: "${idStr}"`);
  }

  const deleted = removeNote(rootDir, id);
  if (deleted) {
    p.log.success(`Removed note #${id}`);
  } else {
    p.log.info(`Note #${id} not found.`);
  }
}

function handleSearch(args: string[], ctx: CLIContext): void {
  const rootDir = getRoot();
  const query = args.join(" ").trim();
  if (!query) {
    throw new Error("Usage: dojops memory search <query>");
  }

  const notes = searchNotes(rootDir, query);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(notes, null, 2));
    return;
  }

  if (notes.length === 0) {
    p.log.info(`No notes matching "${query}".`);
    return;
  }

  const lines = notes.map(formatNote).join("\n");
  p.note(lines, `Search: "${query}" (${notes.length})`);
}

function handleAuto(args: string[]): void {
  const rootDir = getRoot();
  const toggle = args[0];

  if (toggle === "on") {
    saveMemoryConfig(rootDir, true);
    p.log.success("Auto-memory enrichment enabled for `dojops auto`.");
  } else if (toggle === "off") {
    saveMemoryConfig(rootDir, false);
    p.log.success("Auto-memory enrichment disabled for `dojops auto`.");
  } else {
    const enabled = loadMemoryConfig(rootDir);
    p.log.info(`Auto-memory enrichment: ${enabled ? pc.green("on") : pc.dim("off")}`);
    p.log.info(pc.dim("Toggle with: dojops memory auto on|off"));
  }
}

function handleErrors(args: string[], ctx: CLIContext): void {
  const rootDir = getRoot();
  const taskType = extractFlagValue(args, "--type") ?? undefined;
  const patterns = listErrorPatterns(rootDir, taskType, 20);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(patterns, null, 2));
    return;
  }

  if (patterns.length === 0) {
    p.log.info("No error patterns recorded.");
    return;
  }

  const lines = patterns.map((ep) => {
    const count = ep.occurrences > 1 ? pc.yellow(` (${ep.occurrences}x)`) : "";
    const resolved = ep.resolution ? pc.green(" [resolved]") : "";
    const msg =
      ep.error_message.length > 80 ? ep.error_message.slice(0, 77) + "..." : ep.error_message;
    return `${pc.cyan(`#${ep.id}`)} ${pc.dim(ep.task_type)}${count}${resolved}  ${msg}`;
  });
  p.note(lines.join("\n"), `Error patterns (${patterns.length})`);
}

export async function memoryCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0] ?? "list";
  const rest = args.slice(1);

  // Handle --as-flag shortcuts
  if (hasFlag(args, "--add")) {
    const remaining = args.filter((a) => a !== "--add");
    handleAdd(remaining, ctx);
    return;
  }

  switch (sub) {
    case "list":
      handleList(rest, ctx);
      break;
    case "add":
      handleAdd(rest, ctx);
      break;
    case "remove":
    case "rm":
      handleRemove(rest);
      break;
    case "search":
      handleSearch(rest, ctx);
      break;
    case "auto":
      handleAuto(rest);
      break;
    case "errors":
      handleErrors(rest, ctx);
      break;
    default:
      throw new Error(
        `Unknown memory subcommand: "${sub}". Available: list, add, remove, search, auto, errors`,
      );
  }
}
