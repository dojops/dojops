import { runBin } from "../safe-exec";
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

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

function validateSemver(version: string): void {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Invalid version string from registry: ${version}`);
  }
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
  validateSemver(data.version);
  return data.version;
}

function jsonOrThrow(isJson: boolean, data: object, message: string): never | void {
  if (isJson) {
    console.log(JSON.stringify(data));
    return;
  }
  throw new CLIError(ExitCode.GENERAL_ERROR, message);
}

export async function upgradeCommand(args: string[], ctx: CLIContext): Promise<void> {
  const checkOnly = hasFlag(args, "--check");
  const autoYes = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const isJson = ctx.globalOpts.output === "json";

  const currentVersion = getDojopsVersion();
  if (currentVersion === "unknown") {
    return jsonOrThrow(
      isJson,
      { error: "Could not determine current version" },
      "Could not determine current version.",
    );
  }

  const latestVersion = await fetchWithSpinner(isJson);
  if (!latestVersion) return;

  const cmp = compareSemver(currentVersion, latestVersion);
  if (cmp >= 0) {
    return handleUpToDate(isJson, currentVersion, latestVersion);
  }

  if (checkOnly) {
    return handleCheckOnly(isJson, currentVersion, latestVersion);
  }

  const confirmed = await confirmUpgrade(isJson, autoYes, currentVersion, latestVersion);
  if (!confirmed) return;

  try {
    runBin("npm", ["install", "-g", `@dojops/cli@${latestVersion}`], {
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch {
    return jsonOrThrow(
      isJson,
      { error: "npm install failed" },
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
  const vLatest = `v${latestVersion}`;
  p.log.success(`Upgraded to ${pc.cyan(vLatest)}`);
}

async function fetchWithSpinner(isJson: boolean): Promise<string | null> {
  try {
    const s = p.spinner();
    if (!isJson) s.start("Checking npm registry…");
    const version = await fetchLatestVersion();
    if (!isJson) s.stop("Registry checked.");
    return version;
  } catch (err) {
    const msg = `Failed to check for updates: ${(err as Error).message}`;
    if (isJson) {
      console.log(JSON.stringify({ error: msg }));
      return null;
    }
    throw new CLIError(ExitCode.GENERAL_ERROR, msg);
  }
}

function handleUpToDate(isJson: boolean, current: string, latest: string): void {
  if (isJson) {
    console.log(JSON.stringify({ current, latest, upToDate: true }));
    return;
  }
  const vCurrent = `v${current}`;
  p.log.success(`Already up to date — ${pc.cyan(vCurrent)}`);
}

function handleCheckOnly(isJson: boolean, current: string, latest: string): void {
  if (isJson) {
    console.log(JSON.stringify({ current, latest, upToDate: false }));
    return;
  }
  const vCurrent = `v${current}`;
  const vLatest = `v${latest}`;
  p.log.info(`Update available: ${pc.dim(vCurrent)} → ${pc.cyan(vLatest)}`);
  p.log.info(`Run ${pc.cyan("dojops upgrade")} to install.`);
  throw new CLIError(ExitCode.GENERAL_ERROR);
}

async function confirmUpgrade(
  isJson: boolean,
  autoYes: boolean,
  current: string,
  latest: string,
): Promise<boolean> {
  const vCurrent = `v${current}`;
  const vLatest = `v${latest}`;
  if (!autoYes) {
    p.log.info(`Update available: ${pc.dim(vCurrent)} → ${pc.cyan(vLatest)}`);
    const shouldProceed = await p.confirm({ message: "Install update?" });
    if (p.isCancel(shouldProceed) || !shouldProceed) {
      p.log.info("Upgrade cancelled.");
      return false;
    }
  } else if (!isJson) {
    p.log.info(`Upgrading: ${pc.dim(vCurrent)} → ${pc.cyan(vLatest)}`);
  }
  return true;
}
