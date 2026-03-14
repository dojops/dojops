# Contributing

Contributions to DojOps are welcome. This guide covers development setup, coding standards, testing, and how to add new tools and agents.

---

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 8
- **TypeScript** >= 5.4

---

## Development Setup

```bash
# Clone the repository
git clone https://github.com/dojops/dojops.git
cd dojops

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linter
pnpm lint
```

---

## Monorepo Structure

```
packages/
  cli/              CLI entry point + TUI (@clack/prompts)
  api/              REST API (Express) + web dashboard
  skill-registry/   Skill registry + custom skill system (built-in + custom skill discovery)
  core/             LLM providers (6) + specialist agents (16) + CI debugger + infra diff + DevOps checker
  planner/          Task graph decomposition + topological executor
  executor/         SafeExecutor + policy engine + approval workflows + audit log
  runtime/          13 built-in DevOps skills as .dops v2 files
  scanner/          10 security scanners + remediation engine
  session/          Chat session management + memory + context injection
  sdk/              BaseSkill<T> abstract class + Zod re-export + verification types + file-reader utilities
```

Package scope: `@dojops/*`

Dependency flow: `cli -> api -> skill-registry -> runtime -> core -> sdk`

---

## Build, Test, Lint

```bash
# Build all packages via Turbo
pnpm build

# Dev mode (no caching)
pnpm dev

# Run all tests (Vitest)
pnpm test

# Run tests for a specific package
pnpm --filter @dojops/core test
pnpm --filter @dojops/api test

# ESLint across all packages
pnpm lint

# Prettier write
pnpm format

# Prettier check (CI mode)
pnpm format:check

# Run CLI locally (no global install)
pnpm dojops -- "Create a Terraform config for S3"
pnpm dojops -- serve --port=8080
```

---

## Code Style

- **TypeScript** — ES2022, CommonJS modules
- **ESLint** — Enforced across all packages
- **Prettier** — Auto-formatting
- **Husky + lint-staged** — Pre-commit hooks run linting and formatting

Key conventions:

- Use Zod for all schema validation (inputs, outputs, API requests)
- Use `parseAndValidate()` for LLM response parsing
- Follow the existing barrel export pattern (`index.ts` in each package)
- Prefer interfaces over type aliases for public APIs
- Use `async/await` over raw Promises

---

## Testing

DojOps uses Vitest for testing. Current coverage:

| Package                  | Tests    |
| ------------------------ | -------- |
| `@dojops/runtime`        | 481      |
| `@dojops/core`           | 465      |
| `@dojops/cli`            | 247      |
| `@dojops/api`            | 236      |
| `@dojops/skill-registry` | 224      |
| `@dojops/scanner`        | 110      |
| `@dojops/executor`       | 67       |
| `@dojops/planner`        | 39       |
| `@dojops/session`        | 38       |
| `@dojops/sdk`            | 24       |
| **Total**                | **1931** |

### Writing Tests

- Place test files in `__tests__/` directories mirroring the source structure: `src/foo.ts` -> `src/__tests__/foo.test.ts`
- Mock LLM providers for deterministic tests
- Use `supertest` for API endpoint integration tests
- Test both success and error paths

---

## Adding a New Skill

All skills follow the `BaseSkill<T>` pattern. See [DevOps Skills](skills.md) for the full pattern.

### Step-by-Step

1. **Create directory:** `packages/runtime/src/my-skill/`

2. **Define schemas** (`schemas.ts`):

   ```typescript
   import { z } from "@dojops/sdk";

   export const MyToolInputSchema = z.object({
     name: z.string(),
     // tool-specific fields
     existingContent: z
       .string()
       .optional()
       .describe(
         "Existing config file content to update/enhance. If omitted, tool auto-detects existing files.",
       ),
   });

   export const MyToolOutputSchema = z.object({
     // LLM response structure
   });

   export type MyToolInput = z.infer<typeof MyToolInputSchema>;
   export type MyToolOutput = z.infer<typeof MyToolOutputSchema>;
   ```

