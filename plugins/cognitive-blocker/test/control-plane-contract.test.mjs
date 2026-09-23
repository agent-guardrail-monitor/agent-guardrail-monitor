import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  PERMISSIONS,
  can,
  assertPermission,
  normalizeRole,
  permissionMatrix
} from "../src/rbac.mjs";
import {
  FEATURE_CATALOG,
  FEATURE_MAP,
  isFeatureEnabled,
  resolveFeatures,
  validateFeatureChange
} from "../src/feature-catalog.mjs";
import {
  buildInternalErrorReport,
  sanitizeErrorContext
} from "../src/internal-errors.mjs";

const EXPECTED_ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  CLIENT: "CLIENT"
};

const EXPECTED_PERMISSIONS = {
  STATUS_READ: "status.read",
  GUARD_CHECK: "guard.check",
  MEMORY_READ: "memory.read",
  MEMORY_WRITE: "memory.write",
  FEATURES_READ: "features.read",
  FEATURES_MANAGE: "features.manage",
  ERRORS_REPORT: "errors.report",
  ERRORS_READ: "errors.read",
  AUDIT_READ: "audit.read",
  INSTANCE_MANAGE: "instance.manage"
};

const EXPECTED_MATRIX = {
  OWNER: [
    "audit.read",
    "errors.read",
    "errors.report",
    "features.manage",
    "features.read",
    "guard.check",
    "instance.manage",
    "memory.read",
    "memory.write",
    "status.read"
  ],
  ADMIN: [
    "audit.read",
    "errors.read",
    "errors.report",
    "features.manage",
    "features.read",
    "guard.check",
    "memory.read",
    "memory.write",
    "status.read"
  ],
  MANAGER: [
    "errors.report",
    "features.read",
    "guard.check",
    "memory.read",
    "memory.write",
    "status.read"
  ],
  CLIENT: [
    "errors.report",
    "features.read",
    "guard.check",
    "memory.read",
    "status.read"
  ]
};

const EXPECTED_FEATURES = [
  { key: "core_blocking", required: true, defaultEnabled: true },
  { key: "tenant_isolation", required: true, defaultEnabled: true },
  { key: "rbac", required: true, defaultEnabled: true },
  { key: "database_rls", required: true, defaultEnabled: true },
  { key: "cognitive_memory", required: true, defaultEnabled: true },
  { key: "semantic_signals", required: false, defaultEnabled: true },
  { key: "guard_event_history", required: false, defaultEnabled: true },
  { key: "internal_error_reporting", required: false, defaultEnabled: true }
];

test("RBAC public constants are exact immutable contracts", () => {
  assert.deepEqual(ROLES, EXPECTED_ROLES);
  assert.deepEqual(PERMISSIONS, EXPECTED_PERMISSIONS);
  assert.equal(Object.isFrozen(ROLES), true);
  assert.equal(Object.isFrozen(PERMISSIONS), true);
});

test("RBAC permission matrix is exact for every role", () => {
  assert.deepEqual(permissionMatrix(), EXPECTED_MATRIX);

  for (const [role, allowed] of Object.entries(EXPECTED_MATRIX)) {
    for (const permission of Object.values(EXPECTED_PERMISSIONS)) {
      assert.equal(can(role, permission), allowed.includes(permission), role + ":" + permission);
    }
  }
});

test("role normalization is case-insensitive and unknown roles fall back to CLIENT", () => {
  assert.equal(normalizeRole("owner"), "OWNER");
  assert.equal(normalizeRole("AdMiN"), "ADMIN");
  assert.equal(normalizeRole("manager"), "MANAGER");
  assert.equal(normalizeRole("client"), "CLIENT");
  assert.equal(normalizeRole("unknown"), "CLIENT");
  assert.equal(normalizeRole(null), "CLIENT");
  assert.equal(normalizeRole(undefined), "CLIENT");
});

test("permission assertion has exact allow, deny and unknown behavior", () => {
  assert.equal(assertPermission("OWNER", "instance.manage"), true);

  assert.throws(
    () => assertPermission("CLIENT", "memory.write"),
    (error) => {
      assert.equal(error.message, "permission_denied");
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.permission, "memory.write");
      assert.equal(error.role, "CLIENT");
      return true;
    }
  );

  assert.throws(
    () => assertPermission("OWNER", "made.up"),
    (error) => {
      assert.equal(error.message, "unknown_permission");
      assert.equal(error.code, "UNKNOWN_PERMISSION");
      return true;
    }
  );
});

test("feature catalog is an exact frozen product contract", () => {
  assert.deepEqual(FEATURE_CATALOG, EXPECTED_FEATURES);
  assert.equal(Object.isFrozen(FEATURE_CATALOG), true);
  for (const feature of FEATURE_CATALOG) {
    assert.equal(Object.isFrozen(feature), true);
    assert.equal(FEATURE_MAP.get(feature.key), feature);
  }
  assert.deepEqual([...FEATURE_MAP.keys()], EXPECTED_FEATURES.map((feature) => feature.key));
});

