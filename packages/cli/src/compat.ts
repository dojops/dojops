/**
 * Backward compatibility: remaps old flag-based CLI syntax to new subcommand syntax.
 *
 * Old:                        New:
 * --plan "..."              → plan "..."
 * --execute "..."           → plan --execute "..."
 * --debug-ci "..."          → debug ci "..."
 * --diff "..."              → analyze diff "..."
 * login ...                 → auth login ...
 * config --show             → config show
 */
export function remapLegacyArgs(args: string[]): string[] {
  const result = [...args];

  // --debug-ci → debug ci (must check before generic flag stripping)
  const debugIdx = result.indexOf("--debug-ci");
  if (debugIdx !== -1) {
    result.splice(debugIdx, 1);
    return ["debug", "ci", ...result];
  }

  // --diff → analyze diff
  const diffIdx = result.indexOf("--diff");
  if (diffIdx !== -1) {
    result.splice(diffIdx, 1);
    return ["analyze", "diff", ...result];
  }

  // --plan → plan (preserve other flags like --execute, --yes)
  const planIdx = result.indexOf("--plan");
  if (planIdx !== -1) {
    result.splice(planIdx, 1);
    return ["plan", ...result];
  }

  // --execute without --plan → plan --execute
  const execIdx = result.indexOf("--execute");
  if (execIdx !== -1) {
    result.splice(execIdx, 1);
    return ["plan", "--execute", ...result];
  }

  // login → auth login
  if (result[0] === "login") {
    return ["auth", "login", ...result.slice(1)];
  }

  // config --show → config show
  if (result[0] === "config") {
    const showIdx = result.indexOf("--show");
    if (showIdx !== -1) {
      result.splice(showIdx, 1);
      return ["config", "show", ...result.slice(1)];
    }
  }

  return result;
}
