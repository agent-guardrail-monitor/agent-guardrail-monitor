import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecoveryPlan,
  resolveRecoveryAttempt,
  RECOVERY_MAX_ATTEMPTS,
  RECOVERY_PHASES
} from "../src/recovery.mjs";

test("ALLOW authorizes execution and closes correction work", () => {
  const plan = buildRecoveryPlan(
    { proposedActions: [{ resource: "auth" }] },
    { decision: "ALLOW", violations: [] },
    2
  );
  assert.equal(plan.phase, RECOVERY_PHASES.ALLOW);
  assert.equal(plan.canExecute, true);
  assert.equal(plan.nextAttempt, null);
  assert.deepEqual(plan.preserve.resources, ["auth"]);
  assert.deepEqual(plan.corrections, []);
});

test("BLOCK preserves valid resources and isolates invalid resources", () => {
  const plan = buildRecoveryPlan(
    {
      proposedActions: [
        { resource: "auth" },
        { resource: "header" },
        { resource: "global-css" }
      ]
    },
    {
      decision: "BLOCK",
      violations: [
        { ruleId: "EXE-002", evidence: "frozen_element:header" },
        { ruleId: "EXE-001", evidence: "resource_outside_authorized_scope:global-css" }
      ]
    },
    1
  );

  assert.equal(plan.phase, RECOVERY_PHASES.CORRECT);
  assert.equal(plan.canExecute, false);
  assert.equal(plan.nextAttempt, 2);
  assert.deepEqual(plan.invalidResources.sort(), ["global-css", "header"]);
  assert.deepEqual(plan.preserve.resources, ["auth"]);
  assert.equal(plan.corrections.length, 2);
});

test("evidence replacement explicitly preserves already verified items", () => {
  const plan = buildRecoveryPlan(
    {},
    {
      decision: "BLOCK",
      violations: [
        { ruleId: "EVD-003", evidence: "unconfirmed_precedent" }
      ]
    },
    1
  );

  assert.match(plan.corrections[0].instruction, /Replace only/);
  assert.match(plan.corrections[0].instruction, /Preserve already verified items/);
});

test("third blocked attempt enters SAFE_STOP", () => {
  const plan = buildRecoveryPlan(
    {},
    {
      decision: "BLOCK",
      violations: [{ ruleId: "EVD-007", evidence: "test_claim_without_proof" }]
    },
    RECOVERY_MAX_ATTEMPTS
  );

  assert.equal(plan.phase, RECOVERY_PHASES.SAFE_STOP);
  assert.equal(plan.canExecute, false);
  assert.equal(plan.nextAttempt, null);
  assert.match(plan.correctionDirective, /Do not claim completion/);
});

test("attempt values are bounded to the internal retry policy", () => {
  assert.equal(buildRecoveryPlan({}, { decision: "BLOCK", violations: [] }, 0).attempt, 1);
  assert.equal(buildRecoveryPlan({}, { decision: "BLOCK", violations: [] }, 99).attempt, 3);
});

test("duplicate invalid resources are deduplicated", () => {
  const plan = buildRecoveryPlan(
    { proposedActions: [{ resource: "header" }, { resource: "auth" }] },
    {
      decision: "BLOCK",
      violations: [
        { ruleId: "EXE-002", evidence: "frozen_element:header" },
        { ruleId: "EXE-001", evidence: "resource_outside_authorized_scope:header" }
      ]
    },
    1
  );
  assert.deepEqual(plan.invalidResources, ["header"]);
  assert.deepEqual(plan.preserve.resources, ["auth"]);
});


test("identical recovery candidate is a replay and does not consume an attempt", () => {
  const result = resolveRecoveryAttempt({
    id: "11111111-1111-1111-1111-111111111111",
    project_id: null,
    phase: "CORRECT",
    attempt: 2,
    last_request_fingerprint: "same",
    closed_at: null
  }, "same", null);

  assert.deepEqual(result, { attempt: 2, replayed: true });
});

test("corrected recovery candidate advances exactly one attempt", () => {
  const result = resolveRecoveryAttempt({
    id: "11111111-1111-1111-1111-111111111111",
    project_id: "22222222-2222-2222-2222-222222222222",
    phase: "CORRECT",
    attempt: 1,
    last_request_fingerprint: "old",
    closed_at: null
  }, "new", "22222222-2222-2222-2222-222222222222");

  assert.deepEqual(result, { attempt: 2, replayed: false });
});

test("recovery attempt progression is capped at three", () => {
  const result = resolveRecoveryAttempt({
    id: "11111111-1111-1111-1111-111111111111",
    project_id: null,
    phase: "CORRECT",
    attempt: 3,
    last_request_fingerprint: "old",
    closed_at: null
  }, "new", null);

  assert.deepEqual(result, { attempt: 3, replayed: false });
});

