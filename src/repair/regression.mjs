function key(item) {
  return `${item?.runtime || "unknown"}|${item?.filePath || item?.path || ""}`;
}

function evidence(item) {
  const runtime = item?.runtime || "unknown";
  const code = item?.code || "REGRESSION";
  const message = item?.message || "";
  const filePath = item?.filePath || item?.path || null;
  const prefix = filePath
    ? `[${runtime}] ${code} path=${filePath}`
    : `[${runtime}] ${code}`;
  return message ? `${prefix}: ${message}` : prefix;
}

export function compareRepositoryScans(before = {}, current = {}) {
  const regressions = [];
  const beforeResults = new Map((before.results || []).map((item) => [key(item), item]));
  const currentResults = new Map((current.results || []).map((item) => [key(item), item]));

  for (const [entryKey, previous] of beforeResults) {
    const next = currentResults.get(entryKey);
    if (!next) {
      regressions.push({
        code: "CONFIG_REMOVED",
        runtime: previous.runtime || "unknown",
        filePath: previous.filePath || null,
        message: `${previous.filePath || "guardrail configuration"} was removed.`
      });
      continue;
    }

    const previousEvents = new Set(previous.events || []);
    const nextEvents = new Set(next.events || []);
    for (const event of previousEvents) {
      if (!nextEvents.has(event)) {
        regressions.push({
          code: "HOOK_EVENT_REMOVED",
          runtime: previous.runtime || "unknown",
          filePath: previous.filePath || null,
          message: `${event} disappeared from ${previous.filePath || "guardrail configuration"}.`
        });
      }
    }
  }

  const beforeFails = new Set((before.fails || []).map((item) =>
    `${item?.runtime || "unknown"}|${item?.filePath || ""}|${item?.message || ""}`
  ));

  for (const item of current.fails || []) {
    const failKey = `${item?.runtime || "unknown"}|${item?.filePath || ""}|${item?.message || ""}`;
    if (!beforeFails.has(failKey)) {
      regressions.push({
        code: item?.code || "NEW_FAIL_FINDING",
        runtime: item?.runtime || "unknown",
        filePath: item?.filePath || null,
        message: item?.message || "A new FAIL finding appeared."
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of regressions) {
    const id = `${item.code}|${item.runtime}|${item.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }

  return {
    verdict: unique.length ? "FAIL" : "PASS",
    regressions: unique,
    failureEvidence: unique.map(evidence)
  };
}
