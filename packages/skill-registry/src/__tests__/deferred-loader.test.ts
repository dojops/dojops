import { describe, it, expect } from "vitest";
import {
  DeferredSkillLoader,
  tokenizeQuery,
  scoreSkill,
  extractKeywords,
  extractTags,
  extractScopePatterns,
} from "../deferred-loader";
import type { DevOpsSkill } from "@dojops/sdk";

function makeSkill(name: string, description: string): DevOpsSkill {
  return {
    name,
    description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: {} as any,
    validate: () => ({ valid: true }),
    generate: async () => ({ success: true }),
  };
}

/** Simulate a DopsRuntimeV2-like skill with keywords, tags, and scope. */
function makeRuntimeSkill(
  name: string,
  description: string,
  opts: { keywords?: string[]; tags?: string[]; scopeWrite?: string[] } = {},
): DevOpsSkill {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const skill: any = makeSkill(name, description);

  if (opts.keywords) {
    skill.keywords = opts.keywords;
  }

  if (opts.tags || opts.scopeWrite) {
    skill.skill = {
      frontmatter: {
        meta: { name, tags: opts.tags ?? [] },
        scope: opts.scopeWrite ? { write: opts.scopeWrite } : undefined,
      },
    };
  }

  return skill;
}

describe("tokenizeQuery", () => {
  it("splits on whitespace and punctuation", () => {
    expect(tokenizeQuery("terraform aws-vpc")).toEqual(["terraform", "aws", "vpc"]);
  });

  it("lowercases terms", () => {
    expect(tokenizeQuery("Docker Compose")).toEqual(["docker", "compose"]);
  });

  it("filters short tokens", () => {
    expect(tokenizeQuery("a bc de")).toEqual(["bc", "de"]);
  });

  it("handles empty input", () => {
    expect(tokenizeQuery("")).toEqual([]);
  });
});

describe("extractKeywords", () => {
  it("uses runtime keywords getter when available", () => {
    const skill = makeRuntimeSkill("terraform", "Generate Terraform configs", {
      keywords: ["terraform", "tf", "iac", "cloud"],
    });
    expect(extractKeywords(skill)).toEqual(["terraform", "tf", "iac", "cloud"]);
  });

  it("falls back to name + description tokenization", () => {
    const skill = makeSkill("dockerfile", "Generate Docker container images");
    const kw = extractKeywords(skill);
    expect(kw).toContain("dockerfile");
    expect(kw).toContain("docker");
    expect(kw).toContain("container");
  });
});

describe("extractTags", () => {
  it("extracts tags from skill frontmatter", () => {
    const skill = makeRuntimeSkill("terraform", "desc", {
      tags: ["iac", "cloud", "aws"],
    });
    expect(extractTags(skill)).toEqual(["iac", "cloud", "aws"]);
  });

  it("returns empty array when no frontmatter", () => {
    expect(extractTags(makeSkill("foo", "bar"))).toEqual([]);
  });
});

describe("extractScopePatterns", () => {
  it("extracts scope.write patterns", () => {
    const skill = makeRuntimeSkill("terraform", "desc", {
      scopeWrite: ["*.tf", "*.tfvars"],
    });
    expect(extractScopePatterns(skill)).toEqual(["*.tf", "*.tfvars"]);
  });

  it("returns empty array when no scope", () => {
    expect(extractScopePatterns(makeSkill("foo", "bar"))).toEqual([]);
  });
});

describe("scoreSkill", () => {
  it("scores exact keyword matches", () => {
    const skill = makeRuntimeSkill("terraform", "IaC", {
      keywords: ["terraform", "tf", "iac", "cloud"],
    });
    const result = scoreSkill(skill, ["terraform", "cloud"]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedTerms).toContain("terraform");
    expect(result.matchedTerms).toContain("cloud");
  });

  it("scores partial keyword matches", () => {
    const skill = makeRuntimeSkill("terraform", "Infrastructure as Code", {
      keywords: ["terraform", "infrastructure"],
    });
    const result = scoreSkill(skill, ["infra"]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedTerms).toContain("infra");
  });

  it("adds name-exact match bonus", () => {
    const skill = makeRuntimeSkill("docker-compose", "Docker Compose files", {
      keywords: ["docker", "compose"],
    });
    const nameMatch = scoreSkill(skill, ["docker-compose"]);
    const noNameMatch = scoreSkill(skill, ["container"]);
    // Name match should score higher than a non-name match
    expect(nameMatch.score).toBeGreaterThan(noNameMatch.score);
  });

  it("returns zero for no matches", () => {
    const skill = makeRuntimeSkill("terraform", "IaC", { keywords: ["terraform"] });
    const result = scoreSkill(skill, ["kubernetes"]);
    expect(result.score).toBe(0);
    expect(result.matchedTerms).toHaveLength(0);
  });

  it("deduplicates matched terms", () => {
    const skill = makeRuntimeSkill("docker", "Docker containers", {
      keywords: ["docker", "container", "dockerfile"],
    });
    const result = scoreSkill(skill, ["docker"]);
    // "docker" should appear only once even though it matches keyword + name
    const unique = new Set(result.matchedTerms);
    expect(unique.size).toBe(result.matchedTerms.length);
  });
});

