import test from "node:test";
import assert from "node:assert/strict";
import { repairPreflight, validateRepairEvidence } from "../src/repair/protocol.mjs";
import { validateRepairPlan } from "../src/repair/plan.mjs";
import { executeRepairCycle } from "../src/repair/executor.mjs";
import { compareRepositoryScans } from "../src/repair/regression.mjs";
import { parseRepairConfig } from "../src/repair/config.mjs";
import { createOpenAIRepairModel } from "../src/repair/openai-model.mjs";

const validPlan = {
  summary: "Restore disabled hook configuration",
  rootCause: "The repository configuration changed disableAllHooks from false to true.",
  rootCauseEvidence: ["The failing config contains disableAllHooks=true while hooks remain declared."],
  files: [{
    path: ".claude/settings.json",
    content: JSON.stringify({ hooks: { PreToolUse: [] }, disableAllHooks: false }, null, 2),
    reason: "Restore the approved hook activation state."
  }],
  verification: ["Re-run Agent Guardrail Monitor against the repair commit."],
  recurrenceReview: "Reviewed the same disableAllHooks setting across supported project configuration paths.",
  residualRisks: []
};

test("integrated repair protocol blocks VERIFIED FIX without executable proof", () => {
  const result = validateRepairEvidence({
    requestedState: "VERIFIED FIX",
    failureEvidence: ["HOOKS_DISABLED"],
    rootCause: "disableAllHooks=true",
    changedFiles: [".claude/settings.json"],
    checksRun: [],
    recurrenceReview: "reviewed"
  });
  assert.equal(result.release, false);
  assert.equal(result.finalState, "PATCHED, NOT VERIFIED");
  assert.ok(result.missing.includes("passing_post_patch_executable_check"));
});

test("repair preflight reaches READY_TO_PATCH only after failure and root cause evidence", () => {
  const result = repairPreflight({
    failureEvidence: ["HOOKS_DISABLED"],
    rootCause: "disableAllHooks=true",
    changedFiles: []
  });
  assert.equal(result.decision, "PROCEED");
  assert.equal(result.stage, "READY_TO_PATCH");
});

test("repair plan blocks workflow mutation by default", () => {
  const result = validateRepairPlan({
    ...validPlan,
    files: [{
      path: ".github/workflows/ci.yml",
      content: "name: changed",
      reason: "Change CI"
    }]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("file_0_path_blocked"));
});

function fakeRepoClient() {
  const heads = { main: "base123456789" };
  return {
    async getHead(ref) { return heads[ref] || null; },
    async readRepairContext() {
      return [{ path: ".claude/settings.json", sha: "old", content: "{\"disableAllHooks\":true}" }];
    },
    async createBranch(branch, baseSha) { heads[branch] = baseSha; },
    async upsertFile({ branch }) { heads[branch] = "repair987654321"; },
    async createPullRequest() { return { number: 7, html_url: "https://github.test/pr/7" }; },
    async waitForChecks() { return { status: "passed", runs: [{ name: "test", status: "completed", conclusion: "success" }], failed: [] }; },
    async mergePullRequest() { heads.main = "merged555555"; return { merged: true, sha: heads.main }; }
  };
}

const repairModel = {
  async proposeRepair() { return validPlan; }
};

test("closed-loop executor opens a verified repair PR when auto-merge is disabled", async () => {
  const result = await executeRepairCycle({
    owner: "acme",
    repo: "demo",
    failureEvidence: ["[claude] HOOKS_DISABLED: hooks disabled"],
    repoClient: fakeRepoClient(),
    repairModel,
    verify: async () => ({ pass: true, evidence: "Original failure no longer reproduces." }),
    options: { autoMerge: false, waitForChecks: true }
  });
  assert.equal(result.status, "VERIFIED_REPAIR_PR_OPENED");
  assert.equal(result.finalState, "PATCHED, NOT VERIFIED");
  assert.equal(result.pullRequest.number, 7);
});

test("closed-loop executor merges and revalidates when auto-merge is explicitly enabled", async () => {
  const result = await executeRepairCycle({
    owner: "acme",
    repo: "demo",
    failureEvidence: ["[claude] HOOKS_DISABLED: hooks disabled"],
    repoClient: fakeRepoClient(),
    repairModel,
    verify: async () => ({ pass: true, evidence: "Guardrail state passes." }),
    options: { autoMerge: true, waitForChecks: true }
  });
  assert.equal(result.status, "AUTO_REPAIR_VERIFIED");
  assert.equal(result.finalState, "VERIFIED FIX");
  assert.equal(result.mergedSha, "merged555555");
});


test("repository scan comparison detects removed hook events as repairable regressions", () => {
  const before = {
    results: [{ runtime: "claude", filePath: ".claude/settings.json", events: ["PreToolUse"], fails: [] }],
    fails: []
  };
  const current = {
    results: [{ runtime: "claude", filePath: ".claude/settings.json", events: [], fails: [] }],
    fails: []
  };
  const result = compareRepositoryScans(before, current);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.regressions[0].code, "HOOK_EVENT_REMOVED");
  assert.match(result.failureEvidence[0], /PreToolUse/);
});

