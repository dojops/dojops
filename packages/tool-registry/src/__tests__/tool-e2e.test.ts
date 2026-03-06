/**
 * End-to-end tool integration tests.
 *
 * These tests exercise the full custom tool lifecycle:
 * 1. Manifest creation & validation
 * 2. Discovery (global + project, override semantics)
 * 3. JSON Schema → Zod conversion & input validation
 * 4. CustomTool instantiation via ToolRegistry factory
 * 5. LLM generation (via mock provider)
 * 6. File serialization & execution (write to disk)
 * 7. Verification command handling
 * 8. Policy filtering
 * 9. Update mode with backup
 * 10. ToolRegistry metadata (toolType, systemPromptHash, etc.)
 *
 * Uses realistic tool manifests (Caddy web server, Envoy proxy)
 * rather than minimal test stubs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import { LLMProvider, LLMResponse } from "@dojops/core";
import { validateManifest } from "../manifest-schema";
import { discoverTools, discoverToolsWithWarnings } from "../tool-loader";
import { CustomTool } from "../custom-tool";
import { ToolRegistry } from "../registry";
import { jsonSchemaToZod, JSONSchemaObject } from "../json-schema-to-zod";
import { isToolAllowed, loadToolPolicy } from "../policy";
import { serialize } from "../serializers";

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

/** Shared temp dir setup/teardown for E2E tests that need filesystem isolation. */
function useTempDir() {
  let tmpDir: string;
  let projectDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-e2e-"));
    projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  return {
    get tmpDir() {
      return tmpDir;
    },
    get projectDir() {
      return projectDir;
    },
  };
}

/**
 * Write a Caddy tool into projectDir's .dojops/tools, discover it,
 * and return the first discovered entry.
 */
function setupCaddyTool(projectDir: string) {
  const projectToolsDir = path.join(projectDir, ".dojops", "tools");
  writeCaddyTool(projectToolsDir);
  return discoverTools(projectDir)[0];
}

/**
 * Create a CustomTool from a discovered tool entry with the given provider.
 */
function createCustomToolFromEntry(
  entry: ReturnType<typeof discoverTools>[0],
  provider: LLMProvider,
  anchorDir?: string,
) {
  return new CustomTool(
    entry.manifest,
    provider,
    entry.toolDir,
    entry.source,
    entry.inputSchemaRaw,
    undefined,
    anchorDir,
  );
}

/** Write a realistic Caddy tool to disk */
function writeCaddyTool(toolsDir: string): string {
  const dir = path.join(toolsDir, "caddy-config");
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    spec: 1,
    name: "caddy-config",
    version: "1.0.0",
    type: "tool",
    description: "Generates Caddy web server configuration files (Caddyfile format)",
    inputSchema: "input.schema.json",
    tags: ["web-server", "reverse-proxy", "tls"],
    generator: {
      strategy: "llm",
      systemPrompt:
        'You are a Caddy web server configuration expert. Generate a valid Caddyfile configuration. Return a JSON object with a "caddyfile" key containing the raw Caddyfile content as a string.',
      updateMode: true,
      userPromptTemplate:
        'Generate a Caddyfile for domain "{domain}" with the following requirements: {description}',
    },
    files: [{ path: "{outputPath}/Caddyfile", serializer: "raw" }],
    detector: { path: ["Caddyfile", "caddy/Caddyfile"] },
    permissions: { filesystem: "project", network: "none", child_process: "none" },
  };

  const inputSchema = {
    type: "object",
    properties: {
      domain: { type: "string", description: "The domain name", minLength: 1 },
      description: { type: "string", description: "What the Caddyfile should do" },
      outputPath: { type: "string", description: "Directory to write to" },
      enableTls: { type: "boolean", description: "Enable automatic TLS", default: true },
    },
    required: ["domain", "description", "outputPath"],
  };

  fs.writeFileSync(path.join(dir, "tool.yaml"), yaml.dump(manifest), "utf-8");
  fs.writeFileSync(
    path.join(dir, "input.schema.json"),
    JSON.stringify(inputSchema, null, 2) + "\n",
    "utf-8",
  );

  return dir;
}

