import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairHandoff } from "../src/repair-handoff.mjs";

test("repair handoff maps AGM regressions to Software Repair Engineer preflight input", () => {
  const handoff = buildRepairHandoff({
    regressions: [{
      runtime: "claude",
      code: "PROOF_REGRESSION",
      message: "claude proof changed from PASS to FAIL."
    }],
    context: {
      cwd: "~/project",
      baselineGeneratedAt: "2026-09-20T10:00:00.000Z",
      currentGeneratedAt: "2026-09-21T10:00:00.000Z"
    }
  });

  assert.equal(handoff.status, "REPAIR_REQUIRED");
  assert.equal(handoff.rootCauseState, "UNKNOWN");
  assert.equal(handoff.consumer.name, "Software Repair Engineer");
  assert.equal(handoff.consumer.interface, "sre_preflight");
  assert.equal(handoff.repairRequest.failureEvidence.length, 1);
  assert.match(handoff.repairRequest.failureEvidence[0], /PROOF_REGRESSION/);
  assert.equal(handoff.repairRequest.checksRun[0].status, "failed");
  assert.equal(handoff.verification.requiredAfterRepair, true);
});

test("repair handoff remains non-actionable when AGM has no failure evidence", () => {
  const handoff = buildRepairHandoff();

  assert.equal(handoff.status, "NO_REPAIR_REQUIRED");
  assert.deepEqual(handoff.repairRequest.failureEvidence, []);
  assert.equal(handoff.repairRequest.checksRun[0].status, "passed");
  assert.equal(handoff.verification.requiredAfterRepair, false);
});

test("repair handoff deduplicates repeated failure evidence", () => {
  const failure = {
    severity: "FAIL",
    runtime: "copilot",
    code: "HOOKS_DISABLED",
    message: "Hooks are disabled."
  };
  const handoff = buildRepairHandoff({ findings: [failure, failure] });

  assert.equal(handoff.repairRequest.failureEvidence.length, 1);
});