describe("DeferredSkillLoader", () => {
  const skills = [
    makeRuntimeSkill("terraform", "Generate Terraform infrastructure configs", {
      keywords: ["terraform", "tf", "iac", "cloud", "aws", "gcp", "azure"],
      tags: ["iac", "cloud"],
    }),
    makeRuntimeSkill("dockerfile", "Generate Dockerfiles for containerized apps", {
      keywords: ["docker", "dockerfile", "container", "image"],
      tags: ["container", "docker"],
    }),
    makeRuntimeSkill("github-actions", "Generate GitHub Actions CI/CD workflows", {
      keywords: ["github", "actions", "ci", "cd", "workflow", "pipeline"],
      tags: ["ci", "cd"],
    }),
    makeRuntimeSkill("kubernetes", "Generate Kubernetes manifests", {
      keywords: ["kubernetes", "k8s", "pod", "deployment", "service"],
      tags: ["container", "orchestration"],
    }),
    makeRuntimeSkill("helm", "Generate Helm charts", {
      keywords: ["helm", "chart", "kubernetes", "k8s"],
      tags: ["container", "orchestration"],
    }),
    makeRuntimeSkill("nginx", "Generate Nginx configuration files", {
      keywords: ["nginx", "proxy", "reverse", "web", "server"],
      tags: ["web"],
    }),
    makeRuntimeSkill("ansible", "Generate Ansible playbooks", {
      keywords: ["ansible", "playbook", "automation", "configuration"],
      tags: ["automation"],
    }),
  ];

  describe("getRelevantSkills", () => {
    it("returns top-K skills matching the query", () => {
      const loader = new DeferredSkillLoader(skills, { topK: 3 });
      const results = loader.getRelevantSkills("kubernetes deployment helm chart");

      expect(results.length).toBeLessThanOrEqual(3);
      // k8s and helm should be in the top results
      const names = results.map((r) => r.skill.name);
      expect(names).toContain("kubernetes");
      expect(names).toContain("helm");
    });

    it("defaults to topK=5", () => {
      const loader = new DeferredSkillLoader(skills);
      const results = loader.getRelevantSkills("cloud infrastructure docker kubernetes ci cd");
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("returns first K skills when query is empty", () => {
      const loader = new DeferredSkillLoader(skills, { topK: 2 });
      const results = loader.getRelevantSkills("");
      expect(results).toHaveLength(2);
      expect(results[0].skill.name).toBe("terraform");
      expect(results[1].skill.name).toBe("dockerfile");
      expect(results[0].score).toBe(0);
    });

    it("returns empty array when no skills match", () => {
      const loader = new DeferredSkillLoader(skills);
      const results = loader.getRelevantSkills("quantum computing blockchain");
      expect(results).toHaveLength(0);
    });

    it("ranks higher-scoring skills first", () => {
      const loader = new DeferredSkillLoader(skills, { topK: 7 });
      const results = loader.getRelevantSkills("terraform iac cloud");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.name).toBe("terraform");
      // Scores should be in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });
  });

  describe("searchSkills", () => {
    it("returns all matching skills sorted by score", () => {
      const loader = new DeferredSkillLoader(skills);
      const results = loader.searchSkills("docker container");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.name).toBe("dockerfile");
      // Check descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it("returns all skills with score 0 when query is empty", () => {
      const loader = new DeferredSkillLoader(skills);
      const results = loader.searchSkills("");
      expect(results).toHaveLength(skills.length);
      expect(results.every((r) => r.score === 0)).toBe(true);
    });

    it("returns empty array when nothing matches", () => {
      const loader = new DeferredSkillLoader(skills);
      const results = loader.searchSkills("zzzzz");
      expect(results).toHaveLength(0);
    });
  });

  describe("buildCatalog", () => {
    it("lists all skills by name and description", () => {
      const loader = new DeferredSkillLoader(skills);
      const catalog = loader.buildCatalog();

      expect(catalog).toContain("- terraform:");
      expect(catalog).toContain("- dockerfile:");
      expect(catalog).toContain("- nginx:");
      expect(catalog.split("\n")).toHaveLength(skills.length);
    });
  });

  describe("size", () => {
    it("returns total skill count", () => {
      const loader = new DeferredSkillLoader(skills);
      expect(loader.size).toBe(7);
    });

    it("returns 0 for empty loader", () => {
      const loader = new DeferredSkillLoader([]);
      expect(loader.size).toBe(0);
    });
  });
});
