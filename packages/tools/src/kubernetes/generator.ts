import { LLMProvider, parseAndValidate } from "@dojops/core";
import * as yaml from "js-yaml";
import { KubernetesManifest, KubernetesManifestSchema } from "./schemas";
import { YAML_DUMP_OPTIONS } from "../yaml-options";

export async function generateKubernetesManifest(
  appName: string,
  image: string,
  port: number,
  replicas: number,
  namespace: string,
  llm: LLMProvider,
  existingContent?: string,
): Promise<KubernetesManifest> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a Kubernetes expert. Update the existing Kubernetes deployment and service configuration as structured JSON.
Preserve existing structure and settings. Only add/modify what is requested.

You MUST respond with a JSON object matching this exact structure:
{
  "deployment": {
    "replicas": ${replicas},
    "containers": [
      {
        "name": "${appName}",
        "image": "${image}",
        "ports": [{ "containerPort": ${port}, "protocol": "TCP" }],
        "env": [],
        "resources": { "requests": { "cpu": "100m", "memory": "128Mi" }, "limits": { "cpu": "500m", "memory": "256Mi" } }
      }
    ],
    "labels": {}
  },
  "service": {
    "type": "ClusterIP",
    "ports": [{ "port": ${port}, "targetPort": ${port}, "protocol": "TCP" }]
  }
}

IMPORTANT:
- Do NOT use standard Kubernetes manifest format (no apiVersion, kind, metadata)
- "deployment" and "service" are top-level keys with the structure shown above
- "containers" and "ports" must be ARRAYS
- Respond with valid JSON only, no markdown`
    : `You are a Kubernetes expert. Generate Kubernetes deployment and service configuration as structured JSON.

You MUST respond with a JSON object matching this exact structure:
{
  "deployment": {
    "replicas": ${replicas},
    "containers": [
      {
        "name": "${appName}",
        "image": "${image}",
        "ports": [{ "containerPort": ${port}, "protocol": "TCP" }],
        "env": [],
        "resources": { "requests": { "cpu": "100m", "memory": "128Mi" }, "limits": { "cpu": "500m", "memory": "256Mi" } }
      }
    ],
    "labels": {}
  },
  "service": {
    "type": "ClusterIP",
    "ports": [{ "port": ${port}, "targetPort": ${port}, "protocol": "TCP" }]
  }
}

IMPORTANT:
- Do NOT use standard Kubernetes manifest format (no apiVersion, kind, metadata)
- "deployment" and "service" are top-level keys with the structure shown above
- "containers" and "ports" must be ARRAYS
- Respond with valid JSON only, no markdown`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} Kubernetes deployment and service config for app "${appName}" using image "${image}" on port ${port} with ${replicas} replicas in namespace "${namespace}".`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await llm.generate({
    system,
    prompt,
    schema: KubernetesManifestSchema,
  });

  if (response.parsed) {
    return response.parsed as KubernetesManifest;
  }
  return parseAndValidate(response.content, KubernetesManifestSchema);
}

export function manifestToYaml(
  manifest: KubernetesManifest,
  appName: string,
  namespace: string,
): string {
  const labels = { app: appName, ...manifest.deployment.labels };

  const deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: appName, namespace, labels },
    spec: {
      replicas: manifest.deployment.replicas,
      selector: { matchLabels: { app: appName } },
      template: {
        metadata: { labels: { app: appName } },
        spec: {
          containers: manifest.deployment.containers.map((c) => ({
            name: c.name,
            image: c.image,
            ports: c.ports,
            ...(c.env.length > 0 ? { env: c.env } : {}),
            ...(c.resources ? { resources: c.resources } : {}),
          })),
        },
      },
    },
  };

  const service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: appName, namespace },
    spec: {
      type: manifest.service.type,
      selector: { app: appName },
      ports: manifest.service.ports,
    },
  };

  const deployYaml = yaml.dump(deployment, YAML_DUMP_OPTIONS);
  const serviceYaml = yaml.dump(service, YAML_DUMP_OPTIONS);

  return `${deployYaml}---\n${serviceYaml}`;
}
