# @dojops/module-registry

Tool registry with plugin system for [DojOps](https://github.com/dojops/dojops) — discovers, loads, and manages built-in and custom tools.

## Features

- **Unified registry**: Combines 13 built-in tools + custom tools via `getAll()` / `get(name)` / `has()`
- **Custom tool discovery**: Loads from `~/.dojops/tools/` (global) and `.dojops/tools/` (project)
- **Declarative manifests**: `tool.yaml` + `input.schema.json` converted to runtime tools
- **JSON Schema → Zod**: Automatic conversion for custom tool input validation
- **Tool policy**: `.dojops/policy.yaml` allowlist/blocklist enforcement
- **Custom agent discovery**: Parses `README.md` from `.dojops/agents/` into specialist agents
- **Security**: Verification command whitelist, `child_process` permission enforcement, path traversal prevention
- **Integrity**: SHA-256 tool hashing for reproducibility and replay validation

## Custom Tool Structure

```
.dojops/tools/my-tool/
  tool.yaml            # Manifest (spec: 1)
  input.schema.json    # JSON Schema for inputs
  output.schema.json   # Optional: structured LLM output
```

See [TOOL_SPEC_v1.md](https://github.com/dojops/dojops/blob/main/docs/TOOL_SPEC_v1.md) for the full specification.

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
