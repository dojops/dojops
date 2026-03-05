/**
 * Deep Integration Test Suite — Senior DevSecOps Audit
 *
 * End-to-end tests for the entire .dops tool engine:
 * 1. Custom tool creation from scratch (parse → validate → runtime → generate → verify → execute)
 * 2. Security boundary testing (scope enforcement, path traversal, permissions)
 * 3. Update lifecycle (detect → update prompt → preserve_structure)
 * 4. Edge cases and error handling
 * 5. All new features (scope, risk, execution, update, icon)
 * 6. Cross-module integration (parser + compiler + runtime + file-writer + verifier)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseDopsString,
  parseDopsFileAny,
  validateDopsModule,
  validateDopsModuleAny,
} from "../parser";
import { DopsRuntime, DopsRuntimeV2 } from "../runtime";
import { isV2Module } from "../spec";
import { compilePrompt, PromptContext } from "../prompt-compiler";
import { compileInputSchema, compileOutputSchema } from "../schema-compiler";
import {
  writeFiles,
  serializeForFile,
  matchesScopePattern,
  detectExistingContent,
} from "../file-writer";
import { validateStructure } from "../structural-validator";
import type { LLMProvider } from "@dojops/core";

// ─── Helpers ────────────────────────────────────────────

function createMockProvider(response: unknown): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(response),
      parsed: response,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    }),
  };
}

function createFailingProvider(error: string): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockRejectedValue(new Error(error)),
  };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-deep-test-"));
}

function cleanDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── A complete custom .dops tool: "redis-config" ───────

const REDIS_TOOL_DOPS = `---
dops: v1
kind: tool
meta:
  name: redis-config
  version: 2.1.0
  description: "Generates production-ready Redis configuration files"
  author: "DevOps Team"
  tags: [redis, cache, database, nosql]
  icon: "https://registry.dojops.ai/icons/redis.svg"
input:
  fields:
    clusterName:
      type: string
      required: true
      minLength: 1
      maxLength: 64
      pattern: "^[a-z][a-z0-9-]*$"
    maxMemory:
      type: string
      required: true
      description: "Max memory (e.g., 256mb, 1gb)"
    port:
      type: integer
      default: 6379
      min: 1024
      max: 65535
    enablePersistence:
      type: boolean
      default: true
    evictionPolicy:
      type: enum
      values: [noeviction, allkeys-lru, volatile-lru, allkeys-random]
      default: allkeys-lru
    replicas:
      type: integer
      default: 0
      min: 0
      max: 10
    outputPath:
      type: string
      required: true
output:
  type: object
  required: [redisConf]
  properties:
    redisConf:
      type: string
      description: "Raw redis.conf content"
    sentinelConf:
      type: string
      description: "Sentinel config (only if replicas > 0)"
files:
  - path: "{outputPath}/redis.conf"
    format: raw
    dataPath: redisConf
  - path: "{outputPath}/sentinel.conf"
    format: raw
    dataPath: sentinelConf
    conditional: true
detection:
  paths: ["redis.conf", "*/redis.conf"]
verification:
  structural:
    - path: "redisConf"
      required: true
      type: string
      message: "redis.conf content is required"
    - path: "sentinelConf"
      type: string
      requiredUnless: "replicas"
      message: "sentinelConf should be present when replicas > 0"
permissions:
  filesystem: write
  child_process: none
  network: none
scope:
  write: ["{outputPath}/redis.conf", "{outputPath}/sentinel.conf"]
risk:
  level: MEDIUM
  rationale: "Cache configuration changes may affect application performance and data persistence"
execution:
  mode: generate
  deterministic: false
  idempotent: true
update:
  strategy: preserve_structure
  inputSource: file
  injectAs: existingRedisConf
---
# Redis Configuration Generator

## Prompt

You are a Redis configuration expert. Generate a production-ready Redis configuration for the cluster "{clusterName}".

Requirements:
- Max memory: {maxMemory}
- Port: default 6379 unless overridden
- Persistence: RDB + AOF when enabled
- Eviction policy: as specified

Return the raw redis.conf file content as a string in the "redisConf" field.
If replicas > 0, also return sentinel configuration in "sentinelConf".

## Update Prompt

You are updating an existing Redis configuration for cluster "{clusterName}".

EXISTING CONFIGURATION:
{existingRedisConf}

Merge the following changes while preserving all existing custom settings:
- Max memory: {maxMemory}
- Eviction policy: as specified
- Persistence settings: as specified

## Examples

Input: clusterName=cache-primary, maxMemory=1gb, enablePersistence=true
Output: Complete redis.conf with bind, port, maxmemory, save directives, appendonly yes

## Constraints

- Always include bind 127.0.0.1 unless explicitly told otherwise
- Set tcp-backlog to at least 511
- Include comments explaining each section
- Never disable protected-mode in production configs
- Set timeout to 300 seconds minimum

## Keywords

redis, cache, nosql, configuration, database, memory, sentinel
`;

// ─── Minimal tool for edge case testing ─────────────────

const MINIMAL_TOOL_DOPS = `---
dops: v1
meta:
  name: minimal-tool
  version: 0.1.0
  description: "Minimal tool for testing"
output:
  type: object
  properties:
    result:
      type: string
files:
  - path: "out.yaml"
    format: yaml
---
## Prompt

Generate minimal output.

## Keywords

