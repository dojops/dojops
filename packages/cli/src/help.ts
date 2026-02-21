import pc from "picocolors";

function printBanner(): void {
  const c = pc.cyan;
  const d = pc.dim;
  const bc = (s: string) => pc.bold(pc.cyan(s));

  console.log();
  console.log(d("  ╔══════════════════════════════════════════════╗"));
  console.log(d("  ║") + "                                              " + d("║"));
  console.log(d("  ║") + bc("       ██████╗  ██████╗   █████╗              ") + d("║"));
  console.log(d("  ║") + bc("      ██╔═══██╗ ██╔══██╗ ██╔══██╗             ") + d("║"));
  console.log(d("  ║") + bc("      ██║   ██║ ██║  ██║ ███████║             ") + d("║"));
  console.log(d("  ║") + bc("      ██║   ██║ ██║  ██║ ██╔══██║             ") + d("║"));
  console.log(d("  ║") + bc("      ╚██████╔╝ ██████╔╝ ██║  ██║             ") + d("║"));
  console.log(d("  ║") + bc("       ╚═════╝  ╚═════╝  ╚═╝  ╚═╝             ") + d("║"));
  console.log(d("  ║") + "                                              " + d("║"));
  console.log(
    d("  ║") +
      "  " +
      c("▸") +
      pc.bold(pc.white(" Open DevOps Agent")) +
      d("  ·  v1.0.0              ") +
      d("║"),
  );
  console.log(d("  ║") + "  " + d("  AI-powered DevOps automation engine       ") + d("║"));
  console.log(d("  ║") + "                                              " + d("║"));
  console.log(d("  ╚══════════════════════════════════════════════╝"));
  console.log();
}

export { printBanner };

