import type { VerificationIssue } from "@dojops/sdk";
import { StructuralRule } from "./spec";

/**
 * Evaluate declarative structural validation rules against data.
 * Supports dot-notation paths with `*` wildcard for array elements.
 */
export function validateStructure(data: unknown, rules: StructuralRule[]): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  for (const rule of rules) {
    const ruleIssues = evaluateRule(data, rule);
    issues.push(...ruleIssues);
  }

  return issues;
}

function evaluateRule(data: unknown, rule: StructuralRule): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const segments = rule.path.split(".");

  // Resolve all values at the given path
  const values = resolvePath(data, segments);

  // Check requiredUnless: if the "unless" path has a value, skip this rule
  if (rule.requiredUnless) {
    const unlessSegments = rule.requiredUnless.split(".");
    const unlessValues = resolvePath(data, unlessSegments);
    if (unlessValues.some((v) => v.value !== undefined && v.value !== null)) {
      return [];
    }
  }

  if (rule.required) {
    if (values.length === 0) {
      issues.push({ severity: "error", message: rule.message });
    } else {
      for (const v of values) {
        if (v.value === undefined || v.value === null) {
          issues.push({ severity: "error", message: rule.message });
        }
      }
    }
  }

  if (rule.type) {
    for (const v of values) {
      if (v.value === undefined || v.value === null) continue;
      if (!matchesType(v.value, rule.type)) {
        issues.push({ severity: "error", message: rule.message });
      }
    }
  }

  if (rule.minItems !== undefined) {
    for (const v of values) {
      if (v.value === undefined || v.value === null) continue;
      if (Array.isArray(v.value) && v.value.length < rule.minItems) {
        issues.push({ severity: "error", message: rule.message });
      }
    }
  }

  return issues;
}

interface ResolvedValue {
  value: unknown;
  path: string;
}

/**
 * Resolve a dot-notation path (with `*` wildcard for arrays) to all matching values.
 */
function resolvePath(data: unknown, segments: string[]): ResolvedValue[] {
  if (segments.length === 0) {
    return [{ value: data, path: "" }];
  }

  const [first, ...rest] = segments;

  if (first === "*") {
    // Wildcard: iterate over array items or object values
    if (Array.isArray(data)) {
      const results: ResolvedValue[] = [];
      for (let i = 0; i < data.length; i++) {
        const sub = resolvePath(data[i], rest);
        results.push(...sub.map((s) => ({ ...s, path: `[${i}]${s.path ? "." + s.path : ""}` })));
      }
      return results;
    }
    if (typeof data === "object" && data !== null) {
      const results: ResolvedValue[] = [];
      for (const [key, val] of Object.entries(data)) {
        const sub = resolvePath(val, rest);
        results.push(...sub.map((s) => ({ ...s, path: `${key}${s.path ? "." + s.path : ""}` })));
      }
      return results;
    }
    return [];
  }

  // Named segment
  if (typeof data !== "object" || data === null) return [];

  const obj = data as Record<string, unknown>;
  if (!(first in obj)) {
    // Path doesn't exist — return empty (the value is undefined at this path)
    if (rest.length === 0) {
      return [{ value: undefined, path: first }];
    }
    return [];
  }

  return resolvePath(obj[first], rest);
}

function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}