test
`;

// ═════════════════════════════════════════════════════════
// 1. FULL LIFECYCLE: Custom tool creation from scratch
// ═════════════════════════════════════════════════════════

describe("Full Lifecycle: Custom Redis Tool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  describe("Step 1: Parse", () => {
    it("parses the complete redis tool without errors", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module).toBeDefined();
      expect(module.frontmatter.dops).toBe("v1");
      expect(module.frontmatter.kind).toBe("tool");
    });

    it("preserves all meta fields including icon", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const meta = module.frontmatter.meta;
      expect(meta.name).toBe("redis-config");
      expect(meta.version).toBe("2.1.0");
      expect(meta.description).toBe("Generates production-ready Redis configuration files");
      expect(meta.author).toBe("DevOps Team");
      expect(meta.tags).toEqual(["redis", "cache", "database", "nosql"]);
      expect(meta.icon).toBe("https://registry.dojops.ai/icons/redis.svg");
    });

    it("parses all 7 input fields with correct types and constraints", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const fields = module.frontmatter.input!.fields;

      expect(fields["clusterName"].type).toBe("string");
      expect(fields["clusterName"].required).toBe(true);
      expect(fields["clusterName"].minLength).toBe(1);
      expect(fields["clusterName"].maxLength).toBe(64);
      expect(fields["clusterName"].pattern).toBe("^[a-z][a-z0-9-]*$");

      expect(fields["maxMemory"].type).toBe("string");
      expect(fields["maxMemory"].required).toBe(true);

      expect(fields["port"].type).toBe("integer");
      expect(fields["port"].default).toBe(6379);
      expect(fields["port"].min).toBe(1024);
      expect(fields["port"].max).toBe(65535);

      expect(fields["enablePersistence"].type).toBe("boolean");
      expect(fields["enablePersistence"].default).toBe(true);

      expect(fields["evictionPolicy"].type).toBe("enum");
      expect(fields["evictionPolicy"].values).toEqual([
        "noeviction",
        "allkeys-lru",
        "volatile-lru",
        "allkeys-random",
      ]);

      expect(fields["replicas"].type).toBe("integer");
      expect(fields["replicas"].min).toBe(0);
      expect(fields["replicas"].max).toBe(10);

      expect(fields["outputPath"].type).toBe("string");
      expect(fields["outputPath"].required).toBe(true);
    });

    it("parses output schema with required fields", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.frontmatter.output.type).toBe("object");
      expect(module.frontmatter.output.required).toEqual(["redisConf"]);
      expect(module.frontmatter.output.properties.redisConf.type).toBe("string");
      expect(module.frontmatter.output.properties.sentinelConf.type).toBe("string");
    });

    it("parses file specs with conditional and dataPath", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.frontmatter.files).toHaveLength(2);

      const [redisFile, sentinelFile] = module.frontmatter.files;
      expect(redisFile.path).toBe("{outputPath}/redis.conf");
      expect(redisFile.format).toBe("raw");
      expect(redisFile.dataPath).toBe("redisConf");
      expect(redisFile.conditional).toBeUndefined();

      expect(sentinelFile.path).toBe("{outputPath}/sentinel.conf");
      expect(sentinelFile.format).toBe("raw");
      expect(sentinelFile.dataPath).toBe("sentinelConf");
      expect(sentinelFile.conditional).toBe(true);
    });

    it("parses scope write boundaries", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.frontmatter.scope).toBeDefined();
      expect(module.frontmatter.scope!.write).toEqual([
        "{outputPath}/redis.conf",
        "{outputPath}/sentinel.conf",
      ]);
    });

    it("parses risk classification", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.frontmatter.risk).toBeDefined();
      expect(module.frontmatter.risk!.level).toBe("MEDIUM");
      expect(module.frontmatter.risk!.rationale).toContain("Cache configuration changes");
    });

    it("parses execution semantics", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.frontmatter.execution).toBeDefined();
      expect(module.frontmatter.execution!.mode).toBe("generate");
      expect(module.frontmatter.execution!.deterministic).toBe(false);
      expect(module.frontmatter.execution!.idempotent).toBe(true);
    });

    it("parses update configuration", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.frontmatter.update).toBeDefined();
      expect(module.frontmatter.update!.strategy).toBe("preserve_structure");
      expect(module.frontmatter.update!.inputSource).toBe("file");
      expect(module.frontmatter.update!.injectAs).toBe("existingRedisConf");
    });

    it("parses all markdown sections", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.sections.prompt).toContain("Redis configuration expert");
      expect(module.sections.prompt).toContain("{clusterName}");
      expect(module.sections.updatePrompt).toContain("{existingRedisConf}");
      expect(module.sections.updatePrompt).toContain("Merge the following changes");
      expect(module.sections.examples).toContain("cache-primary");
      expect(module.sections.constraints).toContain("bind 127.0.0.1");
      expect(module.sections.constraints).toContain("protected-mode");
      expect(module.sections.keywords).toContain("redis");
      expect(module.sections.keywords).toContain("sentinel");
    });

    it("preserves raw content for hashing", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      expect(module.raw).toBe(REDIS_TOOL_DOPS);
    });
  });

  describe("Step 2: Validate", () => {
    it("validates the complete redis tool successfully", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe("Step 3: Schema Compilation", () => {
    it("compiles input schema with all field types", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      // Valid input
      const validResult = schema.safeParse({
        clusterName: "cache-primary",
        maxMemory: "1gb",
        port: 6379,
        enablePersistence: true,
        evictionPolicy: "allkeys-lru",
        replicas: 2,
        outputPath: tmpDir,
      });
      expect(validResult.success).toBe(true);
    });

    it("rejects invalid input: missing required fields", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      const result = schema.safeParse({ port: 6379 });
      expect(result.success).toBe(false);
    });

    it("rejects invalid input: pattern violation", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      const result = schema.safeParse({
        clusterName: "INVALID-UPPERCASE",
        maxMemory: "1gb",
        outputPath: tmpDir,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid input: port out of range", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      const result = schema.safeParse({
        clusterName: "test",
        maxMemory: "1gb",
        port: 80, // below min 1024
        outputPath: tmpDir,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid input: enum violation", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      const result = schema.safeParse({
        clusterName: "test",
        maxMemory: "1gb",
        evictionPolicy: "invalid-policy",
        outputPath: tmpDir,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid input: replicas exceeds max", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      const result = schema.safeParse({
        clusterName: "test",
        maxMemory: "1gb",
        replicas: 15, // exceeds max 10
        outputPath: tmpDir,
      });
      expect(result.success).toBe(false);
    });

    it("applies default values for optional fields", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      const result = schema.safeParse({
        clusterName: "test",
        maxMemory: "1gb",
        outputPath: tmpDir,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(6379);
        expect(result.data.enablePersistence).toBe(true);
        expect(result.data.replicas).toBe(0);
      }
    });

    it("auto-injects existingContent field in input schema", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const schema = compileInputSchema(module.frontmatter.input!.fields);

      const result = schema.safeParse({
        clusterName: "test",
        maxMemory: "1gb",
        outputPath: tmpDir,
        existingContent: "# old redis.conf",
      });
      expect(result.success).toBe(true);
    });

    it("compiles output schema with required fields", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const outputSchema = compileOutputSchema(
        module.frontmatter.output as Record<string, unknown>,
      );

      // Valid output
      const validResult = outputSchema.safeParse({
        redisConf: "bind 127.0.0.1\nport 6379",
        sentinelConf: "sentinel monitor mymaster 127.0.0.1 6379 2",
      });
      expect(validResult.success).toBe(true);

      // Missing required field
      const invalidResult = outputSchema.safeParse({
        sentinelConf: "sentinel config",
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("Step 4: Runtime Initialization", () => {
    it("creates DopsRuntime from parsed module", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      expect(runtime.name).toBe("redis-config");
      expect(runtime.description).toBe("Generates production-ready Redis configuration files");
    });

    it("exposes risk metadata", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      expect(runtime.risk.level).toBe("MEDIUM");
      expect(runtime.risk.rationale).toContain("Cache configuration");
      expect(runtime.metadata.riskLevel).toBe("MEDIUM");
    });

    it("exposes execution semantics", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      expect(runtime.executionMode.mode).toBe("generate");
      expect(runtime.isDeterministic).toBe(false);
      expect(runtime.isIdempotent).toBe(true);
    });

    it("exposes icon in metadata", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      expect(runtime.metadata.icon).toBe("https://registry.dojops.ai/icons/redis.svg");
    });

    it("computes deterministic hashes", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime1 = new DopsRuntime(module, provider);
      const runtime2 = new DopsRuntime(module, provider);

      expect(runtime1.systemPromptHash).toBe(runtime2.systemPromptHash);
      expect(runtime1.moduleHash).toBe(runtime2.moduleHash);
      expect(runtime1.systemPromptHash.length).toBe(64);
      expect(runtime1.moduleHash.length).toBe(64);
      // Prompt and module hashes should differ (prompt is subset of module)
      expect(runtime1.systemPromptHash).not.toBe(runtime1.moduleHash);
    });

    it("extracts keywords correctly", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      expect(runtime.keywords).toContain("redis");
      expect(runtime.keywords).toContain("cache");
      expect(runtime.keywords).toContain("sentinel");
      expect(runtime.keywords.length).toBe(7);
    });

    it("returns complete metadata object", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);
      const meta = runtime.metadata;

      expect(meta.toolType).toBe("built-in");
      expect(meta.toolVersion).toBe("2.1.0");
      expect(meta.toolSource).toBe("dops");
      expect(meta.toolHash).toBeDefined();
      expect(meta.systemPromptHash).toBeDefined();
      expect(meta.riskLevel).toBe("MEDIUM");
      expect(meta.icon).toBe("https://registry.dojops.ai/icons/redis.svg");
    });

    it("returns file specs", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      expect(runtime.fileSpecs).toHaveLength(2);
      expect(runtime.fileSpecs[0].path).toBe("{outputPath}/redis.conf");
      expect(runtime.fileSpecs[1].path).toBe("{outputPath}/sentinel.conf");
    });
  });

  describe("Step 5: Generate (LLM call)", () => {
    it("generates redis config via mock LLM", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const mockOutput = {
        redisConf: "bind 127.0.0.1\nport 6379\nmaxmemory 1gb\nmaxmemory-policy allkeys-lru",
        sentinelConf: null,
      };
      const provider = createMockProvider(mockOutput);
      const runtime = new DopsRuntime(module, provider);

      const result = await runtime.generate({
        clusterName: "cache-primary",
        maxMemory: "1gb",
        outputPath: tmpDir,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as { generated: typeof mockOutput; isUpdate: boolean };
      expect(data.generated.redisConf).toContain("maxmemory 1gb");
      expect(data.isUpdate).toBe(false);
      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
      });
    });

    it("passes correct system prompt to LLM", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({ redisConf: "config" });
      const runtime = new DopsRuntime(module, provider);

      await runtime.generate({
        clusterName: "my-cache",
        maxMemory: "512mb",
        outputPath: tmpDir,
      });

      const call = vi.mocked(provider.generate).mock.calls[0][0];
      expect(call.system).toContain("Redis configuration expert");
      expect(call.system).toContain("my-cache"); // variable substitution
      expect(call.system).toContain("CONSTRAINTS:"); // constraints compiled
      expect(call.system).toContain("bind 127.0.0.1"); // constraint preserved
      expect(call.system).toContain("EXAMPLES:"); // examples section
    });

    it("handles LLM failure gracefully", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createFailingProvider("API rate limit exceeded");
      const runtime = new DopsRuntime(module, provider);

      const result = await runtime.generate({
        clusterName: "test",
        maxMemory: "1gb",
        outputPath: tmpDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("API rate limit exceeded");
    });
  });

  describe("Step 6: Structural Verification", () => {
    it("passes verification with valid data", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      const result = await runtime.verify({
        redisConf: "bind 127.0.0.1\nport 6379",
        sentinelConf: "sentinel monitor",
      });
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("fails verification when redisConf missing", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      const result = await runtime.verify({
        sentinelConf: "sentinel config",
      });
      expect(result.passed).toBe(false);
      expect(result.issues.some((i) => i.message === "redis.conf content is required")).toBe(true);
    });

    it("fails verification when redisConf is wrong type", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({});
      const runtime = new DopsRuntime(module, provider);

      const result = await runtime.verify({
        redisConf: 12345, // number, not string
      });
      expect(result.passed).toBe(false);
      expect(result.issues.some((i) => i.message === "redis.conf content is required")).toBe(true);
    });
  });

  describe("Step 7: File Writing with Scope Enforcement", () => {
    it("writes redis.conf to disk within scope", () => {
      const data = {
        redisConf: "bind 127.0.0.1\nport 6379\nmaxmemory 1gb",
      };
      const fileSpecs = [
        {
          path: "{outputPath}/redis.conf",
          format: "raw" as const,
          source: "llm" as const,
          dataPath: "redisConf",
        },
      ];
      const scope = { write: ["{outputPath}/redis.conf", "{outputPath}/sentinel.conf"] };

      const result = writeFiles(data, fileSpecs, { outputPath: tmpDir }, false, scope);

      expect(result.filesWritten).toHaveLength(1);
      expect(result.filesWritten[0]).toBe(path.join(tmpDir, "redis.conf"));
      const content = fs.readFileSync(path.join(tmpDir, "redis.conf"), "utf-8");
      expect(content).toBe("bind 127.0.0.1\nport 6379\nmaxmemory 1gb");
    });

    it("writes both files when sentinel data present", () => {
      const data = {
        redisConf: "bind 127.0.0.1\nport 6379",
        sentinelConf: "sentinel monitor mymaster 127.0.0.1 6379 2",
      };
      const fileSpecs = [
        {
          path: "{outputPath}/redis.conf",
          format: "raw" as const,
          source: "llm" as const,
          dataPath: "redisConf",
        },
        {
          path: "{outputPath}/sentinel.conf",
          format: "raw" as const,
          source: "llm" as const,
          dataPath: "sentinelConf",
          conditional: true,
        },
      ];
      const scope = { write: ["{outputPath}/redis.conf", "{outputPath}/sentinel.conf"] };

      const result = writeFiles(data, fileSpecs, { outputPath: tmpDir }, false, scope);

      expect(result.filesWritten).toHaveLength(2);
      expect(fs.existsSync(path.join(tmpDir, "redis.conf"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "sentinel.conf"))).toBe(true);
    });

    it("skips conditional file when data is null", () => {
      const data = {
        redisConf: "bind 127.0.0.1",
        sentinelConf: null,
      };
      const fileSpecs = [
        {
          path: "{outputPath}/redis.conf",
          format: "raw" as const,
          source: "llm" as const,
          dataPath: "redisConf",
        },
        {
          path: "{outputPath}/sentinel.conf",
          format: "raw" as const,
          source: "llm" as const,
          dataPath: "sentinelConf",
          conditional: true,
        },
      ];
      const scope = { write: ["{outputPath}/redis.conf", "{outputPath}/sentinel.conf"] };

      const result = writeFiles(data, fileSpecs, { outputPath: tmpDir }, false, scope);

      expect(result.filesWritten).toHaveLength(1);
      expect(fs.existsSync(path.join(tmpDir, "sentinel.conf"))).toBe(false);
    });

    it("rejects write to path outside scope", () => {
      const data = { redisConf: "bind 127.0.0.1" };
      const fileSpecs = [
        {
          path: "{outputPath}/unauthorized.conf",
          format: "raw" as const,
          source: "llm" as const,
          dataPath: "redisConf",
        },
      ];
      const scope = { write: ["{outputPath}/redis.conf"] };

      expect(() => writeFiles(data, fileSpecs, { outputPath: tmpDir }, false, scope)).toThrow(
        "not in declared write scope",
      );
    });

    it("creates backup when updating existing file", () => {
      // Pre-create existing file
      const redisPath = path.join(tmpDir, "redis.conf");
      fs.writeFileSync(redisPath, "# old config", "utf-8");

      const data = { redisConf: "# new config" };
      const fileSpecs = [
        {
          path: "{outputPath}/redis.conf",
          format: "raw" as const,
          source: "llm" as const,
          dataPath: "redisConf",
        },
      ];

      const result = writeFiles(data, fileSpecs, { outputPath: tmpDir }, true);

      expect(result.filesModified).toHaveLength(1);
      expect(fs.existsSync(redisPath + ".bak")).toBe(true);
      expect(fs.readFileSync(redisPath + ".bak", "utf-8")).toBe("# old config");
      expect(fs.readFileSync(redisPath, "utf-8")).toBe("# new config");
    });
  });

  describe("Step 8: Full execute() lifecycle", () => {
    it("runs generate + write in execute()", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const mockOutput = {
        redisConf: "bind 127.0.0.1\nport 6379\nmaxmemory 256mb",
      };
      const provider = createMockProvider(mockOutput);
      const runtime = new DopsRuntime(module, provider);

      const result = await runtime.execute({
        clusterName: "test-cache",
        maxMemory: "256mb",
        outputPath: tmpDir,
      });

      expect(result.success).toBe(true);
      expect(result.filesWritten).toBeDefined();
      expect(result.filesWritten!.length).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(path.join(tmpDir, "redis.conf"))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "redis.conf"), "utf-8")).toContain(
        "maxmemory 256mb",
      );
    });

    it("execute() enforces scope", async () => {
      // A tool with scope that doesn't match its files (artificial mismatch)
      const dops = `---
