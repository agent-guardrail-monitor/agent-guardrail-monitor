import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const SCHEMA_VERSION = 1;
export const PRODUCT_VERSION = "0.2.0-alpha.2";

export const DOCS = {
  claude: "https://code.claude.com/docs/en/hooks",
  codex: "https://developers.openai.com/docs/hooks",
  copilot: "https://docs.github.com/en/copilot/reference/hooks-reference"
};

const HOME = os.homedir();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanText(value) {
  return String(value ?? "").replace(/\u001b\[[0-9;]*m/g, "").trim();
}

export function normalizePath(file) {
  const absolute = path.resolve(file);
  const home = path.resolve(HOME);
  const absoluteLower = absolute.toLowerCase();
  const homeLower = home.toLowerCase();
  const insideHome = absoluteLower === homeLower ||
    absoluteLower.startsWith((home + path.sep).toLowerCase());
  if (insideHome) {
    return "~" + absolute.slice(home.length).replaceAll("\\", "/");
  }
  return absolute.replaceAll("\\", "/");
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeoutMs || 8000,
    windowsHide: true,
    shell: false
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: cleanText(result.stdout),
    stderr: cleanText(result.stderr),
    error: result.error ? String(result.error.message || result.error) : null
  };
}

function extractVersion(text) {
  const match = String(text || "").match(/\b(v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match ? match[1].replace(/^v/, "") : cleanText(text).split(/\r?\n/)[0] || null;
}

function detectRuntime(name, command) {
  const result = run(command, ["--version"]);
  const missing = result.error && /ENOENT|not found|cannot find/i.test(result.error);
  if (missing) {
    return { name, command, installed: false, version: null, status: "UNKNOWN" };
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.status === 0 || output) {
    return {
      name,
      command,
      installed: true,
      version: extractVersion(output),
      status: result.status === 0 ? "PASS" : "UNKNOWN"
    };
  }
  return { name, command, installed: false, version: null, status: "UNKNOWN" };
}

export function detectRuntimes() {
  return [
    detectRuntime("claude", "claude"),
    detectRuntime("codex", "codex"),
    detectRuntime("copilot", "copilot")
  ];
}

function jsonFilesIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function candidateConfigs(runtime, cwd) {
  if (runtime === "claude") {
    return [
      [path.join(HOME, ".claude", "settings.json"), "user", "json"],
      [path.join(cwd, ".claude", "settings.json"), "project", "json"],
      [path.join(cwd, ".claude", "settings.local.json"), "local", "json"]
    ];
  }
  if (runtime === "codex") {
    return [
      [path.join(HOME, ".codex", "hooks.json"), "user", "json"],
      [path.join(HOME, ".codex", "config.toml"), "user", "toml"],
      [path.join(cwd, ".codex", "hooks.json"), "project", "json"],
      [path.join(cwd, ".codex", "config.toml"), "project", "toml"]
    ];
  }
  if (runtime === "copilot") {
    const items = [
      [path.join(HOME, ".copilot", "settings.json"), "user", "json"]
    ];
    for (const file of jsonFilesIn(path.join(HOME, ".copilot", "hooks"))) {
      items.push([file, "user", "json"]);
    }
    for (const file of jsonFilesIn(path.join(cwd, ".github", "hooks"))) {
      items.push([file, "project", "json"]);
    }
    return items;
  }
  return [];
}

function parseTomlHooks(content) {
  const events = new Set();
  const regex = /\[\[\s*hooks\.([A-Za-z0-9_-]+)\s*\]\]/g;
  let match;
  while ((match = regex.exec(content))) events.add(match[1]);
  return [...events].sort();
}

function deepCommands(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) deepCommands(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if (["command", "commandWindows", "bash", "powershell", "exec"].includes(key) && typeof child === "string") {
      out.push({ field: key, fingerprint: sha256(child) });
    }
    deepCommands(child, out);
  }
  return out;
}

function parseConfig(runtime, file, scope, format) {
  const content = fs.readFileSync(file, "utf8");
  const base = {
    runtime,
    scope,
    format,
    path: normalizePath(file),
    fingerprint: sha256(content),
    valid: true,
    events: [],
    commands: [],
    disableAllHooks: false,
    error: null
  };
  if (format === "toml") {
    base.events = parseTomlHooks(content);
    base.commands = [];
    return base;
  }
  try {
    const value = JSON.parse(content);
    const hooks = value && typeof value === "object" ? value.hooks : null;
    if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
      base.events = Object.keys(hooks).sort();
    }
    base.commands = deepCommands(hooks || value);
    base.disableAllHooks = Boolean(value?.disableAllHooks);
    if (runtime === "copilot" && scope !== "user" && "version" in value && value.version !== 1) {
      base.valid = false;
      base.error = "Copilot hook files require version: 1";
    }
  } catch (error) {
    base.valid = false;
    base.error = String(error.message || error);
  }
  return base;
}

function collectConfigs(cwd) {
  const configs = [];
  for (const runtime of ["claude", "codex", "copilot"]) {
    for (const [file, scope, format] of candidateConfigs(runtime, cwd)) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      configs.push(parseConfig(runtime, file, scope, format));
    }
  }
  return configs;
}

function finding(severity, code, runtime, message, evidence = null) {
  return { severity, code, runtime, message, evidence };
}