export function printHelp(): void {
  printBanner();
  console.log(pc.bold("USAGE"));
  console.log(`  ${pc.dim("$")} oda [command] [options] <prompt>`);
  console.log();
  console.log(pc.bold("COMMANDS"));
  console.log(`  ${pc.cyan("plan")}               Decompose goal into task graph`);
  console.log(`  ${pc.cyan("generate")}           Generate DevOps config ${pc.dim("(default)")}`);
  console.log(`  ${pc.cyan("apply")}              Execute a saved plan`);
  console.log(`  ${pc.cyan("validate")}           Validate plan against schemas`);
  console.log(`  ${pc.cyan("explain")}            LLM explains a plan`);
  console.log(`  ${pc.cyan("debug ci")}           Diagnose CI/CD log failures`);
  console.log(`  ${pc.cyan("analyze diff")}       Analyze infrastructure diff for risk`);
  console.log(`  ${pc.cyan("inspect")}            Inspect config, policy, agents, session`);
  console.log(`  ${pc.cyan("agents")}             List and inspect specialist agents`);
  console.log(`  ${pc.cyan("history")}            View execution history`);
  console.log(`  ${pc.cyan("history verify")}     Verify audit log hash chain integrity`);
  console.log(`  ${pc.cyan("config")}             Configure provider, model, tokens`);
  console.log(`  ${pc.cyan("auth")}               Authenticate with LLM provider`);
  console.log(`  ${pc.cyan("serve")}              Start API server + dashboard`);
  console.log(`  ${pc.cyan("tools")}              Manage system tool sandbox (~/.oda/tools/)`);
  console.log(
    `  ${pc.cyan("status")}             System health diagnostics ${pc.dim("(alias: doctor)")}`,
  );
  console.log(`  ${pc.cyan("init")}               Initialize .oda/ + scan repo context`);
  console.log(`  ${pc.cyan("destroy")}            Remove generated artifacts from a plan`);
  console.log(`  ${pc.cyan("rollback")}           Reverse an applied plan`);
  console.log();
  console.log(pc.bold("GLOBAL OPTIONS"));
  console.log(
    `  ${pc.cyan("--provider=NAME")}    LLM provider: openai, anthropic, ollama, deepseek, gemini`,
  );
  console.log(`  ${pc.cyan("--model=NAME")}       LLM model override`);
  console.log(`  ${pc.cyan("--profile=NAME")}     Use named config profile`);
  console.log(
    `  ${pc.cyan("--output=FORMAT")}    Output: table ${pc.dim("(default)")}, json, yaml`,
  );
  console.log(`  ${pc.cyan("--verbose")}          Verbose output`);
  console.log(`  ${pc.cyan("--debug")}            Debug-level output`);
  console.log(`  ${pc.cyan("--quiet")}            Suppress non-essential output`);
  console.log(`  ${pc.cyan("--no-color")}         Disable color output`);
  console.log(`  ${pc.cyan("--non-interactive")}  Disable interactive prompts`);
  console.log(`  ${pc.cyan("--help, -h")}         Show this help message`);
  console.log();
  console.log(pc.bold("PLAN OPTIONS"));
  console.log(`  ${pc.cyan("--execute")}          Generate + execute with approval workflow`);
  console.log(`  ${pc.cyan("--yes")}              Auto-approve all executions`);
  console.log();
  console.log(pc.bold("APPLY OPTIONS"));
  console.log(`  ${pc.cyan("--dry-run")}              Preview changes without executing`);
  console.log(`  ${pc.cyan("--resume")}               Resume a partially-applied plan`);
  console.log(`  ${pc.cyan("--yes")}                  Auto-approve all executions`);
  console.log(`  ${pc.cyan("--install-packages")}     Run package install after apply`);
  console.log();
  console.log(pc.bold("SERVE OPTIONS"));
  console.log(`  ${pc.cyan("--port=N")}           API server port ${pc.dim("(default: 3000)")}`);
  console.log();
  console.log(pc.bold("BACKWARD COMPATIBILITY"));
  console.log(`  ${pc.dim("$")} oda --plan "..."             ${pc.dim('→ oda plan "..."')}`);
  console.log(
    `  ${pc.dim("$")} oda --execute "..."          ${pc.dim('→ oda plan --execute "..."')}`,
  );
  console.log(`  ${pc.dim("$")} oda --debug-ci "..."         ${pc.dim('→ oda debug ci "..."')}`);
  console.log(
    `  ${pc.dim("$")} oda --diff "..."             ${pc.dim('→ oda analyze diff "..."')}`,
  );
  console.log(`  ${pc.dim("$")} oda login ...                ${pc.dim("→ oda auth login ...")}`);
  console.log(`  ${pc.dim("$")} oda config --show            ${pc.dim("→ oda config show")}`);
  console.log(`  ${pc.dim("$")} oda doctor                   ${pc.dim("→ oda status")}`);
  console.log();
  console.log(pc.bold("EXAMPLES"));
  console.log(`  ${pc.dim("$")} oda "Create a Terraform config for S3"`);
  console.log(`  ${pc.dim("$")} oda plan "Set up CI/CD for a Node.js app"`);
  console.log(`  ${pc.dim("$")} oda plan --execute --yes "Create CI for Node app"`);
  console.log(`  ${pc.dim("$")} oda apply`);
  console.log(`  ${pc.dim("$")} oda debug ci "ERROR: tsc failed..."`);
  console.log(`  ${pc.dim("$")} oda analyze diff "terraform plan output..."`);
  console.log(`  ${pc.dim("$")} oda explain last`);
  console.log(`  ${pc.dim("$")} oda doctor`);
  console.log(`  ${pc.dim("$")} oda agents list`);
  console.log(`  ${pc.dim("$")} oda history list`);
  console.log(`  ${pc.dim("$")} oda serve --port=8080`);
  console.log(`  ${pc.dim("$")} oda plan "Create CI" --output json`);
  console.log(`  ${pc.dim("$")} oda config profile create staging`);
  console.log();
  console.log(pc.bold("CONFIGURATION PRECEDENCE"));
  console.log(`  Provider:  --provider  >  $ODA_PROVIDER  >  config  >  openai`);
  console.log(`  Model:     --model     >  $ODA_MODEL     >  config  >  provider default`);
  console.log(
    `  Token:     $OPENAI_API_KEY / $ANTHROPIC_API_KEY / $DEEPSEEK_API_KEY / $GEMINI_API_KEY  >  config token`,
  );
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
  console.log(`  5    No .oda/ project`);
  console.log();
}

