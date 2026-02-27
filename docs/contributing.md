# Contributing

Contributions to DojOps are welcome. This guide covers development setup, coding standards, testing, and how to add new tools and agents.

---

## Prerequisites

- **Node.js** >= 18
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
  tool-registry/    Tool registry + custom tool system (built-in + custom tool discovery)
  core/             LLM providers (5) + specialist agents (16) + CI debugger + infra diff + DevOps checker
  planner/          Task graph decomposition + topological executor
  executor/         SafeExecutor + policy engine + approval workflows + audit log
  tools/            12 built-in DevOps tools
  scanner/          8 security scanners + remediation engine
  session/          Chat session management + memory + context injection
  sdk/              BaseTool<T> abstract class + Zod re-export + verification types + file-reader utilities
```

Package scope: `@dojops/*`

Dependency flow: `cli -> api -> tool-registry -> tools -> core -> sdk`

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

| Package                 | Tests   |
| ----------------------- | ------- |
| `@dojops/core`          | 238     |
| `@dojops/cli`           | 174     |
| `@dojops/tool-registry` | 148     |
| `@dojops/tools`         | 139     |
| `@dojops/api`           | 118     |
| `@dojops/executor`      | 50      |
| `@dojops/scanner`       | 49      |
| `@dojops/planner`       | 28      |
| `@dojops/session`       | 28      |
| `@dojops/sdk`           | 20      |
| **Total**               | **992** |

### Writing Tests

- Place test files adjacent to source files: `foo.ts` -> `foo.test.ts`
- Mock LLM providers for deterministic tests
- Use `supertest` for API endpoint integration tests
- Test both success and error paths

---

## Adding a New Tool

All tools follow the `BaseTool<T>` pattern. See [DevOps Tools](tools.md) for the full pattern.

### Step-by-Step

1. **Create directory:** `packages/tools/src/my-tool/`

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

4. **Create tool class** (`my-tool.ts`):

   ```typescript
   import { BaseTool, readExistingConfig, backupFile, atomicWriteFileSync } from "@dojops/sdk";

   export class MyTool extends BaseTool<MyToolInput> {
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

7. **Export:** Add to `packages/tools/src/index.ts`

8. **Write tests:** `my-tool.test.ts` with mocked LLM provider — include tests for auto-detection of existing files, update mode prompts, and `.bak` backup creation

---

## Creating a Custom Tool

For tools that don't need to be built into the core, use the custom tool system instead. Custom tools are declarative — no TypeScript code required.

### Step-by-Step

1. **Scaffold** a custom tool:

   ```bash
   dojops tools init my-tool
   ```

   This creates `.dojops/tools/my-tool/` with template `tool.yaml` and `input.schema.json`.

2. **Edit** `tool.yaml` — set the name, description, system prompt, output files, and serializer.

3. **Edit** `input.schema.json` — define the JSON Schema for your tool's input parameters.

4. **Validate** the tool:

   ```bash
   dojops tools validate .dojops/tools/my-tool/
   ```

5. **Test** by generating a config:

   ```bash
   dojops "Generate my-tool config for production"
   ```

Custom tools are automatically discovered and available to the Planner, Executor, and API. See [DevOps Tools — Custom Tool System](tools.md#custom-tool-system) for the full manifest format.

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
- [ ] New tools follow the `BaseTool<T>` pattern
- [ ] Breaking changes are documented

---

## License

DojOps is licensed under the [MIT License](../LICENSE).
