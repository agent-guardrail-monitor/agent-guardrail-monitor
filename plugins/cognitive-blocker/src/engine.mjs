import { RULE_MAP, RULESET_VERSION } from "./rule-catalog.mjs";

const SEMANTIC_THRESHOLD = 0.8;

function violation(ruleId, evidence, source = "deterministic") {
  const rule = RULE_MAP.get(ruleId);
  if (!rule) return null;
  return { ruleId, category: rule.category, text: rule.text, evidence, source };
}

function push(list, ruleId, evidence, source) {
  const item = violation(ruleId, evidence, source);
  if (item && !list.some((x) => x.ruleId === ruleId && x.evidence === evidence)) list.push(item);
}

function bool(checks, key) {
  return checks?.[key] === true;
}

export function evaluateGuard(input = {}) {
  const violations = [];
  const ignoredSignals = [];
  const checks = input.checks || {};
  const task = input.task || {};
  const evidence = input.evidence || {};

  const directChecks = [
    ["autoFlattery","BEH-001"], ["autoAgreement","BEH-001"], ["uncriticalValidation","BEH-002"],
    ["probabilityOnlyConclusion","BEH-003"], ["overconfidenceUnderUncertainty","BEH-004"],
    ["filledMissingInfoByInvention","BEH-005"], ["silentInterpretationChange","BEH-006"],
    ["unsupportedMaterialFact","EVD-001"], ["inventedSource","EVD-002"],
    ["unconfirmedLegalAuthority","EVD-003"], ["unverifiedNumberOrCalculation","EVD-004"],
    ["inferencePresentedAsFact","EVD-005"], ["undemonstratedCausality","EVD-006"],
    ["scopeExpanded","EXE-003"], ["replacedApprovedDecision","EXE-004"],
    ["skippedMandatoryStep","EXE-005"], ["partialPresentedAsComplete","EXE-007"],
    ["objectiveAbandoned","CTX-001"], ["constraintsLost","CTX-002"],
    ["contradictsApprovedDecision","CTX-003"], ["repeatedKnownQuestion","CTX-004"],
    ["wrongContextTarget","CTX-005"], ["mixedProjectInformation","CTX-006"],
    ["importantProjectLost","MEM-001"], ["silentMemoryOverwrite","MEM-002"],
    ["unresolvedMemoryConflict","MEM-003"], ["hypothesisStoredAsFact","MEM-004"],
    ["supersededMemoryUsed","MEM-005"], ["crossAccountMemoryMix","MEM-006"],
    ["irrelevantMemoryUsed","MEM-007"], ["materialDocumentPartIgnored","DOC-002"],
    ["unauthorizedFileContentChange","DOC-003"], ["oldVersionUsed","DOC-004"],
    ["nonexistentDocumentQuote","DOC-005"], ["wrongDocumentUsed","DOC-006"],
    ["changedUnnecessaryFiles","COD-001"], ["unrequestedRefactor","COD-002"],
    ["removedExistingFunctionality","COD-003"], ["unnecessaryInfraChange","COD-004"],
    ["knownRegression","COD-006"], ["createdNewSystemInsteadOfFixingExisting","COD-008"],
    ["genericResponseDespiteContext","RES-001"], ["evasiveWithoutEvidence","RES-002"],
    ["unnecessaryRepetition","RES-003"], ["ignoredMaterialRequestPart","RES-004"],
    ["criteriaChangedAfterResult","RES-005"], ["contraryEvidenceOmitted","RES-006"],
    ["ruleConflict","PLG-001"], ["autoRuleFromSingleError","PLG-002"],
    ["supersededRuleApplied","PLG-003"], ["ruleOverload","PLG-004"]
  ];

  for (const [key, ruleId] of directChecks) {
    if (bool(checks, key)) push(violations, ruleId, key);
  }

  for (const action of input.proposedActions || []) {
    const resource = String(action.resource || "");
    const allowed = Array.isArray(task.authorizedResources) ? task.authorizedResources : [];
    const frozen = Array.isArray(task.frozenElements) ? task.frozenElements : [];
    if (allowed.length && resource && !allowed.includes(resource)) {
      push(violations, "EXE-001", "resource_outside_authorized_scope:" + resource);
    }
    if (resource && frozen.includes(resource)) push(violations, "EXE-002", "frozen_element:" + resource);
    if (action.destructive === true && action.destructiveAuthorized !== true) {
      push(violations, "EXE-008", "destructive_action_without_authorization:" + resource);
    }
  }

  const unmet = Array.isArray(task.unmetSuccessCriteria) ? task.unmetSuccessCriteria : [];
  if (input.completionClaimed === true && unmet.length) {
    push(violations, "EXE-006", "unmet_success_criteria:" + unmet.join(","));
  }

  if (evidence.claimedResearched === true && !evidence.researchProof) {
    push(violations, "EVD-007", "research_claim_without_proof");
  }
  if (evidence.claimedTested === true && !evidence.testProof) {
    push(violations, "EVD-007", "test_claim_without_proof");
  }
  if (evidence.claimedExecuted === true && !evidence.executionProof) {
    push(violations, "EVD-007", "execution_claim_without_proof");
  }

  if (evidence.claimedReadEntireDocument === true && Number(evidence.documentCoverage || 0) < 1) {
    push(violations, "DOC-001", "full_read_claim_without_full_coverage");
  }

  if (checks.codeCorrectionClaimed === true && checks.testPossible === true && checks.testPassed !== true) {
    push(violations, "COD-005", "correction_delivered_without_available_test");
  }
  if (checks.codeCorrectionClaimed === true && !evidence.executionProof && !evidence.testProof) {
    push(violations, "COD-007", "correction_claim_without_execution_or_validation_proof");
  }

  for (const signal of input.semanticSignals || []) {
    const ruleId = String(signal.ruleId || "");
    const confidence = Number(signal.confidence || 0);
    const signalEvidence = String(signal.evidence || "").trim();
    if (!RULE_MAP.has(ruleId)) {
      ignoredSignals.push({ ruleId, reason: "not_in_canonical_ruleset" });
      continue;
    }
    if (confidence < SEMANTIC_THRESHOLD || !signalEvidence) {
      ignoredSignals.push({ ruleId, reason: "insufficient_evidence", confidence });
      continue;
    }
    push(violations, ruleId, signalEvidence, "semantic_signal");
  }

  return {
    decision: violations.length ? "BLOCK" : "ALLOW",
    rulesetVersion: RULESET_VERSION,
    violationCount: violations.length,
    violations,
    ignoredSignals
  };
}
