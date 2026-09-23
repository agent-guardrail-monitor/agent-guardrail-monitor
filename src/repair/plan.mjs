const MAX_FILES = 8;
const MAX_FILE_BYTES = 200_000;

function cleanPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

function blockedPath(path) {
  if (!path || path.startsWith("/") || path.includes("../")) return true;
  if (path === ".git" || path.startsWith(".git/")) return true;
  if (path.startsWith(".github/workflows/")) return true;
  return false;
}

export function validateRepairPlan(plan, { allowedPaths = null } = {}) {
  const errors = [];
  if (!plan || typeof plan !== "object") return { valid: false, errors: ["repair_plan_required"] };

  const rootCause = String(plan.rootCause || "").trim();
  if (!rootCause) errors.push("root_cause_required");

  const rootCauseEvidence = Array.isArray(plan.rootCauseEvidence) ? plan.rootCauseEvidence.filter(Boolean) : [];
  if (!rootCauseEvidence.length) errors.push("root_cause_evidence_required");

  const allowed = allowedPaths ? new Set([...allowedPaths].map(cleanPath)) : null;
  const files = Array.isArray(plan.files) ? plan.files : [];
  if (!files.length) errors.push("at_least_one_file_change_required");
  if (files.length > MAX_FILES) errors.push("too_many_file_changes");

  const seen = new Set();
  for (const [index, item] of files.entries()) {
    const path = cleanPath(item?.path);
    const content = typeof item?.content === "string" ? item.content : null;
    if (!path) errors.push(`file_${index}_path_required`);
    if (blockedPath(path)) errors.push(`file_${index}_path_blocked`);
    if (allowed && !allowed.has(path)) errors.push(`file_${index}_path_outside_repair_scope`);
    if (seen.has(path)) errors.push(`file_${index}_duplicate_path`);
    seen.add(path);
    if (content === null) errors.push(`file_${index}_content_required`);
    if (content !== null && Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      errors.push(`file_${index}_too_large`);
    }
    if (!String(item?.reason || "").trim()) errors.push(`file_${index}_reason_required`);
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      summary: String(plan.summary || "").trim(),
      rootCause,
      rootCauseEvidence: rootCauseEvidence.map(String),
      files: files.map((item) => ({
        path: cleanPath(item.path),
        content: String(item.content ?? ""),
        reason: String(item.reason || "").trim()
      })),
      verification: Array.isArray(plan.verification) ? plan.verification.map(String) : [],
      recurrenceReview: String(plan.recurrenceReview || "").trim(),
      residualRisks: Array.isArray(plan.residualRisks) ? plan.residualRisks.map(String) : []
    }
  };
}

export const REPAIR_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "rootCause",
    "rootCauseEvidence",
    "files",
    "verification",
    "recurrenceReview",
    "residualRisks"
  ],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 2000 },
    rootCause: { type: "string", minLength: 1, maxLength: 5000 },
    rootCauseEvidence: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 3000 }
    },
    files: {
      type: "array",
      minItems: 1,
      maxItems: MAX_FILES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content", "reason"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 500 },
          content: { type: "string", maxLength: MAX_FILE_BYTES },
          reason: { type: "string", minLength: 1, maxLength: 3000 }
        }
      }
    },
    verification: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 1000 }
    },
    recurrenceReview: { type: "string", minLength: 1, maxLength: 5000 },
    residualRisks: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 1, maxLength: 2000 }
    }
  }
};
