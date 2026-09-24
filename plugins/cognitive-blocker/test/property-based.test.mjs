import test from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { evaluateGuard } from "../src/engine.mjs";
import { RULE_IDS } from "../src/rule-catalog.mjs";
import { buildRecoveryPlan, resolveRecoveryAttempt } from "../src/recovery.mjs";
import { can, PERMISSIONS, ROLES } from "../src/rbac.mjs";
import {
  FEATURE_CATALOG,
  isFeatureEnabled,
  resolveFeatures
} from "../src/feature-catalog.mjs";

const FC_OPTIONS = Object.freeze({
  seed: 20260923,
  numRuns: 500,
  verbose: true
});

test("property: every canonical semantic rule blocks with sufficient evidence", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...RULE_IDS),
      fc.string({ minLength: 1, maxLength: 200 }),
      (ruleId, evidence) => {
        const result = evaluateGuard({
          semanticSignals: [{ ruleId, confidence: 0.95, evidence }]
        });
        assert.equal(result.decision, "BLOCK");
        assert.ok(result.violations.some((v) => v.ruleId === ruleId));
      }
    ),
    FC_OPTIONS
  );
});

test("property: weak semantic evidence never creates a block by itself", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...RULE_IDS),
      fc.integer({ min: 0, max: 79 }),
      fc.string({ minLength: 1, maxLength: 200 }),
      (ruleId, confidenceInt, evidence) => {
        const result = evaluateGuard({
          semanticSignals: [{
            ruleId,
            confidence: confidenceInt / 100,
            evidence
          }]
        });
        assert.equal(result.decision, "ALLOW");
        assert.equal(result.violationCount, 0);
      }
    ),
    FC_OPTIONS
  );
});

test("property: unknown rule IDs never become automatic rules", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.string({ minLength: 1, maxLength: 200 }),
      (id, evidence) => {
        const result = evaluateGuard({
          semanticSignals: [{
            ruleId: "UNKNOWN-" + id,
            confidence: 1,
            evidence
          }]
        });
        assert.equal(result.decision, "ALLOW");
        assert.equal(result.violationCount, 0);
        assert.ok(result.ignoredSignals.some((s) => s.reason === "not_in_canonical_ruleset"));
      }
    ),
    FC_OPTIONS
  );
});

test("property: destructive actions require explicit authorization", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 60 }),
      (resource) => {
        const result = evaluateGuard({
          proposedActions: [{ resource, destructive: true }]
        });
        assert.equal(result.decision, "BLOCK");
        assert.ok(result.violations.some((v) => v.ruleId === "EXE-008"));
      }
    ),
    FC_OPTIONS
  );
});

test("property: frozen resources always block proposed changes", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 60 }),
      (resource) => {
        const result = evaluateGuard({
          task: { frozenElements: [resource] },
          proposedActions: [{ resource, destructive: false }]
        });
        assert.equal(result.decision, "BLOCK");
        assert.ok(result.violations.some((v) => v.ruleId === "EXE-002"));
      }
    ),
    FC_OPTIONS
  );
});

test("property: owner permission set is a superset of every role permission", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...Object.values(ROLES)),
      fc.constantFrom(...Object.values(PERMISSIONS)),
      (role, permission) => {
        if (can(role, permission)) {
          assert.equal(can(ROLES.OWNER, permission), true);
        }
      }
    ),
    FC_OPTIONS
  );
});

test("property: required features cannot be disabled by account overrides", () => {
  const required = FEATURE_CATALOG.filter((f) => f.required).map((f) => f.key);
  fc.assert(
    fc.property(
      fc.constantFrom(...required),
      (key) => {
        const overrides = [{ feature_key: key, enabled: false }];
        assert.equal(isFeatureEnabled(key, overrides), true);
        const resolved = resolveFeatures(overrides);
        assert.equal(resolved.find((f) => f.key === key)?.enabled, true);
      }
    ),
    FC_OPTIONS
  );
});

test("property: optional feature flags preserve the explicit account value", () => {
  const optional = FEATURE_CATALOG.filter((f) => !f.required).map((f) => f.key);
  fc.assert(
    fc.property(
      fc.constantFrom(...optional),
      fc.boolean(),
      (key, enabled) => {
        const overrides = [{ feature_key: key, enabled }];
        assert.equal(isFeatureEnabled(key, overrides), enabled);
      }
    ),
    FC_OPTIONS
  );
});


test("property: blocked recovery attempts are always bounded to 1..3", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -1000, max: 1000 }),
      (attempt) => {
        const plan = buildRecoveryPlan(
          {},
          { decision: "BLOCK", violations: [{ ruleId: "RES-001", evidence: "generic" }] },
          attempt
        );
        assert.ok(plan.attempt >= 1 && plan.attempt <= 3);
        assert.equal(plan.phase === "SAFE_STOP", plan.attempt === 3);
        assert.equal(plan.canExecute, false);
      }
    ),
    FC_OPTIONS
  );
});

test("property: exact recovery replay never consumes another attempt", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 3 }),
      fc.string({ minLength: 1, maxLength: 80 }),
      (attempt, fingerprint) => {
        const state = resolveRecoveryAttempt({
          id: "11111111-1111-1111-1111-111111111111",
          project_id: null,
          phase: "CORRECT",
          attempt,
          last_request_fingerprint: fingerprint,
          closed_at: null
        }, fingerprint, null);

        assert.equal(state.attempt, attempt);
        assert.equal(state.replayed, true);
      }
    ),
    FC_OPTIONS
  );
});
