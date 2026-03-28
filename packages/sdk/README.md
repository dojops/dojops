# @dojops/sdk

Base skill abstraction and Zod validation for [DojOps](https://github.com/dojops/dojops) DevOps skills.

## Features

- `BaseSkill<T>` abstract class with Zod `inputSchema` validation
- `DevOpsSkill<T>` interface with `generate()`, optional `execute()`, `verify()`
- Automatic input validation via `safeParse`
- File reader utilities (`readExistingConfig`, `backupFile`) for update workflows
- Re-exports `z` from Zod for convenience

## Usage

```typescript
import { BaseSkill, z } from "@dojops/sdk";

const MySkillInputSchema = z.object({
  name: z.string(),
  replicas: z.number().default(3),
});

type MySkillInput = z.infer<typeof MySkillInputSchema>;

class MySkill extends BaseSkill<MySkillInput> {
  name = "my-skill";
  description = "Generates my config";
  inputSchema = MySkillInputSchema;

  async generate(input: MySkillInput) {
    // LLM call + serialization
  }
}
```

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
