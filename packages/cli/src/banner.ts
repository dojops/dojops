import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}

export function createBanner(): string {
  const ver = pc.dim(`v${getVersion()}`);
  const lines = [
    "",
    `  🥷 ${pc.bold(pc.cyan("DojOps"))}  ${ver}`,
    `  ${pc.dim("AI DevOps Automation Engine")}`,
    "",
  ];
  return lines.join("\n");
}
