/**
 * MCP tool definitions for the DojOps MCP server.
 *
 * Each tool maps to a DojOps CLI capability. External agents (Claude Code,
 * Gemini CLI, Copilot, OpenClaw) call these tools via the MCP protocol.
 *
 * Tools proxy to a running `dojops serve` instance via HTTP.
 */

import { z } from "zod";

export const TOOL_DEFINITIONS = {
  generate: {
    description:
      "Generate DevOps configurations (Dockerfile, CI/CD, Terraform, Kubernetes, etc.) from a natural language prompt. " +
      "Returns the generated content as text. Supports 38 built-in DevOps skills.",
    inputSchema: {
      prompt: z.string().describe("Natural language prompt describing what to generate"),
      skill: z
        .string()
        .optional()
        .describe(
          "Explicit skill name (e.g. 'dockerfile', 'github-actions', 'terraform'). Auto-detected if omitted.",
        ),
      agent: z
        .string()
        .optional()
        .describe("Specialist agent name to route to (e.g. 'kubernetes-agent', 'terraform-agent')"),
    },
  },

  plan: {
    description:
      "Decompose a complex DevOps goal into a task graph and optionally execute it. " +
      "Returns the task graph with dependencies and execution results.",
    inputSchema: {
      goal: z.string().describe("High-level goal to decompose into tasks"),
      execute: z
        .boolean()
        .optional()
        .describe("Execute the plan after decomposition (default: false, plan only)"),
      autoApprove: z
        .boolean()
        .optional()
        .describe("Auto-approve all tasks during execution (default: false)"),
    },
  },

  scan: {
    description:
      "Run security scans on the current project. Checks for vulnerabilities, " +
      "misconfigurations, secrets exposure, and dependency issues.",
    inputSchema: {
      scanners: z
        .array(z.string())
        .optional()
        .describe(
          "Specific scanners to run (e.g. ['dependency', 'secrets', 'iac']). Runs all if omitted.",
        ),
      path: z.string().optional().describe("Path to scan (defaults to current working directory)"),
    },
  },

  "debug-ci": {
    description:
      "Diagnose CI/CD pipeline failures from error logs. Analyzes the log, " +
      "identifies root cause, and suggests fixes.",
    inputSchema: {
      log: z.string().describe("CI/CD error log output to diagnose"),
      platform: z
        .string()
        .optional()
        .describe("CI platform (github-actions, gitlab-ci, jenkins). Auto-detected if omitted."),
    },
  },

  "diff-analyze": {
    description:
      "Analyze infrastructure diffs (terraform plan, kubectl diff, etc.) " +
      "for risks, breaking changes, and recommendations.",
    inputSchema: {
      diff: z.string().describe("Diff output to analyze (terraform plan, kubectl diff, etc.)"),
    },
  },

  chat: {
    description:
      "Send a message to the DojOps interactive chat. Maintains conversation " +
      "context via session ID. Supports agent routing.",
    inputSchema: {
      message: z.string().describe("Message to send"),
      sessionId: z
        .string()
        .optional()
        .describe("Session ID for conversation continuity. Omit to start a new session."),
      agent: z.string().optional().describe("Specialist agent to route to"),
    },
  },

  "list-agents": {
    description: "List all available specialist agents with their descriptions and capabilities.",
    inputSchema: {},
  },

  "list-skills": {
    description:
      "List all available DojOps skills (built-in + custom). " +
      "Each skill is a .dops file that generates specific DevOps configurations.",
    inputSchema: {},
  },

  "repo-scan": {
    description:
      "Scan a repository and return its technology stack, CI/CD setup, " +
      "container configuration, infrastructure files, and security posture.",
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe("Path to the repository root (defaults to current working directory)"),
    },
  },
} as const;