test("repository repair config defaults to automatic repair PR and requires explicit auto-merge", () => {
  const defaults = parseRepairConfig("");
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.mode, "pull_request");
  assert.equal(defaults.autoMerge, false);

  const auto = parseRepairConfig(JSON.stringify({ repair: { mode: "auto_merge" } }));
  assert.equal(auto.enabled, true);
  assert.equal(auto.autoMerge, true);
});

test("invalid repository repair config is surfaced instead of silently enabling custom behavior", () => {
  const config = parseRepairConfig("{");
  assert.equal(config.configError, "Invalid .agent-guardrail-monitor/config.json");
});


test("repair model receives both pre-regression baseline and broken commit context", async () => {
  const refs = [];
  const repoClient = fakeRepoClient();
  repoClient.readRepairContext = async ({ ref }) => {
    refs.push(ref);
    return [{ path: ".claude/settings.json", sha: ref, content: ref === "before111" ? "{\"hooks\":{\"PreToolUse\":[]}}" : "{\"hooks\":{}}" }];
  };
  let observedContext;
  const model = {
    async proposeRepair(input) {
      observedContext = input.repositoryContext;
      return validPlan;
    }
  };

  await executeRepairCycle({
    owner: "acme",
    repo: "demo",
    repairBaseSha: "after222",
    baselineRef: "before111",
    failureEvidence: ["[claude] HOOK_EVENT_REMOVED: PreToolUse disappeared"],
    repoClient,
    repairModel: model,
    verify: async () => ({ pass: true, evidence: "restored" }),
    options: { autoMerge: false, waitForChecks: false }
  });

  assert.deepEqual(refs, ["after222", "before111"]);
  assert.equal(observedContext.currentRef, "after222");
  assert.equal(observedContext.baselineRef, "before111");
  assert.match(observedContext.baseline[0].content, /PreToolUse/);
});


test("OpenAI repair provider uses structured output with store disabled", async () => {
  let requestBody;
  const model = createOpenAIRepairModel({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            output: [{
              content: [{
                type: "output_text",
                text: JSON.stringify(validPlan)
              }]
            }]
          });
        }
      };
    }
  });

  const plan = await model.proposeRepair({
    objective: "restore hooks",
    failureEvidence: ["HOOK_EVENT_REMOVED"],
    repositoryContext: { baseline: [], current: [] }
  });

  assert.equal(requestBody.store, false);
  assert.equal(requestBody.model, "test-model");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(plan.rootCause, validPlan.rootCause);
});

test("OpenAI repair provider refuses execution without an API key", async () => {
  const model = createOpenAIRepairModel({ apiKey: "" });
  assert.equal(model.configured, false);
  await assert.rejects(
    () => model.proposeRepair({
      objective: "repair",
      failureEvidence: ["FAIL"],
      repositoryContext: {}
    }),
    /OPENAI_API_KEY/
  );
});


test("repair plan cannot mutate files outside the evidenced guardrail scope", () => {
  const result = validateRepairPlan({
    ...validPlan,
    files: [{
      path: "README.md",
      content: "changed",
      reason: "unrelated change"
    }]
  }, {
    allowedPaths: new Set([".claude/settings.json"])
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("file_0_path_outside_repair_scope"));
});

test("auto-merge is blocked when repository checks time out", async () => {
  let mergeCalled = false;
  const repoClient = fakeRepoClient();
  repoClient.waitForChecks = async () => ({ status: "timeout", runs: [], failed: [] });
  repoClient.mergePullRequest = async () => {
    mergeCalled = true;
    return { merged: true, sha: "should-not-merge" };
  };

  const result = await executeRepairCycle({
    owner: "acme",
    repo: "demo",
    failureEvidence: ["[claude] HOOKS_DISABLED: hooks disabled"],
    repoClient,
    repairModel,
    verify: async () => ({ pass: true, evidence: "Guardrail state passes." }),
    options: { autoMerge: true, waitForChecks: true, checkTimeoutMs: 10_000 }
  });

  assert.equal(mergeCalled, false);
  assert.equal(result.status, "REPAIR_PR_OPENED_NEEDS_REVIEW");
  assert.equal(result.finalState, "PATCHED, NOT VERIFIED");
});