export function printCommandHelp(command: string): void {
  switch (command) {
    case "plan":
      console.log(`\n${pc.bold("oda plan")} — Decompose a goal into a task graph`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda plan <prompt>`);
      console.log(`  ${pc.dim("$")} oda plan --execute <prompt>`);
      console.log(`  ${pc.dim("$")} oda plan --execute --yes <prompt>`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--execute")}    Generate + execute tasks with approval workflow`);
      console.log(
        `  ${pc.cyan("--yes")}        Auto-approve all executions ${pc.dim("(implies --non-interactive)")}`,
      );
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda plan "Set up CI/CD for a Node.js app"`);
      console.log(`  ${pc.dim("$")} oda plan --execute "Deploy a Terraform stack"`);
      console.log(`  ${pc.dim("$")} oda plan --execute --yes "Create CI for Node app"`);
      console.log(`  ${pc.dim("$")} oda plan "Create CI" --output json`);
      console.log();
      break;

    case "generate":
      console.log(
        `\n${pc.bold("oda generate")} — Generate DevOps configuration via specialist agent`,
      );
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda <prompt>`);
      console.log(`  ${pc.dim("$")} oda generate <prompt>`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Routes your prompt to the best-matching specialist agent and generates`);
      console.log(`  a response. This is the default command when no subcommand is given.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda "Create a Terraform config for S3"`);
      console.log(`  ${pc.dim("$")} oda generate "Write a Kubernetes deployment"`);
      console.log(`  ${pc.dim("$")} oda "Set up monitoring with Prometheus" --output json`);
      console.log();
      break;

    case "apply":
      console.log(`\n${pc.bold("oda apply")} — Execute a saved plan`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda apply [<plan-id>] [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--dry-run")}            Preview changes without writing files`);
      console.log(`  ${pc.cyan("--resume")}             Skip previously completed tasks`);
      console.log(
        `  ${pc.cyan("--yes")}                Auto-approve all executions ${pc.dim("(implies --non-interactive)")}`,
      );
      console.log(`  ${pc.cyan("--install-packages")}  Run package install after successful apply`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Executes a previously saved plan. If no plan ID is given, uses the`);
      console.log(`  current session plan or the most recent one.`);
      console.log();
      console.log(`  Shows a pre-flight summary of all tasks before execution. Use`);
      console.log(`  --dry-run to preview without writing files.`);
      console.log();
      console.log(`  With --install-packages, runs the detected package manager's install`);
      console.log(`  command (e.g. pnpm install, npm install) after a successful apply.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda apply`);
      console.log(`  ${pc.dim("$")} oda apply --dry-run`);
      console.log(`  ${pc.dim("$")} oda apply --resume --yes`);
      console.log(`  ${pc.dim("$")} oda apply --install-packages`);
      console.log(`  ${pc.dim("$")} oda apply plan-abc123`);
      console.log();
      break;

    case "validate":
      console.log(`\n${pc.bold("oda validate")} — Validate a plan against schemas`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda validate [<plan-id>]`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Validates that each task in a plan has a valid id, tool, description,`);
      console.log(`  and that dependencies reference existing tasks.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda validate`);
      console.log(`  ${pc.dim("$")} oda validate plan-abc123`);
      console.log();
      break;

    case "explain":
      console.log(`\n${pc.bold("oda explain")} — LLM explains a plan in plain language`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda explain [<plan-id>|last]`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Uses the LLM to explain what a plan does, its tasks, dependencies,`);
      console.log(`  and potential risks. Defaults to the current session plan.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda explain`);
      console.log(`  ${pc.dim("$")} oda explain last`);
      console.log(`  ${pc.dim("$")} oda explain plan-abc123`);
      console.log();
      break;

    case "debug":
    case "debug ci":
      console.log(`\n${pc.bold("oda debug ci")} — Diagnose CI/CD log failures`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda debug ci <log-content>`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Analyzes CI build logs to identify root causes of failures.`);
      console.log(
        `  Returns error type, summary, root cause, affected files, and suggested fixes.`,
      );
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda debug ci "ERROR: tsc failed with exit code 1"`);
      console.log(`  ${pc.dim("$")} oda debug ci "npm ERR! peer dep missing: react@^18"`);
      console.log();
      break;

    case "analyze":
    case "analyze diff":
      console.log(`\n${pc.bold("oda analyze diff")} — Analyze infrastructure diff for risk`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda analyze diff <diff-content>`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Analyzes infrastructure diffs (e.g. terraform plan output) and provides`);
      console.log(`  risk assessment, cost impact, security impact, and recommendations.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda analyze diff "terraform plan output..."`);
      console.log(`  ${pc.dim("$")} oda analyze diff "+ resource aws_s3_bucket main {}"`);
      console.log();
      break;

    case "inspect":
      console.log(`\n${pc.bold("oda inspect")} — Inspect runtime configuration and state`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda inspect <target>`);
      console.log(`\n${pc.bold("TARGETS")}`);
      console.log(`  ${pc.cyan("config")}     Show resolved provider, model, and tokens`);
      console.log(`  ${pc.cyan("policy")}     Show execution policies`);
      console.log(`  ${pc.cyan("agents")}     List specialist agents`);
      console.log(`  ${pc.cyan("session")}    Show current session state`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda inspect config`);
      console.log(`  ${pc.dim("$")} oda inspect agents`);
      console.log(`  ${pc.dim("$")} oda inspect session --output json`);
      console.log();
      break;

    case "agents":
      console.log(`\n${pc.bold("oda agents")} — List and inspect specialist agents`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda agents [list|info <name>]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(`  ${pc.cyan("list")}         List all specialist agents ${pc.dim("(default)")}`);
      console.log(`  ${pc.cyan("info <name>")}  Show details for a specific agent`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda agents`);
      console.log(`  ${pc.dim("$")} oda agents list`);
      console.log(`  ${pc.dim("$")} oda agents info ops-cortex`);
      console.log(`  ${pc.dim("$")} oda agents list --output json`);
      console.log();
      break;

    case "history":
      console.log(`\n${pc.bold("oda history")} — View execution history and audit logs`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda history [list|show <plan-id>|verify|rollback <plan-id>]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(
        `  ${pc.cyan("list")}              List all plans with status ${pc.dim("(default)")}`,
      );
      console.log(`  ${pc.cyan("show <plan-id>")}    Show plan details and execution results`);
      console.log(`  ${pc.cyan("verify")}            Verify audit log hash chain integrity`);
      console.log(`  ${pc.cyan("rollback <plan-id>")} Reverse an applied plan`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda history`);
      console.log(`  ${pc.dim("$")} oda history list`);
      console.log(`  ${pc.dim("$")} oda history show plan-abc123`);
      console.log(`  ${pc.dim("$")} oda history verify`);
      console.log();
      break;

    case "config":
      console.log(`\n${pc.bold("oda config")} — Configure provider, model, and tokens`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda config [show]`);
      console.log(`  ${pc.dim("$")} oda config [--provider=NAME] [--model=NAME] [--token=KEY]`);
      console.log(`  ${pc.dim("$")} oda config profile <create|use|list> [name]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--provider=NAME")}  Set default LLM provider`);
      console.log(`  ${pc.cyan("--model=NAME")}     Set default model`);
      console.log(`  ${pc.cyan("--token=KEY")}      Save API token for current provider`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(`  ${pc.cyan("show")}             Display current configuration`);
      console.log(`  ${pc.cyan("profile create")}   Save current config as a named profile`);
      console.log(`  ${pc.cyan("profile use")}      Switch to a named profile`);
      console.log(`  ${pc.cyan("profile list")}     List all profiles`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Without arguments, launches an interactive configuration wizard.`);
      console.log(`  With flags, applies settings directly and exits.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda config`);
      console.log(`  ${pc.dim("$")} oda config show`);
      console.log(`  ${pc.dim("$")} oda config --provider=anthropic`);
      console.log(`  ${pc.dim("$")} oda config --token=sk-...`);
      console.log(`  ${pc.dim("$")} oda config profile create staging`);
      console.log(`  ${pc.dim("$")} oda config profile use staging`);
      console.log(`  ${pc.dim("$")} oda config profile list`);
      console.log();
      break;

    case "auth":
      console.log(`\n${pc.bold("oda auth")} — Authenticate with LLM provider`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda auth login [--token=KEY] [--provider=NAME]`);
      console.log(`  ${pc.dim("$")} oda auth status`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(`  ${pc.cyan("login")}    Save API token for a provider`);
      console.log(`  ${pc.cyan("status")}   Show saved tokens and default provider`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--token=KEY")}      API key to save`);
      console.log(`  ${pc.cyan("--provider=NAME")}  Provider to authenticate with`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda auth login --token=sk-...`);
      console.log(`  ${pc.dim("$")} oda auth login --provider=anthropic --token=sk-ant-...`);
      console.log(`  ${pc.dim("$")} oda auth status`);
      console.log();
      break;

    case "serve":
      console.log(`\n${pc.bold("oda serve")} — Start REST API server and web dashboard`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda serve [--port=N]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(
        `  ${pc.cyan("--port=N")}    API server port ${pc.dim("(default: 3000, or $ODA_API_PORT)")}`,
      );
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Starts an Express server exposing all ODA capabilities via REST API`);
      console.log(`  and a web dashboard at the root URL.`);
      console.log(`\n${pc.bold("ENDPOINTS")}`);
      console.log(`  GET  /api/health       Provider status`);
      console.log(`  POST /api/generate     Agent-routed LLM generation`);
      console.log(`  POST /api/plan         Decompose goal into task graph`);
      console.log(`  POST /api/debug-ci     CI log diagnosis`);
      console.log(`  POST /api/diff         Infrastructure diff analysis`);
      console.log(`  GET  /api/agents       List specialist agents`);
      console.log(`  GET  /api/history      Execution history`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda serve`);
      console.log(`  ${pc.dim("$")} oda serve --port=8080`);
      console.log();
      break;

    case "status":
    case "doctor":
      console.log(`\n${pc.bold("oda status")} — System health diagnostics`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda status`);
      console.log(`  ${pc.dim("$")} oda doctor   ${pc.dim("(alias)")}`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Runs diagnostic checks on your ODA installation:`);
      console.log(`  - Node.js version (>= 18)`);
      console.log(`  - LLM provider configured`);
      console.log(`  - API key present`);
      console.log(`  - .oda/ project initialized`);
      console.log(`  - Ollama reachability (if applicable)`);
      console.log(`  - Config file permissions`);
      console.log(`  - Agent tool dependencies (ShellCheck, Snyk, etc.)`);
      console.log();
      console.log(`  When missing tools are detected, offers to install them interactively.`);
      console.log(`  Use --non-interactive to skip the install prompt.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda status`);
      console.log(`  ${pc.dim("$")} oda status --output json`);
      console.log();
      break;

    case "init":
      console.log(`\n${pc.bold("oda init")} — Initialize .oda/ project directory and scan repo`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda init`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Creates the .oda/ directory structure and scans the repository to`);
      console.log(`  build a structured context file (.oda/context.json).`);
      console.log();
      console.log(`  ${pc.bold("Directory structure:")}`);
      console.log(`  - .oda/plans/         Saved plan files`);
      console.log(`  - .oda/history/       Hash-chained audit trail`);
      console.log(`  - .oda/session.json   Current session state`);
      console.log(`  - .oda/context.json   Detected repo context`);
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
        `  Re-running ${pc.cyan("oda init")} on an existing project updates context.json`,
      );
      console.log(`  without recreating existing directories.`);
      console.log();
      console.log(`  ${pc.bold("LLM enrichment:")}`);
      console.log(
        `  When an LLM provider is configured (via ${pc.cyan("oda config")} or env vars),`,
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
      console.log(`  ${pc.dim("$")} oda init`);
      console.log(`  ${pc.dim("$")} oda init && cat .oda/context.json`);
      console.log();
      break;

    case "destroy":
      console.log(`\n${pc.bold("oda destroy")} — Remove generated artifacts from a plan`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda destroy <plan-id> [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--dry-run")}    Preview files to be deleted without removing them`);
      console.log(`  ${pc.cyan("--yes")}        Skip confirmation prompt`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda destroy plan-abc123`);
      console.log(`  ${pc.dim("$")} oda destroy plan-abc123 --dry-run`);
      console.log(`  ${pc.dim("$")} oda destroy plan-abc123 --yes`);
      console.log();
      break;

    case "rollback":
      console.log(`\n${pc.bold("oda rollback")} — Reverse an applied plan`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda rollback <plan-id> [options]`);
      console.log(`\n${pc.bold("OPTIONS")}`);
      console.log(`  ${pc.cyan("--dry-run")}    Preview files to be removed without deleting them`);
      console.log(`  ${pc.cyan("--yes")}        Skip confirmation prompt`);
      console.log(`\n${pc.bold("DESCRIPTION")}`);
      console.log(`  Removes files created by the most recent execution of the given plan.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda rollback plan-abc123`);
      console.log(`  ${pc.dim("$")} oda rollback plan-abc123 --dry-run`);
      console.log();
      break;

    case "tools":
      console.log(`\n${pc.bold("oda tools")} — Manage system tool sandbox`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda tools [list|install|remove|clean]`);
      console.log(`\n${pc.bold("SUBCOMMANDS")}`);
      console.log(
        `  ${pc.cyan("list")}              List all system tools with status ${pc.dim("(default)")}`,
      );
      console.log(`  ${pc.cyan("install <name>")}   Download and install a tool into sandbox`);
      console.log(`  ${pc.cyan("remove <name>")}    Remove a tool from sandbox`);
      console.log(`  ${pc.cyan("clean")}             Remove all sandbox tools`);
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
      console.log(`  Tools are installed into ~/.oda/tools/bin/ without elevated permissions.`);
      console.log(`  The sandbox bin directory is prepended to PATH at startup, so installed`);
      console.log(`  tools are available to all ODA commands transparently.`);
      console.log(`\n${pc.bold("EXAMPLES")}`);
      console.log(`  ${pc.dim("$")} oda tools`);
      console.log(`  ${pc.dim("$")} oda tools list`);
      console.log(`  ${pc.dim("$")} oda tools install terraform`);
      console.log(`  ${pc.dim("$")} oda tools install kubectl`);
      console.log(`  ${pc.dim("$")} oda tools remove terraform`);
      console.log(`  ${pc.dim("$")} oda tools clean --yes`);
      console.log(`  ${pc.dim("$")} oda tools list --output json`);
      console.log();
      break;

    default:
      printHelp();
  }
}
