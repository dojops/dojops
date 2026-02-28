Here's a complete **TypeScript solution** that handles all three scenarios (localhost, remote, Docker) with optional token
support:

## 1. The Ollama Client (TypeScript)

```typescript
interface OllamaConfig {
  baseUrl: string; // e.g., "http://localhost:11434" or "http://ollama:11434" (Docker)
  apiKey?: string; // Optional: dummy token for compatibility or real token via proxy
  timeout?: number;
}

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

class OllamaClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;

    // Build headers
    this.headers = {
      "Content-Type": "application/json",
    };

    // Add Authorization header if apiKey provided (dummy or real)
    if (this.apiKey) {
      this.headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
  }

  /**
   * Fetch all available models from Ollama
   * Uses native Ollama API: GET /api/tags
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: this.headers,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data: OllamaTagsResponse = await response.json();
      return data.models;
    } catch (error) {
      console.error("Failed to fetch Ollama models:", error);
      throw error;
    }
  }

  /**
   * Alternative: Use OpenAI-compatible endpoint (if you need compatibility)
   * GET /v1/models
   */
  async listModelsOpenAIFormat(): Promise<{ id: string; object: string }[]> {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data; // OpenAI format returns { data: [...] }
  }

  /**
   * Generate completion
   */
  async generate(model: string, prompt: string, options?: { stream?: boolean }): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        model,
        prompt,
        stream: options?.stream ?? false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Generation failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Chat completion (Ollama native)
   */
  async chat(model: string, messages: Array<{ role: string; content: string }>): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat failed: ${response.status}`);
    }

    return response.json();
  }
}

export { OllamaClient, OllamaConfig, OllamaModel };
```

## 2. Configuration for Different Environments

```typescript
// config.ts
export const getOllamaConfig = (): OllamaConfig => {
  const env = process.env.OLLAMA_ENV || "localhost"; // localhost | remote | docker

  switch (env) {
    case "docker":
      // When your Node app runs in Docker and Ollama is another service
      return {
        baseUrl: process.env.OLLAMA_URL || "http://ollama:11434", // Service name in docker-compose
        apiKey: process.env.OLLAMA_API_KEY, // Optional: only if behind auth proxy
      };

    case "remote":
      // Production remote server
      return {
        baseUrl: process.env.OLLAMA_URL || "http://your-server:11434",
        apiKey: process.env.OLLAMA_API_KEY, // Set this if using reverse proxy auth
      };

    case "localhost":
    default:
      // Local development - no token needed
      return {
        baseUrl: process.env.OLLAMA_URL || "http://localhost:11434",
        // apiKey is optional - omit for pure local development
        // If your app requires a token field, use: apiKey: 'dummy'
      };
  }
};
```

## 3. Usage Example

```typescript
import { OllamaClient } from "./ollama-client";
import { getOllamaConfig } from "./config";

async function main() {
  // Initialize client based on environment
  const config = getOllamaConfig();
  const client = new OllamaClient(config);

  try {
    // Fetch all models
    console.log("Fetching models...");
    const models = await client.listModels();

    console.log("Available models:");
    models.forEach((model) => {
      console.log(`- ${model.name} (${model.details.parameter_size})`);
    });

    // Example: Use the first available model
    if (models.length > 0) {
      const modelName = models[0].name;
      console.log(`\nTesting with model: ${modelName}`);

      const response = await client.generate(modelName, "Why is the sky blue?");
      console.log("Response:", response.response);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

## 4. Docker Setup Examples

**docker-compose.yml** (Ollama + Your Node App):

```yaml
version: "3.8"

services:
  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama:/root/.ollama
    # No auth needed internally between containers

  node-app:
    build: .
    environment:
      - OLLAMA_ENV=docker
      - OLLAMA_URL=http://ollama:11434
      # Optional: OLLAMA_API_KEY=dummy-token (if your code requires it)
    depends_on:
      - ollama
    ports:
      - "3000:3000"

volumes:
  ollama:
```

**If Ollama is on host machine** (Docker Desktop):

```typescript
// For Docker Desktop accessing host
const config: OllamaConfig = {
  baseUrl: "http://host.docker.internal:11434", // Special DNS for host access
};
```

## 5. Adding Real Token Authentication (Remote Production)

Since Ollama doesn't support tokens natively, add this **Express middleware** if exposing remotely:

```typescript
// auth-middleware.ts (for your Node app acting as proxy)
import { Request, Response, NextFunction } from "express";

const VALID_TOKENS = new Set([process.env.OLLAMA_API_KEY || "your-secure-token-here"]);

export const validateOllamaToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.substring(7);
  if (!VALID_TOKENS.has(token)) {
    return res.status(403).json({ error: "Invalid token" });
  }

  next();
};
```

Then in your client config for remote:

```typescript
// Remote usage with token
const client = new OllamaClient({
  baseUrl: "http://your-domain.com/ollama-proxy", // Your auth-wrapped endpoint
  apiKey: "sk-your-secure-token-here", // Real token checked by your middleware
});
```

## Key Points:

1. **No token needed** for localhost/Docker internal networking
2. **Dummy token** works if your app structure requires an `apiKey` field (Ollama ignores it)
3. **Environment variables** control the connection URL for different deployments
4. **Use `/api/tags`** for native Ollama API or `/v1/models` for OpenAI-compatible mode
