import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGuardianSignals } from "../src/semantic-guardian.mjs";

test("semantic guardian keeps only canonical rule IDs with bounded evidence", () => {
  const result = normalizeGuardianSignals({
    signals: [
      { ruleId: "RES-001", confidence: 0.91, evidence: "generic despite specific context" },
      { ruleId: "FAKE-999", confidence: 1, evidence: "invented" },
      { ruleId: "EVD-002", confidence: 2, evidence: "invalid confidence" },
      { ruleId: "BEH-001", confidence: 0.7, evidence: "" }
    ]
  });
  assert.deepEqual(result, [{
    ruleId: "RES-001",
    confidence: 0.91,
    evidence: "generic despite specific context"
  }]);
});

test("semantic guardian never invents a signal from malformed output", () => {
  assert.deepEqual(normalizeGuardianSignals(null), []);
  assert.deepEqual(normalizeGuardianSignals({ signals: "bad" }), []);
});
