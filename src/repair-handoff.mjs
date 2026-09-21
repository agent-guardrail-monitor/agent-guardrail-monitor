import fs from "node:fs";
import path from "node:path";
import { PRODUCT_VERSION } from "./core.mjs";

export const REPAIR_HANDOFF_SCHEMA_VERSION = 1;

function compact(value, max = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function regressionEvidence(item) {
  const runtime = compact(item?.runtime || "unknown", 80);
  const code = compact(item?.code || "REGRESSION", 120);
  const message = compact(item?.message || "", 1200);
  return message ? `[${runtime}] ${code}: ${message}` : `[${runtime}] ${code}`;
}

function findingEvidence(item) {
  if (item?.severity !== "FAIL") return null;
  const runtime = compact(item.runtime || "unknown", 80);
  const code = compact(item.code || "FAIL_FINDING", 120);
  const message = compact(item.message || "", 1200);
  return message ? `[${runtime}] ${code}: ${message}` : `[${runtime}] ${code}`;
}

function proofEvidence(item) {
  if (item?.status !== "FAIL") return null;
  const runtime = compact(item.runtime || "unknown", 80);
  const reason = compact(item.reason || "runtime proof failed", 1200);
  return `[${runtime}] RUNTIME_PROOF_FAIL: ${reason}`;
}

export function buildRepairHandoff({
  regressions = [],
  findings = [],
  proofs = [],
  context = {}
} = {}) {
  const failureEvidence = unique([
    ...regressions.map(regressionEvidence),
    ...findings.map(findingEvidence),
    ...proofs.map(proofEvidence)
  ]);

  const repairRequired = failureEvidence.length > 0;
  const cwd = compact(context.cwd || "", 500) || null;
  const baselineGeneratedAt = compact(context.baselineGeneratedAt || "", 80) || null;
  const currentGeneratedAt = compact(context.currentGeneratedAt || "", 80) || null;

  return {
    schemaVersion: REPAIR_HANDOFF_SCHEMA_VERSION,
    kind: "AGM_TO_SRE_REPAIR_HANDOFF",
    producer: {
      name: "Agent Guardrail Monitor",
      version: PRODUCT_VERSION
    },

    consumer: {
      name: "Software Repair Engineer",
      interface: "sre_preflight"
    },
    status: repairRequired ? "REPAIR_REQUIRED" : "NO_REPAIR_REQUIRED",
    createdAt: new Date().toISOString(),
    rootCauseState: "UNKNOWN",
    context: {
      cwd,
      baselineGeneratedAt,
      currentGeneratedAt
    },
    repairRequest: {
      objective: compact(
        context.objective ||
        "Diagnose and repair the guardrail regression detected by Agent Guardrail Monitor, then provide executable post-patch verification evidence.",
        3000
      ),
      systemKind: compact(context.systemKind || "coding-agent guardrail", 120),
      failureEvidence,
      changedFiles: [],
      checksRun: [{
        name: "Agent Guardrail Monitor regression gate",
        phase: "detection",
        status: repairRequired ? "failed" : "passed",
        evidence: repairRequired
          ? `${failureEvidence.length} regression/failure evidence item(s) captured.`
          : "No repair-triggering failure evidence was captured."
      }],

      recurrenceReviewed: false,
      deploymentInScope: false,
      deploymentVerified: false
    },
    verification: {
      requiredAfterRepair: repairRequired,
      owner: "Agent Guardrail Monitor",
      criteria: [
        "The original regression evidence is no longer reproduced.",
        "The Agent Guardrail Monitor gate returns PASS against the approved baseline.",
        "Runtime proof returns PASS when that proof surface is available and required."
      ]
    }
  };
}

export function saveRepairHandoff(handoff, file) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(handoff, null, 2) + "\n", "utf8");
  return target;
}