dops: v1
meta:
  name: scope-mismatch
  version: 1.0.0
  description: "Tool with mismatched scope"
output:
  type: object
  properties:
    content:
      type: string
files:
  - path: "{outputPath}/unauthorized.txt"
    format: raw
    dataPath: content
scope:
  write: ["{outputPath}/allowed.txt"]
---
## Prompt

Generate.

## Keywords

test
`;
      const module = parseDopsString(dops);
      const provider = createMockProvider({ content: "data" });
      const runtime = new DopsRuntime(module, provider);

      const result = await runtime.execute({
        outputPath: tmpDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not in declared write scope");
    });
  });
});

// ═════════════════════════════════════════════════════════
// 2. SECURITY BOUNDARY TESTING
// ═════════════════════════════════════════════════════════

describe("Security Boundaries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  describe("Scope Enforcement", () => {
    it("matchesScopePattern: exact match after expansion", () => {
      expect(
        matchesScopePattern("/app/output/redis.conf", ["{outputPath}/redis.conf"], {
          outputPath: "/app/output",
        }),
      ).toBe(true);
    });

    it("matchesScopePattern: no match for different file", () => {
      expect(
        matchesScopePattern("/app/output/evil.conf", ["{outputPath}/redis.conf"], {
          outputPath: "/app/output",
        }),
      ).toBe(false);
    });

    it("matchesScopePattern: matches any pattern in list", () => {
      expect(
        matchesScopePattern(
          "/app/sentinel.conf",
          ["{outputPath}/redis.conf", "{outputPath}/sentinel.conf"],
          { outputPath: "/app" },
        ),
      ).toBe(true);
    });

    it("matchesScopePattern: empty scope list rejects everything", () => {
      expect(matchesScopePattern("/any/path", [], {})).toBe(false);
    });

    it("scope with unexpanded variables does not match", () => {
      expect(
        matchesScopePattern("/app/redis.conf", ["{unknownVar}/redis.conf"], {
          outputPath: "/app",
        }),
      ).toBe(false);
    });
  });

  describe("Path Traversal Prevention", () => {
    it("rejects scope.write paths with .. at parse time", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: bad-scope
  version: 1.0.0
  description: "Bad scope tool"
output:
  type: object
files:
  - path: "out.yaml"
scope:
  write: ["../../../etc/redis.conf"]
---
## Prompt

Generate.

## Keywords

test
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.includes("path traversal"))).toBe(true);
    });

    it("rejects path traversal in file path at write time", () => {
      expect(() =>
        writeFiles(
          { data: "malicious" },
          [{ path: "../../../etc/passwd", format: "raw" as const, source: "llm" as const }],
          {},
          false,
        ),
      ).toThrow("Path traversal detected");
    });

    it("rejects Windows-style path traversal", () => {
      const module = parseDopsString(String.raw`---
