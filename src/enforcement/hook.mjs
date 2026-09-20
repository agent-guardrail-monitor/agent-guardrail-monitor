import fs from "node:fs";
import { VERDICTS } from "./policy.mjs";
import { validateRoute } from "./route.mjs";
import { preActionPipeline } from "./pipeline.mjs";
import { verifyPolicyBundle } from "./signature.mjs";

function parseArgs(value) {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value); } catch { return { command: value }; }
}

function normalizedRuntime(runtime) {
  const value = String(runtime || "").toLowerCase();
  if (value === "github" || value === "github-copilot") return "copilot";
  if (value === "claude-code") return "claude";
  return value;
}

function likelyCritical(tool, args) {
  const name = String(tool || "").toLowerCase();
  if (["write", "edit", "create", "bash", "powershell", "shell", "apply_patch", "computer"].some((x) => name.includes(x))) {
    return true;
  }
  const command = typeof args?.command === "string" ? args.command : "";
  return /\b(rm|del|remove-item|git\s+push|npm\s+publish|curl|wget)\b/i.test(command);
}

export function normalizeHookInput(runtime, input = {}) {
  const rt = normalizedRuntime(runtime);
  const tool = input.tool_name || input.toolName || input.tool || "";
  const args = parseArgs(input.tool_input ?? input.toolArgs ?? input.args ?? {});
  return {
    runtime: rt,
    phase: "PRE_ACTION",
    task: input.agmTask || input.task || {},
    skills: input.agmSkills || input.skills || [],
    action: {
      id: input.tool_use_id || input.toolCallId || input.actionId || null,
      kind: "TOOL_CALL",
      tool,
      args,
      critical: input.agmCritical === true || likelyCritical(tool, args)
    },
    rawEvent: input.hook_event_name || input.event || "PreToolUse"
  };
}

export function evaluateHook(policy, runtime, input) {
  const context = normalizeHookInput(runtime, input);
  const route = validateRoute(context.task, context.action, { strict: false });
  if (route.decision === VERDICTS.BLOCK) {
    return { ...route, matchedRuleIds: [], policyHash: null, context };
  }

  const pipeline = preActionPipeline({
    policy,
    runtime: context.runtime,
    task: context.task,
    action: context.action,
    memory: policy.memoryRegistry || [],
    requiredMemoryKeys: policy.requiredMemoryKeys || [],
    skillRegistry: policy.skillRegistry || [],
    skillExecution: context.skills,
    toolRegistry: policy.toolRegistry || [],
    availableTools: policy.availableTools || []
  });

  return {
    decision: pipeline.decision,
    code: pipeline.code,
    reasons: pipeline.reasons,
    matchedRuleIds: pipeline.state?.policy?.matchedRuleIds || [],
    policyHash: pipeline.state?.policy?.policyHash || null,
    pipelineStage: pipeline.stage,
    pipelineState: pipeline.state,
    context
  };
}

export function hookOutput(runtime, decision) {
  const rt = normalizedRuntime(runtime);
  if (decision.decision === VERDICTS.ALLOW) return {};

  const reason = (decision.reasons || [decision.reason || decision.code || "Blocked by Agent Guardrail Monitor"]).join(" ");

  if (rt === "copilot") {
    return { permissionDecision: "deny", permissionDecisionReason: reason };
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}

export function loadPolicy(file, { publicKey = null } = {}) {
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  if (document?.bundleVersion === 1 && document?.signature) {
    if (!publicKey) throw new Error("Signed policy bundle requires a public key.");
    const verification = verifyPolicyBundle(document, publicKey);
    if (!verification.valid) throw new Error("Signed policy bundle verification failed: " + verification.code);
    return document.policy;
  }
  return document;
}
