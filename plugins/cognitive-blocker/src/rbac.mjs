export const ROLES = Object.freeze({
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  CLIENT: "CLIENT"
});

export const PERMISSIONS = Object.freeze({
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
});

const MATRIX = Object.freeze({
  OWNER: new Set(Object.values(PERMISSIONS)),
  ADMIN: new Set([
    PERMISSIONS.STATUS_READ,
    PERMISSIONS.GUARD_CHECK,
    PERMISSIONS.MEMORY_READ,
    PERMISSIONS.MEMORY_WRITE,
    PERMISSIONS.FEATURES_READ,
    PERMISSIONS.FEATURES_MANAGE,
    PERMISSIONS.ERRORS_REPORT,
    PERMISSIONS.ERRORS_READ,
    PERMISSIONS.AUDIT_READ
  ]),
  MANAGER: new Set([
    PERMISSIONS.STATUS_READ,
    PERMISSIONS.GUARD_CHECK,
    PERMISSIONS.MEMORY_READ,
    PERMISSIONS.MEMORY_WRITE,
    PERMISSIONS.FEATURES_READ,
    PERMISSIONS.ERRORS_REPORT
  ]),
  CLIENT: new Set([
    PERMISSIONS.STATUS_READ,
    PERMISSIONS.GUARD_CHECK,
    PERMISSIONS.MEMORY_READ,
    PERMISSIONS.FEATURES_READ,
    PERMISSIONS.ERRORS_REPORT
  ])
});

export function normalizeRole(role) {
  const value = String(role || "").toUpperCase();
  return Object.hasOwn(ROLES, value) ? ROLES[value] : ROLES.CLIENT;
}

export function can(role, permission) {
  const normalized = normalizeRole(role);
  return MATRIX[normalized]?.has(permission) === true;
}

export function assertPermission(role, permission) {
  if (!Object.values(PERMISSIONS).includes(permission)) {
    throw Object.assign(new Error("unknown_permission"), { code: "UNKNOWN_PERMISSION" });
  }
  if (!can(role, permission)) {
    throw Object.assign(new Error("permission_denied"), {
      code: "PERMISSION_DENIED",
      permission,
      role: normalizeRole(role)
    });
  }
  return true;
}

export function permissionMatrix() {
  return Object.fromEntries(
    Object.entries(MATRIX).map(([role, permissions]) => [role, [...permissions].sort()])
  );
}