dops: v1
meta:
  name: win-traversal
  version: 1.0.0
  description: "Windows traversal"
output:
  type: object
files:
  - path: "out.yaml"
scope:
  write: ["..\\..\\etc\\redis.conf"]
---
## Prompt

Generate.

## Keywords

test
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(false);
    });
  });

  describe("Permission Enforcement", () => {
    it("rejects network: required with risk declared (v1 constraint)", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: net-tool
  version: 1.0.0
  description: "Network tool"
output:
  type: object
files:
  - path: "out.yaml"
risk:
  level: LOW
  rationale: "Test"
permissions:
  network: required
---
## Prompt

Generate.

## Keywords

test
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("network permission must be 'none' for v1 tools");
    });

    it("allows network: none with risk declared", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: safe-tool
  version: 1.0.0
  description: "Safe tool"
output:
  type: object
files:
  - path: "out.yaml"
risk:
  level: LOW
  rationale: "Test"
permissions:
  network: none
---
## Prompt

Generate.

## Keywords

test
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(true);
    });
  });

  describe("Icon URL Security", () => {
    it("rejects HTTP icon URL (non-HTTPS)", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: http-icon
  version: 1.0.0
  description: "HTTP icon"
  icon: "http://evil.com/icon.png"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects FTP icon URL", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: ftp-icon
  version: 1.0.0
  description: "FTP icon"
  icon: "ftp://files.example.com/icon.svg"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects javascript: URI as icon", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: xss-icon
  version: 1.0.0
  description: "XSS icon"
  icon: "javascript:alert(1)"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects data: URI as icon", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: data-icon
  version: 1.0.0
  description: "Data icon"
  icon: "data:image/svg+xml;base64,PHN2Zz4="
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("accepts valid HTTPS icon URL", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: good-icon
  version: 1.0.0
  description: "Good icon"
  icon: "https://cdn.example.com/icons/tool.svg"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`);
      expect(module.frontmatter.meta.icon).toBe("https://cdn.example.com/icons/tool.svg");
    });
  });

  describe("Meta Name Validation", () => {
    it("rejects names with uppercase", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: BadName
  version: 1.0.0
  description: "Bad"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects names starting with number", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: 1bad
  version: 1.0.0
  description: "Bad"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects names with spaces", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: "bad name"
  version: 1.0.0
  description: "Bad"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("accepts valid kebab-case name", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: my-great-tool-v2
  version: 1.0.0
  description: "Good"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`);
      expect(module.frontmatter.meta.name).toBe("my-great-tool-v2");
    });
  });

  describe("Unresolved Variable Detection", () => {
    it("throws on unresolved {var} in file path", () => {
      expect(() =>
        writeFiles(
          { data: "test" },
          [{ path: "{missingVar}/out.yaml", format: "yaml" as const, source: "llm" as const }],
          {},
          false,
        ),
      ).toThrow("Unresolved variable in file path");
    });
  });
});

