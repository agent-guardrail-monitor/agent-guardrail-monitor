import fs from "node:fs";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import { preActionPipeline, finalCompliancePipeline } from "../src/enforcement/pipeline.mjs";
import { hashObject, validatePolicy, VERDICTS } from "../src/enforcement/policy.mjs";
import { buildRepairHandoff } from "../src/repair-handoff.mjs";

const VERSION = "0.2.0-alpha.3";
const DEFAULT_POLICY_URL = new URL("../policy/chatgpt.default.json", import.meta.url);

function loadPolicy() {
  const configuredPath = String(process.env.AGM_CHATGPT_POLICY_PATH || "").trim();
  const text = configuredPath
    ? fs.readFileSync(configuredPath, "utf8")
    : fs.readFileSync(DEFAULT_POLICY_URL, "utf8");
  return JSON.parse(text);
}

function response(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload
  };
}

function annotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true
  };
}
function buildToolRegistry(requiredTools, availableTools, forbiddenTools) {
  const ids = new Set([
    ...(requiredTools || []),
    ...(availableTools || []),
    ...(forbiddenTools || [])
  ]);
  return [...ids].map((id) => ({ id, name: id, status: "ACTIVE" }));
}

function buildSkillRegistry(requiredSkills) {
  return (requiredSkills || []).map((id) => ({
    id,
    name: id,
    status: "ACTIVE",
    priority: "MANDATORY"
  }));
}

const skillExecutionSchema = z.object({
  id: z.string().min(1).max(120),
  loaded: z.boolean().default(false),
  executed: z.boolean().default(false),
  executionProof: z.string().min(1).max(2000).optional()
});

const claimSchema = z.object({
  id: z.string().min(1).max(120),
  claim: z.string().min(1).max(4000),
  verificationStatus: z.enum(["VERIFIED", "SUPPORTED", "INFERRED", "UNKNOWN", "CONTRADICTED"]),
  presentedAsFact: z.boolean().default(false),
  material: z.boolean().default(true),
  source: z.string().max(1000).optional(),
  evidence: z.string().max(4000).optional()
});

const repairRegressionSchema = z.object({
  code: z.string().min(1).max(120),
  runtime: z.string().min(1).max(80).default("unknown"),
  message: z.string().min(1).max(2000)
});

const repairFindingSchema = z.object({
  severity: z.literal("FAIL"),
  code: z.string().min(1).max(120),
  runtime: z.string().min(1).max(80).default("unknown"),
  message: z.string().min(1).max(2000)
});

