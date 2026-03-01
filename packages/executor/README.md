# @dojops/executor

Sandboxed execution engine with policy controls and approval workflows for [DojOps](https://github.com/dojops/dojops).

## Features

- **SafeExecutor**: Orchestrates generate → verify → approve → execute pipeline
- **ExecutionPolicy**: Controls write permissions, allowed/denied paths, env vars, timeouts, file size limits
- **SandboxedFs**: Restricted filesystem operations within policy boundaries
- **Approval workflows**: `AutoApproveHandler`, `AutoDenyHandler`, `CallbackApprovalHandler`
- **Audit logging**: Hash-chained audit trail with verification results and tool metadata
- **Timeout enforcement**: Configurable execution time limits

## Execution Pipeline

```
Input ──► Validate ──► Generate (LLM) ──► Verify ──► Approve ──► Execute ──► Audit Log
```

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