// ═════════════════════════════════════════════════════════
// 3. UPDATE LIFECYCLE
// ═════════════════════════════════════════════════════════

describe("Update Lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  describe("Existing Content Detection", () => {
    it("detects existing redis.conf by exact path", () => {
      fs.writeFileSync(path.join(tmpDir, "redis.conf"), "# existing redis config", "utf-8");
      const content = detectExistingContent(["redis.conf"], tmpDir);
      expect(content).toBe("# existing redis config");
    });

    it("detects existing redis.conf by glob", () => {
      fs.writeFileSync(path.join(tmpDir, "redis.conf"), "# glob match", "utf-8");
      const content = detectExistingContent(["*.conf"], tmpDir);
      expect(content).toBe("# glob match");
    });

    it("detects in subdirectory by glob", () => {
      const subDir = path.join(tmpDir, "config");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, "redis.conf"), "# sub dir", "utf-8");
      const content = detectExistingContent(["config/*.conf"], tmpDir);
      expect(content).toBe("# sub dir");
    });

    it("returns null when no files match", () => {
      const content = detectExistingContent(["redis.conf", "*.conf"], tmpDir);
      expect(content).toBeNull();
    });
  });

  describe("Update Prompt Compilation", () => {
    it("uses ## Update Prompt with custom injectAs variable", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const context: PromptContext = {
        existingContent: "# old redis config\nbind 0.0.0.0",
        input: { clusterName: "prod-cache", maxMemory: "2gb" },
        updateConfig: module.frontmatter.update,
      };

      const prompt = compilePrompt(module.sections, context);

      // Should use ## Update Prompt, not ## Prompt
      expect(prompt).toContain("updating an existing Redis configuration");
      expect(prompt).not.toContain("Redis configuration expert");
      // injectAs = existingRedisConf, so {existingRedisConf} should be substituted
      expect(prompt).toContain("# old redis config");
      expect(prompt).toContain("bind 0.0.0.0");
      // preserve_structure should be appended
      expect(prompt).toContain("Preserve the overall structure");
    });

    it("falls back to ## Prompt with generic update when no ## Update Prompt", () => {
      const module = parseDopsString(MINIMAL_TOOL_DOPS);
      const context: PromptContext = {
        existingContent: "# old content",
        input: {},
      };

      const prompt = compilePrompt(module.sections, context);

      expect(prompt).toContain("Generate minimal output");
      expect(prompt).toContain("UPDATING an existing configuration");
      expect(prompt).toContain("# old content");
    });

    it("does not inject preserve_structure when strategy is replace", () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const context: PromptContext = {
        existingContent: "# old",
        input: { clusterName: "test" },
        updateConfig: {
          strategy: "replace",
          inputSource: "file",
          injectAs: "existingRedisConf",
        },
      };

      const prompt = compilePrompt(module.sections, context);

      expect(prompt).not.toContain("Preserve the overall structure");
    });
  });

  describe("Update Mode in Runtime", () => {
    it("uses update prompt when existingContent provided", async () => {
      const module = parseDopsString(REDIS_TOOL_DOPS);
      const provider = createMockProvider({ redisConf: "updated config" });
      const runtime = new DopsRuntime(module, provider);

      await runtime.generate({
        clusterName: "prod",
        maxMemory: "4gb",
        outputPath: tmpDir,
        existingContent: "# old redis.conf\nbind 0.0.0.0\nport 6379",
      });

      const call = vi.mocked(provider.generate).mock.calls[0][0];
      // Should use update prompt
      expect(call.system).toContain("updating an existing Redis configuration");
      // Should contain existing content via injectAs substitution
      expect(call.system).toContain("bind 0.0.0.0");
    });
  });
});

