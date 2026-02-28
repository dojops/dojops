/**
 * Real-world integration test for the DojOps custom tool system.
 *
 * This test lives under /tmp/dojops-test and exercises the full lifecycle
 * of adding a new external custom tool to a project:
 *
 * 1. Create a realistic tool manifest (tool.yaml) + input schema
 * 2. Discover the tool via discoverTools()
 * 3. Validate the manifest via validateManifest()
 * 4. Build a CustomTool instance and validate input
 * 5. Generate output via mock LLM provider
 * 6. Execute (write files to disk)
 * 7. Verify ToolRegistry integration (metadata, getAll, has)
 * 8. Policy filtering (allow/block)
 * 9. CLI commands: init, validate, load, list (via discoverTools)
 * 10. Backward compat: legacy plugin.yaml + plugins/ directory still work
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

import {
  discoverTools,
  discoverToolsWithWarnings,
  validateManifest,
  CustomTool,
  ToolRegistry,
  loadToolPolicy,
  isToolAllowed,
} from "@dojops/tool-registry";
import { LLMProvider, LLMResponse } from "@dojops/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockProvider(response?: Partial<LLMResponse>): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: "{}",
      parsed: null,
      ...response,
    }),
  };
}

/** Write a Traefik reverse proxy custom tool */
function writeTraefikTool(toolsDir: string): string {
  const dir = path.join(toolsDir, "traefik-config");
  fs.mkdirSync(dir, { recursive: true });

  const manifest: Record<string, unknown> = {
    spec: 1,
    name: "traefik-config",
    version: "1.0.0",
    type: "tool",
    description: "Generates Traefik reverse proxy configuration in YAML format",
    inputSchema: "input.schema.json",
    tags: ["reverse-proxy", "traefik", "load-balancer"],
    generator: {
      strategy: "llm",
      systemPrompt:
        "You are a Traefik reverse proxy expert. Generate a valid Traefik v3 static and dynamic configuration. Return a JSON object with entryPoints, routers, and services.",
      updateMode: true,
      userPromptTemplate:
        'Generate Traefik config for service "{serviceName}" listening on port {port}: {description}',
    },
    files: [{ path: "{outputPath}/traefik.yaml", serializer: "yaml" }],
    detector: { path: ["traefik.yaml", "traefik/traefik.yaml"] },
    permissions: { filesystem: "project", network: "none", child_process: "none" },
  };

  const inputSchema = {
    type: "object",
    properties: {
      serviceName: { type: "string", description: "Name of the service to proxy", minLength: 1 },
      port: {
        type: "integer",
        description: "Upstream service port",
        minimum: 1,
        maximum: 65535,
      },
      description: { type: "string", description: "What the config should do" },
      outputPath: { type: "string", description: "Directory to write to" },
      enableDashboard: {
        type: "boolean",
        description: "Enable Traefik dashboard",
        default: false,
      },
    },
    required: ["serviceName", "port", "description", "outputPath"],
  };

  fs.writeFileSync(path.join(dir, "tool.yaml"), yaml.dump(manifest), "utf-8");
  fs.writeFileSync(
    path.join(dir, "input.schema.json"),
    JSON.stringify(inputSchema, null, 2) + "\n",
    "utf-8",
  );

  return dir;
}

