import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hashObject } from "./policy.mjs";

const SECRET_KEY = /(password|secret|token|api.?key|private.?key|authorization|cookie|credential)/i;
const COMMAND_KEY = /^(command|cmd|script|powershell|bash)$/i;

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function redact(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (COMMAND_KEY.test(key) && typeof value === "string") return { fingerprint: digest(value) };
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
}

export class AuditLog {
  constructor(file) {
    this.file = path.resolve(file);
  }

  entries() {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }

  append(event) {
    const entries = this.entries();
    const previousHash = entries.length ? entries[entries.length - 1].eventHash : null;
    const base = {
      auditVersion: 1,
      at: new Date().toISOString(),
      previousHash,
      event: redact(event)
    };
    const entry = { ...base, eventHash: hashObject(base) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
    return entry;
  }

  verify() {
    let previousHash = null;
    let index = 0;
    try {
      for (const entry of this.entries()) {
        const expected = hashObject({
          auditVersion: entry.auditVersion,
          at: entry.at,
          previousHash,
          event: entry.event
        });
        if (entry.previousHash !== previousHash || entry.eventHash !== expected) {
          return { valid: false, index, code: "AUDIT_TAMPER_DETECTED" };
        }
        previousHash = entry.eventHash;
        index += 1;
      }
      return { valid: true, count: index, head: previousHash };
    } catch (error) {
      return { valid: false, index, code: "AUDIT_PARSE_ERROR", error: String(error.message || error) };
    }
  }
}