// ═════════════════════════════════════════════════════════
// 4. EDGE CASES & ERROR HANDLING
// ═════════════════════════════════════════════════════════

describe("Edge Cases & Error Handling", () => {
  describe("Parser Error Cases", () => {
    it("rejects file without frontmatter", () => {
      expect(() => parseDopsString("no frontmatter")).toThrow(
        "DOPS file must start with --- frontmatter delimiter",
      );
    });

    it("rejects file with unclosed frontmatter", () => {
      expect(() => parseDopsString("---\ndops: v1\nmeta:\n  name: x\n")).toThrow(
        "DOPS file missing closing --- frontmatter delimiter",
      );
    });

    it("rejects invalid YAML", () => {
      expect(() => parseDopsString("---\n: invalid: yaml:\n---\n")).toThrow(
        "Invalid YAML in frontmatter",
      );
    });

    it("rejects dops: v2 (only v1 supported)", () => {
      expect(() =>
        parseDopsString(
          "---\ndops: v2\nmeta:\n  name: x\n  version: 1.0.0\n  description: X\noutput:\n  type: object\nfiles:\n  - path: out.yaml\n---\n## Prompt\ntest\n## Keywords\ntest",
        ),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects missing meta.name", () => {
      expect(() =>
        parseDopsString(
          "---\ndops: v1\nmeta:\n  version: 1.0.0\n  description: X\noutput:\n  type: object\nfiles:\n  - path: out.yaml\n---\n## Prompt\ntest\n## Keywords\ntest",
        ),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects empty files array", () => {
      expect(() =>
        parseDopsString(
          "---\ndops: v1\nmeta:\n  name: test\n  version: 1.0.0\n  description: X\noutput:\n  type: object\nfiles: []\n---\n## Prompt\ntest\n## Keywords\ntest",
        ),
      ).toThrow("Invalid DOPS frontmatter");
    });
  });

  describe("Validation Edge Cases", () => {
    it("catches missing ## Prompt", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: no-prompt
  version: 1.0.0
  description: "No prompt"
output:
  type: object
files:
  - path: "out.yaml"
---
## Keywords

test
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required ## Prompt section");
    });

    it("catches missing ## Keywords", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: no-keywords
  version: 1.0.0
  description: "No keywords"
output:
  type: object
files:
  - path: "out.yaml"
---
## Prompt

Some prompt.
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required ## Keywords section");
    });

    it("catches unknown verification parser", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: bad-parser
  version: 1.0.0
  description: "Bad parser"
output:
  type: object
files:
  - path: "out.yaml"
verification:
  binary:
    command: "unknown-tool validate"
    parser: nonexistent-parser
---
## Prompt

Prompt.

## Keywords

test
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain("Unknown verification parser");
    });

    it("validates template source requires content", () => {
      const module = parseDopsString(`---
dops: v1
meta:
  name: template-no-content
  version: 1.0.0
  description: "Template missing content"
output:
  type: object
files:
  - path: "out.yaml"
    source: template
    format: yaml
---
## Prompt

Prompt.

## Keywords

test
`);
      const result = validateDopsModule(module);
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.includes("template source requires 'content'"))).toBe(
        true,
      );
    });
  });

  describe("Risk Schema Edge Cases", () => {
    it("rejects empty rationale", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: empty-rationale
  version: 1.0.0
  description: "Empty rationale"
output:
  type: object
files:
  - path: "out.yaml"
risk:
  level: HIGH
  rationale: ""
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });

    it("rejects invalid risk level", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: bad-risk
  version: 1.0.0
  description: "Bad risk"
output:
  type: object
files:
  - path: "out.yaml"
risk:
  level: CRITICAL
  rationale: "Whatever"
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });
  });

  describe("Execution Schema Edge Cases", () => {
    it("rejects invalid execution mode", () => {
      expect(() =>
        parseDopsString(`---
dops: v1
meta:
  name: bad-exec
  version: 1.0.0
  description: "Bad exec"
output:
  type: object
files:
  - path: "out.yaml"
execution:
  mode: delete
---
## Prompt

Generate.

## Keywords

test
`),
      ).toThrow("Invalid DOPS frontmatter");
    });
  });

  describe("Structural Validator Edge Cases", () => {
    it("validates nested path with wildcard", () => {
      const rules = [
        {
          path: "containers.*.name",
          required: true,
          message: "Container name required",
        },
      ];
      const data = {
        containers: [{ name: "app", image: "nginx" }, { image: "redis" }],
      };

      const issues = validateStructure(data, rules);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i) => i.message === "Container name required")).toBe(true);
    });

    it("validates minItems on array", () => {
      const rules = [
        {
          path: "resources",
          type: "array",
          minItems: 1,
          message: "At least one resource required",
        },
      ];

      const issues = validateStructure({ resources: [] }, rules);
      expect(issues.length).toBeGreaterThan(0);
    });

    it("passes requiredUnless when unless path has value", () => {
      const rules = [
        {
          path: "sentinelConf",
          required: true,
          requiredUnless: "replicas",
          message: "Sentinel required unless replicas configured",
        },
      ];

      // replicas = 0 (value exists, non-null/undefined) → rule skipped
      const issues1 = validateStructure({ replicas: 0 }, rules);
      expect(issues1.some((i) => i.message.includes("Sentinel required"))).toBe(false);

      // replicas = 3 (value exists) → rule skipped
      const issues2 = validateStructure({ replicas: 3 }, rules);
      expect(issues2.some((i) => i.message.includes("Sentinel required"))).toBe(false);

      // replicas missing entirely → sentinel is required but missing → error
      const issues3 = validateStructure({}, rules);
      expect(issues3.some((i) => i.message.includes("Sentinel required"))).toBe(true);

      // replicas = null → sentinel is required but missing → error
      const issues4 = validateStructure({ replicas: null }, rules);
      expect(issues4.some((i) => i.message.includes("Sentinel required"))).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════
// 5. BUILT-IN MODULES REGRESSION: verify all 12 modules
//    have scope, risk, execution sections
// ═════════════════════════════════════════════════════════

describe("Built-in Module Regression: New Sections", () => {
  const MODULES_DIR = path.join(__dirname, "../../modules");
  const moduleFiles = fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith(".dops"));

  const MEDIUM_RISK_TOOLS = new Set([
    "terraform",
    "kubernetes",
    "helm",
    "dockerfile",
    "ansible",
    "nginx",
    "systemd",
  ]);
  const LOW_RISK_TOOLS = new Set([
    "github-actions",
    "gitlab-ci",
    "makefile",
    "prometheus",
    "docker-compose",
  ]);

  it("has exactly 12 built-in modules", () => {
    expect(moduleFiles.length).toBe(12);
  });

  for (const file of moduleFiles) {
    const moduleName = file.replace(".dops", "");

    describe(`${moduleName}.dops`, () => {
      it("has scope section with at least one write path", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module.frontmatter.scope).toBeDefined();
        expect(module.frontmatter.scope!.write.length).toBeGreaterThanOrEqual(1);
      });

      it("scope paths cover all file spec paths", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        const filePaths = module.frontmatter.files.map((f: { path: string }) => f.path);
        // Each file path should be covered by at least one scope pattern
        for (const filePath of filePaths) {
          const hasMatch = matchesScopePattern(filePath, module.frontmatter.scope!.write, {});
          expect(hasMatch).toBe(true);
        }
      });

      it("has risk section with correct level", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module.frontmatter.risk).toBeDefined();
        expect(module.frontmatter.risk!.rationale.length).toBeGreaterThan(0);

        if (MEDIUM_RISK_TOOLS.has(moduleName)) {
          expect(module.frontmatter.risk!.level).toBe("MEDIUM");
        } else if (LOW_RISK_TOOLS.has(moduleName)) {
          expect(module.frontmatter.risk!.level).toBe("LOW");
        }
      });

      it("has execution section with idempotent: true", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module.frontmatter.execution).toBeDefined();
        expect(module.frontmatter.execution!.mode).toBe("generate");
        expect(module.frontmatter.execution!.idempotent).toBe(true);
      });

      it("has update section when detection is present", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        if (module.frontmatter.detection) {
          expect(module.frontmatter.update).toBeDefined();
          expect(module.frontmatter.update!.strategy).toBe("replace");
          expect(module.frontmatter.update!.injectAs).toBe("existingContent");
        }
      });

      it("scope paths do not contain path traversal", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        for (const writePath of module.frontmatter.scope!.write) {
          expect(writePath).not.toContain("..");
        }
      });

      it("validates without errors after adding new sections", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        const result = validateDopsModuleAny(module);
        expect(result.valid).toBe(true);
      });

      it("creates runtime successfully", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        const provider = createMockProvider({});
        if (isV2Module(module)) {
          const runtime = new DopsRuntimeV2(module, provider);
          expect(runtime.name).toBe(moduleName);
          expect(runtime.risk.level).toBeDefined();
          expect(runtime.executionMode).toBeDefined();
          expect(runtime.metadata.riskLevel).toBeDefined();
        } else {
          const runtime = new DopsRuntime(module, provider);
          expect(runtime.name).toBe(moduleName);
          expect(runtime.risk.level).toBeDefined();
          expect(runtime.executionMode).toBeDefined();
          expect(runtime.metadata.riskLevel).toBeDefined();
        }
      });
    });
  }
});

