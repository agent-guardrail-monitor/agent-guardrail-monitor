import crypto from "node:crypto";

export const POLICY_SCHEMA_VERSION = 1;
export const VERDICTS = Object.freeze({
  ALLOW: "ALLOW",
  BLOCK: "BLOCK",
  REQUIRE_REVIEW: "REQUIRE_REVIEW",
  UNKNOWN: "UNKNOWN"
});

const EFFECTS = new Set(["ALLOW", "BLOCK", "REQUIRE_TOOL", "REQUIRE_SKILL", "REQUIRE_REVIEW"]);
const EXTERNAL_SOURCES = new Set([
  "TOOL_OUTPUT", "FILE_CONTENT", "WEB_CONTENT", "RETRIEVED_CONTENT",
  "MCP_RESULT", "UNTRUSTED_EXTERNAL"
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function list(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function includesValue(ruleValue, actual) {
  const expected = list(ruleValue);
  if (!expected.length) return true;
  return expected.includes(actual);
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function actionCommand(action = {}) {
  const args = parseMaybeJson(action.args);
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  for (const key of ["command", "cmd", "script", "powershell", "bash"]) {
    if (typeof args[key] === "string") return args[key];
  }
  return "";
}

function regexMatch(pattern, value) {
  if (!pattern) return true;
  try { return new RegExp(pattern).test(String(value ?? "")); }
  catch { return false; }
}

function matches(rule, context) {
  const match = rule.match || {};
  const action = context.action || {};
  const task = context.task || {};
  if (!includesValue(match.runtime, context.runtime)) return false;
  if (!includesValue(match.tool, action.tool)) return false;
  if (!includesValue(match.actionKind, action.kind)) return false;
  if (match.commandRegex && !regexMatch(match.commandRegex, actionCommand(action))) return false;
  if (match.objectiveRegex && !regexMatch(match.objectiveRegex, task.originalObjective || task.objective || "")) return false;

  const requiredLabels = list(match.taskLabels);
  if (requiredLabels.length) {
    const labels = new Set(list(task.labels));
    if (!requiredLabels.every((label) => labels.has(label))) return false;
  }
  return true;
}

export function authorityForSource(source) {
  const normalized = String(source || "UNKNOWN").toUpperCase();
  if (EXTERNAL_SOURCES.has(normalized)) return "DATA";
  if (normalized === "SYSTEM" || normalized === "PLATFORM") return "PLATFORM";
  if (normalized === "DEVELOPER" || normalized === "ORGANIZATION") return "ORGANIZATION_POLICY";
  if (normalized === "USER") return "USER_DIRECTIVE";
  if (normalized === "PLUGIN_POLICY") return "PLUGIN_POLICY";
  return "UNKNOWN";
}

export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { valid: false, errors: ["policy must be an object"] };
  }
  if (policy.schemaVersion !== POLICY_SCHEMA_VERSION) {
    errors.push("schemaVersion must equal " + POLICY_SCHEMA_VERSION);
  }
  if (!policy.policyId || typeof policy.policyId !== "string") errors.push("policyId is required");
  if (!Number.isInteger(policy.version) || policy.version < 1) errors.push("version must be a positive integer");
  if (!Array.isArray(policy.rules)) errors.push("rules must be an array");

  const ids = new Set();
  for (const [index, rule] of (policy.rules || []).entries()) {
    const prefix = "rules[" + index + "]";
    if (!rule || typeof rule !== "object") { errors.push(prefix + " must be an object"); continue; }
    if (!rule.id || typeof rule.id !== "string") errors.push(prefix + ".id is required");
    else if (ids.has(rule.id)) errors.push("duplicate rule id: " + rule.id);
    else ids.add(rule.id);
    if (!["ACTIVE", "DISABLED"].includes(rule.status || "ACTIVE")) errors.push(prefix + ".status is invalid");
    if (!["PRE_ACTION", "POST_ACTION", "OUTPUT", "ANY"].includes(rule.phase || "PRE_ACTION")) {
      errors.push(prefix + ".phase is invalid");
    }
    if (!rule.effect || !EFFECTS.has(rule.effect.type)) errors.push(prefix + ".effect.type is invalid");
    if (rule.effect?.type === "REQUIRE_TOOL" && !rule.effect.tool) errors.push(prefix + ".effect.tool is required");
    if (rule.effect?.type === "REQUIRE_SKILL" && !rule.effect.skill) errors.push(prefix + ".effect.skill is required");
    if (rule.match?.commandRegex) {
      try { new RegExp(rule.match.commandRegex); } catch { errors.push(prefix + ".match.commandRegex is invalid"); }
    }
    if (rule.match?.objectiveRegex) {
      try { new RegExp(rule.match.objectiveRegex); } catch { errors.push(prefix + ".match.objectiveRegex is invalid"); }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function compileDirective(input) {
  const source = String(input?.source || "USER").toUpperCase();
  const base = {
    id: input?.id || null,
    source,
    authority: authorityForSource(source),
    text: String(input?.text || ""),
    scope: list(input?.scope),
    priority: input?.priority || "MANDATORY",
    version: Number.isInteger(input?.version) ? input.version : 1
  };

  if (!input?.normalizedRule) {
    return {
      status: "REQUIRE_REVIEW",
      reason: "A natural-language directive cannot become active policy without a validated normalizedRule.",
      directive: base
    };
  }

  if (base.authority === "DATA") {
    return {
      status: "REQUIRE_REVIEW",
      reason: "External data cannot promote itself to directive authority.",
      directive: base
    };
  }

  const rule = {
    id: base.id,
    source,
    authority: base.authority,
    text: base.text,
    priority: base.priority,
    version: base.version,
    status: "ACTIVE",
    ...input.normalizedRule
  };
  return { status: "COMPILED", directive: base, rule };
}

function skillState(skills, id) {
  return (skills || []).find((skill) => skill.id === id || skill.name === id) || null;
}

function mandatory(rule) {
  return (rule.priority || "MANDATORY") === "MANDATORY";
}

function detectMandatoryConflict(rules) {
  const mandatoryRules = rules.filter(mandatory);
  const hasAllow = mandatoryRules.some((rule) => rule.effect.type === "ALLOW");
  const hasBlock = mandatoryRules.some((rule) => rule.effect.type === "BLOCK");
  if (hasAllow && hasBlock) return "Matched mandatory ALLOW and BLOCK rules.";

  const tools = new Set(mandatoryRules.filter((r) => r.effect.type === "REQUIRE_TOOL").map((r) => r.effect.tool));
  if (tools.size > 1) return "Matched mandatory rules require different tools.";

  return null;
}

export function evaluatePolicy(policy, context = {}) {
  const validation = validatePolicy(policy);
  const strict = policy?.strict === true;
  if (!validation.valid) {
    return {
      decision: strict ? VERDICTS.BLOCK : VERDICTS.UNKNOWN,
      matchedRuleIds: [],
      reasons: validation.errors,
      policyHash: policy ? hashObject(policy) : null,
      code: "INVALID_POLICY"
    };
  }

  const phase = context.phase || "PRE_ACTION";
  const active = policy.rules.filter((rule) =>
    (rule.status || "ACTIVE") === "ACTIVE" &&
    (rule.phase || "PRE_ACTION") !== "ANY" ? (rule.phase || "PRE_ACTION") === phase : true
  );
  const matched = active.filter((rule) => matches(rule, context));
  const conflict = detectMandatoryConflict(matched);

  if (conflict) {
    return {
      decision: VERDICTS.REQUIRE_REVIEW,
      matchedRuleIds: matched.map((r) => r.id),
      reasons: [conflict],
      policyHash: hashObject(policy),
      code: "POLICY_CONFLICT"
    };
  }

  const reasons = [];
  let review = false;

  for (const rule of matched) {
    const effect = rule.effect;
    if (effect.type === "BLOCK") {
      reasons.push(effect.reason || ("Blocked by " + rule.id));
      return {
        decision: VERDICTS.BLOCK,
        matchedRuleIds: matched.map((r) => r.id),
        reasons,
        policyHash: hashObject(policy),
        code: "RULE_BLOCK"
      };
    }
    if (effect.type === "REQUIRE_TOOL" && context.action?.tool !== effect.tool) {
      reasons.push(effect.reason || ("Rule " + rule.id + " requires tool " + effect.tool));
      return {
        decision: VERDICTS.BLOCK,
        matchedRuleIds: matched.map((r) => r.id),
        reasons,
        policyHash: hashObject(policy),
        code: "REQUIRED_TOOL_MISSING"
      };
    }
    if (effect.type === "REQUIRE_SKILL") {
      const state = skillState(context.skills, effect.skill);
      const loaded = state?.loaded === true;
      const executionRequired = effect.executionRequired !== false;
      const executed = state?.executed === true && Boolean(state?.executionProof);
      if (!loaded || (executionRequired && !executed)) {
        reasons.push(effect.reason || ("Rule " + rule.id + " requires skill " + effect.skill + " with execution proof"));
        return {
          decision: VERDICTS.BLOCK,
          matchedRuleIds: matched.map((r) => r.id),
          reasons,
          policyHash: hashObject(policy),
          code: "REQUIRED_SKILL_MISSING"
        };
      }
    }
    if (effect.type === "REQUIRE_REVIEW") {
      review = true;
      reasons.push(effect.reason || ("Rule " + rule.id + " requires review"));
    }
  }

  if (review) {
    return {
      decision: VERDICTS.REQUIRE_REVIEW,
      matchedRuleIds: matched.map((r) => r.id),
      reasons,
      policyHash: hashObject(policy),
      code: "REVIEW_REQUIRED"
    };
  }

  if (!matched.length && strict && context.action?.critical === true) {
    const critical = policy.defaults?.criticalUnmatched || "BLOCK";
    return {
      decision: critical === "REQUIRE_REVIEW" ? VERDICTS.REQUIRE_REVIEW : VERDICTS.BLOCK,
      matchedRuleIds: [],
      reasons: ["Critical action has no matching active policy rule."],
      policyHash: hashObject(policy),
      code: "CRITICAL_UNMATCHED"
    };
  }

  const unmatched = policy.defaults?.unmatched || "ALLOW";
  return {
    decision: unmatched === "BLOCK" ? VERDICTS.BLOCK :
      unmatched === "REQUIRE_REVIEW" ? VERDICTS.REQUIRE_REVIEW : VERDICTS.ALLOW,
    matchedRuleIds: matched.map((r) => r.id),
    reasons,
    policyHash: hashObject(policy),
    code: matched.length ? "POLICY_ALLOW" : "NO_MATCH"
  };
}
