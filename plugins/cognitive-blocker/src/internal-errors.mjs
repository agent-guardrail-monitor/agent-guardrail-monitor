import crypto from "node:crypto";

const SECRET_KEYS = /token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key/i;

function sanitize(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 4000) return value.slice(0, 4000) + "…";
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    output[key] = SECRET_KEYS.test(key) ? "[redacted]" : sanitize(item, depth + 1);
  }
  return output;
}

export function buildInternalErrorReport(input = {}) {
  const error = input.error instanceof Error ? input.error : null;
  const stackFingerprint = error?.stack
    ? crypto.createHash("sha256").update(error.stack).digest("hex")
    : null;

  return {
    source: String(input.source || "internal").slice(0, 120),
    errorCode: String(input.errorCode || error?.code || "UNCLASSIFIED").slice(0, 120),
    message: String(input.message || error?.message || "Internal error").slice(0, 2000),
    context: sanitize(input.context || {}),
    stackFingerprint,
    requestFingerprint: input.requestFingerprint ? String(input.requestFingerprint).slice(0, 256) : null,
    projectId: input.projectId || null
  };
}

export function sanitizeErrorContext(value) {
  return sanitize(value);
}
