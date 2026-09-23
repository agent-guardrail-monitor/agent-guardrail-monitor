const GUARDRail_PATH = /(?:^|\s)path=([^:]+?)(?=:|$)/;

function guardrailPath(path) {
  const value = String(path || "").trim();
  return (
    value === ".claude/settings.json" ||
    value === ".claude/settings.local.json" ||
    value === ".codex/hooks.json" ||
    value === ".codex/config.toml" ||
    value.startsWith(".github/hooks/")
  );
}

function evidencePaths(failureEvidence = []) {
  const paths = new Set();
  for (const item of failureEvidence) {
    const match = String(item || "").match(GUARDRail_PATH);
    if (match && guardrailPath(match[1])) paths.add(match[1]);
  }
  return [...paths];
}

function changedGuardrailPaths(baseline = [], current = []) {
  const before = new Map((baseline || []).filter((x) => guardrailPath(x.path)).map((x) => [x.path, x.content]));
  const after = new Map((current || []).filter((x) => guardrailPath(x.path)).map((x) => [x.path, x.content]));
  const changed = [];
  for (const [path, content] of before) {
    if (!after.has(path) || after.get(path) !== content) changed.push(path);
  }
  return changed;
}

export function proposeDeterministicRepair({
  failureEvidence = [],
  repositoryContext = {}
} = {}) {
  const baseline = Array.isArray(repositoryContext?.baseline) ? repositoryContext.baseline : [];
  const current = Array.isArray(repositoryContext?.current) ? repositoryContext.current : [];
  const baselineByPath = new Map(baseline.map((item) => [item.path, item]));

  let paths = evidencePaths(failureEvidence);
  if (!paths.length) {
    const changed = changedGuardrailPaths(baseline, current);
    if (changed.length === 1) paths = changed;
  }

  const restorable = paths
    .filter((path) => baselineByPath.has(path))
    .filter((path) => guardrailPath(path));

  if (!restorable.length) return null;

  const currentByPath = new Map(current.map((item) => [item.path, item]));
  const files = [];
  for (const path of restorable) {
    const approved = baselineByPath.get(path);
    const active = currentByPath.get(path);
    if (active?.content === approved.content) continue;
    files.push({
      path,
      content: approved.content,
      reason: "Restore the last approved guardrail configuration proven by the pre-regression commit."
    });
  }
  if (!files.length) return null;

  const evidence = failureEvidence.map(String).filter(Boolean);
  return {
    summary: `Restore approved guardrail state for ${files.map((x) => x.path).join(", ")}`,
    rootCause:
      "The pushed commit changed or removed approved guardrail configuration that existed in the immediately previous commit.",
    rootCauseEvidence: evidence.length
      ? evidence
      : files.map((file) => `Baseline/current diff changed ${file.path}.`),
    files,
    verification: [
      "Re-run Agent Guardrail Monitor against the repair commit.",
      "Confirm the original regression evidence no longer reproduces."
    ],
    recurrenceReview:
      "Compared the broken guardrail files with the immediately previous approved commit and restored only evidenced guardrail paths.",
    residualRisks: [
      "Whole-file restoration can revert intentional changes made in the same guardrail file after the baseline; the default pull-request mode keeps those changes reviewable."
    ],
    strategy: "deterministic_baseline_restore"
  };
}

export function createIntegratedRepairModel({ fallback = null } = {}) {
  return {
    configured: true,
    model: fallback?.configured
      ? `deterministic+${fallback.model || "model-fallback"}`
      : "deterministic",
    deterministic: true,
    fallbackConfigured: fallback?.configured === true,
    fallbackModel: fallback?.model || null,

    async proposeRepair(input) {
      const deterministic = proposeDeterministicRepair(input);
      if (deterministic) return deterministic;
      if (fallback?.configured && typeof fallback.proposeRepair === "function") {
        return fallback.proposeRepair(input);
      }
      throw new Error(
        "No deterministic repair plan was available and the optional model fallback is not configured."
      );
    }
  };
}
