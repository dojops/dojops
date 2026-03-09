# @dojops/core

LLM providers, multi-agent routing, CI debugger, and infra diff analysis for [DojOps](https://github.com/dojops/dojops).

## Features

- **6 LLM providers**: OpenAI, Anthropic, Ollama, DeepSeek, Google Gemini, GitHub Copilot
- **Structured output**: Zod schema enforcement with provider-native JSON modes
- **17 specialist agents**: Terraform, Kubernetes, CI/CD, security, Docker, cloud architecture, DevSecOps reviewer, and more
- **Agent router**: Keyword-based routing with confidence scoring
- **CI debugger**: Analyzes CI logs, produces structured diagnoses
- **Infra diff analyzer**: Risk assessment, cost/security impact analysis

## Providers

| Provider       | Env Variable           | JSON Mode          |
| -------------- | ---------------------- | ------------------ |
| OpenAI         | `OPENAI_API_KEY`       | `response_format`  |
| Anthropic      | `ANTHROPIC_API_KEY`    | Prefill            |
| Ollama         | `OLLAMA_HOST`          | `format`           |
| DeepSeek       | `DEEPSEEK_API_KEY`     | `response_format`  |
| Gemini         | `GEMINI_API_KEY`       | `responseMimeType` |
| GitHub Copilot | `GITHUB_COPILOT_TOKEN` | `response_format`  |

## Usage

```typescript
import { createProvider, DevOpsAgent } from "@dojops/core";

const provider = createProvider(); // uses DOJOPS_PROVIDER env var
const agent = new DevOpsAgent(provider);
const response = await agent.generate({ prompt: "..." });
```

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
