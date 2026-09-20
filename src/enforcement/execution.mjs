import fs from "node:fs";
import crypto from "node:crypto";
import { hashObject } from "./policy.mjs";

function fileSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readPath(value, dotted) {
  let current = value;
  for (const part of String(dotted || "").split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export function createExecutionReceipt({ action, decision, toolResult = null }) {
  return {
    receiptVersion: 1,
    actionId: action?.id || null,
    tool: action?.tool || null,
    requestFingerprint: hashObject({ kind: action?.kind, tool: action?.tool, args: action?.args }),
    policyDecision: decision?.decision || null,
    policyHash: decision?.policyHash || null,
    startedAt: action?.startedAt || null,
    completedAt: new Date().toISOString(),
    toolResultFingerprint: toolResult == null ? null : hashObject(toolResult)
  };
}

export function verifyProof(proof) {
  if (!proof || typeof proof !== "object") {
    return { status: "UNKNOWN", code: "PROOF_MISSING", evidence: null };
  }

  try {
    if (proof.type === "file_hash") {
      if (!proof.path || !proof.sha256) return { status: "UNKNOWN", code: "PROOF_INCOMPLETE", evidence: null };
      if (!fs.existsSync(proof.path)) return { status: "CONTRADICTED", code: "FILE_MISSING", evidence: proof.path };
      const actual = fileSha256(proof.path);
      return actual === proof.sha256
        ? { status: "VERIFIED", code: "FILE_HASH_MATCH", evidence: actual }
        : { status: "CONTRADICTED", code: "FILE_HASH_MISMATCH", evidence: actual };
    }

    if (proof.type === "json_value") {
      if (!proof.path || !proof.field) return { status: "UNKNOWN", code: "PROOF_INCOMPLETE", evidence: null };
      if (!fs.existsSync(proof.path)) return { status: "CONTRADICTED", code: "FILE_MISSING", evidence: proof.path };
      const value = JSON.parse(fs.readFileSync(proof.path, "utf8"));
      const actual = readPath(value, proof.field);
      return Object.is(actual, proof.expected)
        ? { status: "VERIFIED", code: "JSON_VALUE_MATCH", evidence: hashObject(actual) }
        : { status: "CONTRADICTED", code: "JSON_VALUE_MISMATCH", evidence: hashObject(actual) };
    }

    if (proof.type === "adapter_receipt") {
      if (proof.verifiedByAdapter === true && proof.receiptId && proof.verificationEvidence) {
        return { status: "SUPPORTED", code: "ADAPTER_VERIFIED", evidence: hashObject(proof.verificationEvidence) };
      }
      return { status: "UNKNOWN", code: "ADAPTER_PROOF_UNVERIFIED", evidence: null };
    }
  } catch (error) {
    return { status: "UNKNOWN", code: "PROOF_CHECK_ERROR", evidence: String(error.message || error) };
  }

  return { status: "UNKNOWN", code: "UNSUPPORTED_PROOF_TYPE", evidence: null };
}

export function completionStatus({ proofRequired = true, proof }) {
  if (!proofRequired) return { status: "SUPPORTED", code: "PROOF_NOT_REQUIRED" };
  return verifyProof(proof);
}
