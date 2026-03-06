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

function checkRequired(
  values: ResolvedValue[],
  message: string,
  issues: VerificationIssue[],
): void {
  if (values.length === 0) {
    issues.push({ severity: "error", message });
    return;
  }
  for (const v of values) {
    if (v.value === undefined || v.value === null) {
      issues.push({ severity: "error", message });
    }
  }
}

function checkType(
  values: ResolvedValue[],
  expectedType: string,
  message: string,
  issues: VerificationIssue[],
): void {
  for (const v of values) {
    if (v.value === undefined || v.value === null) continue;
    if (!matchesType(v.value, expectedType)) {
      issues.push({ severity: "error", message });
    }
  }
}

function checkMinItems(
  values: ResolvedValue[],
  minItems: number,
  message: string,
  issues: VerificationIssue[],
): void {
  for (const v of values) {
    if (v.value === undefined || v.value === null) continue;
    if (Array.isArray(v.value) && v.value.length < minItems) {
      issues.push({ severity: "error", message });
    }
  }
}

function evaluateRule(data: unknown, rule: StructuralRule): VerificationIssue[] {
  const values = resolvePath(data, rule.path.split("."));

  // Check requiredUnless: if the "unless" path has a value, skip this rule
  if (rule.requiredUnless) {
    const unlessValues = resolvePath(data, rule.requiredUnless.split("."));
    if (unlessValues.some((v) => v.value !== undefined && v.value !== null)) {
      return [];
    }
  }

  const issues: VerificationIssue[] = [];
  if (rule.required) checkRequired(values, rule.message, issues);
  if (rule.type) checkType(values, rule.type, rule.message, issues);
  if (rule.minItems !== undefined) checkMinItems(values, rule.minItems, rule.message, issues);
  return issues;
}

interface ResolvedValue {
  value: unknown;
  path: string;
}

/**
 * Resolve a dot-notation path (with `*` wildcard for arrays) to all matching values.
 */
function resolveWildcard(data: unknown, rest: string[]): ResolvedValue[] {
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

function resolvePath(data: unknown, segments: string[]): ResolvedValue[] {
  if (segments.length === 0) {
    return [{ value: data, path: "" }];
  }

  const [first, ...rest] = segments;

  if (first === "*") return resolveWildcard(data, rest);

  // Named segment
  if (typeof data !== "object" || data === null) return [];

  const obj = data as Record<string, unknown>;
  if (!(first in obj)) {
    return rest.length === 0 ? [{ value: undefined, path: first }] : [];
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
