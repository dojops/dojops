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
git clone https://github.com/dojops/oda.git
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
  cli/            CLI entry point + TUI (@clack/prompts)
  api/            REST API (Express) + web dashboard
  core/           LLM providers (5) + specialist agents (16) + CI debugger + infra diff + DevOps checker
  planner/        Task graph decomposition + topological executor
  executor/       SafeExecutor + policy engine + approval workflows + audit log
  tools/          12 DevOps tools
  scanner/        6 security scanners + remediation engine
  session/        Chat session management + memory + context injection
  sdk/            BaseTool<T> abstract class + Zod re-export + verification types
```

Package scope: `@dojops/*`

Dependency flow: `cli -> api -> planner -> executor -> tools -> core -> sdk`

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

| Package            | Tests   |
| ------------------ | ------- |
| `@dojops/core`     | 208     |
| `@dojops/cli`      | 144     |
| `@dojops/tools`    | 111     |
| `@dojops/api`      | 96      |
| `@dojops/scanner`  | 43      |
| `@dojops/executor` | 40      |
| `@dojops/planner`  | 28      |
| `@dojops/session`  | 28      |
| `@dojops/sdk`      | 7       |
| **Total**          | **685** |

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

   export async function generateMyTool(input: MyToolInput, provider: LLMProvider) {
     const response = await provider.generate({
       prompt: buildPrompt(input),
       schema: MyToolOutputSchema,
     });
     return parseAndValidate(response.content, MyToolOutputSchema);
   }
   ```

4. **Create tool class** (`my-tool.ts`):

   ```typescript
   import { BaseTool } from "@dojops/sdk";

   export class MyTool extends BaseTool<MyToolInput> {
     name = "my-tool";
     inputSchema = MyToolInputSchema;

     async generate(input: MyToolInput) {
       return generateMyTool(input, this.provider);
     }

     async execute(input: MyToolInput) {
       const result = await this.generate(input);
       // Write files to disk
     }
   }
   ```

5. **Optional: Add detector** (`detector.ts`) for filesystem context detection

6. **Optional: Add verifier** (`verifier.ts`) for external tool validation

7. **Export:** Add to `packages/tools/src/index.ts`

8. **Write tests:** `my-tool.test.ts` with mocked LLM provider

---

## Adding a New Agent

Agents are defined in `packages/core/src/agents/specialists.ts`.

### Step-by-Step

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
