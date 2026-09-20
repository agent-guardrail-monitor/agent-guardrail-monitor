import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const cli = path.resolve("bin/agent-guardrail-monitor.mjs");
const policy = path.resolve("policy/strict.example.json");

test("CLI validates packaged strict policy", () => {
  const run = spawnSync(process.execPath, [cli, "policy", "validate", "--file", policy], {
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const body = JSON.parse(run.stdout);
  assert.equal(body.valid, true);
});

test("CLI hook denies destructive Claude tool call and exits cleanly for hook parser", () => {
  const run = spawnSync(process.execPath, [
    cli, "hook", "--runtime", "claude", "--policy", policy
  ], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "rm -rf /tmp/agm-test" }
    }),
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const body = JSON.parse(run.stdout);
  assert.equal(body.hookSpecificOutput.permissionDecision, "deny");
});

test("CLI hook fails closed when policy file is missing", () => {
  const run = spawnSync(process.execPath, [
    cli, "hook", "--runtime", "copilot", "--policy", path.resolve("missing-policy.json")
  ], {
    input: JSON.stringify({ toolName: "shell", toolArgs: { command: "echo test" } }),
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const body = JSON.parse(run.stdout);
  assert.equal(body.permissionDecision, "deny");
  assert.match(body.permissionDecisionReason, /could not prove policy evaluation/i);
});
