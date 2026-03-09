import { describe, it, expect } from "vitest";
import {
  parseDojopsMdString,
  extractNotesSection,
  extractActivityEntries,
} from "../../context/dojops-md-parser";

const VALID_FRONTMATTER = `---
dojops: 1
scannedAt: "2026-03-08T10:00:00.000Z"
primaryLanguage: node
languages:
  - name: node
    confidence: 0.9
    indicator: package.json
packageManager: null
ci:
  - platform: github-actions
    configPath: .github/workflows/ci.yml
container:
  hasDockerfile: true
  hasCompose: false
  hasSwarm: false
infra:
  hasTerraform: false
  tfProviders: []
  hasState: false
  hasKubernetes: false
  hasHelm: false
  hasAnsible: false
  hasKustomize: false
  hasVagrant: false
  hasPulumi: false
  hasCloudFormation: false
monitoring:
  hasPrometheus: false
  hasNginx: false
  hasSystemd: false
  hasHaproxy: false
  hasTomcat: false
  hasApache: false
  hasCaddy: false
  hasEnvoy: false
scripts:
  shellScripts: []
  pythonScripts: []
  hasJustfile: false
security:
  hasEnvExample: false
  hasGitignore: true
  hasCodeowners: false
  hasSecurityPolicy: false
  hasDependabot: false
  hasRenovate: false
  hasSecretScanning: false
  hasEditorConfig: false
meta:
  isGitRepo: true
  isMonorepo: false
  hasMakefile: false
  hasReadme: true
  hasEnvFile: false
relevantDomains:
  - ci-cd
devopsFiles:
  - .github/workflows/ci.yml
  - Dockerfile
---

# DojOps Project Context

## Notes

My project notes here.

## Recent Activity

<!-- activity-start -->
- 2026-03-08T10:00:00Z — Generated ci.yml (github-actions)
- 2026-03-07T09:00:00Z — Security scan: 0 findings
<!-- activity-end -->
`;

describe("parseDojopsMdString", () => {
  it("parses valid DOJOPS.md into RepoContext", () => {
    const result = parseDojopsMdString(VALID_FRONTMATTER, "/tmp/test");
    expect(result.context).not.toBeNull();
    expect(result.context!.primaryLanguage).toBe("node");
    expect(result.context!.version).toBe(2);
    expect(result.context!.rootPath).toBe("/tmp/test");
    expect(result.context!.ci[0].platform).toBe("github-actions");
    expect(result.context!.container.hasDockerfile).toBe(true);
    expect(result.context!.devopsFiles).toEqual([".github/workflows/ci.yml", "Dockerfile"]);
  });

  it("returns formatVersion from dojops field", () => {
    const result = parseDojopsMdString(VALID_FRONTMATTER);
    expect(result.formatVersion).toBe(1);
  });

  it("preserves rawFrontmatter for custom keys", () => {
    const content = VALID_FRONTMATTER.replace("dojops: 1", "dojops: 1\nmyCustomKey: hello");
    const result = parseDojopsMdString(content);
    expect(result.rawFrontmatter).not.toBeNull();
    expect(result.rawFrontmatter!.myCustomKey).toBe("hello");
  });

  it("returns body without frontmatter", () => {
    const result = parseDojopsMdString(VALID_FRONTMATTER);
    expect(result.body).toContain("# DojOps Project Context");
    expect(result.body).toContain("## Notes");
    expect(result.body).not.toContain("dojops: 1");
  });

  it("returns null context for content without frontmatter", () => {
    const result = parseDojopsMdString("# Just a markdown file\n\nNo frontmatter here.");
    expect(result.context).toBeNull();
    expect(result.body).toContain("Just a markdown file");
  });

  it("returns null context for invalid YAML", () => {
    const result = parseDojopsMdString("---\n: invalid: yaml: {{{\n---\n\nBody");
    expect(result.context).toBeNull();
    expect(result.body).toBe("Body");
  });

  it("returns null context when closing fence is missing", () => {
    const result = parseDojopsMdString("---\ndojops: 1\nNo closing fence");
    expect(result.context).toBeNull();
  });

  it("returns null context when required fields are missing", () => {
    const result = parseDojopsMdString("---\ndojops: 1\nprimaryLanguage: node\n---\n\nBody");
    expect(result.context).toBeNull();
    expect(result.formatVersion).toBe(1);
  });

  it("defaults rootPath to '.' when not provided", () => {
    const result = parseDojopsMdString(VALID_FRONTMATTER);
    expect(result.context).not.toBeNull();
    expect(result.context!.rootPath).toBe(".");
  });
});

describe("extractNotesSection", () => {
  it("extracts notes content from body", () => {
    const body = "## Notes\n\nMy project notes here.\n\n## Recent Activity\n";
    expect(extractNotesSection(body)).toBe("My project notes here.");
  });

  it("returns empty string when no Notes section", () => {
    expect(extractNotesSection("## Other\n\nContent")).toBe("");
  });

  it("handles notes at end of file", () => {
    const body = "## Notes\n\nLast section content.\n";
    expect(extractNotesSection(body)).toBe("Last section content.");
  });
});

describe("extractActivityEntries", () => {
  it("extracts activity entries between markers", () => {
    const body = [
      "## Recent Activity",
      "",
      "<!-- activity-start -->",
      "- 2026-03-08T10:00:00Z — Generated ci.yml",
      "- 2026-03-07T09:00:00Z — Security scan",
      "<!-- activity-end -->",
    ].join("\n");

    const entries = extractActivityEntries(body);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain("Generated ci.yml");
  });

  it("returns empty array when no markers", () => {
    expect(extractActivityEntries("## Recent Activity\n")).toEqual([]);
  });

  it("ignores non-list lines between markers", () => {
    const body = "<!-- activity-start -->\nsome text\n- valid entry\n<!-- activity-end -->";
    const entries = extractActivityEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("valid entry");
  });
});
