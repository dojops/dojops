---
name: format
description: Format code in the DojOps monorepo using Prettier. Format all files or check formatting without writing.
argument-hint: "[check | filepath]"
disable-model-invocation: false
allowed-tools: Bash
---

Format code in the DojOps monorepo using Prettier.

## Commands

### Format all files

```bash
pnpm format
```

### Check formatting without writing

```bash
pnpm format:check
```

### Format specific files

```bash
pnpm exec prettier --write "$ARGUMENTS"
```

## Notes

- Config: `.prettierrc.json` (semi, double quotes, trailing commas, 100 width)
- Pre-commit hook runs Prettier automatically via lint-staged
