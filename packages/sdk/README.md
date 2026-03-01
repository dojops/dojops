# @dojops/sdk

Base tool abstraction and Zod validation for [DojOps](https://github.com/dojops/dojops) DevOps tools.

## Features

- `BaseTool<T>` abstract class with Zod `inputSchema` validation
- Automatic input validation via `safeParse`
- Optional `verify()` interface for external tool validation
- File reader utilities (`readExistingConfig`, `backupFile`) for update workflows
- Re-exports `z` from Zod for convenience

## Usage

```typescript
import { BaseTool, z } from "@dojops/sdk";

const MyToolInputSchema = z.object({
  name: z.string(),
  replicas: z.number().default(3),
});

type MyToolInput = z.infer<typeof MyToolInputSchema>;

class MyTool extends BaseTool<MyToolInput> {
  name = "my-tool";
  description = "Generates my config";
  inputSchema = MyToolInputSchema;

  async generate(input: MyToolInput) {
    // LLM call + serialization
  }
}
```

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