test("feature resolution preserves required controls and exact optional overrides", () => {
  const defaults = resolveFeatures();
  assert.deepEqual(
    defaults.map(({ key, enabled }) => ({ key, enabled })),
    EXPECTED_FEATURES.map(({ key, defaultEnabled }) => ({ key, enabled: defaultEnabled }))
  );

  const resolved = resolveFeatures([
    { feature_key: "core_blocking", enabled: false },
    { feature_key: "semantic_signals", enabled: false },
    { key: "guard_event_history", enabled: 0 },
    { feature_key: "internal_error_reporting", enabled: 1 },
    { feature_key: "unknown_feature", enabled: false }
  ]);

  assert.equal(resolved.find((f) => f.key === "core_blocking").enabled, true);
  assert.equal(resolved.find((f) => f.key === "semantic_signals").enabled, false);
  assert.equal(resolved.find((f) => f.key === "guard_event_history").enabled, false);
  assert.equal(resolved.find((f) => f.key === "internal_error_reporting").enabled, true);
  assert.equal(resolved.length, EXPECTED_FEATURES.length);
});

test("feature enabled lookup handles required, optional, defaults and unknown keys", () => {
  assert.equal(isFeatureEnabled("core_blocking", [{ feature_key: "core_blocking", enabled: false }]), true);
  assert.equal(isFeatureEnabled("semantic_signals"), true);
  assert.equal(isFeatureEnabled("semantic_signals", [{ feature_key: "semantic_signals", enabled: false }]), false);
  assert.equal(isFeatureEnabled("guard_event_history", [{ key: "guard_event_history", enabled: 0 }]), false);
  assert.equal(isFeatureEnabled("does_not_exist"), false);
});

test("feature change validation returns exact states and exact errors", () => {
  const optionalOff = validateFeatureChange("semantic_signals", false);
  assert.equal(optionalOff.feature.key, "semantic_signals");
  assert.equal(optionalOff.enabled, false);

  const requiredOn = validateFeatureChange("core_blocking", true);
  assert.equal(requiredOn.feature.key, "core_blocking");
  assert.equal(requiredOn.enabled, true);

  assert.throws(
    () => validateFeatureChange("core_blocking", false),
    (error) => {
      assert.equal(error.message, "required_feature_cannot_be_disabled");
      assert.equal(error.code, "REQUIRED_FEATURE");
      assert.equal(error.feature, "core_blocking");
      return true;
    }
  );

  assert.throws(
    () => validateFeatureChange("no_such_feature", true),
    (error) => {
      assert.equal(error.message, "unknown_feature");
      assert.equal(error.code, "UNKNOWN_FEATURE");
      assert.equal(error.feature, "no_such_feature");
      return true;
    }
  );
});

test("error sanitizer preserves primitives, bounds arrays/objects and redacts secret-like keys", () => {
  assert.equal(sanitizeErrorContext(null), null);
  assert.equal(sanitizeErrorContext(42), 42);
  assert.equal(sanitizeErrorContext("ok"), "ok");

  const long = "x".repeat(5000);
  const shortened = sanitizeErrorContext(long);
  assert.equal(shortened.length, 4001);
  assert.equal(shortened.endsWith("…"), true);

  const array = sanitizeErrorContext(Array.from({ length: 80 }, (_, i) => i));
  assert.equal(array.length, 50);

  const object = Object.fromEntries(Array.from({ length: 120 }, (_, i) => ["k" + i, i]));
  assert.equal(Object.keys(sanitizeErrorContext(object)).length, 100);

  const secrets = sanitizeErrorContext({
    token: "a",
    accessSecret: "b",
    password: "c",
    authorization: "d",
    cookie: "e",
    api_key: "f",
    "private-key": "g",
    safe: "visible"
  });

  for (const key of ["token","accessSecret","password","authorization","cookie","api_key","private-key"]) {
    assert.equal(secrets[key], "[redacted]");
  }
  assert.equal(secrets.safe, "visible");
});

test("error report defaults are exact", () => {
  assert.deepEqual(buildInternalErrorReport(), {
    source: "internal",
    errorCode: "UNCLASSIFIED",
    message: "Internal error",
    context: {},
    stackFingerprint: null,
    requestFingerprint: null,
    projectId: null
  });
});

test("error report uses Error fallbacks and hashes the stack with SHA-256", () => {
  const error = new Error("boom");
  error.code = "E_BOOM";
  const report = buildInternalErrorReport({ error });

  assert.equal(report.source, "internal");
  assert.equal(report.errorCode, "E_BOOM");
  assert.equal(report.message, "boom");
  assert.equal(report.stackFingerprint, crypto.createHash("sha256").update(error.stack).digest("hex"));
});

test("explicit error-report fields override fallbacks and respect field bounds", () => {
  const error = new Error("fallback");
  error.code = "E_FALLBACK";
  const projectId = "project-1";
  const report = buildInternalErrorReport({
    error,
    source: "s".repeat(200),
    errorCode: "C".repeat(200),
    message: "m".repeat(3000),
    requestFingerprint: "r".repeat(400),
    projectId,
    context: { password: "hidden", safe: "yes" }
  });

  assert.equal(report.source.length, 120);
  assert.equal(report.errorCode.length, 120);
  assert.equal(report.message.length, 2000);
  assert.equal(report.requestFingerprint.length, 256);
  assert.equal(report.projectId, projectId);
  assert.equal(report.context.password, "[redacted]");
  assert.equal(report.context.safe, "yes");
});
