import { VERDICTS, evaluatePolicy } from "./policy.mjs";
import { resolveMemory } from "./memory.mjs";
import { resolveSkills, verifyMandatorySkills } from "./skills.mjs";
import { resolveTools, routeTool } from "./tools.mjs";
import { validateRoute } from "./route.mjs";
import { validateOutput } from "./evidence.mjs";

function stop(decision, stage, code, reasons, state) {
  return { decision, stage, code, reasons: Array.isArray(reasons) ? reasons : [reasons], state };
}

export function preActionPipeline({
  policy,
  runtime,
  task = {},
  action = {},
  memory = [],
  requiredMemoryKeys = [],
  skillRegistry = [],
  skillExecution = [],
  toolRegistry = [],
  availableTools = []
} = {}) {
  const memoryResolution = resolveMemory(memory, {
    scopes: task.scopes || task.labels || [],
    requiredKeys: requiredMemoryKeys
  });

  if (memoryResolution.conflicts.length) {
    return stop(
      VERDICTS.REQUIRE_REVIEW,
      "MEMORY_RESOLUTION",
      "MEMORY_CONFLICT",
      memoryResolution.conflicts.map((item) => item.key),
      { memory: memoryResolution }
    );
  }

  if (memoryResolution.missing.length && action.critical === true) {
    return stop(
      VERDICTS.BLOCK,
      "MEMORY_RESOLUTION",
      "REQUIRED_MEMORY_MISSING",
      memoryResolution.missing,
      { memory: memoryResolution }
    );
  }

  const skillResolution = resolveSkills(skillRegistry, {
    labels: task.labels,
    actionKind: action.kind
  });
  const skillProof = verifyMandatorySkills(skillResolution, skillExecution);
  if (!skillProof.valid) {
    return stop(
      VERDICTS.BLOCK,
      "SKILL_RESOLUTION",
      "MANDATORY_SKILL_MISSING",
      skillProof.missing,
      { memory: memoryResolution, skills: skillResolution, skillProof }
    );
  }

  const toolResolution = resolveTools(toolRegistry, task, availableTools);
  if (toolResolution.status === "BLOCK") {
    return stop(
      VERDICTS.BLOCK,
      "TOOL_RESOLUTION",
      "REQUIRED_TOOL_UNAVAILABLE",
      [...toolResolution.missingRequired, ...toolResolution.unavailableRequired],
      { memory: memoryResolution, skills: skillResolution, skillProof, tools: toolResolution }
    );
  }

  const toolRoute = action.tool ? routeTool(toolResolution, action.tool) : { decision: VERDICTS.ALLOW, code: "NO_TOOL_ACTION" };
  if (toolRoute.decision !== VERDICTS.ALLOW) {
    return stop(
      toolRoute.decision === "UNKNOWN" && action.critical === true ? VERDICTS.BLOCK : toolRoute.decision,
      "TOOL_RESOLUTION",
      toolRoute.code,
      action.tool || "unknown tool",
      { memory: memoryResolution, skills: skillResolution, skillProof, tools: toolResolution, toolRoute }
    );
  }

  const route = validateRoute(task, action, { strict: policy?.strict === true });
  if (route.decision !== VERDICTS.ALLOW) {
    return stop(
      route.decision === VERDICTS.UNKNOWN && action.critical === true ? VERDICTS.BLOCK : route.decision,
      "ROUTE_VALIDATION",
      route.code,
      route.reason,
      { memory: memoryResolution, skills: skillResolution, skillProof, tools: toolResolution, toolRoute, route }
    );
  }

  const policyDecision = evaluatePolicy(policy, {
    phase: "PRE_ACTION",
    runtime,
    task,
    action,
    skills: skillExecution
  });

  return {
    decision: policyDecision.decision,
    stage: "POLICY_CHECK",
    code: policyDecision.code,
    reasons: policyDecision.reasons,
    state: {
      memory: memoryResolution,
      skills: skillResolution,
      skillProof,
      tools: toolResolution,
      toolRoute,
      route,
      policy: policyDecision
    }
  };
}

export function finalCompliancePipeline({
  preAction,
  completion = null,
  claims = [],
  formatValid = true,
  scopeValid = true
} = {}) {
  const state = preAction?.state || {};
  return validateOutput({
    policyDecision: state.policy || { decision: preAction?.decision || VERDICTS.UNKNOWN },
    routeDecision: state.route,
    mandatorySkills: state.skillProof,
    completion,
    claims,
    formatValid,
    scopeValid
  });
}
