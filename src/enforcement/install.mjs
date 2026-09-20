import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, "..", "..");
const cliPath = path.join(packageRoot, "bin", "agent-guardrail-monitor.mjs");
const examplePolicyPath = path.join(packageRoot, "policy", "strict.example.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function ensurePolicy(projectRoot, requestedPolicy) {
  if (requestedPolicy) {
    const resolved = path.resolve(projectRoot, requestedPolicy);
    if (!fs.existsSync(resolved)) throw new Error("Policy file does not exist: " + resolved);
    return resolved;
  }

  const target = path.join(projectRoot, ".agent-guardrail-monitor", "policy.json");
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(examplePolicyPath, target);
  }
  return target;
}

function hookArgs(runtime, policyPath, publicKeyPath) {
  const args = [cliPath, "hook", "--runtime", runtime, "--policy", policyPath];
  if (publicKeyPath) args.push("--public-key", publicKeyPath);
  return args;
}

function claudeHandler(policyPath, publicKeyPath) {
  return {
    type: "command",
    command: process.execPath,
    args: hookArgs("claude", policyPath, publicKeyPath),
    timeout: 5
  };
}

function isAgmClaudeHandler(handler) {
  return handler?.type === "command" &&
    Array.isArray(handler.args) &&
    handler.args.includes("hook") &&
    handler.args.includes("claude") &&
    handler.args.some((arg) => String(arg).endsWith("agent-guardrail-monitor.mjs"));
}

function installClaude(projectRoot, policyPath, publicKeyPath) {
  const file = path.join(projectRoot, ".claude", "settings.json");
  let settings = {};
  if (fs.existsSync(file)) settings = readJson(file);
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Claude settings must be a JSON object.");
  }

  settings.hooks ||= {};
  const groups = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];

  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    group.hooks = group.hooks.filter((handler) => !isAgmClaudeHandler(handler));
  }

  const allGroup = groups.find((group) => group && (group.matcher === "*" || group.matcher === "" || group.matcher == null));
  if (allGroup) {
    allGroup.hooks ||= [];
    allGroup.hooks.push(claudeHandler(policyPath, publicKeyPath));
  } else {
    groups.push({ matcher: "*", hooks: [claudeHandler(policyPath, publicKeyPath)] });
  }

  settings.hooks.PreToolUse = groups;
  writeJson(file, settings);
  return file;
}

function installCopilot(projectRoot, policyPath, publicKeyPath) {
  const file = path.join(projectRoot, ".github", "hooks", "agent-guardrail-monitor.json");
  writeJson(file, {
    version: 1,
    hooks: {
      preToolUse: [{
        type: "command",
        exec: process.execPath,
        args: hookArgs("copilot", policyPath, publicKeyPath),
        timeoutSec: 5
      }]
    }
  });
  return file;
}

export function installHook({ runtime, cwd = process.cwd(), policy = null, publicKey = null } = {}) {
  const projectRoot = path.resolve(cwd);
  const normalized = String(runtime || "").toLowerCase();

  if (!["claude", "copilot", "codex"].includes(normalized)) {
    throw new Error("runtime must be claude, copilot, or codex");
  }

  if (normalized === "codex") {
    return {
      status: "UNKNOWN",
      runtime: "codex",
      reason: "Codex enforcement installation is withheld until the exact runtime/version blocking path has a passing canary.",
      projectRoot
    };
  }

  const policyPath = ensurePolicy(projectRoot, policy);
  const policyDocument = readJson(policyPath);
  const publicKeyPath = publicKey ? path.resolve(projectRoot, publicKey) : null;
  if (publicKeyPath && !fs.existsSync(publicKeyPath)) {
    throw new Error("Public key file does not exist: " + publicKeyPath);
  }
  if (policyDocument?.bundleVersion === 1 && policyDocument?.signature && !publicKeyPath) {
    throw new Error("Signed policy bundle installation requires --public-key.");
  }

  const configPath = normalized === "claude"
    ? installClaude(projectRoot, policyPath, publicKeyPath)
    : installCopilot(projectRoot, policyPath, publicKeyPath);

  return {
    status: "INSTALLED",
    runtime: normalized,
    projectRoot,
    configPath,
    policyPath,
    publicKeyPath,
    cliPath,
    limitation: normalized === "claude"
      ? "Claude command-hook timeouts are provider fail-open; AGM remains local and bounded, but timeout bypass is outside AGM authority."
      : "Copilot preToolUse command-hook timeouts are provider fail-open; AGM remains local and bounded, but timeout bypass is outside AGM authority."
  };
}
