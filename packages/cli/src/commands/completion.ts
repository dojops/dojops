import { CommandHandler } from "../types";
import {
  BASH_COMPLETION_SCRIPT,
  ZSH_COMPLETION_SCRIPT,
  FISH_COMPLETION_SCRIPT,
} from "../completions";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { homedir } from "os";
import pc from "picocolors";

export const completionBashCommand: CommandHandler = async () => {
  console.log(BASH_COMPLETION_SCRIPT);
};

export const completionZshCommand: CommandHandler = async () => {
  console.log(ZSH_COMPLETION_SCRIPT);
};

export const completionFishCommand: CommandHandler = async () => {
  console.log(FISH_COMPLETION_SCRIPT);
};

export const completionUsageCommand: CommandHandler = async () => {
  console.error("Usage: dojops completion <bash|zsh|fish>");
  console.error("       dojops completion install [bash|zsh|fish]");
  console.error("");
  console.error("Generate shell completion scripts for dojops.");
  process.exit(2);
};

/** Detect the user's default shell from $SHELL. */
function detectShell(): string | null {
  const shell = process.env.SHELL;
  if (!shell) return null;
  const base = shell.split("/").pop() ?? "";
  if (["bash", "zsh", "fish"].includes(base)) return base;
  return null;
}

/** Get brew prefix on macOS, or null. */
function getBrewPrefix(): string | null {
  try {
    return execFileSync("brew", ["--prefix"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function installBash(): string {
  const brewPrefix = getBrewPrefix();
  let target: string;
  if (brewPrefix && process.platform === "darwin") {
    target = join(brewPrefix, "etc", "bash_completion.d", "dojops");
  } else {
    target = join(homedir(), ".bash_completion.d", "dojops");
  }
  const dir = join(target, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, BASH_COMPLETION_SCRIPT, "utf8");
  return target;
}

function installZsh(): { target: string; needsFpath: boolean } {
  const dir = join(homedir(), ".zsh", "completions");
  const target = join(dir, "_dojops");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, ZSH_COMPLETION_SCRIPT, "utf8");
  const fpath = process.env.FPATH ?? "";
  const needsFpath = !fpath.split(":").includes(dir);
  return { target, needsFpath };
}

function installFish(): string {
  const dir = join(homedir(), ".config", "fish", "completions");
  const target = join(dir, "dojops.fish");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, FISH_COMPLETION_SCRIPT, "utf8");
  return target;
}

export const completionInstallCommand: CommandHandler = async (args) => {
  const shell = args[0] ?? detectShell();
  if (!shell) {
    console.error("Could not detect shell. Specify one: dojops completion install <bash|zsh|fish>");
    process.exit(2);
  }

  const verb = (target: string) => (existsSync(target) ? "Updated" : "Installed");

  switch (shell) {
    case "bash": {
      const target = installBash();
      console.log(pc.green(`✔ ${verb(target)} dojops completions for bash`));
      console.log("  → " + target);
      console.log(pc.dim("  Restart your shell or run: source ~/.bashrc"));
      break;
    }
    case "zsh": {
      const dir = join(homedir(), ".zsh", "completions");
      const target = join(dir, "_dojops");
      const action = verb(target);
      const { target: writtenTarget, needsFpath } = installZsh();
      console.log(pc.green(`✔ ${action} dojops completions for zsh`));
      console.log("  → " + writtenTarget);
      if (needsFpath) {
        console.log(
          pc.yellow(
            "  Add to ~/.zshrc: fpath=(~/.zsh/completions $fpath); autoload -Uz compinit && compinit",
          ),
        );
      } else {
        console.log(pc.dim("  Restart your shell or run: exec zsh"));
      }
      break;
    }
    case "fish": {
      const dir = join(homedir(), ".config", "fish", "completions");
      const target = join(dir, "dojops.fish");
      const action = verb(target);
      const writtenTarget = installFish();
      console.log(pc.green(`✔ ${action} dojops completions for fish`));
      console.log("  → " + writtenTarget);
      console.log(pc.dim("  Completions will be available in new shell sessions."));
      break;
    }
    default:
      console.error('Unknown shell: "' + shell + '". Supported: bash, zsh, fish');
      process.exit(2);
  }
};
