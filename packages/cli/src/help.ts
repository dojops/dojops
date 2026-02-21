import pc from "picocolors";

export function printHelp(): void {
  console.log();
  console.log(`  ${pc.bold(pc.cyan("oda"))} — AI-powered DevOps automation agent`);
  console.log();
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
  console.log(`  ${pc.cyan("history verify")}    Verify audit log hash chain integrity`);
  console.log(`  ${pc.cyan("config")}             Configure provider, model, tokens`);
  console.log(`  ${pc.cyan("auth")}               Authenticate with LLM provider`);
  console.log(`  ${pc.cyan("serve")}              Start API server + dashboard`);
  console.log(`  ${pc.cyan("doctor")}             System health diagnostics`);
  console.log(`  ${pc.cyan("init")}               Initialize .oda/ in project`);
  console.log(`  ${pc.cyan("destroy")}            Remove generated artifacts from a plan`);
  console.log(`  ${pc.cyan("rollback")}           Reverse an applied plan`);
  console.log();
  console.log(pc.bold("GLOBAL OPTIONS"));
  console.log(`  ${pc.cyan("--provider=NAME")}    LLM provider: openai, anthropic, ollama`);
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
  console.log(`  ${pc.cyan("--dry-run")}          Preview changes without executing`);
  console.log(`  ${pc.cyan("--resume")}           Resume a partially-applied plan`);
  console.log(`  ${pc.cyan("--yes")}              Auto-approve all executions`);
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
  console.log(`  Token:     $OPENAI_API_KEY / $ANTHROPIC_API_KEY  >  config token`);
  console.log();
  console.log(pc.bold("MODELS"));
  console.log(`  ${pc.dim("OpenAI:")}    gpt-4o, gpt-4o-mini`);
  console.log(`  ${pc.dim("Anthropic:")} claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001`);
  console.log(`  ${pc.dim("Ollama:")}    llama3, mistral, codellama`);
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
      console.log(`  ${pc.cyan("--execute")}    Generate + execute tasks with approval`);
      console.log(`  ${pc.cyan("--yes")}        Auto-approve all executions`);
      console.log();
      break;
    case "debug":
      console.log(`\n${pc.bold("oda debug ci")} — Diagnose CI/CD log failures`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda debug ci <log-content>`);
      console.log();
      break;
    case "analyze":
      console.log(`\n${pc.bold("oda analyze")} — Analyze infrastructure changes`);
      console.log(`\n${pc.bold("USAGE")}`);
      console.log(`  ${pc.dim("$")} oda analyze diff <diff-content>`);
      console.log();
      break;
    default:
      printHelp();
  }
}
