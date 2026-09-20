import test from "node:test";
import assert from "node:assert/strict";

import { resolveMemory } from "../src/enforcement/memory.mjs";
import { resolveSkills, verifyMandatorySkills } from "../src/enforcement/skills.mjs";
import { resolveTools, routeTool } from "../src/enforcement/tools.mjs";
import { TaskStateMachine } from "../src/enforcement/task.mjs";
import { validateClaims, validateOutput } from "../src/enforcement/evidence.mjs";
import { detectDrift } from "../src/enforcement/drift.mjs";
import { preActionPipeline, finalCompliancePipeline } from "../src/enforcement/pipeline.mjs";

function basePolicy(rules = []) {
  return {
    schemaVersion: 1,
    policyId: "pipeline-test",
    version: 1,
    strict: true,
    defaults: { unmatched: "ALLOW", criticalUnmatched: "BLOCK" },
    rules
  };
}

test("memory resolver detects equal-priority contradictions", () => {
  const result = resolveMemory([
    { id: "m1", key: "deployment", value: "blue", priority: "HIGH", status: "ACTIVE" },
    { id: "m2", key: "deployment", value: "green", priority: "HIGH", status: "ACTIVE" }
  ]);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.conflicts.length, 1);
});

test("memory resolver selects higher-priority active record", () => {
  const result = resolveMemory([
    { id: "low", key: "tool", value: "shell", priority: "LOW", status: "ACTIVE" },
    { id: "high", key: "tool", value: "device", priority: "HIGH", status: "ACTIVE" }
  ], { requiredKeys: ["tool"] });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.used[0].value, "device");
});

test("mandatory skill proof requires load execution and proof", () => {
  const resolved = resolveSkills([
    { id: "s1", priority: "MANDATORY", status: "ACTIVE", triggers: { taskLabels: ["edit"] } }
  ], { labels: ["edit"] });
  assert.equal(verifyMandatorySkills(resolved, [{ id: "s1", loaded: true, executed: true }]).valid, false);
  assert.equal(verifyMandatorySkills(resolved, [{ id: "s1", loaded: true, executed: true, executionProof: "p" }]).valid, true);
});

test("tool resolver blocks unavailable required tool", () => {
  const result = resolveTools([
    { id: "device", aliases: ["connect-device"], status: "ACTIVE" }
  ], { requiredTools: ["connect-device"] }, ["shell"]);
  assert.equal(result.status, "BLOCK");
  assert.deepEqual(result.unavailableRequired, ["device"]);
});

test("tool router blocks forbidden tool", () => {
  const result = resolveTools([
    { id: "shell", aliases: ["Bash"], status: "ACTIVE" }
  ], { forbiddenTools: ["Bash"] }, ["Bash"]);
  assert.equal(routeTool(result, "Bash").decision, "BLOCK");
});

test("task cannot complete without verified or supported proof", () => {
  const task = new TaskStateMachine({ id: "t1", originalObjective: "publish verified artifact" });
  assert.equal(task.complete({ status: "UNKNOWN" }), false);
  assert.equal(task.state.status, "UNKNOWN");
});

test("task completion is accepted with verified proof", () => {
  const task = new TaskStateMachine({ id: "t2", originalObjective: "publish verified artifact" });
  assert.equal(task.complete({ status: "VERIFIED", evidence: "sha" }), true);
  assert.equal(task.state.status, "COMPLETED");
});

test("unknown claim presented as fact is rejected", () => {
  const result = validateClaims([
    { id: "c1", claim: "deploy completed", verificationStatus: "UNKNOWN", presentedAsFact: true }
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "UNKNOWN_PRESENTED_AS_FACT");
});

test("supported material claim requires source and evidence", () => {
  const result = validateClaims([
    { id: "c1", claim: "commit exists", verificationStatus: "SUPPORTED", material: true }
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "SUPPORTED_CLAIM_MISSING_EVIDENCE");
});

test("output validator blocks unverified execution completion", () => {
  const result = validateOutput({
    policyDecision: { decision: "ALLOW" },
    routeDecision: { decision: "ALLOW" },
    mandatorySkills: { valid: true },
    completion: { status: "UNKNOWN" },
    claims: []
  });
  assert.equal(result.release, false);
  assert.match(result.reasons.join(","), /execution_proof/);
});

test("drift monitor marks PASS-to-UNKNOWN canary regression critical", () => {
  const result = detectDrift(
    { runtimeVersion: "1", canaryStatus: "PASS" },
    { runtimeVersion: "2", canaryStatus: "UNKNOWN" }
  );
  assert.equal(result.driftDetected, true);
  assert.equal(result.critical, true);
  assert.ok(result.changes.some((item) => item.code === "PROOF_DRIFT"));
});

test("pre-action pipeline blocks conflicting memory before tool execution", () => {
  const result = preActionPipeline({
    policy: basePolicy(),
    runtime: "claude",
    task: { originalObjective: "edit", labels: ["edit"], allowedTools: ["editor"] },
    action: { kind: "TOOL_CALL", tool: "editor", critical: true },
    memory: [
      { id: "m1", key: "target", value: "a", priority: "HIGH", status: "ACTIVE" },
      { id: "m2", key: "target", value: "b", priority: "HIGH", status: "ACTIVE" }
    ],
    toolRegistry: [{ id: "editor", status: "ACTIVE" }],
    availableTools: ["editor"]
  });
  assert.equal(result.decision, "REQUIRE_REVIEW");
  assert.equal(result.stage, "MEMORY_RESOLUTION");
});

test("pre-action pipeline blocks missing mandatory skill proof", () => {
  const result = preActionPipeline({
    policy: basePolicy(),
    runtime: "claude",
    task: { originalObjective: "edit", labels: ["edit"], allowedTools: ["editor"] },
    action: { kind: "TOOL_CALL", tool: "editor", critical: true },
    skillRegistry: [
      { id: "surgical-edit", priority: "MANDATORY", status: "ACTIVE", triggers: { taskLabels: ["edit"] } }
    ],
    skillExecution: [{ id: "surgical-edit", loaded: true, executed: false }],
    toolRegistry: [{ id: "editor", status: "ACTIVE" }],
    availableTools: ["editor"]
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.stage, "SKILL_RESOLUTION");
});

test("pre-action and final compliance pipeline release a fully proven result", () => {
  const policy = basePolicy([
    {
      id: "allow-editor",
      status: "ACTIVE",
      priority: "MANDATORY",
      phase: "PRE_ACTION",
      match: { tool: "editor" },
      effect: { type: "ALLOW" }
    }
  ]);

  const pre = preActionPipeline({
    policy,
    runtime: "generic",
    task: { originalObjective: "edit", allowedTools: ["editor"] },
    action: { kind: "TOOL_CALL", tool: "editor", critical: true },
    toolRegistry: [{ id: "editor", status: "ACTIVE" }],
    availableTools: ["editor"]
  });
  assert.equal(pre.decision, "ALLOW");

  const final = finalCompliancePipeline({
    preAction: pre,
    completion: { status: "VERIFIED" },
    claims: [{
      id: "c1",
      claim: "edit was verified",
      verificationStatus: "VERIFIED",
      presentedAsFact: true,
      source: "file-readback",
      evidence: "sha256:abc"
    }]
  });
  assert.equal(final.release, true);
});

test("final compliance rejects inference mislabeled as fact", () => {
  const final = validateOutput({
    policyDecision: { decision: "ALLOW" },
    claims: [{
      id: "c1",
      claim: "likely root cause",
      verificationStatus: "INFERRED",
      presentedAsFact: true
    }]
  });
  assert.equal(final.release, false);
});
