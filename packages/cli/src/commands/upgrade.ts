import { execSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { ExitCode, CLIError } from "../exit-codes";
import { getDojopsVersion } from "../state";
import { hasFlag } from "../parser";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/@dojops/cli/latest";

/**
 * Simple semver comparison: returns -1, 0, or 1.
 * Only handles numeric x.y.z — sufficient for our use case.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string> {
  const resp = await fetch(NPM_REGISTRY_URL);
  if (!resp.ok) {
    throw new Error(`npm registry returned ${resp.status}`);
  }
  const data = (await resp.json()) as { version?: string };
  if (!data.version) {
    throw new Error("Could not parse version from npm registry response");
  }
  return data.version;
}

export async function upgradeCommand(args: string[], ctx: CLIContext): Promise<void> {
  const checkOnly = hasFlag(args, "--check");
  const autoYes = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const isJson = ctx.globalOpts.output === "json";

  const currentVersion = getDojopsVersion();
  if (currentVersion === "unknown") {
    if (isJson) {
      console.log(JSON.stringify({ error: "Could not determine current version" }));
      return;
    }
    throw new CLIError(ExitCode.GENERAL_ERROR, "Could not determine current version.");
  }

  // Fetch latest from npm
  let latestVersion: string;
  try {
    const s = p.spinner();
    if (!isJson) s.start("Checking npm registry…");
    latestVersion = await fetchLatestVersion();
    if (!isJson) s.stop("Registry checked.");
  } catch (err) {
    if (isJson) {
      console.log(
        JSON.stringify({
          error: `Failed to check for updates: ${(err as Error).message}`,
        }),
      );
      return;
    }
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Failed to check for updates: ${(err as Error).message}`,
    );
  }

  const cmp = compareSemver(currentVersion, latestVersion);

  // Already up to date
  if (cmp >= 0) {
    if (isJson) {
      console.log(
        JSON.stringify({
          current: currentVersion,
          latest: latestVersion,
          upToDate: true,
        }),
      );
      return;
    }
    const currentVersionLabel = pc.cyan(`v${currentVersion}`);
    p.log.success(`Already up to date — ${currentVersionLabel}`);
    return;
  }

  // Update available
  if (checkOnly) {
    if (isJson) {
      console.log(
        JSON.stringify({
          current: currentVersion,
          latest: latestVersion,
          upToDate: false,
        }),
      );
      return;
    }
    const currentDim = pc.dim(`v${currentVersion}`);
    const latestCyan = pc.cyan(`v${latestVersion}`);
    p.log.info(`Update available: ${currentDim} → ${latestCyan}`);
    p.log.info(`Run ${pc.cyan("dojops upgrade")} to install.`);
    throw new CLIError(ExitCode.GENERAL_ERROR);
  }

  // Interactive confirmation
  if (!autoYes) {
    const currentDim = pc.dim(`v${currentVersion}`);
    const latestCyan = pc.cyan(`v${latestVersion}`);
    p.log.info(`Update available: ${currentDim} → ${latestCyan}`);
    const shouldProceed = await p.confirm({ message: "Install update?" });
    if (p.isCancel(shouldProceed) || !shouldProceed) {
      p.log.info("Upgrade cancelled.");
      return;
    }
  } else if (!isJson) {
    const currentDim = pc.dim(`v${currentVersion}`);
    const latestCyan = pc.cyan(`v${latestVersion}`);
    p.log.info(`Upgrading: ${currentDim} → ${latestCyan}`);
  }

  // Run npm install
  try {
    execSync(`npm install -g @dojops/cli@${latestVersion}`, {
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch {
    if (isJson) {
      console.log(JSON.stringify({ error: "npm install failed" }));
      return;
    }
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      "npm install failed. Try running manually:\n  npm install -g @dojops/cli",
    );
  }

  if (isJson) {
    console.log(
      JSON.stringify({
        current: currentVersion,
        latest: latestVersion,
        upToDate: true,
        upgraded: true,
      }),
    );
    return;
  }

  const upgradedVersion = pc.cyan(`v${latestVersion}`);
  p.log.success(`Upgraded to ${upgradedVersion}`);
}
