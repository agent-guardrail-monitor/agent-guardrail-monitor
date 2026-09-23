export const REPAIR_MODES = Object.freeze(["off", "pull_request", "auto_merge"]);

export function normalizeRepairConfig(value = {}) {
  const repair = value?.repair && typeof value.repair === "object" ? value.repair : value;
  const requested = String(repair?.mode || "pull_request").trim().toLowerCase();
  const mode = REPAIR_MODES.includes(requested) ? requested : "pull_request";

  return {
    enabled: repair?.enabled !== false && mode !== "off",
    mode,
    autoMerge: mode === "auto_merge",
    waitForChecks: repair?.waitForChecks !== false,
    allowWorkflowChanges: repair?.allowWorkflowChanges === true,
    checkTimeoutMs: Number.isFinite(repair?.checkTimeoutMs)
      ? Math.max(10_000, Math.min(Number(repair.checkTimeoutMs), 600_000))
      : 180_000
  };
}

export function parseRepairConfig(text) {
  if (!String(text || "").trim()) return normalizeRepairConfig();
  try {
    return normalizeRepairConfig(JSON.parse(text));
  } catch {
    return {
      ...normalizeRepairConfig(),
      configError: "Invalid .agent-guardrail-monitor/config.json"
    };
  }
}
