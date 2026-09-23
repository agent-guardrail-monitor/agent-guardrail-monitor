export const RECOVERY_MAX_ATTEMPTS = 3;

export const RECOVERY_PHASES = Object.freeze({
  CORRECT: "CORRECT",
  ALLOW: "ALLOW",
  SAFE_STOP: "SAFE_STOP"
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function resourceFromEvidence(evidence) {
  const text = String(evidence || "");
  for (const prefix of [
    "resource_outside_authorized_scope:",
    "frozen_element:",
    "destructive_action_without_authorization:"
  ]) {
    if (text.startsWith(prefix)) return text.slice(prefix.length);
  }
  return null;
}

function instructionForViolation(violation) {
  const ruleId = String(violation.ruleId || "");
  const evidence = String(violation.evidence || "");

  if (ruleId === "EXE-001") {
    return "Remove only the action outside the authorized scope. Preserve authorized actions.";
  }
  if (ruleId === "EXE-002") {
    return "Revert or omit the change to the frozen element. Preserve that element exactly as previously approved.";
  }
  if (ruleId === "EXE-008") {
    return "Omit the destructive action unless explicit authorization exists. Preserve non-destructive authorized work.";
  }
  if (ruleId === "EXE-006" || ruleId === "EXE-007") {
    return "Continue the required work and do not claim completion until every applicable success criterion is satisfied.";
  }
  if (ruleId === "EVD-002" || ruleId === "EVD-003") {
    return "Replace only the unsupported or unconfirmed item with verified evidence. Preserve already verified items.";
  }
  if (ruleId === "EVD-007") {
    return "Remove the unproven execution/research/test claim or obtain the missing proof before making that claim.";
  }
  if (ruleId === "DOC-001") {
    return "Complete the document coverage before claiming full reading, or accurately state that coverage is partial.";
  }
  if (ruleId === "COD-005" || ruleId === "COD-007") {
    return "Run the available validation/test and keep the correction unclaimed until execution evidence exists.";
  }
  if (ruleId.startsWith("MEM-")) {
    return "Correct only the conflicting or invalid memory use while preserving valid current account/project memory.";
  }
  if (ruleId.startsWith("CTX-")) {
    return "Restore the original task context, restrictions and approved decisions without changing unrelated work.";
  }
  if (ruleId.startsWith("DOC-")) {
    return "Correct only the document-specific defect using the requested/current document and preserve valid document work.";
  }
  if (ruleId.startsWith("COD-")) {
    return "Correct only the evidenced software defect and preserve unaffected files, behavior and approved functionality.";
  }
  if (ruleId.startsWith("RES-")) {
    return "Revise only the defective response portion while preserving valid, specific and supported content.";
  }
  if (ruleId.startsWith("EVD-")) {
    return "Correct only the unsupported factual/evidentiary claim and preserve supported material.";
  }
  if (ruleId.startsWith("BEH-")) {
    return "Regenerate only the affected reasoning/response behavior using the user's actual instruction and available evidence.";
  }
  if (ruleId.startsWith("PLG-")) {
    return "Resolve the plugin-control conflict without inventing or expanding blocking rules.";
  }

  return "Correct only the evidenced violation and preserve all non-violating content and actions.";
}

export function buildRecoveryPlan(payload = {}, guardResult = {}, attempt = 1) {
  const normalizedAttempt = Math.max(1, Math.min(RECOVERY_MAX_ATTEMPTS, Number(attempt) || 1));
  const violations = Array.isArray(guardResult.violations) ? guardResult.violations : [];
  const invalidResources = unique(violations.map((v) => resourceFromEvidence(v.evidence)));

  const proposedActions = Array.isArray(payload.proposedActions) ? payload.proposedActions : [];
  const preservedResources = unique(
    proposedActions
      .map((action) => String(action?.resource || ""))
      .filter((resource) => resource && !invalidResources.includes(resource))
  );

  if (guardResult.decision === "ALLOW") {
    return {
      phase: RECOVERY_PHASES.ALLOW,
      canExecute: true,
      attempt: normalizedAttempt,
      maxAttempts: RECOVERY_MAX_ATTEMPTS,
      nextAttempt: null,
      invalidResources: [],
      preserve: {
        resources: preservedResources,
        instruction: "Preserve the validated candidate exactly through execution."
      },
      corrections: [],
      unresolvedViolations: []
    };
  }

  const corrections = violations.map((violation) => ({
    ruleId: violation.ruleId,
    evidence: violation.evidence,
    instruction: instructionForViolation(violation)
  }));

  const safeStop = normalizedAttempt >= RECOVERY_MAX_ATTEMPTS;

  return {
    phase: safeStop ? RECOVERY_PHASES.SAFE_STOP : RECOVERY_PHASES.CORRECT,
    canExecute: false,
    attempt: normalizedAttempt,
    maxAttempts: RECOVERY_MAX_ATTEMPTS,
    nextAttempt: safeStop ? null : normalizedAttempt + 1,
    invalidResources,
    preserve: {
      resources: preservedResources,
      instruction: "Preserve all validated content, decisions and actions not implicated by the listed violations."
    },
    corrections,
    unresolvedViolations: violations.map((v) => ({
      ruleId: v.ruleId,
      evidence: v.evidence
    })),
    correctionDirective: safeStop
      ? "Stop automatic retries. Do not claim completion. Return the unresolved canonical violations and the evidence still required."
      : "Correct only the listed violations, preserve everything else that is valid, then submit the corrected candidate for recheck using the same recoverySessionId."
  };
}