test("closed recovery sessions cannot be reused", () => {
  assert.throws(
    () => resolveRecoveryAttempt({
      id: "11111111-1111-1111-1111-111111111111",
      project_id: null,
      phase: "ALLOW",
      attempt: 2,
      last_request_fingerprint: "old",
      closed_at: "2026-09-23T00:00:00Z"
    }, "new", null),
    (error) => {
      assert.equal(error.code, "RECOVERY_SESSION_CLOSED");
      assert.equal(error.phase, "ALLOW");
      return true;
    }
  );
});

test("recovery session cannot cross project boundaries", () => {
  assert.throws(
    () => resolveRecoveryAttempt({
      id: "11111111-1111-1111-1111-111111111111",
      project_id: "22222222-2222-2222-2222-222222222222",
      phase: "CORRECT",
      attempt: 1,
      last_request_fingerprint: "old",
      closed_at: null
    }, "new", "33333333-3333-3333-3333-333333333333"),
    (error) => {
      assert.equal(error.code, "RECOVERY_PROJECT_MISMATCH");
      assert.equal(error.sessionProject, "22222222-2222-2222-2222-222222222222");
      assert.equal(error.candidateProject, "33333333-3333-3333-3333-333333333333");
      return true;
    }
  );
});


test("recovery phase constants and retry limit are exact", () => {
  assert.deepEqual(RECOVERY_PHASES, {
    CORRECT: "CORRECT",
    ALLOW: "ALLOW",
    SAFE_STOP: "SAFE_STOP"
  });
  assert.equal(Object.isFrozen(RECOVERY_PHASES), true);
  assert.equal(RECOVERY_MAX_ATTEMPTS, 3);
});

const instructionCases = [
  ["EXE-001", "resource_outside_authorized_scope:header", "Remove only the action outside the authorized scope. Preserve authorized actions."],
  ["EXE-002", "frozen_element:header", "Revert or omit the change to the frozen element. Preserve that element exactly as previously approved."],
  ["EXE-008", "destructive_action_without_authorization:db", "Omit the destructive action unless explicit authorization exists. Preserve non-destructive authorized work."],
  ["EXE-006", "unmet_success_criteria:tests", "Continue the required work and do not claim completion until every applicable success criterion is satisfied."],
  ["EXE-007", "partial_presented_as_complete", "Continue the required work and do not claim completion until every applicable success criterion is satisfied."],
  ["EVD-002", "invented_source", "Replace only the unsupported or unconfirmed item with verified evidence. Preserve already verified items."],
  ["EVD-003", "unconfirmed_precedent", "Replace only the unsupported or unconfirmed item with verified evidence. Preserve already verified items."],
  ["EVD-007", "test_claim_without_proof", "Remove the unproven execution/research/test claim or obtain the missing proof before making that claim."],
  ["DOC-001", "full_read_claim_without_full_coverage", "Complete the document coverage before claiming full reading, or accurately state that coverage is partial."],
  ["COD-005", "correction_delivered_without_available_test", "Run the available validation/test and keep the correction unclaimed until execution evidence exists."],
  ["COD-007", "correction_claim_without_execution_or_validation_proof", "Run the available validation/test and keep the correction unclaimed until execution evidence exists."],
  ["MEM-003", "unresolvedMemoryConflict", "Correct only the conflicting or invalid memory use while preserving valid current account/project memory."],
  ["CTX-002", "constraintsLost", "Restore the original task context, restrictions and approved decisions without changing unrelated work."],
  ["DOC-004", "oldVersionUsed", "Correct only the document-specific defect using the requested/current document and preserve valid document work."],
  ["COD-002", "unrequestedRefactor", "Correct only the evidenced software defect and preserve unaffected files, behavior and approved functionality."],
  ["RES-001", "genericResponseDespiteContext", "Revise only the defective response portion while preserving valid, specific and supported content."],
  ["EVD-004", "unverifiedNumberOrCalculation", "Correct only the unsupported factual/evidentiary claim and preserve supported material."],
  ["BEH-004", "overconfidenceUnderUncertainty", "Regenerate only the affected reasoning/response behavior using the user's actual instruction and available evidence."],
  ["PLG-001", "ruleConflict", "Resolve the plugin-control conflict without inventing or expanding blocking rules."],
  ["UNKNOWN-1", "unknown", "Correct only the evidenced violation and preserve all non-violating content and actions."]
];

for (const [ruleId, evidence, expectedInstruction] of instructionCases) {
  test(`recovery instruction for ${ruleId} is exact and surgical`, () => {
    const plan = buildRecoveryPlan(
      {},
      { decision: "BLOCK", violations: [{ ruleId, evidence }] },
      1
    );
    assert.equal(plan.corrections.length, 1);
    assert.deepEqual(plan.corrections[0], {
      ruleId,
      evidence,
      instruction: expectedInstruction
    });
  });
}