// ═════════════════════════════════════════════════════════
// 6. CROSS-MODULE INTEGRATION
// ═════════════════════════════════════════════════════════

describe("Cross-Module Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  it("end-to-end: parse → compile schema → compile prompt → generate → verify → serialize", async () => {
    const module = parseDopsString(REDIS_TOOL_DOPS);

    // 1. Compile schemas
    const inputSchema = compileInputSchema(module.frontmatter.input!.fields);
    const outputSchema = compileOutputSchema(module.frontmatter.output as Record<string, unknown>);

    // 2. Validate input
    const inputResult = inputSchema.safeParse({
      clusterName: "integration-cache",
      maxMemory: "512mb",
      port: 6380,
      enablePersistence: true,
      evictionPolicy: "volatile-lru",
      replicas: 0,
      outputPath: tmpDir,
    });
    expect(inputResult.success).toBe(true);

    // 3. Compile prompt
    const prompt = compilePrompt(module.sections, {
      input: inputResult.data,
    });
    expect(prompt).toContain("integration-cache");
    expect(prompt).toContain("CONSTRAINTS:");

    // 4. Mock LLM output
    const mockOutput = {
      redisConf:
        "bind 127.0.0.1\nport 6380\nmaxmemory 512mb\nmaxmemory-policy volatile-lru\nsave 900 1",
    };

    // 5. Validate output
    const outputResult = outputSchema.safeParse(mockOutput);
    expect(outputResult.success).toBe(true);

    // 6. Structural verification
    const structural = module.frontmatter.verification?.structural;
    const issues = structural ? validateStructure(mockOutput, structural) : [];
    expect(issues).toHaveLength(0);

    // 7. Serialize
    const serialized = serializeForFile(mockOutput, module.frontmatter.files[0]);
    expect(serialized).toBe(mockOutput.redisConf);

    // 8. Write files
    const writeResult = writeFiles(
      mockOutput,
      [module.frontmatter.files[0]], // just redis.conf
      { outputPath: tmpDir },
      false,
      module.frontmatter.scope,
    );
    expect(writeResult.filesWritten).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmpDir, "redis.conf"), "utf-8")).toContain("maxmemory 512mb");
  });

  it("end-to-end update: detect → compile update prompt → generate → verify → write with backup", async () => {
    // 1. Pre-create existing config
    fs.writeFileSync(
      path.join(tmpDir, "redis.conf"),
      "# existing config\nbind 0.0.0.0\nport 6379\nmaxmemory 256mb",
      "utf-8",
    );

    // 2. Parse module
    const module = parseDopsString(REDIS_TOOL_DOPS);

    // 3. Detect existing content
    const existing = detectExistingContent(module.frontmatter.detection!.paths, tmpDir);
    expect(existing).toBeDefined();
    expect(existing).toContain("bind 0.0.0.0");

    // 4. Compile update prompt
    const prompt = compilePrompt(module.sections, {
      existingContent: existing!,
      input: { clusterName: "upgrade-cache", maxMemory: "1gb" },
      updateConfig: module.frontmatter.update,
    });
    expect(prompt).toContain("updating an existing");
    expect(prompt).toContain("bind 0.0.0.0"); // existing content injected
    expect(prompt).toContain("Preserve the overall structure"); // preserve_structure

    // 5. Mock updated output
    const updatedOutput = {
      redisConf:
        "# existing config\nbind 0.0.0.0\nport 6379\nmaxmemory 1gb\nmaxmemory-policy allkeys-lru",
    };

    // 6. Write with backup
    const writeResult = writeFiles(
      updatedOutput,
      [module.frontmatter.files[0]],
      { outputPath: tmpDir },
      true, // isUpdate
      module.frontmatter.scope,
    );

    expect(writeResult.filesModified).toHaveLength(1);
    expect(fs.existsSync(path.join(tmpDir, "redis.conf.bak"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "redis.conf.bak"), "utf-8")).toContain(
      "maxmemory 256mb",
    );
    expect(fs.readFileSync(path.join(tmpDir, "redis.conf"), "utf-8")).toContain("maxmemory 1gb");
  });

  it("hash stability: same module always produces same hashes", () => {
    const module1 = parseDopsString(REDIS_TOOL_DOPS);
    const module2 = parseDopsString(REDIS_TOOL_DOPS);
    const provider = createMockProvider({});

    const rt1 = new DopsRuntime(module1, provider);
    const rt2 = new DopsRuntime(module2, provider);

    expect(rt1.systemPromptHash).toBe(rt2.systemPromptHash);
    expect(rt1.moduleHash).toBe(rt2.moduleHash);
  });

  it("hash changes when module content changes", () => {
    const module1 = parseDopsString(REDIS_TOOL_DOPS);
    const modified = REDIS_TOOL_DOPS.replace("redis-config", "redis-config-v2");
    const module2 = parseDopsString(modified);
    const provider = createMockProvider({});

    const rt1 = new DopsRuntime(module1, provider);
    const rt2 = new DopsRuntime(module2, provider);

    expect(rt1.moduleHash).not.toBe(rt2.moduleHash);
  });

  it("prompt hash changes when prompt changes", () => {
    const module1 = parseDopsString(REDIS_TOOL_DOPS);
    const modified = REDIS_TOOL_DOPS.replace(
      "Redis configuration expert",
      "Redis configuration specialist",
    );
    const module2 = parseDopsString(modified);
    const provider = createMockProvider({});

    const rt1 = new DopsRuntime(module1, provider);
    const rt2 = new DopsRuntime(module2, provider);

    expect(rt1.systemPromptHash).not.toBe(rt2.systemPromptHash);
  });
});