const repairProofSchema = z.object({
  runtime: z.string().min(1).max(80),
  status: z.literal("FAIL"),
  reason: z.string().min(1).max(2000)
});
export function buildAgmMcpServer() {
  const server = new McpServer(
    { name: "agent-guardrail-monitor", version: VERSION },
    {
      instructions:
        "When this app is enabled for a conversation, use agm_preflight before a material action or answer. " +
        "If the verdict is BLOCK, REQUIRE_REVIEW, or UNKNOWN, do not represent the action as approved or completed. " +
        "When AGM-observed regression evidence requires software repair, use agm_prepare_repair_handoff and route only its repairRequest to the separate Software Repair Engineer. " +
        "After repair, AGM must retest the original control before a verified completion claim. " +
        "Before releasing a final answer with material factual or execution claims, use agm_validate_output. " +
        "Only release when it returns release=true. This app does not override ChatGPT platform policy and cannot " +
        "intercept turns in which the host does not invoke the app."
    }
  );

  server.registerTool(
    "agm_status",
    {
      title: "Agent Guardrail Monitor status",
      description:
        "Returns the active AGM policy identity, version, and enforcement boundary without changing external state.",
      inputSchema: z.object({}),
      annotations: annotations()
    },
    async () => {
      const policy = loadPolicy();
      const validation = validatePolicy(policy);
      return response({
        product: "Agent Guardrail Monitor",
        version: VERSION,
        policyId: policy.policyId || null,
        policyVersion: policy.version || null,
        policyHash: hashObject(policy),
        policyValid: validation.valid,
        policyErrors: validation.errors,
        capability: "MCP_DECISION_GATE",
        enforcementState: "AVAILABLE_WHEN_INVOKED",
        limitations: [
          "The MCP app cannot intercept a ChatGPT turn that does not invoke it.",
          "Platform-level safety and permission systems remain authoritative.",
          "A host timeout or provider path outside this MCP endpoint is outside AGM authority."
        ]
      });
    }
  );

  server.registerTool(
    "agm_preflight",
    {
      title: "AGM preflight decision",
      description:
        "Use this tool before a material answer or action to check required skills, required tools, route constraints, and deterministic policy. It only evaluates and does not perform the action.",
      inputSchema: z.object({
        objective: z.string().min(1).max(2000),
        actionKind: z.string().min(1).max(120).default("respond"),
        tool: z.string().min(1).max(200).optional(),
        command: z.string().max(4000).optional(),
        critical: z.boolean().default(false),
        labels: z.array(z.string().min(1).max(120)).max(30).default([]),
        requiredSkills: z.array(z.string().min(1).max(120)).max(20).default([]),
        skillExecution: z.array(skillExecutionSchema).max(30).default([]),
        requiredTools: z.array(z.string().min(1).max(200)).max(20).default([]),
        availableTools: z.array(z.string().min(1).max(200)).max(100).default([]),
        forbiddenTools: z.array(z.string().min(1).max(200)).max(50).default([])
      }),
      annotations: annotations()
    },
    async (input) => {
      const policy = loadPolicy();
      const validation = validatePolicy(policy);
      if (!validation.valid) {
        return response({
          decision: VERDICTS.BLOCK,
          stage: "POLICY_CHECK",
          code: "INVALID_POLICY",
          reasons: validation.errors
        });
      }

      if (input.requiredTools.length && !input.tool) {
        return response({
          decision: VERDICTS.BLOCK,
          stage: "TOOL_RESOLUTION",
          code: "REQUIRED_TOOL_NOT_SELECTED",
          reasons: ["A required tool was declared but no tool is selected for this action."]
        });
      }

      if (input.requiredTools.length && !input.requiredTools.includes(input.tool)) {
        return response({
          decision: VERDICTS.BLOCK,
          stage: "TOOL_RESOLUTION",
          code: "WRONG_REQUIRED_TOOL",
          reasons: ["The selected tool is not one of the required tools for this action."]
        });
      }

      const task = {
        originalObjective: input.objective,
        labels: input.labels,
        requiredTools: input.requiredTools,
        forbiddenTools: input.forbiddenTools
      };
      const action = {
        kind: input.actionKind,
        tool: input.tool,
        args: input.command ? { command: input.command } : {},
        critical: input.critical
      };
      const result = preActionPipeline({
        policy,
        runtime: "chatgpt-mcp",
        task,
        action,
        skillRegistry: buildSkillRegistry(input.requiredSkills),
        skillExecution: input.skillExecution,
        toolRegistry: buildToolRegistry(
          input.requiredTools,
          input.availableTools,
          input.forbiddenTools
        ),
        availableTools: input.availableTools
      });

      return response({
        decision: result.decision,
        stage: result.stage,
        code: result.code,
        reasons: result.reasons,
        policyId: policy.policyId,
        policyVersion: policy.version,
        policyHash: hashObject(policy),
        releaseAction: result.decision === VERDICTS.ALLOW,
        enforcementState: "DECISION_PRODUCED"
      });
    }
  );

  server.registerTool(
    "agm_prepare_repair_handoff",
    {
      title: "Prepare Software Repair Engineer handoff",
      description:
        "Transforms AGM-observed regression evidence into a structured Software Repair Engineer preflight payload. " +
        "This tool does not diagnose root cause, patch files, or claim that a repair was completed.",
      inputSchema: z.object({
        regressions: z.array(repairRegressionSchema).max(50).default([]),
        findings: z.array(repairFindingSchema).max(50).default([]),
        proofs: z.array(repairProofSchema).max(30).default([]),
        context: z.object({
          cwd: z.string().max(500).optional(),
          baselineGeneratedAt: z.string().max(80).optional(),
          currentGeneratedAt: z.string().max(80).optional(),
          objective: z.string().max(3000).optional(),
          systemKind: z.string().max(120).optional()
        }).default({})
      }),
      annotations: annotations()
    },
    async (input) => response(buildRepairHandoff(input))
  );

  server.registerTool(
    "agm_validate_output",
    {
      title: "AGM final output validation",
      description:
        "Use this tool immediately before a final answer containing material factual or execution claims. It checks the prior preflight verdict and claim evidence, and returns whether the answer may be released.",
      inputSchema: z.object({
        preflightDecision: z.enum(["ALLOW", "BLOCK", "REQUIRE_REVIEW", "UNKNOWN"]),
        completionStatus: z.enum(["VERIFIED", "SUPPORTED", "INFERRED", "UNKNOWN", "CONTRADICTED"]).optional(),
        claims: z.array(claimSchema).max(50).default([]),
        formatValid: z.boolean().default(true),
        scopeValid: z.boolean().default(true)
      }),
      annotations: annotations()
    },
    async (input) => {
      const result = finalCompliancePipeline({
        preAction: {
          decision: input.preflightDecision,
          state: {
            policy: { decision: input.preflightDecision },
            route: { decision: input.preflightDecision === "ALLOW" ? "ALLOW" : input.preflightDecision },
            skillProof: { valid: input.preflightDecision === "ALLOW" }
          }
        },
        completion: input.completionStatus ? { status: input.completionStatus } : null,
        claims: input.claims,
        formatValid: input.formatValid,
        scopeValid: input.scopeValid
      });

      return response({
        release: result.release,
        decision: result.decision,
        reasons: result.reasons,
        claims: result.claims,
        enforcementState: "OUTPUT_DECISION_PRODUCED"
      });
    }
  );

  return server;
}

const handler = createMcpHandler(buildAgmMcpServer, { legacy: "stateless" });
export const agmMcpNodeHandler = toNodeHandler(handler, {
  onerror: (error) => {
    console.error(JSON.stringify({
      event: "mcp_adapter_error",
      message: error.message
    }));
  }
});