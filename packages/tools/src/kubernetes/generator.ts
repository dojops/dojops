import { LLMProvider } from "@dojops/core";
import * as yaml from "js-yaml";
import { KubernetesManifest, KubernetesManifestSchema } from "./schemas";

export async function generateKubernetesManifest(
  appName: string,
  image: string,
  port: number,
  replicas: number,
  namespace: string,
  llm: LLMProvider,
): Promise<KubernetesManifest> {
  const response = await llm.generate({
    system: `You are a Kubernetes expert. Generate Kubernetes deployment and service configuration as structured JSON.

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
- Respond with valid JSON only, no markdown`,
    prompt: `Generate Kubernetes deployment and service config for app "${appName}" using image "${image}" on port ${port} with ${replicas} replicas in namespace "${namespace}".`,
    schema: KubernetesManifestSchema,
  });

  return response.parsed as KubernetesManifest;
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

  const deployYaml = yaml.dump(deployment, { lineWidth: 120, noRefs: true });
  const serviceYaml = yaml.dump(service, { lineWidth: 120, noRefs: true });

  return `${deployYaml}---\n${serviceYaml}`;
}
