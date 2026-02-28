import pc from "picocolors";
import { createBanner } from "./banner";

function printBanner(): void {
  console.log(createBanner());
}

export { printBanner };

export function printHelp(): void {
  printBanner();
  console.log(pc.bold("USAGE"));
  console.log(`  ${pc.dim("$")} dojops [command] [options] <prompt>`);
  console.log();
  console.log(pc.bold("COMMANDS"));
  console.log(`  ${pc.cyan("plan")}               Decompose goal into task graph`);
  console.log(`  ${pc.cyan("generate")}           Generate DevOps config ${pc.dim("(default)")}`);
  console.log(`  ${pc.cyan("apply")}              Execute a saved plan`);
  console.log(`  ${pc.cyan("validate")}           Validate plan against schemas`);
  console.log(`  ${pc.cyan("explain")}            LLM explains a plan`);
  console.log(`  ${pc.cyan("debug ci")}           Diagnose CI/CD log failures`);
  console.log(`  ${pc.cyan("analyze diff")}       Analyze infrastructure diff for risk`);
  console.log(`  ${pc.cyan("inspect")}            Inspect config and session state`);
  console.log(`  ${pc.cyan("agents")}             Manage specialist agents (built-in + custom)`);
  console.log(`  ${pc.cyan("verify")}             Verify a configuration file`);
  console.log(`  ${pc.cyan("history")}            View execution history`);
  console.log(`  ${pc.cyan("history verify")}     Verify audit log hash chain integrity`);
  console.log(`  ${pc.cyan("history audit")}      View audit log entries`);
  console.log(`  ${pc.cyan("config")}             Configure provider, model, tokens`);
  console.log(`  ${pc.cyan("provider")}           Manage LLM providers (list/add/remove/default)`);
  console.log(`  ${pc.cyan("auth")}               Authenticate with LLM provider`);
  console.log(`  ${pc.cyan("serve")}              Start API server + dashboard`);
  console.log(`  ${pc.cyan("chat")}               Interactive AI DevOps session`);
  console.log(`  ${pc.cyan("check")}              LLM-powered DevOps config quality check`);
  console.log(`  ${pc.cyan("scan")}               Security scan: vulns, deps, IaC, secrets`);
  console.log(`  ${pc.cyan("tools")}              Manage DevOps tools (custom + marketplace)`);
  console.log(`  ${pc.cyan("toolchain")}          Manage system toolchain (~/.dojops/toolchain/)`);
  console.log(
    `  ${pc.cyan("status")}             System health diagnostics ${pc.dim("(alias: doctor)")}`,
  );
  console.log(`  ${pc.cyan("init")}               Initialize .dojops/ + scan repo context`);
  console.log(`  ${pc.cyan("clean")}              Remove generated artifacts from a plan`);
  console.log(`  ${pc.dim("  destroy")}            ${pc.dim("Deprecated alias for clean")}`);
  console.log(`  ${pc.cyan("rollback")}           Reverse an applied plan`);
  console.log();
  console.log(pc.bold("GLOBAL OPTIONS"));
  console.log(
    `  ${pc.cyan("--provider=NAME")}    LLM provider: openai, anthropic, ollama, deepseek, gemini`,
  );
  console.log(`  ${pc.cyan("--model=NAME")}       LLM model override`);
  console.log(`  ${pc.cyan("--temperature=N")}    LLM temperature (0-2)`);
  console.log(`  ${pc.cyan("--profile=NAME")}     Use named config profile`);
  console.log(
    `  ${pc.cyan("--output=FORMAT")}    Output: table ${pc.dim("(default)")}, json, yaml`,
  );
  console.log(`  ${pc.cyan("--verbose")}          Verbose output`);
  console.log(`  ${pc.cyan("--debug")}            Debug-level output`);
  console.log(`  ${pc.cyan("--quiet")}            Suppress non-essential output`);
  console.log(`  ${pc.cyan("--agent=NAME")}       Force routing to a specific specialist agent`);
  console.log(`  ${pc.cyan("--timeout=<ms>")}     Global timeout for operations`);
  console.log(`  ${pc.cyan("--no-color")}         Disable color output`);
  console.log(`  ${pc.cyan("--non-interactive")}  Disable interactive prompts`);
  console.log(`  ${pc.cyan("--help, -h")}         Show this help message`);
  console.log();
  console.log(pc.bold("PLAN OPTIONS"));
  console.log(`  ${pc.cyan("--execute")}          Generate + execute with approval workflow`);
  console.log(`  ${pc.cyan("--yes")}              Auto-approve all executions`);
  console.log(`  ${pc.cyan("--skip-verify")}      Skip external config validation`);
  console.log();
  console.log(pc.bold("APPLY OPTIONS"));
  console.log(`  ${pc.cyan("--dry-run")}              Preview changes without executing`);
  console.log(`  ${pc.cyan("--resume")}               Resume a partially-applied plan`);
  console.log(`  ${pc.cyan("--yes")}                  Auto-approve all executions`);
  console.log(
    `  ${pc.cyan("--skip-verify")}          Skip external config validation (verification runs by default)`,
  );
  console.log(`  ${pc.cyan("--force")}                Skip git dirty working tree check`);
  console.log(`  ${pc.cyan("--allow-all-paths")}      Bypass DevOps file write allowlist`);
  console.log(`  ${pc.cyan("--install-packages")}     Run package install after apply`);
  console.log(
    `  ${pc.cyan("--replay")}               Deterministic mode: temp=0, validate provider/model/prompts`,
  );
  console.log(`  ${pc.cyan("--task=ID")}              Execute only a single task from the plan`);
  console.log(
    `  ${pc.cyan("--timeout <sec>")}        Execution timeout per task in seconds (default: 60)`,
  );
  console.log();
  console.log(pc.bold("SCAN OPTIONS"));
  console.log(
    `  ${pc.cyan("--security")}         Security scans only (trivy, gitleaks, hadolint, checkov)`,
  );
  console.log(`  ${pc.cyan("--deps")}             Dependency scans only (npm-audit, pip-audit)`);
  console.log(`  ${pc.cyan("--iac")}              IaC scans only (checkov, hadolint, shellcheck)`);
  console.log(`  ${pc.cyan("--sbom")}             Generate Software Bill of Materials`);
  console.log(`  ${pc.cyan("--license")}          License compliance scan only`);
  console.log(`  ${pc.cyan("--fix")}              Auto-remediate HIGH/CRITICAL findings`);
  console.log(`  ${pc.cyan("--target=<dir>")}     Target directory for scanning`);
  console.log(
    `  ${pc.cyan("--fail-on <sev>")}    Exit non-zero at severity threshold: CRITICAL, HIGH ${pc.dim("(default)")}, MEDIUM, LOW`,
  );
  console.log();
  console.log(pc.bold("CHAT OPTIONS"));
  console.log(
    `  ${pc.cyan("--message=<text>")}   Single chat message (non-interactive) ${pc.dim("(alias: -m)")}`,
  );
  console.log();
  console.log(pc.bold("SERVE OPTIONS"));
  console.log(`  ${pc.cyan("--port=N")}           API server port ${pc.dim("(default: 3000)")}`);
  console.log(`  ${pc.cyan("credentials")}        Generate API key for dashboard auth`);
  console.log();
  console.log(pc.bold("BACKWARD COMPATIBILITY"));
  console.log(`  ${pc.dim("$")} dojops --plan "..."             ${pc.dim('→ dojops plan "..."')}`);
  console.log(
    `  ${pc.dim("$")} dojops --execute "..."          ${pc.dim('→ dojops plan --execute "..."')}`,
  );
  console.log(
    `  ${pc.dim("$")} dojops --debug-ci "..."         ${pc.dim('→ dojops debug ci "..."')}`,
  );
  console.log(
    `  ${pc.dim("$")} dojops --diff "..."             ${pc.dim('→ dojops analyze diff "..."')}`,
  );
  console.log(
    `  ${pc.dim("$")} dojops login ...                ${pc.dim("→ dojops auth login ...")}`,
  );
  console.log(`  ${pc.dim("$")} dojops config --show            ${pc.dim("→ dojops config show")}`);
  console.log(`  ${pc.dim("$")} dojops doctor                   ${pc.dim("→ dojops status")}`);
  console.log();
  console.log(pc.bold("EXAMPLES"));
  console.log(`  ${pc.dim("$")} dojops "Create a Terraform config for S3"`);
  console.log(`  ${pc.dim("$")} dojops plan "Set up CI/CD for a Node.js app"`);
  console.log(`  ${pc.dim("$")} dojops plan --execute --yes "Create CI for Node app"`);
  console.log(`  ${pc.dim("$")} dojops apply`);
  console.log(`  ${pc.dim("$")} dojops debug ci "ERROR: tsc failed..."`);
  console.log(`  ${pc.dim("$")} dojops analyze diff "terraform plan output..."`);
  console.log(`  ${pc.dim("$")} dojops explain last`);
  console.log(`  ${pc.dim("$")} dojops doctor`);
  console.log(`  ${pc.dim("$")} dojops agents list`);
  console.log(`  ${pc.dim("$")} dojops history list`);
  console.log(`  ${pc.dim("$")} dojops history audit --planId plan-abc123`);
  console.log(`  ${pc.dim("$")} dojops verify main.tf`);
  console.log(`  ${pc.dim("$")} dojops verify .github/workflows/ci.yml`);
  console.log(`  ${pc.dim("$")} dojops serve --port=8080`);
  console.log(`  ${pc.dim("$")} dojops plan "Create CI" --output json`);
  console.log(`  ${pc.dim("$")} dojops config profile create staging`);
  console.log();
  console.log(pc.bold("CONFIGURATION PRECEDENCE"));
  console.log(`  Provider:  --provider  >  $DOJOPS_PROVIDER  >  config  >  openai`);
  console.log(`  Model:     --model     >  $DOJOPS_MODEL     >  config  >  provider default`);
  console.log(`  Temp:      --temperature > $DOJOPS_TEMPERATURE > config > provider default`);
  console.log(
    `  Token:     $OPENAI_API_KEY / $ANTHROPIC_API_KEY / $DEEPSEEK_API_KEY / $GEMINI_API_KEY  >  config token`,
  );
  console.log();
  console.log(pc.bold("CI ENVIRONMENTS"));
  console.log(`  Automatically detected via $CI, $GITHUB_ACTIONS, $GITLAB_CI, $JENKINS_URL,`);
  console.log(`  $CIRCLECI, $TF_BUILD. In CI mode: non-interactive prompts are forced,`);
  console.log(`  banner is suppressed, and scan findings emit GitHub Actions annotations.`);
  console.log();
  console.log(pc.bold("MODELS"));
  console.log(`  ${pc.dim("OpenAI:")}    gpt-4o, gpt-4o-mini`);
  console.log(`  ${pc.dim("Anthropic:")} claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001`);
  console.log(`  ${pc.dim("Ollama:")}    llama3, mistral, codellama`);
  console.log(`  ${pc.dim("DeepSeek:")} deepseek-chat, deepseek-reasoner`);
  console.log(`  ${pc.dim("Gemini:")}   gemini-2.5-flash, gemini-2.5-pro`);
  console.log();
  console.log(pc.bold("EXIT CODES"));
  console.log(`  0    Success`);
  console.log(`  1    General error`);
  console.log(`  2    Validation error`);
  console.log(`  3    Approval required`);
  console.log(`  4    Lock conflict`);
  console.log(`  5    No .dojops/ project`);
  console.log(`  6    Security issues (HIGH findings)`);
  console.log(`  7    Critical vulnerabilities`);
  console.log();
}