/** Write a Redis config custom tool */
function writeRedisTool(toolsDir: string): string {
  const dir = path.join(toolsDir, "redis-config");
  fs.mkdirSync(dir, { recursive: true });

  const manifest: Record<string, unknown> = {
    spec: 1,
    name: "redis-config",
    version: "0.5.0",
    type: "tool",
    description: "Generates Redis configuration files (redis.conf format)",
    inputSchema: "input.schema.json",
    tags: ["database", "cache", "redis"],
    generator: {
      strategy: "llm",
      systemPrompt:
        "You are a Redis configuration expert. Generate a valid redis.conf file. Return a JSON object with a 'config' key containing the raw redis.conf content.",
    },
    files: [{ path: "{outputPath}/redis.conf", serializer: "raw" }],
    permissions: { filesystem: "project", network: "none", child_process: "none" },
  };

  const inputSchema = {
    type: "object",
    properties: {
      maxMemory: { type: "string", description: "Max memory limit (e.g. 256mb)" },
      port: { type: "integer", description: "Redis listen port", minimum: 1, maximum: 65535 },
      outputPath: { type: "string", description: "Directory to write to" },
      description: { type: "string", description: "What the config should do" },
    },
    required: ["outputPath", "description"],
  };

  fs.writeFileSync(path.join(dir, "tool.yaml"), yaml.dump(manifest), "utf-8");
  fs.writeFileSync(
    path.join(dir, "input.schema.json"),
    JSON.stringify(inputSchema, null, 2) + "\n",
    "utf-8",
  );

  return dir;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("External Tool Integration: Full Lifecycle", () => {
  let tmpDir: string;
  let projectDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-ext-tool-"));
    projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Manifest Validation ──

  describe("Step 1: Manifest Validation", () => {
    it("Traefik tool manifest is valid", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);

      const manifestPath = path.join(toolsDir, "traefik-config", "tool.yaml");
      const raw = yaml.load(fs.readFileSync(manifestPath, "utf-8"));
      const result = validateManifest(raw);

      expect(result.valid).toBe(true);
      expect(result.manifest!.name).toBe("traefik-config");
      expect(result.manifest!.version).toBe("1.0.0");
      expect(result.manifest!.files[0].serializer).toBe("yaml");
      expect(result.manifest!.tags).toContain("traefik");
      expect(result.manifest!.generator.updateMode).toBe(true);
    });

    it("Redis tool manifest is valid", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeRedisTool(toolsDir);

      const manifestPath = path.join(toolsDir, "redis-config", "tool.yaml");
      const raw = yaml.load(fs.readFileSync(manifestPath, "utf-8"));
      const result = validateManifest(raw);

      expect(result.valid).toBe(true);
      expect(result.manifest!.name).toBe("redis-config");
      expect(result.manifest!.files[0].serializer).toBe("raw");
    });
  });

  // ── 2. Tool Discovery ──

  describe("Step 2: Tool Discovery", () => {
    it("discovers Traefik tool from project .dojops/tools/", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);

      const tools = discoverTools(projectDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].manifest.name).toBe("traefik-config");
      expect(tools[0].source.type).toBe("custom");
      expect(tools[0].source.location).toBe("project");
      expect(tools[0].source.toolVersion).toBe("1.0.0");
      expect(tools[0].source.toolHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("discovers Redis tool from global ~/.dojops/tools/", () => {
      const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
      writeRedisTool(globalToolsDir);

      const tools = discoverTools(projectDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].manifest.name).toBe("redis-config");
      expect(tools[0].source.location).toBe("global");
    });

    it("discovers both tools (project + global), project overrides global", () => {
      const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
      writeRedisTool(globalToolsDir);

      const projectToolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(projectToolsDir);

      const tools = discoverTools(projectDir);
      expect(tools).toHaveLength(2);
      const names = tools.map((t) => t.manifest.name).sort();
      expect(names).toEqual(["redis-config", "traefik-config"]);
    });

    it("project tool overrides global tool with same name", () => {
      const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
      writeTraefikTool(globalToolsDir);

      // Create project version with bumped version
      const projectToolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(projectToolsDir);
      // Modify the project version
      const manifestPath = path.join(projectToolsDir, "traefik-config", "tool.yaml");
      const content = yaml.load(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      content.version = "2.0.0";
      fs.writeFileSync(manifestPath, yaml.dump(content), "utf-8");

      const tools = discoverTools(projectDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].manifest.version).toBe("2.0.0");
      expect(tools[0].source.location).toBe("project");
    });

    it("provides warnings for invalid tools", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      const brokenDir = path.join(toolsDir, "broken-tool");
      fs.mkdirSync(brokenDir, { recursive: true });
      fs.writeFileSync(path.join(brokenDir, "tool.yaml"), "not valid: [yaml", "utf-8");

      const { tools, warnings } = discoverToolsWithWarnings(projectDir);
      expect(tools).toHaveLength(0);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("Failed to load");
    });
  });

  // ── 3. JSON Schema → Zod Validation ──

  describe("Step 3: Input Schema Validation", () => {
    it("validates Traefik input correctly", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);
      const entry = discoverTools(projectDir)[0];
      const provider = createMockProvider();

      const tool = new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
      );

      // Valid input
      expect(
        tool.validate({
          serviceName: "web-api",
          port: 3000,
          description: "Route traffic to web API",
          outputPath: "/tmp/out",
        }).valid,
      ).toBe(true);

      // Valid with optional field
      expect(
        tool.validate({
          serviceName: "web-api",
          port: 3000,
          description: "test",
          outputPath: "/tmp",
          enableDashboard: true,
        }).valid,
      ).toBe(true);

      // Missing required field
      expect(tool.validate({ serviceName: "web-api", port: 3000 }).valid).toBe(false);

      // serviceName minLength violation
      expect(
        tool.validate({
          serviceName: "",
          port: 3000,
          description: "test",
          outputPath: "/tmp",
        }).valid,
      ).toBe(false);

      // Port out of range
      expect(
        tool.validate({
          serviceName: "web",
          port: 99999,
          description: "test",
          outputPath: "/tmp",
        }).valid,
      ).toBe(false);
    });
  });

  // ── 4. LLM Generation ──

  describe("Step 4: LLM Generation", () => {
    it("generates Traefik YAML config via mock LLM", async () => {
      const traefikConfig = {
        entryPoints: {
          web: { address: ":80" },
          websecure: { address: ":443" },
        },
        http: {
          routers: {
            "web-api": {
              rule: "Host(`api.example.com`)",
              service: "web-api-service",
              entryPoints: ["websecure"],
            },
          },
          services: {
            "web-api-service": {
              loadBalancer: {
                servers: [{ url: "http://localhost:3000" }],
              },
            },
          },
        },
      };

      const provider = createMockProvider({
        content: JSON.stringify(traefikConfig),
        parsed: traefikConfig,
      });

      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);
      const entry = discoverTools(projectDir)[0];

      const tool = new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
      );

      const result = await tool.generate({
        serviceName: "web-api",
        port: 3000,
        description: "Route HTTPS traffic to Node.js API",
        outputPath: path.join(tmpDir, "output"),
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const data = result.data as { generated: unknown; isUpdate: boolean };
      expect(data.isUpdate).toBe(false);
      expect(data.generated).toEqual(traefikConfig);

      // Verify LLM was called with correct prompts
      const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.system).toContain("Traefik");
      expect(call.prompt).toContain("web-api");
      expect(call.prompt).toContain("3000");
    });

    it("generates Redis raw config via mock LLM", async () => {
      const redisConf = `bind 127.0.0.1
port 6379
maxmemory 256mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
`;
      const provider = createMockProvider({
        content: redisConf,
        parsed: undefined, // raw string, no structured output
      });

      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeRedisTool(toolsDir);
      const entry = discoverTools(projectDir)[0];

      const tool = new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
      );

      const result = await tool.generate({
        maxMemory: "256mb",
        port: 6379,
        outputPath: path.join(tmpDir, "output"),
        description: "Production Redis with LRU eviction",
      });

      expect(result.success).toBe(true);
      const data = result.data as { generated: unknown };
      expect(data.generated).toBe(redisConf);
    });
  });

  // ── 5. Execute (Write Files to Disk) ──

  describe("Step 5: Execution (File Writing)", () => {
    it("Traefik tool writes YAML config to disk", async () => {
      const traefikConfig = {
        entryPoints: { web: { address: ":80" } },
        http: {
          routers: { api: { rule: "Host(`api.local`)" } },
        },
      };

      const provider = createMockProvider({ parsed: traefikConfig });

      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);
      const entry = discoverTools(projectDir)[0];

      const outputDir = "output";
      const tool = new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
        undefined,
        entry.toolDir,
      );

      const result = await tool.execute({
        serviceName: "api",
        port: 8080,
        description: "Basic proxy",
        outputPath: outputDir,
      });

      expect(result.success).toBe(true);

      // File should exist on disk — resolveFilePath now anchors to toolDir
      const filePath = path.join(entry.toolDir, outputDir, "traefik.yaml");
      expect(fs.existsSync(filePath)).toBe(true);

      // Content should be valid YAML
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = yaml.load(content) as Record<string, unknown>;
      expect(parsed).toHaveProperty("entryPoints");
      expect(parsed).toHaveProperty("http");

      // filesWritten should be populated
      expect(result.filesWritten).toBeDefined();
      expect(result.filesWritten).toContain(filePath);
    });

    it("Redis tool writes raw config to disk", async () => {
      const redisConf = "bind 0.0.0.0\nport 6380\nmaxmemory 128mb\n";
      const provider = createMockProvider({
        content: redisConf,
        parsed: undefined,
      });

      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeRedisTool(toolsDir);
      const entry = discoverTools(projectDir)[0];

      const outputDir = "redis-output";
      const tool = new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
        undefined,
        entry.toolDir,
      );

      const result = await tool.execute({
        maxMemory: "128mb",
        port: 6380,
        outputPath: outputDir,
        description: "Development Redis",
      });

      expect(result.success).toBe(true);

      const filePath = path.join(entry.toolDir, outputDir, "redis.conf");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(redisConf);
    });

    it("update mode creates .bak backup and sets isUpdate flag", async () => {
      const provider = createMockProvider({
        parsed: { entryPoints: { web: { address: ":443" } } },
      });

      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);
      const entry = discoverTools(projectDir)[0];

      const outputDir = "output";
      // Create existing file under toolDir since resolveFilePath anchors to it
      const absOutputDir = path.join(entry.toolDir, outputDir);
      fs.mkdirSync(absOutputDir, { recursive: true });
      const filePath = path.join(absOutputDir, "traefik.yaml");
      fs.writeFileSync(filePath, "original: content\n", "utf-8");

      const tool = new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
        undefined,
        entry.toolDir,
      );

      const result = await tool.execute({
        serviceName: "api",
        port: 443,
        description: "Update to HTTPS",
        outputPath: outputDir,
        existingContent: "original: content\n",
      });

      expect(result.success).toBe(true);

      // Backup should exist
      expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
      expect(fs.readFileSync(`${filePath}.bak`, "utf-8")).toBe("original: content\n");

      // New content should be written
      const newContent = yaml.load(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      expect(newContent).toHaveProperty("entryPoints");

      // filesModified should be populated
      expect(result.filesModified).toContain(filePath);
    });
  });

  // ── 6. ToolRegistry Integration ──

  describe("Step 6: ToolRegistry Integration", () => {
    it("ToolRegistry combines built-in + custom tools", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);
      writeRedisTool(toolsDir);

      const entries = discoverTools(projectDir);
      const provider = createMockProvider();

      const customTools = entries.map(
        (e) => new CustomTool(e.manifest, provider, e.toolDir, e.source, e.inputSchemaRaw),
      );

      // Mock some built-in tools
      const mockBuiltIns = [
        { name: "terraform", description: "Terraform tool", inputSchema: {} },
        { name: "kubernetes", description: "K8s tool", inputSchema: {} },
      ] as never[];

      const registry = new ToolRegistry(mockBuiltIns, customTools);

      // All tools accessible
      expect(registry.size).toBe(4); // 2 built-in + 2 custom
      expect(registry.has("terraform")).toBe(true);
      expect(registry.has("kubernetes")).toBe(true);
      expect(registry.has("traefik-config")).toBe(true);
      expect(registry.has("redis-config")).toBe(true);
      expect(registry.has("nonexistent")).toBe(false);

      // getAll returns all
      expect(registry.getAll()).toHaveLength(4);

      // getBuiltIn and getCustomTools
      expect(registry.getBuiltIn()).toHaveLength(2);
      expect(registry.getCustomTools()).toHaveLength(2);
    });

    it("getToolMetadata returns correct metadata for custom tools", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);

      const entries = discoverTools(projectDir);
      const provider = createMockProvider();
      const customTools = entries.map(
        (e) => new CustomTool(e.manifest, provider, e.toolDir, e.source, e.inputSchemaRaw),
      );

      const registry = new ToolRegistry([], customTools);
      const meta = registry.getToolMetadata("traefik-config");

      expect(meta).toBeDefined();
      expect(meta!.toolType).toBe("custom");
      expect(meta!.toolVersion).toBe("1.0.0");
      expect(meta!.toolSource).toBe("project");
      expect(meta!.toolHash).toMatch(/^[a-f0-9]{64}$/);
      expect(meta!.systemPromptHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("systemPromptHash is stable and unique per tool", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);
      writeRedisTool(toolsDir);

      const entries = discoverTools(projectDir);
      const provider = createMockProvider();
      const tools = entries.map(
        (e) => new CustomTool(e.manifest, provider, e.toolDir, e.source, e.inputSchemaRaw),
      );

      // Different tools have different hashes
      expect(tools[0].systemPromptHash).not.toBe(tools[1].systemPromptHash);

      // Same tool has stable hash
      const tool2 = new CustomTool(
        entries[0].manifest,
        provider,
        entries[0].toolDir,
        entries[0].source,
        entries[0].inputSchemaRaw,
      );
      expect(tools[0].systemPromptHash).toBe(tool2.systemPromptHash);
    });
  });

  // ── 7. Policy Filtering ──

  describe("Step 7: Policy Filtering", () => {
    it("blockedTools prevents specific tools", () => {
      const dojopsDir = path.join(projectDir, ".dojops");
      fs.mkdirSync(dojopsDir, { recursive: true });
      fs.writeFileSync(
        path.join(dojopsDir, "policy.yaml"),
        yaml.dump({ blockedTools: ["redis-config"] }),
        "utf-8",
      );

      const policy = loadToolPolicy(projectDir);
      expect(isToolAllowed("traefik-config", policy)).toBe(true);
      expect(isToolAllowed("redis-config", policy)).toBe(false);
    });

    it("allowedTools restricts to only listed tools", () => {
      const dojopsDir = path.join(projectDir, ".dojops");
      fs.mkdirSync(dojopsDir, { recursive: true });
      fs.writeFileSync(
        path.join(dojopsDir, "policy.yaml"),
        yaml.dump({ allowedTools: ["traefik-config"] }),
        "utf-8",
      );

      const policy = loadToolPolicy(projectDir);
      expect(isToolAllowed("traefik-config", policy)).toBe(true);
      expect(isToolAllowed("redis-config", policy)).toBe(false);
      expect(isToolAllowed("any-other-tool", policy)).toBe(false);
    });

    it("blockedTools takes precedence over allowedTools", () => {
      const dojopsDir = path.join(projectDir, ".dojops");
      fs.mkdirSync(dojopsDir, { recursive: true });
      fs.writeFileSync(
        path.join(dojopsDir, "policy.yaml"),
        yaml.dump({
          allowedTools: ["traefik-config"],
          blockedTools: ["traefik-config"],
        }),
        "utf-8",
      );

      const policy = loadToolPolicy(projectDir);
      expect(isToolAllowed("traefik-config", policy)).toBe(false);
    });
  });

  // ── 8. Backward Compatibility ──

  describe("Step 8: Backward Compatibility", () => {
    it("discovers tools from legacy plugins/ directory", () => {
      const legacyDir = path.join(projectDir, ".dojops", "plugins");
      writeTraefikTool(legacyDir);

      const tools = discoverTools(projectDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].manifest.name).toBe("traefik-config");
    });

    it("discovers tools with legacy plugin.yaml manifest", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      const toolDir = path.join(toolsDir, "legacy-tool");
      fs.mkdirSync(toolDir, { recursive: true });

      // Write as plugin.yaml (legacy name)
      const manifest = {
        spec: 1,
        name: "legacy-tool",
        version: "1.0.0",
        type: "tool",
        description: "A tool with legacy manifest name",
        inputSchema: "input.schema.json",
        generator: { strategy: "llm", systemPrompt: "Generate stuff." },
        files: [{ path: "output.yaml", serializer: "yaml" }],
      };
      fs.writeFileSync(path.join(toolDir, "plugin.yaml"), yaml.dump(manifest), "utf-8");
      fs.writeFileSync(
        path.join(toolDir, "input.schema.json"),
        JSON.stringify({
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        }),
        "utf-8",
      );

      const tools = discoverTools(projectDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].manifest.name).toBe("legacy-tool");
    });

    it("legacy policy fields (allowedPlugins/blockedPlugins) still work", () => {
      const dojopsDir = path.join(projectDir, ".dojops");
      fs.mkdirSync(dojopsDir, { recursive: true });
      fs.writeFileSync(
        path.join(dojopsDir, "policy.yaml"),
        yaml.dump({ allowedPlugins: ["traefik-config"], blockedPlugins: ["redis-config"] }),
        "utf-8",
      );

      const policy = loadToolPolicy(projectDir);
      expect(policy.allowedTools).toEqual(["traefik-config"]);
      expect(policy.blockedTools).toEqual(["redis-config"]);
    });

    it("new policy fields take precedence over legacy", () => {
      const dojopsDir = path.join(projectDir, ".dojops");
      fs.mkdirSync(dojopsDir, { recursive: true });
      fs.writeFileSync(
        path.join(dojopsDir, "policy.yaml"),
        yaml.dump({
          allowedTools: ["new-tool"],
          allowedPlugins: ["old-tool"],
        }),
        "utf-8",
      );

      const policy = loadToolPolicy(projectDir);
      expect(policy.allowedTools).toEqual(["new-tool"]);
    });
  });

  // ── 9. Tool Hash Integrity ──

  describe("Step 9: Hash Integrity", () => {
    it("hash changes when manifest is modified", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);

      const before = discoverTools(projectDir);
      const hashBefore = before[0].source.toolHash;

      // Modify the system prompt
      const manifestPath = path.join(toolsDir, "traefik-config", "tool.yaml");
      const content = yaml.load(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      (content.generator as Record<string, unknown>).systemPrompt = "Modified system prompt.";
      fs.writeFileSync(manifestPath, yaml.dump(content), "utf-8");

      const after = discoverTools(projectDir);
      const hashAfter = after[0].source.toolHash;

      expect(hashBefore).not.toBe(hashAfter);
    });

    it("hash is stable when nothing changes", () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);

      const first = discoverTools(projectDir);
      const second = discoverTools(projectDir);

      expect(first[0].source.toolHash).toBe(second[0].source.toolHash);
    });
  });

  // ── 10. Verify (no command → pass) ──

  describe("Step 10: Verification", () => {
    it("verify passes for tools without verification command", async () => {
      const toolsDir = path.join(projectDir, ".dojops", "tools");
      writeTraefikTool(toolsDir);
      const entry = discoverTools(projectDir)[0];
      const provider = createMockProvider();

      const tool = new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
      );

      const result = await tool.verify({});
      expect(result.passed).toBe(true);
      expect(result.tool).toBe("traefik-config");
      expect(result.issues).toHaveLength(0);
    });
  });
});
