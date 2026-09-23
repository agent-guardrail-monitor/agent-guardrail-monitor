import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecoveryPlan,
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
