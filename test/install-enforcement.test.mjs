import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { installHook } from "../src/enforcement/install.mjs";

test("Claude installer preserves existing settings and adds one AGM PreToolUse handler", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agm-install-claude-"));
  try {
    const settingsFile = path.join(root, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo existing" }] }]
      },
      permissions: { allow: ["Read"] }
    }));

    const first = installHook({ runtime: "claude", cwd: root });
    const second = installHook({ runtime: "claude", cwd: root });
    assert.equal(first.status, "INSTALLED");
    assert.equal(second.status, "INSTALLED");

    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.equal(settings.permissions.allow[0], "Read");
    assert.equal(settings.hooks.Stop.length, 1);

    const handlers = settings.hooks.PreToolUse.flatMap((group) => group.hooks || [])
      .filter((handler) => Array.isArray(handler.args) && handler.args.includes("claude"));
    assert.equal(handlers.length, 1);
    assert.ok(fs.existsSync(first.policyPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Copilot installer writes dedicated preToolUse command hook", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agm-install-copilot-"));
  try {
    const result = installHook({ runtime: "copilot", cwd: root });
    assert.equal(result.status, "INSTALLED");
    const config = JSON.parse(fs.readFileSync(result.configPath, "utf8"));
    const hook = config.hooks.preToolUse[0];
    assert.equal(hook.type, "command");
    assert.equal(hook.exec, process.execPath);
    assert.ok(hook.args.includes("copilot"));
    assert.ok(fs.existsSync(result.policyPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex installer stays UNKNOWN instead of inventing a blocking path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agm-install-codex-"));
  try {
    const result = installHook({ runtime: "codex", cwd: root });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(fs.existsSync(path.join(root, ".codex", "hooks.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
