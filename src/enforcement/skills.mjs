function list(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function applies(skill, task) {
  const triggers = skill.triggers || {};
  const taskLabels = new Set(list(task.labels));
  const requiredLabels = list(triggers.taskLabels);
  if (requiredLabels.length && !requiredLabels.some((label) => taskLabels.has(label))) return false;
  if (triggers.actionKinds?.length && !list(triggers.actionKinds).includes(task.actionKind)) return false;
  return true;
}

export function resolveSkills(skills = [], task = {}) {
  const applicable = skills.filter((skill) => (skill.status || "ACTIVE") === "ACTIVE" && applies(skill, task));
  const result = {
    mandatory: [],
    conditional: [],
    optional: [],
    forbidden: [],
    invalid: []
  };

  for (const skill of applicable) {
    const level = String(skill.priority || skill.level || "OPTIONAL").toUpperCase();
    if (level === "MANDATORY") result.mandatory.push(skill);
    else if (level === "CONDITIONAL") result.conditional.push(skill);
    else if (level === "OPTIONAL") result.optional.push(skill);
    else if (level === "FORBIDDEN") result.forbidden.push(skill);
    else result.invalid.push(skill);
  }

  return {
    ...result,
    status: result.invalid.length ? "UNKNOWN" : "RESOLVED",
    requiredIds: result.mandatory.map((skill) => skill.id)
  };
}

export function verifyMandatorySkills(resolution, execution = []) {
  const byId = new Map(execution.map((item) => [item.id || item.skillId, item]));
  const missing = [];
  for (const skill of resolution.mandatory || []) {
    const state = byId.get(skill.id);
    if (!state?.loaded || !state?.executed || !state?.executionProof) missing.push(skill.id);
  }
  return {
    valid: missing.length === 0,
    missing,
    status: missing.length ? "BLOCK" : "VERIFIED"
  };
}
