import pc from "picocolors";
import * as p from "@clack/prompts";
import { CommandHandler } from "../types";
import { initProject, findProjectRoot } from "../state";

export const initCommand: CommandHandler = async () => {
  const root = findProjectRoot() ?? process.cwd();
  const created = initProject(root);

  if (created.length === 0) {
    p.log.info("Project already initialized.");
    p.log.info(`  ${pc.dim(root + "/.oda/")}`);
    return;
  }

  const lines = created.map((f) => `  ${pc.green("+")} ${f}`);
  p.note(lines.join("\n"), `Initialized .oda/ in ${pc.dim(root)}`);
  p.log.success("Project initialized.");
};
