# @dojops/api

REST API server and web dashboard for [DojOps](https://github.com/dojops/dojops) — AI DevOps Automation Engine.

Exposes all DojOps capabilities over HTTP with a built-in web dashboard for monitoring and interaction.

## Features

- 19 REST API endpoints for generation, planning, scanning, chat, and metrics
- Built-in web dashboard with dark theme
- API key authentication (Bearer token / X-API-Key)
- In-memory execution history with UUID-based lookup
- Metrics aggregation (overview, security, audit)
- CORS support

## API Endpoints

| Method | Path            | Description                          |
| ------ | --------------- | ------------------------------------ |
| `GET`  | `/api/health`   | Health check + provider status       |
| `POST` | `/api/generate` | Agent-routed LLM generation          |
| `POST` | `/api/plan`     | Task graph decomposition + execution |
| `POST` | `/api/debug-ci` | CI log diagnosis                     |
| `POST` | `/api/diff`     | Infrastructure diff analysis         |
| `POST` | `/api/scan`     | Security/dependency/IaC scans        |
| `POST` | `/api/chat`     | Chat message (with agent routing)    |
| `GET`  | `/api/agents`   | List specialist agents               |
| `GET`  | `/api/history`  | Execution history                    |
| `GET`  | `/api/metrics`  | Dashboard metrics                    |

## Usage

```bash
# Via CLI
dojops serve
dojops serve --port=8080

# Programmatic
import { createApp } from "@dojops/api";
```

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
