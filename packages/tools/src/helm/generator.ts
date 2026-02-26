import { LLMProvider, parseAndValidate } from "@dojops/core";
import * as yaml from "js-yaml";
import { HelmChartResponse, HelmChartResponseSchema, HelmInput } from "./schemas";
import { YAML_DUMP_OPTIONS } from "../yaml-options";

export async function generateHelmValues(
  input: HelmInput,
  llm: LLMProvider,
  existingContent?: string,
): Promise<HelmChartResponse> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a Helm chart expert. Update the existing Helm chart values as structured JSON.
Preserve existing values and settings. Only add/modify what is requested.

You MUST respond with a JSON object matching this exact structure:
{
  "values": {
    "replicaCount": 1,
    "image": { "repository": "nginx", "tag": "latest", "pullPolicy": "IfNotPresent" },
    "service": { "type": "ClusterIP", "port": 80 },
    "resources": { "requests": { "cpu": "100m", "memory": "128Mi" }, "limits": { "cpu": "500m", "memory": "256Mi" } },
    "env": [{ "name": "NODE_ENV", "value": "production" }]
  },
  "notes": "Optional notes about the chart"
}

IMPORTANT:
- The top-level object must have a "values" key containing all Helm values
- "image" must have "repository", "tag", and "pullPolicy"
- "service" must have "type" and "port"
- "env" is an array of { "name", "value" } objects
- Respond with valid JSON only, no markdown`
    : `You are a Helm chart expert. Generate Helm chart values as structured JSON.

You MUST respond with a JSON object matching this exact structure:
{
  "values": {
    "replicaCount": 1,
    "image": { "repository": "nginx", "tag": "latest", "pullPolicy": "IfNotPresent" },
    "service": { "type": "ClusterIP", "port": 80 },
    "resources": { "requests": { "cpu": "100m", "memory": "128Mi" }, "limits": { "cpu": "500m", "memory": "256Mi" } },
    "env": [{ "name": "NODE_ENV", "value": "production" }]
  },
  "notes": "Optional notes about the chart"
}

IMPORTANT:
- The top-level object must have a "values" key containing all Helm values
- "image" must have "repository", "tag", and "pullPolicy"
- "service" must have "type" and "port"
- "env" is an array of { "name", "value" } objects
- Respond with valid JSON only, no markdown`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} Helm values for chart "${input.chartName}" using image "${input.image}" on port ${input.port}.`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await llm.generate({
    system,
    prompt,
    schema: HelmChartResponseSchema,
  });

  if (response.parsed) {
    return response.parsed as HelmChartResponse;
  }
  return parseAndValidate(response.content, HelmChartResponseSchema);
}

export function generateChartYaml(input: HelmInput): string {
  const chart = {
    apiVersion: "v2",
    name: input.chartName,
    description: input.description,
    type: "application",
    version: "0.1.0",
    appVersion: input.appVersion,
  };
  return yaml.dump(chart, YAML_DUMP_OPTIONS);
}

export function valuesToYaml(values: HelmChartResponse["values"]): string {
  return yaml.dump(values, YAML_DUMP_OPTIONS);
}

export function generateDeploymentTemplate(chartName: string): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${chartName}.fullname" . }}
  labels:
    {{- include "${chartName}.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "${chartName}.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "${chartName}.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.service.port }}
              protocol: TCP
          {{- with .Values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
`;
}

export function generateServiceTemplate(chartName: string): string {
  return `apiVersion: v1
kind: Service
metadata:
  name: {{ include "${chartName}.fullname" . }}
  labels:
    {{- include "${chartName}.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.port }}
      protocol: TCP
  selector:
    {{- include "${chartName}.selectorLabels" . | nindent 4 }}
`;
}

export function generateHelpersTemplate(chartName: string): string {
  return `{{- define "${chartName}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "${chartName}.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "${chartName}.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "${chartName}.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "${chartName}.selectorLabels" -}}
app.kubernetes.io/name: {{ include "${chartName}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
`;
}
