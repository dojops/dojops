# @dojops/planner

LLM-powered task graph decomposition and topological executor for [DojOps](https://github.com/dojops/dojops).

## Features

- **Task decomposition**: Breaks complex DevOps goals into a directed acyclic graph (DAG) of tasks
- **Topological execution**: Kahn's algorithm for dependency-respecting execution order
- **Input wiring**: `$ref:<taskId>` references for passing outputs between tasks
- **Resume support**: `completedTaskIds` skip for resuming interrupted plans
- **Tool metadata**: Tasks carry `toolType`, `toolVersion`, `toolHash`, `systemPromptHash` for reproducibility

## How It Works

```
"Set up CI/CD for a Node.js app with Docker and Kubernetes"
    │
    ▼
  decompose() ──► LLM call with structured output
    │
    ▼
  TaskGraph { nodes: TaskNode[], edges: [...] }
    │
    ▼
  PlannerExecutor ──► topological sort ──► execute tasks in order
```

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
