import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand, writeMarkerHook } from "./core.mjs";

function result(runtime, status, reason, details = null) {
  return { runtime, status, reason, details, checkedAt: new Date().toISOString() };
}

function quote(parts) {
  return parts.map((part) => {
    const value = String(part);
    return /\s|"/.test(value) ? '"' + value.replaceAll('"', '\\"') + '"' : value;
  }).join(" ");
}

function runtimeOf(runtimes, name) {
  return (runtimes || []).find((item) => item.name === name && item.installed);
}

function markerData(file) {
  try { return fs.readFileSync(file, "utf8").slice(0, 1000); } catch { return ""; }
}

function proveClaude(root, hookScript, marker, runtime) {
  if (!runtime) return result("claude", "UNKNOWN", "Claude Code CLI is not installed.");
  const settings = path.join(root, "claude-settings.json");
  fs.writeFileSync(settings, JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: "startup",
        hooks: [{
          type: "command",
          command: quote([process.execPath, hookScript, marker])
        }]
      }]
    }
  }, null, 2));

  const run = runCommand("claude", [
    "--restricted",
    "--settings", settings,
    "--init-only"
  ], { cwd: root, timeoutMs: 20000 });

  if (fs.existsSync(marker)) {
    return result("claude", "PASS", "SessionStart hook produced execution evidence.", {
      version: runtime.version,
      marker: markerData(marker)
    });
  }
  if (run.status === 0) {
    return result("claude", "FAIL", "Claude initialized successfully but the SessionStart canary did not execute.", {
      version: runtime.version,
      stdout: run.stdout.slice(0, 800),
      stderr: run.stderr.slice(0, 800)
    });
  }
  return result("claude", "UNKNOWN", "Claude canary could not complete, so execution was not proven.", {
    version: runtime.version,
    exitCode: run.status,
    error: run.error,
    stderr: run.stderr.slice(0, 800)
  });
}

function writeCodexHook(root, hookScript, marker) {
  const dir = path.join(root, ".codex");
  fs.mkdirSync(dir, { recursive: true });
  const command = quote([process.execPath, hookScript, marker]);
  fs.writeFileSync(path.join(dir, "hooks.json"), JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: "startup|resume",
        hooks: [{
          type: "command",
          command,
          commandWindows: command,
          timeout: 8
        }]
      }]
    }
  }, null, 2));
}

function proveCodex(root, hookScript, marker, runtime, live) {
  if (!runtime) return result("codex", "UNKNOWN", "Codex CLI is not installed.");
  if (!live) return result("codex", "UNKNOWN",
    "A real Codex session is required for runtime proof. Use --live to execute it.",
    { version: runtime.version, costMode: "model-session" });

  writeCodexHook(root, hookScript, marker);
  const run = runCommand("codex", [
    "exec",
    "--ephemeral",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "Reply with exactly OK. Do not use tools."
  ], { cwd: root, timeoutMs: 60000 });

  if (fs.existsSync(marker)) {
    return result("codex", "PASS", "SessionStart hook produced execution evidence.", {
      version: runtime.version,
      marker: markerData(marker)
    });
  }
  if (run.status === 0) {
    return result("codex", "FAIL", "Codex completed but the SessionStart canary did not execute.", {
      version: runtime.version,
      stdout: run.stdout.slice(0, 800),
      stderr: run.stderr.slice(0, 800)
    });
  }
  return result("codex", "UNKNOWN",
    "Codex runtime proof could not complete; trust, authentication, network, or runtime state may be required.",
    { version: runtime.version, exitCode: run.status, error: run.error, stderr: run.stderr.slice(0, 800) });
}

function writeCopilotHook(root, hookScript, marker) {
  const dir = path.join(root, ".github", "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent-guardrail-monitor.json"), JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{
        type: "command",
        exec: process.execPath,
        args: [hookScript, marker],
        timeoutSec: 8
      }]
    }
  }, null, 2));
}

function proveCopilot(root, hookScript, marker, runtime, live) {
  if (!runtime) return result("copilot", "UNKNOWN", "GitHub Copilot CLI is not installed.");
  if (!live) return result("copilot", "UNKNOWN",
    "A real Copilot CLI session is required for runtime proof. Use --live to execute it.",
    { version: runtime.version, costMode: "model-session" });

  writeCopilotHook(root, hookScript, marker);
  const run = runCommand("copilot", [
    "-p", "Reply with exactly OK. Do not use tools.",
    "--no-color"
  ], { cwd: root, timeoutMs: 60000 });

  if (fs.existsSync(marker)) {
    return result("copilot", "PASS", "sessionStart hook produced execution evidence.", {
      version: runtime.version,
      marker: markerData(marker)
    });
  }
  if (run.status === 0) {
    return result("copilot", "FAIL", "Copilot completed but the sessionStart canary did not execute.", {
      version: runtime.version,
      stdout: run.stdout.slice(0, 800),
      stderr: run.stderr.slice(0, 800)
    });
  }
  return result("copilot", "UNKNOWN",
    "Copilot runtime proof could not complete; authentication, network, or runtime state may be required.",
    { version: runtime.version, exitCode: run.status, error: run.error, stderr: run.stderr.slice(0, 800) });
}

export function proveInstalled(runtimes, { live = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-guardrail-monitor-"));
  const hookScript = path.join(root, "marker-hook.mjs");
  writeMarkerHook(hookScript);
  try {
    return [
      proveClaude(root, hookScript, path.join(root, "claude.marker"), runtimeOf(runtimes, "claude")),
      proveCodex(root, hookScript, path.join(root, "codex.marker"), runtimeOf(runtimes, "codex"), live),
      proveCopilot(root, hookScript, path.join(root, "copilot.marker"), runtimeOf(runtimes, "copilot"), live)
    ];
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}