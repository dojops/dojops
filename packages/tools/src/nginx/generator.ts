import { LLMProvider, parseAndValidate } from "@dojops/core";
import { NginxConfig, NginxConfigSchema, NginxInput } from "./schemas";

export async function generateNginxConfig(
  input: NginxInput,
  provider: LLMProvider,
  existingContent?: string,
): Promise<NginxConfig> {
  const isUpdate = !!existingContent;
  const upstreamDesc = input.upstreams
    .map((u) => `${u.name}: [${u.servers.join(", ")}]`)
    .join("; ");

  const system = isUpdate
    ? `You are an Nginx configuration expert. Update the existing reverse proxy configuration as structured JSON.
Preserve existing server blocks and settings. Only add/modify what is requested.
${input.sslEnabled ? "Include SSL/TLS configuration with certificate paths." : "HTTP only, no SSL."}
Respond with valid JSON matching the required structure.`
    : `You are an Nginx configuration expert. Generate a reverse proxy configuration as structured JSON.
${input.sslEnabled ? "Include SSL/TLS configuration with certificate paths." : "HTTP only, no SSL."}
Respond with valid JSON matching the required structure.`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} an Nginx reverse proxy config for server: ${input.serverName}
Upstreams: ${upstreamDesc}
${input.sslEnabled ? "Enable SSL with certificate at /etc/nginx/ssl/cert.pem and key at /etc/nginx/ssl/key.pem." : ""}
Include appropriate proxy headers (X-Real-IP, X-Forwarded-For, Host).`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await provider.generate({
    system,
    prompt,
    schema: NginxConfigSchema,
  });

  if (response.parsed) {
    return response.parsed as NginxConfig;
  }
  return parseAndValidate(response.content, NginxConfigSchema);
}

export function nginxConfigToString(config: NginxConfig): string {
  const lines: string[] = [];

  // Upstreams
  for (const upstream of config.upstreams) {
    lines.push(`upstream ${upstream.name} {`);
    if (upstream.loadBalancing !== "round-robin") {
      lines.push(`    ${upstream.loadBalancing};`);
    }
    for (const server of upstream.servers) {
      lines.push(`    server ${server};`);
    }
    lines.push("}");
    lines.push("");
  }

  // Servers
  for (const server of config.servers) {
    lines.push("server {");
    lines.push(`    listen ${server.listen};`);
    lines.push(`    server_name ${server.server_name};`);

    if (server.ssl_certificate) {
      lines.push("");
      lines.push(`    ssl_certificate ${server.ssl_certificate};`);
      lines.push(`    ssl_certificate_key ${server.ssl_certificate_key};`);
    }

    for (const location of server.locations) {
      lines.push("");
      lines.push(`    location ${location.path} {`);
      if (location.proxy_pass) {
        lines.push(`        proxy_pass ${location.proxy_pass};`);
      }
      if (location.root) {
        lines.push(`        root ${location.root};`);
      }
      if (location.try_files) {
        lines.push(`        try_files ${location.try_files};`);
      }
      for (const [key, value] of Object.entries(location.extra_directives)) {
        lines.push(`        ${key} ${value};`);
      }
      lines.push("    }");
    }

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}