/** Write a realistic Envoy tool to disk */
function writeEnvoyTool(toolsDir: string): string {
  const dir = path.join(toolsDir, "envoy-config");
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    spec: 1,
    name: "envoy-config",
    version: "0.2.0",
    type: "tool",
    description: "Generates Envoy proxy configuration in YAML format",
    inputSchema: "input.schema.json",
    tags: ["proxy", "service-mesh", "envoy"],
    generator: {
      strategy: "llm",
      systemPrompt:
        "You are an Envoy proxy configuration expert. Generate a valid Envoy v3 bootstrap configuration.",
      updateMode: false,
    },
    files: [{ path: "{outputPath}/envoy.yaml", serializer: "yaml" }],
    verification: { command: "yamllint -d relaxed envoy.yaml" },
    detector: { path: "envoy.yaml" },
    permissions: { filesystem: "project", network: "none", child_process: "required" },
  };

  const inputSchema = {
    type: "object",
    properties: {
      serviceName: { type: "string", description: "Name of the service", minLength: 1 },
      listenPort: {
        type: "integer",
        description: "Port for the listener",
        minimum: 1,
        maximum: 65535,
      },
      upstreamHost: { type: "string", description: "Upstream service hostname" },
      upstreamPort: {
        type: "integer",
        description: "Upstream service port",
        minimum: 1,
        maximum: 65535,
      },
      outputPath: { type: "string", description: "Directory to write to" },
    },
    required: ["serviceName", "listenPort", "upstreamHost", "upstreamPort", "outputPath"],
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

describe("Tool E2E: Manifest Validation", () => {
  it("validates the Caddy tool manifest", () => {
    const manifest = {
      spec: 1,
      name: "caddy-config",
      version: "1.0.0",
      type: "tool",
      description: "Generates Caddy web server configuration files",
      inputSchema: "input.schema.json",
      tags: ["web-server"],
      generator: {
        strategy: "llm",
        systemPrompt: "You are a Caddy expert.",
        updateMode: true,
        userPromptTemplate: "Generate a Caddyfile for {domain}",
      },
      files: [{ path: "{outputPath}/Caddyfile", serializer: "raw" }],
      detector: { path: ["Caddyfile", "caddy/Caddyfile"] },
      permissions: { filesystem: "project", network: "none", child_process: "none" },
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.manifest!.name).toBe("caddy-config");
    expect(result.manifest!.files[0].serializer).toBe("raw");
    expect(result.manifest!.detector!.path).toEqual(["Caddyfile", "caddy/Caddyfile"]);
  });

  it("validates the Envoy tool manifest", () => {
    const manifest = {
      spec: 1,
      name: "envoy-config",
      version: "0.2.0",
      type: "tool",
      description: "Generates Envoy proxy configuration in YAML format",
      inputSchema: "input.schema.json",
      tags: ["proxy"],
      generator: {
        strategy: "llm",
        systemPrompt: "You are an Envoy expert.",
      },
      files: [{ path: "{outputPath}/envoy.yaml", serializer: "yaml" }],
      verification: { command: "yamllint -d relaxed envoy.yaml" },
      permissions: { filesystem: "project", child_process: "required" },
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.manifest!.verification!.command).toContain("yamllint");
    expect(result.manifest!.permissions!.child_process).toBe("required");
  });

  it("rejects manifest with path traversal in inputSchema", () => {
    const result = validateManifest({
      spec: 1,
      name: "evil",
      version: "1.0.0",
      type: "tool",
      description: "test",
      inputSchema: "../../../etc/passwd",
      generator: { strategy: "llm", systemPrompt: "test" },
      files: [{ path: "out.yaml", serializer: "yaml" }],
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("traversal");
  });

  it("rejects manifest with path traversal in file path", () => {
    const result = validateManifest({
      spec: 1,
      name: "evil",
      version: "1.0.0",
      type: "tool",
      description: "test",
      inputSchema: "input.schema.json",
      generator: { strategy: "llm", systemPrompt: "test" },
      files: [{ path: "../../etc/shadow", serializer: "raw" }],
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("traversal");
  });

  it("rejects manifest with invalid name (uppercase)", () => {
    const result = validateManifest({
      spec: 1,
      name: "CaddyConfig",
      version: "1.0.0",
      type: "tool",
      description: "test",
      inputSchema: "input.schema.json",
      generator: { strategy: "llm", systemPrompt: "test" },
      files: [{ path: "out.yaml", serializer: "yaml" }],
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("lowercase");
  });
});

describe("Tool E2E: Discovery & Registry", () => {
  const ctx = useTempDir();

  it("discovers Caddy tool from project directory", () => {
    const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
    writeCaddyTool(projectToolsDir);

    const tools = discoverTools(ctx.projectDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("caddy-config");
    expect(tools[0].manifest.version).toBe("1.0.0");
    expect(tools[0].source.location).toBe("project");
    expect(tools[0].source.toolHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tools[0].inputSchemaRaw).toBeDefined();
    expect(tools[0].inputSchemaRaw.type).toBe("object");
  });

  it("discovers Envoy tool from global directory", () => {
    const globalToolsDir = path.join(ctx.tmpDir, ".dojops", "tools");
    writeEnvoyTool(globalToolsDir);

    const tools = discoverTools(ctx.projectDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("envoy-config");
    expect(tools[0].source.location).toBe("global");
  });

  it("discovers both Caddy (project) and Envoy (global) tools", () => {
    const globalToolsDir = path.join(ctx.tmpDir, ".dojops", "tools");
    writeEnvoyTool(globalToolsDir);

    const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
    writeCaddyTool(projectToolsDir);

    const tools = discoverTools(ctx.projectDir);
    expect(tools).toHaveLength(2);

    const names = tools.map((t) => t.manifest.name).sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(["caddy-config", "envoy-config"]);
  });

  it("provides warnings for invalid tools", () => {
    const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
    fs.mkdirSync(path.join(projectToolsDir, "broken-tool"), { recursive: true });
    fs.writeFileSync(
      path.join(projectToolsDir, "broken-tool", "tool.yaml"),
      "spec: 999\nname: broken\n",
      "utf-8",
    );

    const { tools, warnings } = discoverToolsWithWarnings(ctx.projectDir);
    expect(tools).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Failed to load");
  });

  it("ToolRegistry integrates custom tools alongside built-in tools", () => {
    const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
    writeCaddyTool(projectToolsDir);
    writeEnvoyTool(projectToolsDir);

    const entries = discoverTools(ctx.projectDir);
    const provider = createMockProvider();

    const customTools = entries.map(
      (entry) =>
        new CustomTool(
          entry.manifest,
          provider,
          entry.toolDir,
          entry.source,
          entry.inputSchemaRaw,
          entry.outputSchemaRaw,
        ),
    );

    // Create registry with mock built-in tools + real custom tools
    const mockBuiltIn = [
      { name: "github-actions", description: "GHA", inputSchema: {} },
    ] as never[];
    const registry = new ToolRegistry(mockBuiltIn, customTools);

    expect(registry.has("caddy-config")).toBe(true);
    expect(registry.has("envoy-config")).toBe(true);
    expect(registry.has("github-actions")).toBe(true);
    expect(registry.size).toBe(3);

    // Custom tool metadata
    const caddyMeta = registry.getToolMetadata("caddy-config");
    expect(caddyMeta).toBeDefined();
    expect(caddyMeta!.toolType).toBe("custom");
    expect(caddyMeta!.toolVersion).toBe("1.0.0");
    expect(caddyMeta!.toolSource).toBe("project");
    expect(caddyMeta!.systemPromptHash).toMatch(/^[a-f0-9]{64}$/);

    const envoyMeta = registry.getToolMetadata("envoy-config");
    expect(envoyMeta!.toolType).toBe("custom");
    expect(envoyMeta!.toolVersion).toBe("0.2.0");

    // Built-in metadata
    const ghaMeta = registry.getToolMetadata("github-actions");
    expect(ghaMeta!.toolType).toBe("built-in");
    expect(ghaMeta!.toolVersion).toBeUndefined();
  });

  it("custom tools can override built-in tools by name", () => {
    // Create a tool named "nginx" which is also a built-in
    const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
    const dir = path.join(projectToolsDir, "nginx");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "tool.yaml"),
      yaml.dump({
        spec: 1,
        name: "nginx",
        version: "2.0.0",
        type: "tool",
        description: "Custom nginx tool",
        inputSchema: "input.schema.json",
        generator: { strategy: "llm", systemPrompt: "Custom nginx" },
        files: [{ path: "nginx.conf", serializer: "raw" }],
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(dir, "input.schema.json"),
      JSON.stringify({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      "utf-8",
    );

    const entries = discoverTools(ctx.projectDir);
    const provider = createMockProvider();
    const customTools = entries.map(
      (entry) =>
        new CustomTool(entry.manifest, provider, entry.toolDir, entry.source, entry.inputSchemaRaw),
    );

    const mockBuiltInNginx = {
      name: "nginx",
      description: "Built-in nginx",
      inputSchema: {},
    } as never;
    const registry = new ToolRegistry([mockBuiltInNginx], customTools);

    // Custom tool should override the built-in
    const tool = registry.get("nginx");
    expect(tool).toBeDefined();
    expect(tool!.description).toBe("Custom nginx tool");

    const meta = registry.getToolMetadata("nginx");
    expect(meta!.toolType).toBe("custom");
    expect(meta!.toolVersion).toBe("2.0.0");
  });
});

describe("Tool E2E: JSON Schema to Zod Conversion", () => {
  it("converts Caddy input schema with all field types", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        domain: { type: "string", minLength: 1 },
        description: { type: "string" },
        outputPath: { type: "string" },
        enableTls: { type: "boolean", default: true },
        upstreams: { type: "array", items: { type: "string" } },
      },
      required: ["domain", "description", "outputPath"],
    };

    const zodSchema = jsonSchemaToZod(schema);

    // Valid input
    const valid = zodSchema.safeParse({
      domain: "example.com",
      description: "Reverse proxy",
      outputPath: "/tmp",
    });
    expect(valid.success).toBe(true);

    // Valid with optional + default
    const withOptional = zodSchema.safeParse({
      domain: "test.com",
      description: "test",
      outputPath: "/out",
      enableTls: false,
      upstreams: ["localhost:3000", "localhost:3001"],
    });
    expect(withOptional.success).toBe(true);

    // Missing required field
    const missing = zodSchema.safeParse({ domain: "example.com" });
    expect(missing.success).toBe(false);

    // domain minLength violation
    const empty = zodSchema.safeParse({
      domain: "",
      description: "test",
      outputPath: "/out",
    });
    expect(empty.success).toBe(false);
  });

  it("converts Envoy input schema with integer constraints", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        serviceName: { type: "string", minLength: 1 },
        listenPort: { type: "integer", minimum: 1, maximum: 65535 },
        upstreamHost: { type: "string" },
        upstreamPort: { type: "integer", minimum: 1, maximum: 65535 },
        outputPath: { type: "string" },
      },
      required: ["serviceName", "listenPort", "upstreamHost", "upstreamPort", "outputPath"],
    };

    const zodSchema = jsonSchemaToZod(schema);

    // Valid
    const valid = zodSchema.safeParse({
      serviceName: "web-api",
      listenPort: 8080,
      upstreamHost: "backend",
      upstreamPort: 3000,
      outputPath: "/tmp",
    });
    expect(valid.success).toBe(true);

    // Port out of range
    const badPort = zodSchema.safeParse({
      serviceName: "web-api",
      listenPort: 99999,
      upstreamHost: "backend",
      upstreamPort: 3000,
      outputPath: "/tmp",
    });
    expect(badPort.success).toBe(false);

    // Port must be integer
    const floatPort = zodSchema.safeParse({
      serviceName: "web-api",
      listenPort: 80.5,
      upstreamHost: "backend",
      upstreamPort: 3000,
      outputPath: "/tmp",
    });
    expect(floatPort.success).toBe(false);
  });
});

describe("Tool E2E: CustomTool Generate & Execute", () => {
  const ctx = useTempDir();

  it("Caddy tool: generates Caddyfile via LLM", async () => {
    const caddyfileContent = "example.com {\n  reverse_proxy localhost:3000\n  tls internal\n}\n";
    const provider = createMockProvider({
      content: JSON.stringify({ caddyfile: caddyfileContent }),
      parsed: { caddyfile: caddyfileContent },
    });

    const entry = setupCaddyTool(ctx.projectDir);
    const tool = createCustomToolFromEntry(entry, provider);

    // Validate input
    const validation = tool.validate({
      domain: "example.com",
      description: "Reverse proxy to Node app",
      outputPath: path.join(ctx.tmpDir, "output"),
    });
    expect(validation.valid).toBe(true);

    // Generate
    const result = await tool.generate({
      domain: "example.com",
      description: "Reverse proxy to Node app",
      outputPath: path.join(ctx.tmpDir, "output"),
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const data = result.data as { generated: unknown; isUpdate: boolean };
    expect(data.isUpdate).toBe(false);
    expect(data.generated).toEqual({ caddyfile: caddyfileContent });

    // Check the LLM was called with the user prompt template
    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.prompt).toContain("example.com");
    expect(call.prompt).toContain("Reverse proxy to Node app");
    expect(call.system).toContain("Caddy");
  });

  it("Caddy tool: executes and writes Caddyfile to disk", async () => {
    const caddyfileContent = "example.com {\n  reverse_proxy localhost:3000\n}\n";
    const provider = createMockProvider({
      parsed: { caddyfile: caddyfileContent },
    });

    const entry = setupCaddyTool(ctx.projectDir);
    const outputDir = "output";
    const tool = createCustomToolFromEntry(entry, provider, entry.toolDir);

    const result = await tool.execute({
      domain: "example.com",
      description: "Reverse proxy",
      outputPath: outputDir,
    });

    expect(result.success).toBe(true);

    // Check file was written — serializer is "raw", so it should write the raw content
    // The raw serializer converts objects to JSON string (since data.generated is an object)
    // resolveFilePath now anchors to toolDir, so paths are absolute under entry.toolDir
    const filePath = path.join(entry.toolDir, outputDir, "Caddyfile");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    // "raw" serializer: object → JSON.stringify
    expect(content).toContain("caddyfile");

    // filesWritten should be populated
    expect(result.filesWritten).toBeDefined();
    expect(result.filesWritten).toContain(filePath);
  });

  it("Caddy tool: raw serializer writes string data directly", async () => {
    // When the LLM returns a raw string (not JSON object), it should be written as-is
    const rawContent = "example.com {\n  reverse_proxy localhost:3000\n}\n";
    const provider = createMockProvider({
      content: rawContent,
      parsed: undefined, // no structured output, falls back to raw string
    });

    const entry = setupCaddyTool(ctx.projectDir);
    const outputDir = "output";
    const tool = createCustomToolFromEntry(entry, provider, entry.toolDir);

    const result = await tool.execute({
      domain: "example.com",
      description: "Reverse proxy",
      outputPath: outputDir,
    });

    expect(result.success).toBe(true);

    const filePath = path.join(entry.toolDir, outputDir, "Caddyfile");
    const content = fs.readFileSync(filePath, "utf-8");
    // raw serializer: string → string as-is
    expect(content).toBe(rawContent);
  });

  it("Envoy tool: generates YAML config and serializes", async () => {
    const envoyConfig = {
      admin: { address: { socket_address: { address: "0.0.0.0", port_value: 9901 } } },
      static_resources: {
        listeners: [
          {
            name: "web-api-listener",
            address: { socket_address: { address: "0.0.0.0", port_value: 8080 } },
          },
        ],
        clusters: [
          {
            name: "web-api-cluster",
            load_assignment: {
              cluster_name: "web-api-cluster",
              endpoints: [
                {
                  lb_endpoints: [
                    {
                      endpoint: {
                        address: { socket_address: { address: "backend", port_value: 3000 } },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    };

    const provider = createMockProvider({ parsed: envoyConfig });

    const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
    writeEnvoyTool(projectToolsDir);

    const entry = discoverTools(ctx.projectDir)[0];
    const outputDir = "output";
    const tool = createCustomToolFromEntry(entry, provider, entry.toolDir);

    const result = await tool.execute({
      serviceName: "web-api",
      listenPort: 8080,
      upstreamHost: "backend",
      upstreamPort: 3000,
      outputPath: outputDir,
    });

    expect(result.success).toBe(true);

    // Check YAML serialization — resolveFilePath now anchors to toolDir
    const filePath = path.join(entry.toolDir, outputDir, "envoy.yaml");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");

    // Parse it back to verify it's valid YAML
    const parsed = yaml.load(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("admin");
    expect(parsed).toHaveProperty("static_resources");
    expect(content).toContain("web-api-cluster");
  });

  it("Caddy tool: update mode creates .bak backup", async () => {
    const provider = createMockProvider({
      parsed: { caddyfile: "updated content" },
    });

    const entry = setupCaddyTool(ctx.projectDir);

    const outputDir = "output";
    // Create existing file under toolDir since resolveFilePath anchors to it
    const absOutputDir = path.join(entry.toolDir, outputDir);
    fs.mkdirSync(absOutputDir, { recursive: true });
    const filePath = path.join(absOutputDir, "Caddyfile");
    fs.writeFileSync(filePath, "original content", "utf-8");

    const tool = createCustomToolFromEntry(entry, provider, entry.toolDir);

    const result = await tool.execute({
      domain: "example.com",
      description: "Update config",
      outputPath: outputDir,
      existingContent: "original content",
    });

    expect(result.success).toBe(true);

    // Backup should exist
    expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${filePath}.bak`, "utf-8")).toBe("original content");

    // filesModified should be populated
    expect(result.filesModified).toContain(filePath);
  });

  it("input validation rejects invalid input", () => {
    const provider = createMockProvider();
    const entry = setupCaddyTool(ctx.projectDir);
    const tool = createCustomToolFromEntry(entry, provider);

    // Missing required fields
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ domain: "example.com" }).valid).toBe(false);

    // domain minLength violation
    expect(tool.validate({ domain: "", description: "test", outputPath: "/out" }).valid).toBe(
      false,
    );

    // Valid
    expect(
      tool.validate({ domain: "example.com", description: "test", outputPath: "/out" }).valid,
    ).toBe(true);
  });
});

describe("Tool E2E: Verification", () => {
  const ctx = useTempDir();

  it("Caddy tool: verify passes (no verification command)", async () => {
    const provider = createMockProvider();
    const entry = setupCaddyTool(ctx.projectDir);
    const tool = createCustomToolFromEntry(entry, provider);

    const result = await tool.verify({});
    expect(result.passed).toBe(true);
    expect(result.tool).toBe("caddy-config");
    expect(result.issues).toHaveLength(0);
  });

  it(
    "Envoy tool: verify attempts whitelisted command (yamllint is allowed)",
    { timeout: 15_000 },
    async () => {
      const provider = createMockProvider();
      const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
      writeEnvoyTool(projectToolsDir);
      const entry = discoverTools(ctx.projectDir)[0];
      const tool = createCustomToolFromEntry(entry, provider);

      // yamllint IS in the whitelist and child_process is "required",
      // so verify() will attempt execution. Since yamllint isn't installed
      // in the test environment, it should fail with an execution error
      // (not a whitelist rejection).
      const result = await tool.verify({});
      expect(result.tool).toBe("envoy-config");
      // Either passes (if yamllint installed) or fails with command error (not whitelist error)
      if (!result.passed) {
        expect(result.issues[0].message).toContain("Verification command failed");
        expect(result.issues[0].message).not.toContain("whitelist");
      }
    },
  );
});

describe("Tool E2E: Policy Filtering", () => {
  const ctx = useTempDir();

  it("blockedTools prevents tool from being loaded", () => {
    // Write policy file
    const dojopsDir = path.join(ctx.tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ blockedTools: ["caddy-config"] }),
      "utf-8",
    );

    const policy = loadToolPolicy(ctx.tmpDir);
    expect(isToolAllowed("caddy-config", policy)).toBe(false);
    expect(isToolAllowed("envoy-config", policy)).toBe(true);
  });

  it("allowedTools restricts to only listed tools", () => {
    const dojopsDir = path.join(ctx.tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ allowedTools: ["caddy-config"] }),
      "utf-8",
    );

    const policy = loadToolPolicy(ctx.tmpDir);
    expect(isToolAllowed("caddy-config", policy)).toBe(true);
    expect(isToolAllowed("envoy-config", policy)).toBe(false);
  });

  it("no policy file means everything is allowed", () => {
    const policy = loadToolPolicy(ctx.tmpDir);
    expect(isToolAllowed("anything", policy)).toBe(true);
  });
});

describe("Tool E2E: Serialization", () => {
  it("raw serializer handles string data", () => {
    const data = "example.com {\n  reverse_proxy localhost:3000\n}\n";
    const result = serialize(data, "raw");
    expect(result).toBe(data);
  });

  it("raw serializer converts object to JSON", () => {
    const data = { key: "value", nested: { a: 1 } };
    const result = serialize(data, "raw");
    expect(JSON.parse(result)).toEqual(data);
  });

  it("yaml serializer produces valid YAML", () => {
    const data = {
      admin: { address: "0.0.0.0:9901" },
      static_resources: { listeners: [{ name: "main" }] },
    };
    const result = serialize(data, "yaml");
    const parsed = yaml.load(result) as Record<string, unknown>;
    expect(parsed).toEqual(data);
  });

  it("json serializer produces indented JSON", () => {
    const data = { key: "value" };
    const result = serialize(data, "json");
    expect(result).toBe('{\n  "key": "value"\n}\n');
  });
});

describe("Tool E2E: systemPromptHash Stability", () => {
  const ctx = useTempDir();

  it("same manifest produces same systemPromptHash", () => {
    const provider = createMockProvider();
    const entry = setupCaddyTool(ctx.projectDir);

    const tool1 = createCustomToolFromEntry(entry, provider);
    const tool2 = createCustomToolFromEntry(entry, provider);

    expect(tool1.systemPromptHash).toBe(tool2.systemPromptHash);
    expect(tool1.systemPromptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different system prompts produce different hashes", () => {
    const provider = createMockProvider();
    const projectToolsDir = path.join(ctx.projectDir, ".dojops", "tools");
    writeCaddyTool(projectToolsDir);
    writeEnvoyTool(projectToolsDir);

    const entries = discoverTools(ctx.projectDir);
    expect(entries).toHaveLength(2);

    const tools = entries.map((e) => createCustomToolFromEntry(e, provider));

    expect(tools[0].systemPromptHash).not.toBe(tools[1].systemPromptHash);
  });
});
