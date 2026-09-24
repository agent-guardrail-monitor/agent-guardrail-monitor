import test from "node:test";
import assert from "node:assert/strict";
import { RULE_CATALOG } from "../src/rule-catalog.mjs";
import { evaluateGuard } from "../src/engine.mjs";

test("canonical catalog is fixed at 59 unique rules", () => {
  assert.equal(RULE_CATALOG.length, 59);
  assert.equal(new Set(RULE_CATALOG.map((r) => r.id)).size, 59);
});

test("blocks modification outside authorized scope and frozen elements", () => {
  const result = evaluateGuard({
    task: { authorizedResources: ["auth"], frozenElements: ["header"] },
    proposedActions: [
      { resource: "header" },
      { resource: "global-css" }
    ]
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.violations.some((v) => v.ruleId === "EXE-002"));
  assert.ok(result.violations.some((v) => v.ruleId === "EXE-001"));
});

test("blocks false execution claims", () => {
  const result = evaluateGuard({ evidence: { claimedExecuted: true } });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.violations.some((v) => v.ruleId === "EVD-007"));
});

test("blocks completion with unmet success criteria", () => {
  const result = evaluateGuard({
    completionClaimed: true,
    task: { unmetSuccessCriteria: ["tests pass"] }
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.violations.some((v) => v.ruleId === "EXE-006"));
});

test("ignores unknown or weak semantic signals", () => {
  const result = evaluateGuard({
    semanticSignals: [
      { ruleId: "NEW-999", confidence: 1, evidence: "invented" },
      { ruleId: "BEH-001", confidence: 0.4, evidence: "weak" }
    ]
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.ignoredSignals.length, 2);
});

test("blocks strong semantic evidence only for canonical rules", () => {
  const result = evaluateGuard({
    semanticSignals: [
      { ruleId: "RES-001", confidence: 0.95, evidence: "specific context existed but answer stayed generic" }
    ]
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.violations.some((v) => v.ruleId === "RES-001"));
});

test("allows normal behavior when no canonical blocker is evidenced", () => {
  const result = evaluateGuard({
    task: { authorizedResources: ["auth"] },
    proposedActions: [{ resource: "auth", destructive: false }]
  });
  assert.equal(result.decision, "ALLOW");
});
