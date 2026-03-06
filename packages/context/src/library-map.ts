/**
 * Maps DojOps tool/agent domains to Context7 library search queries.
 * Used to resolve the right documentation source for each technology.
 */
export const TOOL_LIBRARY_MAP: Record<string, string> = {
  "github-actions": "github actions",
  terraform: "terraform",
  kubernetes: "kubernetes",
  helm: "helm",
  ansible: "ansible",
  "docker-compose": "docker compose",
  dockerfile: "docker",
  nginx: "nginx",
  makefile: "gnu make",
  "gitlab-ci": "gitlab ci",
  jenkinsfile: "jenkins",
  prometheus: "prometheus",
  systemd: "systemd",
};

/**
 * Maps specialist agent domains to Context7 library search queries.
 * Covers the 16 built-in specialist agent domains.
 */
export const AGENT_LIBRARY_MAP: Record<string, string> = {
  ci: "github actions",
  terraform: "terraform",
  kubernetes: "kubernetes",
  helm: "helm",
  ansible: "ansible",
  docker: "docker",
  nginx: "nginx",
  monitoring: "prometheus",
  "gitlab-ci": "gitlab ci",
  makefile: "gnu make",
  systemd: "systemd",
};

/**
 * Resolve a keyword to a Context7 library search query.
 * Checks tool map first, then agent map, then returns the keyword itself.
 */
export function resolveLibraryQuery(keyword: string): string {
  const lower = keyword.toLowerCase();
  return TOOL_LIBRARY_MAP[lower] ?? AGENT_LIBRARY_MAP[lower] ?? lower;
}
