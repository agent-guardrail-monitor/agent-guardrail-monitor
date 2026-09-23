const EXEC_KEYS = new Set(["command", "commandWindows", "bash", "powershell", "exec"]);

function collectJsonCommands(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonCommands(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if (EXEC_KEYS.has(key) && typeof child === "string") out.push(child.trim());
    collectJsonCommands(child, out);
  }
  return out;
}

function collectTomlCommands(content) {
  const out = [];
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(command|commandWindows|bash|powershell|exec)\s*=\s*(.+?)\s*$/i);
    if (match) out.push(match[2].trim());
  }
  return out;
}

export function extractExecutableCommands(path, content) {
  const file = String(path || "").toLowerCase();
  if (file.endsWith(".json")) {
    try {
      return collectJsonCommands(JSON.parse(String(content || "")));
    } catch {
      return null;
    }
  }
  if (file.endsWith(".toml")) return collectTomlCommands(content);
  return [];
}

export function validateRepairContentSafety({
  plan,
  baselineContext = [],
  currentContext = []
} = {}) {
  const errors = [];
  const baseline = new Map((baselineContext || []).map((item) => [item.path, item]));
  const current = new Map((currentContext || []).map((item) => [item.path, item]));

  for (const [index, file] of (plan?.files || []).entries()) {
    const proposed = extractExecutableCommands(file.path, file.content);
    if (proposed === null) {
      errors.push(`file_${index}_invalid_json`);
      continue;
    }

    const approvedSource = baseline.get(file.path) || current.get(file.path);
    const approved = approvedSource
      ? extractExecutableCommands(file.path, approvedSource.content)
      : [];

    if (approved === null) {
      errors.push(`file_${index}_approved_source_invalid`);
      continue;
    }

    const allowed = new Set(approved || []);
    for (const command of proposed || []) {
      if (!allowed.has(command)) {
        errors.push(`file_${index}_introduces_unapproved_executable_command`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
