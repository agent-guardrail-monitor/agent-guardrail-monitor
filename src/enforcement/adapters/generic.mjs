import { preActionPipeline, finalCompliancePipeline } from "../pipeline.mjs";
import { createExecutionReceipt, completionStatus } from "../execution.mjs";

function parseArgs(args) {
  if (typeof args !== "string") return args || {};
  try { return JSON.parse(args); } catch { return { raw: args }; }
}

export function normalizeGenericFunctionCall(call = {}) {
  return {
    id: call.id || call.callId || null,
    kind: "TOOL_CALL",
    tool: call.name || call.tool || "",
    args: parseArgs(call.arguments ?? call.args ?? {}),
    critical: call.critical !== false
  };
}

export async function executeFunctionCall({
  call,
  policy,
  runtime = "generic",
  task = {},
  memory = [],
  requiredMemoryKeys = [],
  skillRegistry = [],
  skillExecution = [],
  toolRegistry = [],
  availableTools = [],
  executor,
  proofFactory,
  proofRequired = true,
  claims = []
} = {}) {
  const action = normalizeGenericFunctionCall(call);
  const preAction = preActionPipeline({
    policy,
    runtime,
    task,
    action,
    memory,
    requiredMemoryKeys,
    skillRegistry,
    skillExecution,
    toolRegistry,
    availableTools
  });

  if (preAction.decision !== "ALLOW") {
    return { executed: false, preAction, receipt: null, completion: null, final: null, releaseable: false };
  }

  if (typeof executor !== "function") {
    return {
      executed: false,
      preAction: { ...preAction, decision: "UNKNOWN", code: "EXECUTOR_MISSING" },
      receipt: null,
      completion: null,
      final: null,
      releaseable: false
    };
  }

  const startedAt = new Date().toISOString();
  const toolResult = await executor(action);
  const policyDecision = preAction.state?.policy || { decision: preAction.decision, policyHash: null };
  const receipt = createExecutionReceipt({
    action: { ...action, startedAt },
    decision: policyDecision,
    toolResult
  });

  const proof = typeof proofFactory === "function"
    ? await proofFactory({ action, toolResult, receipt })
    : null;
  const completion = completionStatus({ proofRequired, proof });
  const final = finalCompliancePipeline({
    preAction,
    completion,
    claims
  });

  return {
    executed: true,
    preAction,
    toolResult,
    receipt,
    proof,
    completion,
    final,
    releaseable: final.release === true
  };
}
