export const FINAL_REPAIR_STATES = Object.freeze([
  "VERIFIED FIX",
  "PATCHED, NOT VERIFIED",
  "ROOT CAUSE FOUND, PATCH BLOCKED",
  "INVESTIGATION INCOMPLETE"
]);

function normalized(value) {
  return String(value ?? "").trim();
}

export function isPassingPostPatch(check) {
  const phase = normalized(check?.phase).toLowerCase();
  const postPatch = /(after fix|after patch|post-patch|post patch|verification|verify|final)/.test(phase);
  const passing = check?.status === "passed" || check?.exitCode === 0 || check?.exit_code === 0;
  return postPatch && passing;
}

export function repairPreflight(input = {}) {
  const failureEvidence = Array.isArray(input.failureEvidence) ? input.failureEvidence.filter(Boolean) : [];
  const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles.filter(Boolean) : [];
  const checksRun = Array.isArray(input.checksRun) ? input.checksRun : [];
  const missing = [];
  let stage = "INTAKE";

  if (!failureEvidence.length) {
    missing.push("failure_evidence");
    stage = "REPRODUCTION_REQUIRED";
  } else if (!normalized(input.rootCause)) {
    missing.push("root_cause");
    stage = "ROOT_CAUSE_REQUIRED";
  } else if (!changedFiles.length) {
    stage = "READY_TO_PATCH";
  } else {
    if (!checksRun.some(isPassingPostPatch)) missing.push("passing_post_patch_check");
    if (!input.recurrenceReviewed) missing.push("recurrence_review");
    if (input.deploymentInScope && !input.deploymentVerified) missing.push("deployment_verification");
    stage = missing.length ? "PATCHED_NEEDS_VERIFICATION" : "READY_FOR_FINAL_GATE";
  }

  return {
    decision: missing.length ? "NEEDS_EVIDENCE" : "PROCEED",
    stage,
    missing,
    nextAction:
      stage === "REPRODUCTION_REQUIRED" ? "Reproduce or deterministically bound the failure." :
      stage === "ROOT_CAUSE_REQUIRED" ? "Establish the causal mechanism before patching." :
      stage === "READY_TO_PATCH" ? "Patch the smallest correct layer and add regression coverage." :
      stage === "PATCHED_NEEDS_VERIFICATION" ? "Complete post-patch verification and recurrence review." :
      "Run the final repair evidence gate."
  };
}

export function validateRepairEvidence(input = {}) {
  const requestedState = input.requestedState || "INVESTIGATION INCOMPLETE";
  if (!FINAL_REPAIR_STATES.includes(requestedState)) {
    return {
      release: false,
      decision: "INVALID_REPAIR_STATE",
      finalState: "INVESTIGATION INCOMPLETE",
      missing: ["valid_final_state"]
    };
  }

  if (requestedState !== "VERIFIED FIX") {
    return {
      release: true,
      decision: "ALLOW_NON_VERIFIED_STATE",
      finalState: requestedState,
      missing: [],
      residualRisks: input.residualRisks || []
    };
  }

  const missing = [];
  if (!Array.isArray(input.failureEvidence) || !input.failureEvidence.length) missing.push("failure_evidence");
  if (!normalized(input.rootCause)) missing.push("root_cause");
  if (!Array.isArray(input.changedFiles) || !input.changedFiles.length) missing.push("changed_files");
  if (!normalized(input.recurrenceReview)) missing.push("recurrence_review");
  if (!Array.isArray(input.checksRun) || !input.checksRun.some(isPassingPostPatch)) {
    missing.push("passing_post_patch_executable_check");
  }
  if (input.deploymentInScope && !normalized(input.deploymentVerification)) {
    missing.push("deployment_verification");
  }

  const release = missing.length === 0;
  return {
    release,
    decision: release ? "ALLOW_VERIFIED_FIX" : "BLOCK_VERIFIED_FIX",
    finalState: release ? "VERIFIED FIX" : "PATCHED, NOT VERIFIED",
    missing,
    residualRisks: input.residualRisks || []
  };
}

export function buildRepairEvidence({
  issue,
  environment,
  failureEvidence = [],
  rootCause = "",
  changedFiles = [],
  checksRun = [],
  recurrenceReview = "",
  deploymentVerification = "",
  residualRisks = [],
  finalState = "INVESTIGATION INCOMPLETE"
} = {}) {
  return {
    issue: normalized(issue),
    environment: environment || null,
    failure_evidence: failureEvidence,
    root_cause: normalized(rootCause),
    changed_files: changedFiles,
    checks_run: checksRun,
    recurrence_review: normalized(recurrenceReview),
    deployment_verification: normalized(deploymentVerification),
    residual_risks: residualRisks,
    final_state: finalState
  };
}
