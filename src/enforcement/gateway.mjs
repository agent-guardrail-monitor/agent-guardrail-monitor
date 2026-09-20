import { evaluatePolicy, VERDICTS } from "./policy.mjs";
import { validateRoute } from "./route.mjs";
import { createExecutionReceipt, completionStatus } from "./execution.mjs";

export function preActionCheck({ policy, runtime, task = {}, action = {}, skills = [] }) {
  const route = validateRoute(task, action, { strict: policy?.strict === true });
  if (route.decision !== VERDICTS.ALLOW) {
    return {
      decision: route.decision === VERDICTS.UNKNOWN ? VERDICTS.REQUIRE_REVIEW : route.decision,
      code: route.code,
      reasons: [route.reason],
      matchedRuleIds: [],
      policyHash: null
    };
  }
  return evaluatePolicy(policy, { phase: "PRE_ACTION", runtime, task, action, skills });
}

export async function executeControlled({
  policy,
  runtime,
  task = {},
  action = {},
  skills = [],
  executor,
  proofFactory,
  proofRequired = true
}) {
  const decision = preActionCheck({ policy, runtime, task, action, skills });
  if (decision.decision !== VERDICTS.ALLOW) {
    return { decision, executed: false, receipt: null, completion: null };
  }

  if (typeof executor !== "function") {
    return {
      decision: { ...decision, decision: VERDICTS.UNKNOWN, code: "EXECUTOR_MISSING", reasons: ["No executor supplied."] },
      executed: false,
      receipt: null,
      completion: null
    };
  }

  const startedAt = new Date().toISOString();
  const toolResult = await executor(action);
  const receipt = createExecutionReceipt({
    action: { ...action, startedAt },
    decision,
    toolResult
  });
  const proof = typeof proofFactory === "function" ? await proofFactory({ action, toolResult, receipt }) : null;
  const completion = completionStatus({ proofRequired, proof });

  return {
    decision,
    executed: true,
    toolResult,
    receipt,
    completion,
    releaseable: !proofRequired || ["VERIFIED", "SUPPORTED"].includes(completion.status)
  };
}
