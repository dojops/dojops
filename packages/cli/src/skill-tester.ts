import * as fs from "node:fs";
import * as path from "node:path";
import { parseDopsFile, validateDopsSkill } from "@dojops/runtime";

export interface SkillTestFixture {
  /** Test case name. */
  name: string;
  /** Input prompt for the skill. */
  prompt: string;
  /** Expected patterns in output (regex strings). */
  expectedPatterns?: string[];
  /** Patterns that must NOT appear in output. */
  forbiddenPatterns?: string[];
}

export interface SkillTestResult {
  fixture: string;
  passed: boolean;
  errors: string[];
}

/**
 * Load test fixtures for a skill.
 * Looks in .dojops/skill-tests/<skillName>.json
 */
export function loadFixtures(rootDir: string, skillName: string): SkillTestFixture[] {
  const fixturesDir = path.join(rootDir, ".dojops", "skill-tests");
  const fixturePath = path.join(fixturesDir, `${skillName}.json`);

  if (!fs.existsSync(fixturePath)) return [];

  try {
    const content = fs.readFileSync(fixturePath, "utf-8");
    const data = JSON.parse(content);
    if (!Array.isArray(data)) return [];
    return data as SkillTestFixture[];
  } catch {
    return [];
  }
}

/**
 * Validate a skill file against its schema without LLM execution.
 * Checks: parses correctly, required sections present, schema compiles.
 */
export function validateSkillFile(filePath: string): SkillTestResult {
  const errors: string[] = [];
  const name = path.basename(filePath, ".dops");

  try {
    const skill = parseDopsFile(filePath);
    const validation = validateDopsSkill(skill);

    if (!validation.valid && validation.errors) {
      errors.push(...validation.errors);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    fixture: `${name}:schema`,
    passed: errors.length === 0,
    errors,
  };
}

/** Check that all expected patterns appear in the output. */
function checkExpectedPatterns(output: string, patterns: string[]): string[] {
  const errors: string[] = [];
  for (const pattern of patterns) {
    try {
      if (!new RegExp(pattern).test(output)) {
        errors.push(`Expected pattern not found: ${pattern}`);
      }
    } catch {
      errors.push(`Invalid regex pattern: ${pattern}`);
    }
  }
  return errors;
}

/** Check that no forbidden patterns appear in the output. */
function checkForbiddenPatterns(output: string, patterns: string[]): string[] {
  const errors: string[] = [];
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern).test(output)) {
        errors.push(`Forbidden pattern found: ${pattern}`);
      }
    } catch {
      errors.push(`Invalid regex pattern: ${pattern}`);
    }
  }
  return errors;
}

/**
 * Test skill output against fixture expectations.
 * Does NOT call LLM — validates structure of pre-generated output.
 */
export function testOutputAgainstFixture(
  output: string,
  fixture: SkillTestFixture,
): SkillTestResult {
  const errors: string[] = [];

  if (fixture.expectedPatterns) {
    errors.push(...checkExpectedPatterns(output, fixture.expectedPatterns));
  }

  if (fixture.forbiddenPatterns) {
    errors.push(...checkForbiddenPatterns(output, fixture.forbiddenPatterns));
  }

  return {
    fixture: fixture.name,
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Discover all skill files in standard locations.
 */
export function discoverSkillFiles(rootDir: string): string[] {
  const locations = [path.join(rootDir, ".dojops", "skills")];

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  locations.push(path.join(home, ".dojops", "skills"));

  const files: string[] = [];
  for (const dir of locations) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".dops"));
    files.push(...entries.map((f) => path.join(dir, f)));
  }
  return files;
}
