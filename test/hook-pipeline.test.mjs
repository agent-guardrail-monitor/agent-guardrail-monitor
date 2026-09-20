import test from "node:test";
import assert from "node:assert/strict";

import { evaluateHook, hookOutput } from "../src/enforcement/hook.mjs";

function policy(extra = {}) {
  return {
    schemaVersion: 1,
    policyId: "hook-pipeline",
    version: 1,
    strict: true,
    defaults: { unmatched: "ALLOW", criticalUnmatched: "BLOCK" },
    rules: [{
      id: "allow-editor",
      status: "ACTIVE",
      priority: "MANDATORY",
      phase: "PRE_ACTION",
      match: { tool: "Edit" },
      effect: { type: "ALLOW" }
    }],
    ...extra
  };
}

test("runtime hook enforces configured mandatory skill registry", () => {
  const p = policy({
    skillRegistry: [{
      id: "surgical-edit",
      status: "ACTIVE",
      priority: "MANDATORY",
      triggers: { taskLabels: ["image_edit"] }
    }]
  });

  const decision = evaluateHook(p, "claude", {
    tool_name: "Edit",
    tool_input: { file_path: "image.json" },
    agmTask: { labels: ["image_edit"] },
    agmSkills: [{ id: "surgical-edit", loaded: true, executed: false }]
  });

  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.pipelineStage, "SKILL_RESOLUTION");
  assert.equal(hookOutput("claude", decision).hookSpecificOutput.permissionDecision, "deny");
});

test("runtime hook requires review on configured memory conflict", () => {
  const p = policy({
    memoryRegistry: [
      { id: "m1", key: "target", value: "one", priority: "HIGH", status: "ACTIVE" },
      { id: "m2", key: "target", value: "two", priority: "HIGH", status: "ACTIVE" }
    ]
  });

  const decision = evaluateHook(p, "copilot", {
    toolName: "Edit",
    toolArgs: { file_path: "file.txt" }
  });

  assert.equal(decision.decision, "REQUIRE_REVIEW");
  assert.equal(decision.pipelineStage, "MEMORY_RESOLUTION");
  assert.equal(hookOutput("copilot", decision).permissionDecision, "deny");
});

test("runtime hook blocks forbidden registered tool before policy allow", () => {
  const p = policy({
    toolRegistry: [{ id: "editor", aliases: ["Edit"], status: "ACTIVE" }]
  });

  const decision = evaluateHook(p, "claude", {
    tool_name: "Edit",
    tool_input: { file_path: "file.txt" },
    agmTask: { forbiddenTools: ["Edit"] }
  });

  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.pipelineStage, "TOOL_RESOLUTION");
});
