import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, PERMISSIONS, can, assertPermission } from "../src/rbac.mjs";
import {
  FEATURE_CATALOG,
  isFeatureEnabled,
  resolveFeatures,
  validateFeatureChange
} from "../src/feature-catalog.mjs";
import { buildInternalErrorReport, sanitizeErrorContext } from "../src/internal-errors.mjs";

test("RBAC owner has every declared permission", () => {
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(can(ROLES.OWNER, permission), true, permission);
  }
});

test("RBAC admin cannot manage the instance owner boundary", () => {
  assert.equal(can(ROLES.ADMIN, PERMISSIONS.INSTANCE_MANAGE), false);
  assert.throws(
    () => assertPermission(ROLES.ADMIN, PERMISSIONS.INSTANCE_MANAGE),
    (error) => error.code === "PERMISSION_DENIED"
  );
});

test("RBAC manager cannot manage feature flags or read error history", () => {
  assert.equal(can(ROLES.MANAGER, PERMISSIONS.FEATURES_MANAGE), false);
  assert.equal(can(ROLES.MANAGER, PERMISSIONS.ERRORS_READ), false);
  assert.equal(can(ROLES.MANAGER, PERMISSIONS.ERRORS_REPORT), true);
});

test("required internal controls cannot be disabled by feature flags", () => {
  for (const feature of FEATURE_CATALOG.filter((item) => item.required)) {
    assert.throws(
      () => validateFeatureChange(feature.key, false),
      (error) => error.code === "REQUIRED_FEATURE"
    );
    assert.equal(isFeatureEnabled(feature.key, [{ feature_key: feature.key, enabled: false }]), true);
  }
});

test("optional feature flags are account overrides", () => {
  const features = resolveFeatures([
    { feature_key: "semantic_signals", enabled: false }
  ]);
  assert.equal(features.find((item) => item.key === "semantic_signals").enabled, false);
  assert.equal(features.find((item) => item.key === "core_blocking").enabled, true);
});

test("internal error reports redact secrets and hash stack data", () => {
  const error = new Error("boom");
  error.code = "E_TEST";
  const report = buildInternalErrorReport({
    error,
    source: "unit_test",
    context: {
      token: "should-not-appear",
      nested: { authorization: "Bearer secret", safe: "ok" }
    }
  });

  assert.equal(report.context.token, "[redacted]");
  assert.equal(report.context.nested.authorization, "[redacted]");
  assert.equal(report.context.nested.safe, "ok");
  assert.match(report.stackFingerprint, /^[a-f0-9]{64}$/);
});

test("sanitizer truncates deep data rather than expanding indefinitely", () => {
  const value = { a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } };
  const sanitized = sanitizeErrorContext(value);
  assert.equal(sanitized.a.b.c.d.e.f, "[truncated]");
});
