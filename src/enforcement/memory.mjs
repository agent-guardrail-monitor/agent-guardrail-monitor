import { hashObject } from "./policy.mjs";

function list(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function activeAt(record, now) {
  if ((record.status || "ACTIVE") !== "ACTIVE") return false;
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (record.validFrom && new Date(record.validFrom).getTime() > time) return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= time) return false;
  return true;
}

function scopeMatches(record, requestedScopes) {
  const scopes = list(record.scope);
  if (!scopes.length || scopes.includes("*")) return true;
  const wanted = new Set(list(requestedScopes));
  return scopes.some((scope) => wanted.has(scope));
}

function priority(record) {
  const p = record.priority;
  if (typeof p === "number") return p;
  return ({ CRITICAL: 400, HIGH: 300, NORMAL: 200, LOW: 100 }[String(p || "NORMAL").toUpperCase()] || 200);
}

export function resolveMemory(records = [], {
  scopes = [],
  requiredKeys = [],
  now = new Date()
} = {}) {
  const expired = [];
  const candidates = [];

  for (const record of records) {
    if ((record.status || "ACTIVE") !== "ACTIVE") continue;
    if (!activeAt(record, now)) {
      expired.push(record.id);
      continue;
    }
    if (!scopeMatches(record, scopes)) continue;
    candidates.push(record);
  }

  const byKey = new Map();
  for (const record of candidates) {
    const key = record.key || record.id;
    const bucket = byKey.get(key) || [];
    bucket.push(record);
    byKey.set(key, bucket);
  }

  const used = [];
  const conflicts = [];

  for (const [key, bucket] of byKey) {
    bucket.sort((a, b) => priority(b) - priority(a) || Number(b.version || 0) - Number(a.version || 0));
    const topPriority = priority(bucket[0]);
    const top = bucket.filter((item) => priority(item) === topPriority);
    const hashes = new Set(top.map((item) => hashObject(item.value)));
    if (hashes.size > 1) {
      conflicts.push({ key, recordIds: top.map((item) => item.id), reason: "equal-priority active memories disagree" });
      continue;
    }
    used.push(top[0]);
  }

  const present = new Set(used.map((record) => record.key || record.id));
  const missing = list(requiredKeys).filter((key) => !present.has(key));

  return {
    status: conflicts.length ? "CONFLICT" : missing.length ? "INCOMPLETE" : "RESOLVED",
    used,
    conflicts,
    missing,
    expired
  };
}
