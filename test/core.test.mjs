import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSnapshot, compareSnapshots } from "../src/core.mjs";

function snapshot({ version = "1.0.0", events = ["PreToolUse"], valid = true, findings = [], proofs = [] } = {}) {
  return {
    runtimes: [
      { name: "claude", installed: true, version, status: "PASS" },
      { name: "codex", installed: false, version: null, status: "UNKNOWN" },
      { name: "copilot", installed: false, version: null, status: "UNKNOWN" }
    ],
    configs: [{
      runtime: "claude",
      scope: "project",
      path: "~/.fixture/settings.json",
      fingerprint: events.join("|") + "|" + valid,
      valid,
      events,
      commands: [],
      disableAllHooks: false,
      error: valid ? null : "invalid"
    }],
    findings,
    proofs
  };
}

test("a runtime version change is informational when controls remain intact", () => {
  const result = compareSnapshots(
    snapshot({ version: "1.0.0" }),
    snapshot({ version: "1.1.0" })
  );
  assert.equal(result.verdict, "PASS");
  assert.equal(result.regressions.length, 0);
  assert.ok(result.changes.some((item) => item.code === "RUNTIME_VERSION_CHANGED"));
});

test("removing a previously present hook event fails the gate", () => {
  const result = compareSnapshots(
    snapshot({ events: ["PreToolUse", "Stop"] }),
    snapshot({ events: ["Stop"] })
  );
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.regressions.some((item) => item.code === "HOOK_EVENT_REMOVED"));
});

test("a valid config becoming invalid fails the gate", () => {
  const result = compareSnapshots(
    snapshot({ valid: true }),
    snapshot({ valid: false })
  );
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.regressions.some((item) => item.code === "CONFIG_BECAME_INVALID"));
});

test("a new static FAIL finding fails the gate", () => {
  const result = compareSnapshots(
    snapshot(),
    snapshot({
      findings: [{
        severity: "FAIL",
        code: "HOOKS_DISABLED",
        runtime: "claude",
        message: "Hooks disabled."
      }]
    })
  );
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.regressions.some((item) => item.code === "NEW_FAIL_FINDING"));
});

test("a live proof regression from PASS to UNKNOWN fails the gate", () => {
  const result = compareSnapshots(
    snapshot({ proofs: [{ runtime: "claude", status: "PASS" }] }),
    snapshot({ proofs: [{ runtime: "claude", status: "UNKNOWN" }] })
  );
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.regressions.some((item) => item.code === "PROOF_REGRESSION"));
});


test("snapshots fingerprint hook commands instead of storing plaintext", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agm-test-"));
  const dir = path.join(root, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  const secretCommand = "SECRET_TOKEN=do-not-store node guard.js";
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: secretCommand }]
      }]
    }
  }));

  try {
    const current = buildSnapshot(root);
    const config = current.configs.find((item) =>
      item.runtime === "claude" && item.scope === "project"
    );
    assert.ok(config);
    assert.equal(config.commands.length, 1);
    assert.ok(config.commands[0].fingerprint);
    assert.equal("value" in config.commands[0], false);
    assert.equal(JSON.stringify(current).includes("do-not-store"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("disableAllHooks with configured hooks is a static FAIL", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agm-test-"));
  const dir = path.join(root, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({
    disableAllHooks: true,
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "node verify.js" }] }]
    }
  }));

  try {
    const current = buildSnapshot(root);
    assert.ok(current.findings.some((item) =>
      item.code === "HOOKS_DISABLED" && item.severity === "FAIL"
    ));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});