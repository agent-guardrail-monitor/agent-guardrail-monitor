import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuard } from "../src/engine.mjs";

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

for (const [check, ruleId] of directChecks) {
  test(`direct check ${check} maps to ${ruleId}`, () => {
    const result = evaluateGuard({ checks: { [check]: true } });
    assert.equal(result.decision, "BLOCK");
    assert.ok(result.violations.some((v) => v.ruleId === ruleId));
  });
}

test("authorized resource is allowed when no other blocker exists", () => {
  const result = evaluateGuard({
    task: { authorizedResources: ["auth"] },
    proposedActions: [{ resource: "auth", destructive: false }]
  });
  assert.equal(result.decision, "ALLOW");
});

test("resource outside explicit scope triggers EXE-001", () => {
  const result = evaluateGuard({
    task: { authorizedResources: ["auth"] },
    proposedActions: [{ resource: "header", destructive: false }]
  });
  assert.ok(result.violations.some((v) => v.ruleId === "EXE-001"));
});

test("unmet success criteria trigger EXE-006 only when completion is claimed", () => {
  assert.equal(
    evaluateGuard({ task: { unmetSuccessCriteria: ["tests"] } }).decision,
    "ALLOW"
  );
  const completed = evaluateGuard({
    completionClaimed: true,
    task: { unmetSuccessCriteria: ["tests"] }
  });
  assert.ok(completed.violations.some((v) => v.ruleId === "EXE-006"));
});

for (const [claimKey, proofKey] of [
  ["claimedResearched", "researchProof"],
  ["claimedTested", "testProof"],
  ["claimedExecuted", "executionProof"]
]) {
  test(`${claimKey} requires ${proofKey}`, () => {
    const missing = evaluateGuard({ evidence: { [claimKey]: true } });
    assert.ok(missing.violations.some((v) => v.ruleId === "EVD-007"));

    const proven = evaluateGuard({
      evidence: { [claimKey]: true, [proofKey]: "receipt" }
    });
    assert.equal(proven.decision, "ALLOW");
  });
}

test("full document claim requires full coverage", () => {
  const blocked = evaluateGuard({
    evidence: { claimedReadEntireDocument: true, documentCoverage: 0.99 }
  });
  assert.ok(blocked.violations.some((v) => v.ruleId === "DOC-001"));

  const allowed = evaluateGuard({
    evidence: { claimedReadEntireDocument: true, documentCoverage: 1 }
  });
  assert.equal(allowed.decision, "ALLOW");
});

test("code correction with possible test requires passing proof", () => {
  const result = evaluateGuard({
    checks: { codeCorrectionClaimed: true, testPossible: true, testPassed: false },
    evidence: {}
  });
  assert.ok(result.violations.some((v) => v.ruleId === "COD-005"));
  assert.ok(result.violations.some((v) => v.ruleId === "COD-007"));
});