export function printCommandHelp(command: string): void {
  switch (command) {
    case "plan":
      console.log(`\n${pc.bold("dojops plan")} — Decompose a goal into a task graph`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops plan <prompt>`);
      console.log(`  ${pc.dim("$")} dojops plan --execute <prompt>`);
      console.log(`  ${pc.dim("$")} dojops plan --execute --yes <prompt>`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(
        `  ${pc.cyan("--execute")}       Generate + execute tasks with approval workflow`,
      );
      console.log(
        `  ${pc.cyan("--yes")}           Auto-approve all executions ${pc.dim("(implies --non-interactive)")}`,
      );
      console.log(
        `  ${pc.cyan("--skip-verify")}   Skip external config validation ${pc.dim("(--execute only)")}`,
      );
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops plan "Set up CI/CD for a Node.js app"`);
      console.log(`  ${pc.dim("$")} dojops plan --execute "Deploy a Terraform stack"`);
      console.log(`  ${pc.dim("$")} dojops plan --execute --yes "Create CI for Node app"`);
      console.log(`  ${pc.dim("$")} dojops plan "Create CI" --output json`);
      console.log();
      break;

    case "generate":
      console.log(
        `\n${pc.bold("dojops generate")} — Generate DevOps configuration via specialist agent`,
      );
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops <prompt>`);
      console.log(`  ${pc.dim("$")} dojops generate <prompt>`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(
        `  ${pc.cyan("--agent=NAME")}         Force routing to a specific specialist agent`,
      );
      console.log(`  ${pc.cyan("--write=PATH")}         Write generated output to a file`);
      console.log(`  ${pc.cyan("--allow-all-paths")}    Bypass DevOps file allowlist for --write`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Routes your prompt to the best-matching specialist agent and generates`);
      console.log(`  a response. This is the default command when no subcommand is given.`);
      console.log(`  Use --agent to bypass automatic routing and target a specific agent.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops "Create a Terraform config for S3"`);
      console.log(`  ${pc.dim("$")} dojops generate "Write a Kubernetes deployment"`);
      console.log(`  ${pc.dim("$")} dojops "Set up monitoring with Prometheus" --output json`);
      console.log(`  ${pc.dim("$")} dojops --agent terraform "Create S3 bucket"`);
      console.log(`  ${pc.dim("$")} dojops generate "CI for Node" --write ci.yml`);
      console.log();
      break;

    case "apply":
      console.log(`\n${pc.bold("dojops apply")} — Execute a saved plan`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops apply [<plan-id>] [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--dry-run")}            Preview changes without writing files`);
      console.log(`  ${pc.cyan("--resume")}             Skip previously completed tasks`);
      console.log(
        `  ${pc.cyan("--yes")}                Auto-approve all executions ${pc.dim("(implies --non-interactive)")}`,
      );
      console.log(
        `  ${pc.cyan("--skip-verify")}       Skip external config validation (verification on by default)`,
      );
      console.log(`  ${pc.cyan("--force")}              Skip git dirty working tree check`);
      console.log(`  ${pc.cyan("--allow-all-paths")}   Bypass DevOps file write allowlist`);
      console.log(`  ${pc.cyan("--install-packages")}  Run package install after successful apply`);
      console.log(
        `  ${pc.cyan("--replay")}            Deterministic replay: force temp=0, validate environment match`,
      );
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Executes a previously saved plan. If no plan ID is given, uses the`);
      console.log(`  current session plan or the most recent one.`);
      console.log();
      console.log(`  Shows a pre-flight summary of all tasks before execution. Use`);
      console.log(`  --dry-run to preview without writing files.`);
      console.log();
      console.log(`  With --install-packages, runs the detected package manager's install`);
      console.log(`  command (e.g. pnpm install, npm install) after a successful apply.`);
      console.log();
      console.log(`  With --replay, forces temperature=0 and validates that the current`);
      console.log(`  provider, model, and plugin system prompts match those stored in the`);
      console.log(`  plan. This enforces bit-for-bit reproducibility. Use --yes to force`);
      console.log(`  replay even if mismatches are detected.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops apply`);
      console.log(`  ${pc.dim("$")} dojops apply --dry-run`);
      console.log(`  ${pc.dim("$")} dojops apply --resume --yes`);
      console.log(`  ${pc.dim("$")} dojops apply --skip-verify`);
      console.log(`  ${pc.dim("$")} dojops apply --install-packages`);
      console.log(`  ${pc.dim("$")} dojops apply --replay`);
      console.log(`  ${pc.dim("$")} dojops apply --replay --yes`);
      console.log(`  ${pc.dim("$")} dojops apply plan-abc123`);
      console.log();
      break;

    case "validate":
      console.log(`\n${pc.bold("dojops validate")} — Validate a plan against schemas`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops validate [<plan-id>]`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Validates that each task in a plan has a valid id, tool, description,`);
      console.log(`  and that dependencies reference existing tasks.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops validate`);
      console.log(`  ${pc.dim("$")} dojops validate plan-abc123`);
      console.log();
      break;

    case "explain":
      console.log(`\n${pc.bold("dojops explain")} — LLM explains a plan in plain language`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops explain [<plan-id>|last]`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Uses the LLM to explain what a plan does, its tasks, dependencies,`);
      console.log(`  and potential risks. Defaults to the current session plan.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops explain`);
      console.log(`  ${pc.dim("$")} dojops explain last`);
      console.log(`  ${pc.dim("$")} dojops explain plan-abc123`);
      console.log();
      break;

    case "debug":
    case "debug ci":
      console.log(`\n${pc.bold("dojops debug ci")} — Diagnose CI/CD log failures`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops debug ci <log-content>`);
      console.log(`  ${pc.dim("$")} dojops debug ci --file <path>`);
      console.log(`  ${pc.dim("$")} cat ci.log | dojops debug ci`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--file=PATH")}    Read log content from a file`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Analyzes CI build logs to identify root causes of failures.`);
      console.log(
        `  Returns error type, summary, root cause, affected files, and suggested fixes.`,
      );
      console.log(`  Accepts input via argument, --file flag, or stdin pipe.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops debug ci "ERROR: tsc failed with exit code 1"`);
      console.log(`  ${pc.dim("$")} dojops debug ci --file build.log`);
      console.log(`  ${pc.dim("$")} cat ci.log | dojops debug ci`);
      console.log();
      break;

    case "analyze":
    case "analyze diff":
      console.log(`\n${pc.bold("dojops analyze diff")} — Analyze infrastructure diff for risk`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops analyze diff <diff-content>`);
      console.log(`  ${pc.dim("$")} dojops analyze diff --file <path>`);
      console.log(`  ${pc.dim("$")} terraform plan | dojops analyze diff`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--file=PATH")}    Read diff content from a file`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Analyzes infrastructure diffs (e.g. terraform plan output) and provides`);
      console.log(`  risk assessment, cost impact, security impact, and recommendations.`);
      console.log(`  Accepts input via argument, --file flag, or stdin pipe.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops analyze diff "terraform plan output..."`);
      console.log(`  ${pc.dim("$")} dojops analyze diff --file plan.diff`);
      console.log(`  ${pc.dim("$")} terraform plan | dojops analyze diff`);
      console.log();
      break;

    case "inspect":
      console.log(`\n${pc.bold("dojops inspect")} — Inspect runtime configuration and state`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops inspect <target>`);
      console.log(`\n${pc.bold("TARGETS")}`);
      console.log(`  ${pc.cyan("config")}     Show resolved provider, model, and tokens`);
      console.log(`  ${pc.cyan("session")}    Show current session state`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops inspect config`);
      console.log(`  ${pc.dim("$")} dojops inspect session --output json`);
      console.log();
      break;

    case "agents":
      console.log(`\n${pc.bold("dojops agents")} — Manage specialist agents (built-in + custom)`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops agents [list|info|create|remove]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(
        `  ${pc.cyan("list")}              List all agents (built-in + custom) ${pc.dim("(default)")}`,
      );
      console.log(`  ${pc.cyan("info <name>")}       Show detailed agent info`);
      console.log(
        `  ${pc.cyan("create <desc>")}     Create a custom agent (LLM-generated from description)`,
      );
      console.log(`  ${pc.cyan("create --manual")}   Create a custom agent interactively`);
      console.log(`  ${pc.cyan("remove <name>")}     Remove a custom agent`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(
        `  ${pc.cyan("--global")}          Create agent in global ~/.dojops/agents/ (create only)`,
      );
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops agents`);
      console.log(`  ${pc.dim("$")} dojops agents list`);
      console.log(`  ${pc.dim("$")} dojops agents info ops-cortex`);
      console.log(`  ${pc.dim("$")} dojops agents list --output json`);
      console.log(
        `  ${pc.dim("$")} dojops agents create "an SRE specialist for incident response"`,
      );
      console.log(`  ${pc.dim("$")} dojops agents create --manual`);
      console.log(`  ${pc.dim("$")} dojops agents create --global "a cost optimization expert"`);
      console.log(`  ${pc.dim("$")} dojops agents remove sre-specialist`);
      console.log();
      break;

    case "history":
      console.log(`\n${pc.bold("dojops history")} — View execution history and audit logs`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops history [list|show <plan-id>|verify|audit]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(
        `  ${pc.cyan("list")}              List all plans with status ${pc.dim("(default)")}`,
      );
      console.log(`  ${pc.cyan("show <plan-id>")}    Show plan details and execution results`);
      console.log(`  ${pc.cyan("verify")}            Verify audit log hash chain integrity`);
      console.log(`  ${pc.cyan("audit")}             View audit log entries`);
      console.log(`\n${pc.bold("AUDIT OPTIONS")}`);
      console.log(`  ${pc.cyan("--planId=ID")}       Filter audit entries by plan ID`);
      console.log(
        `  ${pc.cyan("--status=STATUS")}   Filter by status (success, failure, cancelled)`,
      );
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops history`);
      console.log(`  ${pc.dim("$")} dojops history list`);
      console.log(`  ${pc.dim("$")} dojops history show plan-abc123`);
      console.log(`  ${pc.dim("$")} dojops history verify`);
      console.log(`  ${pc.dim("$")} dojops history audit`);
      console.log(`  ${pc.dim("$")} dojops history audit --planId plan-abc123`);
      console.log(`  ${pc.dim("$")} dojops history audit --status failure`);
      console.log();
      break;

    case "config":
      console.log(`\n${pc.bold("dojops config")} — Configure provider, model, and tokens`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops config [show]`);
      console.log(`  ${pc.dim("$")} dojops config [--provider=NAME] [--model=NAME] [--token=KEY]`);
      console.log(`  ${pc.dim("$")} dojops config profile <create|use|list> [name]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--provider=NAME")}  Set default LLM provider`);
      console.log(`  ${pc.cyan("--model=NAME")}     Set default model`);
      console.log(`  ${pc.cyan("--token=KEY")}      Save API token for current provider`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(`  ${pc.cyan("show")}             Display current configuration`);
      console.log(`  ${pc.cyan("profile create")}   Save current config as a named profile`);
      console.log(`  ${pc.cyan("profile use")}      Switch to a named profile`);
      console.log(`  ${pc.cyan("profile list")}     List all profiles`);
      console.log(`  ${pc.cyan("profile delete")}   Remove a named profile`);
      console.log(`  ${pc.cyan("reset")}            Reset configuration to defaults`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Without arguments, launches an interactive configuration wizard.`);
      console.log(`  With flags, applies settings directly and exits.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops config`);
      console.log(`  ${pc.dim("$")} dojops config show`);
      console.log(`  ${pc.dim("$")} dojops config --provider=anthropic`);
      console.log(`  ${pc.dim("$")} dojops config --token=sk-...`);
      console.log(`  ${pc.dim("$")} dojops config profile create staging`);
      console.log(`  ${pc.dim("$")} dojops config profile use staging`);
      console.log(`  ${pc.dim("$")} dojops config profile list`);
      console.log();
      break;

    case "provider":
      console.log(`\n${pc.bold("dojops provider")} — Manage LLM providers`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops provider [list|add|remove|default]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(
        `  ${pc.cyan("list")}              List all providers with status ${pc.dim("(default)")}`,
      );
      console.log(`  ${pc.cyan("add <name>")}       Add/configure a provider token`);
      console.log(`  ${pc.cyan("remove <name>")}    Remove a provider token`);
      console.log(`  ${pc.cyan("default <name>")}   Set the default provider`);
      console.log(
        `  ${pc.cyan("switch")}            Interactive picker to switch default provider`,
      );
      console.log(`\n${pc.bold("FLAGS")}`);
      console.log(`  ${pc.cyan("--token=KEY")}       API token (for add)`);
      console.log(`  ${pc.cyan("--as-default=NAME")} Set default provider (shortcut)`);
      console.log(`  ${pc.cyan("--output=json")}     Output list as JSON`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops provider`);
      console.log(`  ${pc.dim("$")} dojops provider list`);
      console.log(`  ${pc.dim("$")} dojops provider add openai --token sk-...`);
      console.log(`  ${pc.dim("$")} dojops provider add anthropic --token sk-ant-...`);
      console.log(`  ${pc.dim("$")} dojops provider default anthropic`);
      console.log(`  ${pc.dim("$")} dojops provider switch`);
      console.log(`  ${pc.dim("$")} dojops provider --as-default openai`);
      console.log(`  ${pc.dim("$")} dojops provider remove openai`);
      console.log(`  ${pc.dim("$")} dojops provider list --output json`);
      console.log();
      break;

    case "auth":
      console.log(`\n${pc.bold("dojops auth")} — Authenticate with LLM provider`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops auth login [--token=KEY] [--provider=NAME]`);
      console.log(`  ${pc.dim("$")} dojops auth status`);
      console.log(`  ${pc.dim("$")} dojops auth logout [--provider=NAME] [--all]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(`  ${pc.cyan("login")}    Save API token for a provider`);
      console.log(`  ${pc.cyan("status")}   Show saved tokens and default provider`);
      console.log(`  ${pc.cyan("logout")}   Remove saved API token`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--token=KEY")}      API key to save`);
      console.log(`  ${pc.cyan("--provider=NAME")}  Provider to authenticate with`);
      console.log(`  ${pc.cyan("--all")}            Remove all saved tokens (logout)`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops auth login --token=sk-...`);
      console.log(`  ${pc.dim("$")} dojops auth login --provider=anthropic --token=sk-ant-...`);
      console.log(`  ${pc.dim("$")} dojops auth status`);
      console.log(`  ${pc.dim("$")} dojops auth logout`);
      console.log(`  ${pc.dim("$")} dojops auth logout --all`);
      console.log();
      break;

    case "serve":
      console.log(`\n${pc.bold("dojops serve")} — Start REST API server and web dashboard`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops serve [--port=N]`);
      console.log(`  ${pc.dim("$")} dojops serve credentials`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(
        `  ${pc.cyan("credentials")}   Generate an API key and save to ~/.dojops/server.json`,
      );
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(
        `  ${pc.cyan("--port=N")}      API server port ${pc.dim("(default: 3000, or $DOJOPS_API_PORT)")}`,
      );
      console.log(
        `  ${pc.cyan("--no-auth")}     Allow unauthenticated access ${pc.dim("(not recommended)")}`,
      );
      console.log(
        `  ${pc.cyan("--tls-cert=F")}  Path to TLS certificate file ${pc.dim("(enables HTTPS)")}`,
      );
      console.log(
        `  ${pc.cyan("--tls-key=F")}   Path to TLS private key file ${pc.dim("(requires --tls-cert)")}`,
      );
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Starts an Express server exposing all DojOps capabilities via REST API`);
      console.log(`  and a web dashboard at the root URL.`);
      console.log(`  When DOJOPS_API_KEY is set or ~/.dojops/server.json exists, all API`);
      console.log(`  routes (except /api/health) require authentication.`);
      console.log(`  Use --tls-cert and --tls-key together to enable HTTPS. Without TLS,`);
      console.log(`  a warning is shown if API key auth is enabled (cleartext credentials).`);
      console.log(`\n${pc.bold("ENDPOINTS")}`);
      console.log(`  GET  /api/health       Provider status`);
      console.log(`  POST /api/generate     Agent-routed LLM generation`);
      console.log(`  POST /api/plan         Decompose goal into task graph`);
      console.log(`  POST /api/debug-ci     CI log diagnosis`);
      console.log(`  POST /api/diff         Infrastructure diff analysis`);
      console.log(`  GET  /api/agents       List specialist agents`);
      console.log(`  GET  /api/history      Execution history`);
      console.log(`  POST /api/scan         Security scan`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops serve credentials`);
      console.log(`  ${pc.dim("$")} dojops serve`);
      console.log(`  ${pc.dim("$")} dojops serve --port=8080`);
      console.log(`  ${pc.dim("$")} dojops serve --tls-cert=cert.pem --tls-key=key.pem`);
      console.log();
      break;

    case "status":
    case "doctor":
      console.log(`\n${pc.bold("dojops status")} — System health diagnostics`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops status`);
      console.log(`  ${pc.dim("$")} dojops doctor   ${pc.dim("(alias)")}`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Runs diagnostic checks on your DojOps installation:`);
      console.log(`  - Node.js version (>= 18)`);
      console.log(`  - LLM provider configured`);
      console.log(`  - API key present`);
      console.log(`  - .dojops/ project initialized`);
      console.log(`  - Ollama reachability (if applicable)`);
      console.log(`  - Config file permissions`);
      console.log(`  - Agent tool dependencies (ShellCheck, Snyk, etc.)`);
      console.log();
      console.log(`  When missing tools are detected, offers to install them interactively.`);
      console.log(`  Use --non-interactive to skip the install prompt.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops status`);
      console.log(`  ${pc.dim("$")} dojops status --output json`);
      console.log();
      break;

    case "init":
      console.log(
        `\n${pc.bold("dojops init")} — Initialize .dojops/ project directory and scan repo`,
      );
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops init`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Creates the .dojops/ directory structure and scans the repository to`);
      console.log(`  build a structured context file (.dojops/context.json).`);
      console.log();
      console.log(`  ${pc.bold("Directory structure:")}`);
      console.log(`  - .dojops/plans/         Saved plan files`);
      console.log(`  - .dojops/history/       Hash-chained audit trail`);
      console.log(`  - .dojops/session.json   Current session state`);
      console.log(`  - .dojops/context.json   Detected repo context`);
      console.log();
      console.log(`  ${pc.bold("Repo scanning detects:")}`);
      console.log(`  - Languages (Node, Python, Go, Rust, Java, Ruby)`);
      console.log(`  - Package managers (pnpm, yarn, npm, pip, cargo, etc.)`);
      console.log(`  - CI/CD platforms (GitHub Actions, GitLab CI, Jenkins, CircleCI)`);
      console.log(`  - Container configs (Dockerfile, Docker Compose)`);
      console.log(`  - Infrastructure (Terraform, Kubernetes, Helm, Ansible)`);
      console.log(`  - Monitoring (Prometheus, Nginx, Systemd)`);
      console.log(`  - Repo metadata (git, monorepo, Makefile, .env)`);
      console.log();
      console.log(
        `  Re-running ${pc.cyan("dojops init")} on an existing project updates context.json`,
      );
      console.log(`  without recreating existing directories.`);
      console.log();
      console.log(`  ${pc.bold("LLM enrichment:")}`);
      console.log(
        `  When an LLM provider is configured (via ${pc.cyan("dojops config")} or env vars),`,
      );
      console.log(`  init automatically sends scan results to the LLM for deeper analysis:`);
      console.log(`  project description, tech stack summary, suggested workflows, and`);
      console.log(`  recommended specialist agents. Without a provider, init works fully`);
      console.log(`  offline with filesystem-only detection.`);
      console.log();
      console.log(`  ${pc.bold("Tool dependencies:")}`);
      console.log(`  After scanning, init checks for optional tool dependencies used by`);
      console.log(`  specialist agents (ShellCheck, Snyk, Pyright, etc.) and interactively`);
      console.log(`  offers to install any that are missing.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops init`);
      console.log(`  ${pc.dim("$")} dojops init && cat .dojops/context.json`);
      console.log();
      break;

    case "clean":
      console.log(`\n${pc.bold("dojops clean")} — Remove generated artifacts from a plan`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops clean <plan-id> [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--dry-run")}    Preview files to be deleted without removing them`);
      console.log(`  ${pc.cyan("--yes")}        Skip confirmation prompt`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops clean plan-abc123`);
      console.log(`  ${pc.dim("$")} dojops clean plan-abc123 --dry-run`);
      console.log(`  ${pc.dim("$")} dojops clean plan-abc123 --yes`);
      console.log(`\n${pc.bold("NOTE")}`);
      console.log(`  ${pc.dim("'destroy' is a deprecated alias for 'clean'.")}`);
      console.log();
      break;

    case "destroy":
      console.log(`\n${pc.yellow("'destroy' is deprecated. Use 'clean' instead.")}`);
      console.log(`\n${pc.bold("dojops clean")} — Remove generated artifacts from a plan`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops clean <plan-id> [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--dry-run")}    Preview files to be deleted without removing them`);
      console.log(`  ${pc.cyan("--yes")}        Skip confirmation prompt`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops clean plan-abc123`);
      console.log(`  ${pc.dim("$")} dojops clean plan-abc123 --dry-run`);
      console.log(`  ${pc.dim("$")} dojops clean plan-abc123 --yes`);
      console.log();
      break;

    case "rollback":
      console.log(`\n${pc.bold("dojops rollback")} — Reverse an applied plan`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops rollback <plan-id> [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--dry-run")}    Preview files to be removed without deleting them`);
      console.log(`  ${pc.cyan("--yes")}        Skip confirmation prompt`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Removes files created by the most recent execution of the given plan.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops rollback plan-abc123`);
      console.log(`  ${pc.dim("$")} dojops rollback plan-abc123 --dry-run`);
      console.log();
      break;

    case "scan":
      console.log(`\n${pc.bold("dojops scan")} — Scan project for security vulnerabilities`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops scan [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--security")}     Run security scanners only (trivy, gitleaks)`);
      console.log(`  ${pc.cyan("--deps")}         Run dependency audit only (npm, pip)`);
      console.log(`  ${pc.cyan("--iac")}          Run IaC scanners only (checkov, hadolint)`);
      console.log(`  ${pc.cyan("--sbom")}         Generate Software Bill of Materials (CycloneDX)`);
      console.log(`  ${pc.cyan("--fix")}          Generate and apply LLM-powered remediation`);
      console.log(
        `  ${pc.cyan("--yes")}          Auto-approve remediation ${pc.dim("(requires --fix)")}`,
      );
      console.log(`\n${pc.bold("SCANNERS")}`);
      console.log(`  ${pc.cyan("npm audit")}      Node.js dependency vulnerabilities`);
      console.log(`  ${pc.cyan("pip-audit")}      Python dependency vulnerabilities`);
      console.log(
        `  ${pc.cyan("trivy")}          Filesystem vulnerability + secret + misconfig scan`,
      );
      console.log(`  ${pc.cyan("gitleaks")}       Secret/credential leak detection`);
      console.log(`  ${pc.cyan("checkov")}        Infrastructure-as-Code policy checks`);
      console.log(`  ${pc.cyan("hadolint")}       Dockerfile linting`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Runs security scanners against the project directory. Scanners are`);
      console.log(`  selected based on project context (detected via ${pc.cyan("dojops init")}).`);
      console.log(`  Missing scanner binaries are gracefully skipped.`);
      console.log();
      console.log(`  With ${pc.cyan("--fix")}, sends HIGH/CRITICAL findings to the LLM to`);
      console.log(`  generate a remediation plan, then applies approved patches.`);
      console.log(`\n${pc.bold("EXIT CODES")}`);
      console.log(`  0    No HIGH or CRITICAL findings`);
      console.log(`  6    HIGH findings detected`);
      console.log(`  7    CRITICAL findings detected`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops scan`);
      console.log(`  ${pc.dim("$")} dojops scan --deps`);
      console.log(`  ${pc.dim("$")} dojops scan --security`);
      console.log(`  ${pc.dim("$")} dojops scan --iac`);
      console.log(`  ${pc.dim("$")} dojops scan --fix`);
      console.log(`  ${pc.dim("$")} dojops scan --fix --yes`);
      console.log(`  ${pc.dim("$")} dojops scan --output json`);
      console.log();
      break;

    case "chat":
      console.log(`\n${pc.bold("dojops chat")} — Interactive AI DevOps session`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops chat`);
      console.log(`  ${pc.dim("$")} dojops chat --session <name>`);
      console.log(`  ${pc.dim("$")} dojops chat --resume`);
      console.log(`  ${pc.dim("$")} dojops chat --agent <name>`);
      console.log(`  ${pc.dim("$")} dojops chat --deterministic`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--session=NAME")}     Resume or create a named session`);
      console.log(`  ${pc.cyan("--resume")}           Resume the most recent session`);
      console.log(`  ${pc.cyan("--agent=NAME")}       Pin conversation to a specialist agent`);
      console.log(`  ${pc.cyan("--deterministic")}    Deterministic mode (no summarization)`);
      console.log(`\n${pc.bold("SLASH COMMANDS")}`);
      console.log(`  ${pc.cyan("/exit")}              Save and exit`);
      console.log(`  ${pc.cyan("/agent <name>")}      Pin to specialist agent (or 'auto')`);
      console.log(`  ${pc.cyan("/plan <goal>")}       Bridge to dojops plan`);
      console.log(`  ${pc.cyan("/apply")}             Bridge to dojops apply`);
      console.log(`  ${pc.cyan("/scan")}              Bridge to dojops scan`);
      console.log(`  ${pc.cyan("/history")}           Show session message history`);
      console.log(`  ${pc.cyan("/clear")}             Clear session messages`);
      console.log(`  ${pc.cyan("/save")}              Save session to disk`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops chat`);
      console.log(`  ${pc.dim("$")} dojops chat --session myproject`);
      console.log(`  ${pc.dim("$")} dojops chat --resume`);
      console.log(`  ${pc.dim("$")} dojops chat --agent terraform`);
      console.log(`  ${pc.dim("$")} dojops chat --deterministic`);
      console.log();
      break;

    case "tools":
      console.log(`\n${pc.bold("dojops tools")} — Manage DevOps tools (custom + marketplace)`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops tools [list|init|validate|load]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(`  ${pc.cyan("list")}              List all custom tools ${pc.dim("(default)")}`);
      console.log(
        `  ${pc.cyan("init <name>")}      Scaffold a new tool (tool.yaml + input.schema.json)`,
      );
      console.log(`  ${pc.cyan("validate <name>")}  Validate a tool manifest`);
      console.log(`  ${pc.cyan("load <path>")}      Load a tool from a local directory`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--output=json")}   Output list as JSON`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Custom tools are declarative manifests (tool.yaml) that define LLM-powered`);
      console.log(`  configuration generators. Tools are discovered from:`);
      console.log(`    - ~/.dojops/tools/<name>/    (global)`);
      console.log(`    - .dojops/tools/<name>/      (project, overrides global)`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops tools`);
      console.log(`  ${pc.dim("$")} dojops tools list`);
      console.log(`  ${pc.dim("$")} dojops tools init my-tool`);
      console.log(`  ${pc.dim("$")} dojops tools validate my-tool`);
      console.log(`  ${pc.dim("$")} dojops tools load /path/to/tool`);
      console.log(`  ${pc.dim("$")} dojops tools list --output json`);
      console.log();
      break;

    case "toolchain":
      console.log(`\n${pc.bold("dojops toolchain")} — Manage system toolchain`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops toolchain [list|load|install|remove|clean]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(
        `  ${pc.cyan("list")}              List all system tools with status ${pc.dim("(default)")}`,
      );
      console.log(`  ${pc.cyan("load")}              Re-scan and detect available tools`);
      console.log(`  ${pc.cyan("install <name>")}   Download and install a tool`);
      console.log(`  ${pc.cyan("remove <name>")}    Remove a tool`);
      console.log(`  ${pc.cyan("clean")}             Remove all toolchain tools`);
      console.log(`\n${pc.bold("AVAILABLE TOOLS")}`);
      console.log(`  ${pc.cyan("terraform")}    Infrastructure as Code (HashiCorp)`);
      console.log(`  ${pc.cyan("kubectl")}      Kubernetes CLI`);
      console.log(`  ${pc.cyan("gh")}           GitHub CLI`);
      console.log(`  ${pc.cyan("hadolint")}     Dockerfile linter`);
      console.log(`  ${pc.cyan("ansible")}      IT automation (via pipx/pip)`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--output=json")}   Output list as JSON`);
      console.log(`  ${pc.cyan("--yes")}           Skip confirmation (clean)`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  System tools are installed into ~/.dojops/toolchain/bin/ without elevated`);
      console.log(`  permissions. The toolchain bin directory is prepended to PATH at startup,`);
      console.log(`  so installed tools are available to all DojOps commands transparently.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops toolchain`);
      console.log(`  ${pc.dim("$")} dojops toolchain list`);
      console.log(`  ${pc.dim("$")} dojops toolchain load`);
      console.log(`  ${pc.dim("$")} dojops toolchain install terraform`);
      console.log(`  ${pc.dim("$")} dojops toolchain install kubectl`);
      console.log(`  ${pc.dim("$")} dojops toolchain remove terraform`);
      console.log(`  ${pc.dim("$")} dojops toolchain clean --yes`);
      console.log(`  ${pc.dim("$")} dojops toolchain list --output json`);
      console.log();
      break;

    case "check":
      console.log(`\n${pc.bold("dojops check")} — LLM-powered DevOps configuration quality check`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops check`);
      console.log(`  ${pc.dim("$")} dojops check --output json`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Reads DevOps files detected during ${pc.cyan("dojops init")} and sends them`);
      console.log(`  to the LLM for quality, security, and best-practice analysis.`);
      console.log();
      console.log(`  Returns a maturity score (0-100), findings by severity, and`);
      console.log(`  recommendations for missing files.`);
      console.log(`\n${pc.bold("SCORING")}`);
      console.log(`  ${pc.red("0-25")}   Minimal — missing critical configs`);
      console.log(`  ${pc.yellow("26-50")}  Basic — fundamentals present but gaps`);
      console.log(`  ${pc.cyan("51-75")}  Good — solid setup with room for improvement`);
      console.log(`  ${pc.green("76-100")} Excellent — production-ready with best practices`);
      console.log(`\n${pc.bold("PREREQUISITES")}`);
      console.log(`  Requires ${pc.cyan("dojops init")} and a configured LLM provider.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops check`);
      console.log(`  ${pc.dim("$")} dojops check --output json`);
      console.log();
      break;

    case "verify":
      console.log(`\n${pc.bold("dojops verify")} — Verify a configuration file`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} dojops verify <file>`);
      console.log(`\n${pc.bold("SUPPORTED FILE TYPES")}`);
      console.log(`  ${pc.cyan(".tf")}                  Terraform (terraform validate)`);
      console.log(`  ${pc.cyan("Dockerfile")}           Docker (hadolint)`);
      console.log(`  ${pc.cyan(".yaml/.yml")}           Auto-detected:`);
      console.log(`    - Kubernetes (apiVersion + kind)     kubectl dry-run`);
      console.log(`    - GitHub Actions (on + jobs)         structural lint`);
      console.log(`    - GitLab CI (.gitlab-ci.yml)         structural lint`);
      console.log(`    - Docker Compose (services)          structural lint`);
      console.log(`    - Helm (Chart.yaml, values.yaml)     structural lint`);
      console.log(`    - Prometheus (global + scrape)        structural lint`);
      console.log(`    - Ansible (hosts + tasks)            structural lint`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} dojops verify main.tf`);
      console.log(`  ${pc.dim("$")} dojops verify Dockerfile`);
      console.log(`  ${pc.dim("$")} dojops verify k8s/deployment.yaml`);
      console.log(`  ${pc.dim("$")} dojops verify .github/workflows/ci.yml`);
      console.log();
      break;

    default:
      printHelp();
  }
}
