import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput, VerificationResult } from "@odaops/sdk";
import { LLMProvider } from "@odaops/core";
import { KubernetesInputSchema, KubernetesInput } from "./schemas";
import { generateKubernetesManifest, manifestToYaml } from "./generator";
import { verifyKubernetesYaml } from "./verifier";

export class KubernetesTool extends BaseTool<KubernetesInput> {
  name = "kubernetes";
  description = "Generates Kubernetes deployment and service manifests";
  inputSchema = KubernetesInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: KubernetesInput): Promise<ToolOutput> {
    try {
      const manifest = await generateKubernetesManifest(
        input.appName,
        input.image,
        input.port,
        input.replicas,
        input.namespace,
        this.provider,
      );

      const yamlContent = manifestToYaml(manifest, input.appName, input.namespace);

      return {
        success: true,
        data: {
          manifest,
          yaml: yamlContent,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async verify(data: unknown): Promise<VerificationResult> {
    const d = data as { yaml?: string };
    const yaml = d?.yaml ?? "";
    return verifyKubernetesYaml(yaml);
  }

  async execute(input: KubernetesInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { yaml: string };
    fs.mkdirSync(input.outputPath, { recursive: true });
    fs.writeFileSync(path.join(input.outputPath, `${input.appName}.yaml`), data.yaml, "utf-8");

    return result;
  }
}