3. **Implement generator** (`generator.ts`):

   ```typescript
   import { parseAndValidate } from "@dojops/core";

   export async function generateMyTool(
     input: MyToolInput,
     provider: LLMProvider,
     existingContent?: string,
   ) {
     const isUpdate = !!existingContent;
     const system = isUpdate
       ? "Update the existing config. Preserve existing structure and settings."
       : "Generate a new config from scratch.";
     const prompt = isUpdate
       ? `${buildPrompt(input)}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
       : buildPrompt(input);
     const response = await provider.generate({ system, prompt, schema: MyToolOutputSchema });
     return parseAndValidate(response.content, MyToolOutputSchema);
   }
   ```

4. **Create skill class** (`my-skill.ts`):

   ```typescript
   import { BaseSkill, readExistingConfig, backupFile, atomicWriteFileSync } from "@dojops/sdk";

   export class MySkill extends BaseSkill<MyToolInput> {
     name = "my-tool";
     inputSchema = MyToolInputSchema;

     async generate(input: MyToolInput) {
       const existingContent = input.existingContent ?? readExistingConfig(outputPath);
       const isUpdate = !!existingContent;
       const result = await generateMyTool(input, this.provider, existingContent);
       return { success: true, data: { ...result, isUpdate } };
     }

     async execute(input: MyToolInput) {
       const result = await this.generate(input);
       if (result.data.isUpdate) backupFile(outputPath);
       atomicWriteFileSync(outputPath, result.data.content);
       return {
         ...result,
         filesWritten: [outputPath],
         filesModified: result.data.isUpdate ? [outputPath] : [],
       };
     }
   }
   ```

5. **Optional: Add detector** (`detector.ts`) for filesystem context detection

6. **Optional: Add verifier** (`verifier.ts`) for external tool validation

7. **Export:** Add to `packages/runtime/src/index.ts`

8. **Write tests:** `my-skill.test.ts` with mocked LLM provider — include tests for auto-detection of existing files, update mode prompts, and `.bak` backup creation

---

## Creating a Custom Skill

For skills that don't need to be built into the core, use the custom skill system instead. Custom skills are declarative — no TypeScript code required.

### Step-by-Step

1. **Scaffold** a custom skill:

   ```bash
   dojops skills init my-skill
   ```

   This creates `.dojops/skills/my-skill.dops` with a template `.dops v2` file.

2. **Edit** the `.dops` file — set the name, description, context, output files, and prompt sections.

3. **Validate** the skill:

   ```bash
   dojops skills validate .dojops/skills/my-skill.dops
   ```

4. **Test** by generating a config:

   ```bash
   dojops "Generate my-skill config for production"
   ```

Custom skills are automatically discovered and available to the Planner, Executor, and API. See [DevOps Skills — Custom Skill System](skills.md#custom-skill-system) for the full format.

---

## Adding a New Agent

There are two ways to add agents: as a **custom agent** (no source code changes) or as a **built-in agent** (requires modifying the codebase).

### Option 1: Custom Agent (Recommended for Most Cases)

Create a custom agent without modifying DojOps source code:

```bash
# LLM-generated (recommended)
dojops agents create "an SRE specialist for incident response and reliability"

# Manual creation via interactive prompts
dojops agents create --manual
```

Custom agents are stored as structured `README.md` files in `.dojops/agents/<name>/` (project) or `~/.dojops/agents/<name>/` (global). They participate in the same keyword-based routing as built-in agents and can override built-in agents by name.

See [Specialist Agents — Custom Agents](agents.md#custom-agents) for the full README.md format and discovery rules.

### Option 2: Built-in Agent (For Core Contributions)

Built-in agents are defined in `packages/core/src/agents/specialists.ts`.

1. Add a new entry to the specialists array:

   ```typescript
   {
     name: "my-specialist",
     domain: "my-domain",
     description: "Expert in...",
     keywords: ["keyword1", "keyword2", "keyword3"],
     toolDependencies: ["optional-tool"],
   }
   ```

2. The agent will automatically:
   - Be registered in the `AgentRouter`
   - Appear in `dojops agents list`
   - Be available in the API (`GET /api/agents`)
   - Be routable by keyword matching

3. Write tests for keyword routing accuracy.

---

## PR Workflow

1. **Fork** the repository
2. **Branch** from `main`: `git checkout -b feature/my-feature`
3. **Implement** your changes with tests
4. **Verify:**
   ```bash
   pnpm build
   pnpm test
   pnpm lint
   pnpm format:check
   ```
5. **Commit** with a descriptive message
6. **Submit** a pull request against `main`

### PR Checklist

- [ ] All tests pass (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Formatting is correct (`pnpm format:check`)
- [ ] New features include tests
- [ ] New skills follow the `BaseSkill<T>` pattern
- [ ] Breaking changes are documented

---

## License

DojOps is licensed under the [MIT License](../LICENSE).
