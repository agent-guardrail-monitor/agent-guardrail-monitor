function list(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function names(tool) {
  return new Set([tool.id, tool.name, ...list(tool.aliases)].filter(Boolean));
}

export function resolveTools(registry = [], task = {}, available = []) {
  const required = new Set(list(task.requiredTools));
  const allowed = new Set(list(task.allowedTools));
  const forbidden = new Set(list(task.forbiddenTools));
  const availableNames = new Set(list(available));
  const records = [];

  for (const tool of registry.filter((item) => (item.status || "ACTIVE") === "ACTIVE")) {
    const aliases = names(tool);
    const matches = (set) => [...aliases].some((name) => set.has(name));
    let state = "ALLOWED";
    if (matches(forbidden)) state = "FORBIDDEN";
    else if (matches(required)) state = "REQUIRED";
    else if (allowed.size && !matches(allowed)) state = "FORBIDDEN";

    const isAvailable = [...aliases].some((name) => availableNames.has(name));
    if ((state === "REQUIRED" || state === "ALLOWED") && availableNames.size && !isAvailable) {
      state = "UNAVAILABLE";
    }
    records.push({ ...tool, resolution: state });
  }

  const missingRequired = [...required].filter((name) => {
    return !records.some((tool) => names(tool).has(name) && tool.resolution === "REQUIRED");
  });

  const unavailableRequired = records
    .filter((tool) => [...names(tool)].some((name) => required.has(name)) && tool.resolution === "UNAVAILABLE")
    .map((tool) => tool.id);

  return {
    status: missingRequired.length || unavailableRequired.length ? "BLOCK" : "RESOLVED",
    tools: records,
    missingRequired,
    unavailableRequired
  };
}

export function routeTool(resolution, requestedTool) {
  const record = (resolution.tools || []).find((tool) => names(tool).has(requestedTool));
  if (!record) return { decision: "UNKNOWN", code: "TOOL_NOT_REGISTERED" };
  if (record.resolution === "FORBIDDEN") return { decision: "BLOCK", code: "TOOL_FORBIDDEN", toolId: record.id };
  if (record.resolution === "UNAVAILABLE") return { decision: "BLOCK", code: "TOOL_UNAVAILABLE", toolId: record.id };
  return { decision: "ALLOW", code: "TOOL_ROUTED", toolId: record.id };
}