// ═════════════════════════════════════════════════════════
// 7. SERIALIZATION FORMATS
// ═════════════════════════════════════════════════════════

describe("Serialization Format Testing", () => {
  it("serializes YAML with dataPath extraction", () => {
    const result = serializeForFile(
      { config: { name: "redis", port: 6379 }, extra: "ignored" },
      {
        path: "out.yaml",
        format: "yaml",
        source: "llm",
        dataPath: "config",
      },
    );
    expect(result).toContain("name: redis");
    expect(result).toContain("port: 6379");
    expect(result).not.toContain("extra");
  });

  it("serializes JSON with nested dataPath", () => {
    const result = serializeForFile(
      { deep: { nested: { key: "value" } } },
      {
        path: "out.json",
        format: "json",
        source: "llm",
        dataPath: "deep.nested",
      },
    );
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("serializes raw string via dataPath", () => {
    const result = serializeForFile(
      { content: "raw string content", meta: {} },
      {
        path: "out.txt",
        format: "raw",
        source: "llm",
        dataPath: "content",
      },
    );
    expect(result).toBe("raw string content");
  });

  it("renders template with {{ .Values.key }}", () => {
    const result = serializeForFile(
      { name: "redis-cache", port: 6379 },
      {
        path: "out.conf",
        format: "raw",
        source: "template",
        content: "server {{ .Values.name }}:{{ .Values.port }}",
      },
    );
    expect(result).toBe("server redis-cache:6379");
  });

  it("serializes multi-document YAML", () => {
    const result = serializeForFile(
      [
        { kind: "Deployment", name: "app" },
        { kind: "Service", name: "svc" },
      ],
      {
        path: "out.yaml",
        format: "yaml",
        source: "llm",
        multiDocument: true,
      },
    );
    expect(result).toContain("kind: Deployment");
    expect(result).toContain("---");
    expect(result).toContain("kind: Service");
  });
});

// ═════════════════════════════════════════════════════════
// 8. BACKWARD COMPATIBILITY
// ═════════════════════════════════════════════════════════

describe("Backward Compatibility", () => {
  it("minimal tool without new sections parses and validates", () => {
    const module = parseDopsString(MINIMAL_TOOL_DOPS);
    const result = validateDopsModule(module);
    expect(result.valid).toBe(true);
    expect(module.frontmatter.scope).toBeUndefined();
    expect(module.frontmatter.risk).toBeUndefined();
    expect(module.frontmatter.execution).toBeUndefined();
    expect(module.frontmatter.update).toBeUndefined();
    expect(module.frontmatter.meta.icon).toBeUndefined();
  });

  it("minimal tool runtime defaults are safe", () => {
    const module = parseDopsString(MINIMAL_TOOL_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.risk).toEqual({
      level: "LOW",
      rationale: "No risk classification declared",
    });
    expect(runtime.executionMode).toEqual({
      mode: "generate",
      deterministic: false,
      idempotent: false,
    });
    expect(runtime.isDeterministic).toBe(false);
    expect(runtime.isIdempotent).toBe(false);
    expect(runtime.metadata.riskLevel).toBe("LOW");
    expect(runtime.metadata.icon).toBeUndefined();
  });

  it("writeFiles works without scope (no enforcement)", () => {
    const tmpDir = makeTmpDir();
    try {
      const result = writeFiles(
        { key: "value" },
        [{ path: "{outputPath}/any-file.yaml", format: "yaml" as const, source: "llm" as const }],
        { outputPath: tmpDir },
        false,
        // no scope
      );
      expect(result.filesWritten).toHaveLength(1);
    } finally {
      cleanDir(tmpDir);
    }
  });
});
