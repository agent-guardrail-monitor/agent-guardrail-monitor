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
    const violation = result.violations.find((v) => v.ruleId === ruleId);
    assert.ok(violation);
    assert.equal(violation.source, "deterministic");
    assert.equal(violation.evidence, check);
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

test("duplicate equivalent violations are deduplicated", () => {
  const result = evaluateGuard({
    task: { authorizedResources: ["auth"] },
    proposedActions: [
      { resource: "header", destructive: false },
      { resource: "header", destructive: false }
    ]
  });

  const scopeViolations = result.violations.filter(
    (v) => v.ruleId === "EXE-001" && v.evidence === "resource_outside_authorized_scope:header"
  );
  assert.equal(scopeViolations.length, 1);
});

test("destructive authorization is exact", () => {
  const blocked = evaluateGuard({
    proposedActions: [{ resource: "db", destructive: true, destructiveAuthorized: false }]
  });
  assert.ok(blocked.violations.some((v) => v.ruleId === "EXE-008"));

  const allowed = evaluateGuard({
    proposedActions: [{ resource: "db", destructive: true, destructiveAuthorized: true }]
  });
  assert.equal(allowed.decision, "ALLOW");
});

test("non-array scopes safely default to no explicit scope", () => {
  const result = evaluateGuard({
    task: { authorizedResources: "auth", frozenElements: "header" },
    proposedActions: [{ resource: "header", destructive: false }]
  });
  assert.equal(result.decision, "ALLOW");
});

test("semantic threshold and source are exact", () => {
  const low = evaluateGuard({
    semanticSignals: [{ ruleId: "RES-001", confidence: 0.7999, evidence: "evidence" }]
  });
  assert.equal(low.decision, "ALLOW");
  assert.equal(low.ignoredSignals[0].reason, "insufficient_evidence");

  const exact = evaluateGuard({
    semanticSignals: [{ ruleId: "RES-001", confidence: 0.8, evidence: " evidence " }]
  });
  const violation = exact.violations.find((v) => v.ruleId === "RES-001");
  assert.ok(violation);
  assert.equal(violation.source, "semantic_signal");
  assert.equal(violation.evidence, "evidence");
});

test("blank semantic evidence is ignored", () => {
  const result = evaluateGuard({
    semanticSignals: [{ ruleId: "RES-001", confidence: 1, evidence: "   " }]
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.ignoredSignals[0].reason, "insufficient_evidence");
});

test("semantic duplicate evidence is emitted once", () => {
  const result = evaluateGuard({
    semanticSignals: [
      { ruleId: "RES-001", confidence: 1, evidence: "same" },
      { ruleId: "RES-001", confidence: 1, evidence: "same" }
    ]
  });
  assert.equal(result.violations.filter((v) => v.ruleId === "RES-001").length, 1);
});

test("result envelope reports exact counts and ruleset identity", () => {
  const result = evaluateGuard({ checks: { autoFlattery: true, uncriticalValidation: true } });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.violationCount, 2);
  assert.equal(typeof result.rulesetVersion, "string");
  assert.ok(result.rulesetVersion.length > 0);
  assert.equal(result.violations.length, 2);
  assert.deepEqual(result.ignoredSignals, []);
});
