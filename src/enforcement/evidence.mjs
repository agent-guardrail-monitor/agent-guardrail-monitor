import { VERDICTS } from "./policy.mjs";

const CLAIM_STATES = new Set(["VERIFIED", "SUPPORTED", "INFERRED", "UNKNOWN", "CONTRADICTED"]);

export function validateClaims(claims = []) {
  const violations = [];
  for (const claim of claims) {
    if (!claim?.id || !claim?.claim) {
      violations.push({ claimId: claim?.id || null, code: "CLAIM_SCHEMA_INVALID" });
      continue;
    }
    const status = claim.verificationStatus || claim.status || "UNKNOWN";
    if (!CLAIM_STATES.has(status)) {
      violations.push({ claimId: claim.id, code: "CLAIM_STATUS_INVALID" });
      continue;
    }
    if (status === "CONTRADICTED") {
      violations.push({ claimId: claim.id, code: "CONTRADICTED_CLAIM" });
    }
    if (status === "UNKNOWN" && claim.presentedAsFact === true) {
      violations.push({ claimId: claim.id, code: "UNKNOWN_PRESENTED_AS_FACT" });
    }
    if (status === "INFERRED" && claim.presentedAsFact === true) {
      violations.push({ claimId: claim.id, code: "INFERENCE_PRESENTED_AS_FACT" });
    }
    if (claim.material !== false && ["VERIFIED", "SUPPORTED"].includes(status)) {
      if (!claim.source || !claim.evidence) {
        violations.push({ claimId: claim.id, code: "SUPPORTED_CLAIM_MISSING_EVIDENCE" });
      }
    }
  }
  return {
    valid: violations.length === 0,
    violations,
    counts: Object.fromEntries([...CLAIM_STATES].map((state) => [
      state,
      claims.filter((claim) => (claim.verificationStatus || claim.status || "UNKNOWN") === state).length
    ]))
  };
}

export function validateOutput({
  policyDecision,
  routeDecision,
  mandatorySkills,
  completion,
  claims = [],
  formatValid = true,
  scopeValid = true
} = {}) {
  const reasons = [];
  if (policyDecision && policyDecision.decision !== VERDICTS.ALLOW) {
    reasons.push("policy:" + policyDecision.decision);
  }
  if (routeDecision && routeDecision.decision !== VERDICTS.ALLOW) {
    reasons.push("route:" + routeDecision.decision);
  }
  if (mandatorySkills && mandatorySkills.valid === false) {
    reasons.push("mandatory_skills_missing");
  }
  if (completion && !["VERIFIED", "SUPPORTED"].includes(completion.status)) {
    reasons.push("execution_proof:" + completion.status);
  }

  const claimResult = validateClaims(claims);
  if (!claimResult.valid) reasons.push("claim_validation_failed");
  if (!formatValid) reasons.push("format_invalid");
  if (!scopeValid) reasons.push("scope_invalid");

  return {
    release: reasons.length === 0,
    decision: reasons.length ? VERDICTS.BLOCK : VERDICTS.ALLOW,
    reasons,
    claims: claimResult
  };
}