function analyze(runtimes, configs) {
  const findings = [];
  const byRuntime = new Map(runtimes.map((runtime) => [runtime.name, runtime]));

  for (const config of configs) {
    if (!config.valid) {
      findings.push(finding("FAIL", "INVALID_CONFIG", config.runtime,
        `Invalid ${config.format.toUpperCase()} hook/config file: ${config.path}`, config.error));
      continue;
    }
    if (config.events.length > 0 && !byRuntime.get(config.runtime)?.installed) {
      findings.push(finding("UNKNOWN", "RUNTIME_NOT_INSTALLED", config.runtime,
        `${config.events.length} hook event(s) configured, but ${config.runtime} CLI was not detected.`, config.path));
    }
    if (config.disableAllHooks && config.events.length > 0) {
      findings.push(finding("FAIL", "HOOKS_DISABLED", config.runtime,
        `Hooks are declared in ${config.path}, but disableAllHooks is true.`, config.path));
    }
    if (config.runtime === "codex" && config.scope === "project" && config.events.length > 0) {
      findings.push(finding("UNKNOWN", "CODEX_PROJECT_TRUST", "codex",
        "Project Codex hooks are present; static inspection cannot prove the project layer is trusted or the hook hash is approved.",
        config.path));
    }
  }

  const copilotProjectHooks = configs.some((c) => c.runtime === "copilot" && c.scope === "project" && c.events.length);
  const copilotDisabled = configs.some((c) => c.runtime === "copilot" && c.scope === "user" && c.disableAllHooks);
  if (copilotProjectHooks && copilotDisabled) {
    findings.push(finding("FAIL", "COPILOT_PROJECT_HOOKS_DISABLED", "copilot",
      "Project Copilot hooks exist while the user configuration disables hooks."));
  }

  return findings;
}

export function buildSnapshot(cwd = process.cwd(), proofs = []) {
  const root = path.resolve(cwd);
  const runtimes = detectRuntimes();
  const configs = collectConfigs(root);
  const findings = analyze(runtimes, configs);
  return {
    schemaVersion: SCHEMA_VERSION,
    product: { name: "Agent Guardrail Monitor", version: PRODUCT_VERSION },
    generatedAt: new Date().toISOString(),
    cwd: normalizePath(root),
    platform: { os: process.platform, arch: process.arch, node: process.version },
    runtimes,
    configs,
    findings,
    proofs
  };
}

function runtimeMap(snapshot) {
  return new Map((snapshot.runtimes || []).map((r) => [r.name, r]));
}

function configKey(config) {
  return `${config.runtime}|${config.scope}|${config.path}`;
}

export function compareSnapshots(baseline, current) {
  const changes = [];
  const regressions = [];
  const baseRuntimes = runtimeMap(baseline);
  const curRuntimes = runtimeMap(current);

  for (const [name, before] of baseRuntimes) {
    const after = curRuntimes.get(name);
    if (before.installed && !after?.installed) {
      regressions.push({ code: "RUNTIME_REMOVED", runtime: name, message: `${name} was present in baseline and is now missing.` });
    } else if (before.version !== after?.version) {
      changes.push({ code: "RUNTIME_VERSION_CHANGED", runtime: name, before: before.version, after: after?.version || null });
    }
  }

  const baseConfigs = new Map((baseline.configs || []).map((c) => [configKey(c), c]));
  const curConfigs = new Map((current.configs || []).map((c) => [configKey(c), c]));

  for (const [key, before] of baseConfigs) {
    const after = curConfigs.get(key);
    if (!after) {
      regressions.push({ code: "CONFIG_REMOVED", runtime: before.runtime, message: `${before.path} was removed.` });
      continue;
    }
    if (before.valid && !after.valid) {
      regressions.push({ code: "CONFIG_BECAME_INVALID", runtime: before.runtime, message: `${before.path} is now invalid.` });
    }
    if (before.fingerprint !== after.fingerprint) {
      changes.push({ code: "CONFIG_CHANGED", runtime: before.runtime, path: before.path });
    }
    const removedEvents = (before.events || []).filter((event) => !(after.events || []).includes(event));
    for (const event of removedEvents) {
      regressions.push({ code: "HOOK_EVENT_REMOVED", runtime: before.runtime, message: `${event} disappeared from ${before.path}.` });
    }
  }

  const baseFailCodes = new Set((baseline.findings || []).filter((f) => f.severity === "FAIL").map((f) => `${f.runtime}|${f.code}`));
  for (const item of current.findings || []) {
    const key = `${item.runtime}|${item.code}`;
    if (item.severity === "FAIL" && !baseFailCodes.has(key)) {
      regressions.push({ code: "NEW_FAIL_FINDING", runtime: item.runtime, message: item.message });
    }
  }

  const baseProofs = new Map((baseline.proofs || []).map((p) => [p.runtime, p]));
  for (const proof of current.proofs || []) {
    const before = baseProofs.get(proof.runtime);
    if (before?.status === "PASS" && proof.status !== "PASS") {
      regressions.push({ code: "PROOF_REGRESSION", runtime: proof.runtime,
        message: `${proof.runtime} proof changed from PASS to ${proof.status}.` });
    }
  }

  return { verdict: regressions.length ? "FAIL" : "PASS", changes, regressions };
}

export function saveSnapshot(snapshot, file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

export function loadSnapshot(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function runCommand(command, args, options) {
  return run(command, args, options);
}

export function writeMarkerHook(scriptPath) {
  const source = `import fs from "node:fs";\nconst marker = process.argv[2];\nfs.writeFileSync(marker, JSON.stringify({ firedAt: new Date().toISOString(), stdin: await new Promise((resolve) => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", d => s += d); process.stdin.on("end", () => resolve(s)); }) }) + "\\n");\n`;
  fs.writeFileSync(scriptPath, source, "utf8");
}