test("all three resource evidence prefixes are extracted and deduplicated", () => {
  const plan = buildRecoveryPlan(
    {
      proposedActions: [
        { resource: "header" },
        { resource: "db" },
        { resource: "css" },
        { resource: "auth" },
        { resource: "auth" }
      ]
    },
    {
      decision: "BLOCK",
      violations: [
        { ruleId: "EXE-001", evidence: "resource_outside_authorized_scope:css" },
        { ruleId: "EXE-002", evidence: "frozen_element:header" },
        { ruleId: "EXE-008", evidence: "destructive_action_without_authorization:db" },
        { ruleId: "RES-001", evidence: "not_a_resource" }
      ]
    },
    1
  );

  assert.deepEqual(plan.invalidResources, ["css", "header", "db"]);
  assert.deepEqual(plan.preserve.resources, ["auth"]);
});

test("non-array actions and violations are normalized safely", () => {
  const plan = buildRecoveryPlan(
    { proposedActions: "invalid" },
    { decision: "BLOCK", violations: "invalid" },
    "invalid"
  );
  assert.equal(plan.attempt, 1);
  assert.deepEqual(plan.invalidResources, []);
  assert.deepEqual(plan.preserve.resources, []);
  assert.deepEqual(plan.corrections, []);
  assert.deepEqual(plan.unresolvedViolations, []);
  assert.equal(plan.phase, "CORRECT");
  assert.equal(plan.nextAttempt, 2);
});

test("ALLOW envelope is exact at the maximum normalized attempt", () => {
  const plan = buildRecoveryPlan(
    {
      proposedActions: [
        { resource: "auth" },
        { resource: "" },
        {},
        { resource: "auth" }
      ]
    },
    { decision: "ALLOW", violations: [{ ruleId: "IGNORED", evidence: "ignored" }] },
    99
  );

  assert.deepEqual(plan, {
    phase: "ALLOW",
    canExecute: true,
    attempt: 3,
    maxAttempts: 3,
    nextAttempt: null,
    invalidResources: [],
    preserve: {
      resources: ["auth"],
      instruction: "Preserve the validated candidate exactly through execution."
    },
    corrections: [],
    unresolvedViolations: []
  });
});

test("CORRECT envelope preserves exact unresolved violations and directive", () => {
  const violations = [
    { ruleId: "RES-001", evidence: "generic" },
    { ruleId: "EVD-004", evidence: "number" }
  ];
  const plan = buildRecoveryPlan({}, { decision: "BLOCK", violations }, 2);

  assert.equal(plan.phase, "CORRECT");
  assert.equal(plan.canExecute, false);
  assert.equal(plan.attempt, 2);
  assert.equal(plan.maxAttempts, 3);
  assert.equal(plan.nextAttempt, 3);
  assert.deepEqual(plan.unresolvedViolations, violations);
  assert.equal(
    plan.preserve.instruction,
    "Preserve all validated content, decisions and actions not implicated by the listed violations."
  );
  assert.equal(
    plan.correctionDirective,
    "Correct only the listed violations, preserve everything else that is valid, then submit the corrected candidate for recheck using the same recoverySessionId."
  );
});

test("SAFE_STOP envelope is exact on the third blocked candidate", () => {
  const violation = { ruleId: "EVD-007", evidence: "execution_claim_without_proof" };
  const plan = buildRecoveryPlan({}, { decision: "BLOCK", violations: [violation] }, 3);

  assert.equal(plan.phase, "SAFE_STOP");
  assert.equal(plan.canExecute, false);
  assert.equal(plan.attempt, 3);
  assert.equal(plan.maxAttempts, 3);
  assert.equal(plan.nextAttempt, null);
  assert.deepEqual(plan.unresolvedViolations, [violation]);
  assert.equal(
    plan.correctionDirective,
    "Stop automatic retries. Do not claim completion. Return the unresolved canonical violations and the evidence still required."
  );
});

test("closed_at alone closes a CORRECT session", () => {
  assert.throws(
    () => resolveRecoveryAttempt({
      id: "11111111-1111-1111-1111-111111111111",
      project_id: null,
      phase: "CORRECT",
      attempt: 1,
      last_request_fingerprint: "old",
      closed_at: "2026-09-23T00:00:00Z"
    }, "new", null),
    (error) => error.code === "RECOVERY_SESSION_CLOSED"
  );
});

test("ALLOW phase closes a session even without closed_at", () => {
  assert.throws(
    () => resolveRecoveryAttempt({
      id: "11111111-1111-1111-1111-111111111111",
      project_id: null,
      phase: "ALLOW",
      attempt: 1,
      last_request_fingerprint: "old",
      closed_at: null
    }, "new", null),
    (error) => error.code === "RECOVERY_SESSION_CLOSED" && error.phase === "ALLOW"
  );
});

test("SAFE_STOP phase closes a session even without closed_at", () => {
  assert.throws(
    () => resolveRecoveryAttempt({
      id: "11111111-1111-1111-1111-111111111111",
      project_id: null,
      phase: "SAFE_STOP",
      attempt: 3,
      last_request_fingerprint: "old",
      closed_at: null
    }, "new", null),
    (error) => error.code === "RECOVERY_SESSION_CLOSED" && error.phase === "SAFE_STOP"
  );
});

test("missing session starts at attempt one", () => {
  assert.deepEqual(resolveRecoveryAttempt(null, "any", null), {
    attempt: 1,
    replayed: false
  });
});
