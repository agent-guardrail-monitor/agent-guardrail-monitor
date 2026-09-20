import { VERDICTS } from "./policy.mjs";

function array(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

export function validateRoute(task = {}, action = {}, { strict = false } = {}) {
  const allowedTools = new Set(array(task.allowedTools));
  const forbiddenTools = new Set(array(task.forbiddenTools));
  const allowedActions = new Set(array(task.allowedActions));
  const forbiddenActions = new Set(array(task.forbiddenActions));

  if (action.tool && forbiddenTools.has(action.tool)) {
    return { decision: VERDICTS.BLOCK, code: "FORBIDDEN_TOOL", reason: "Tool is forbidden by task state." };
  }
  if (action.kind && forbiddenActions.has(action.kind)) {
    return { decision: VERDICTS.BLOCK, code: "FORBIDDEN_ACTION", reason: "Action kind is forbidden by task state." };
  }
  if (allowedTools.size && action.tool && !allowedTools.has(action.tool)) {
    return { decision: VERDICTS.BLOCK, code: "ROUTE_DEVIATION", reason: "Tool is outside the task allowlist." };
  }
  if (allowedActions.size && action.kind && !allowedActions.has(action.kind)) {
    return { decision: VERDICTS.BLOCK, code: "ROUTE_DEVIATION", reason: "Action is outside the task allowlist." };
  }

  if (!task.originalObjective && strict) {
    return { decision: VERDICTS.UNKNOWN, code: "OBJECTIVE_UNKNOWN", reason: "Strict route validation requires originalObjective." };
  }
  return { decision: VERDICTS.ALLOW, code: "ROUTE_OK", reason: null };
}
