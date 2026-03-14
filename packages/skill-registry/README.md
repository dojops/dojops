# @dojops/skill-registry

Skill registry for [DojOps](https://github.com/dojops/dojops) — discovers, loads, and manages built-in and custom .dops skills.

## Features

- **Unified registry**: Combines 13 built-in skills + custom skills via `getAll()` / `get(name)` / `has()`
- **Custom skill discovery**: Loads from `~/.dojops/skills/` (global) and `.dojops/skills/` (project)
- **Skill policy**: `.dojops/policy.yaml` allowlist/blocklist enforcement
- **Custom agent discovery**: Parses `.dojops/agents/*.yaml` into specialist agents
- **Security**: Verification command whitelist, `child_process` permission enforcement, path traversal prevention
- **Integrity**: SHA-256 skill hashing for reproducibility and replay validation

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
