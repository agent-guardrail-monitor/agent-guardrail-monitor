import crypto from "node:crypto";
import { validateRepairPlan } from "./plan.mjs";
import { repairPreflight, validateRepairEvidence } from "./protocol.mjs";

function text(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function repairBranchName(baseSha, failureEvidence) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(failureEvidence))
    .digest("hex")
    .slice(0, 8);
  return `agm/repair/${String(baseSha).slice(0, 7)}-${digest}-${Date.now().toString(36)}`;
}

function prBody({ failureEvidence, plan, verification, evidenceGate }) {
  const failures = failureEvidence.map((item) => `- ${item}`).join("\n");
  const files = plan.files.map((item) => `- \`${item.path}\`: ${item.reason}`).join("\n");
  const verificationText = verification?.evidence || verification?.summary || "No verification evidence returned.";
  return [
    "## Agent Guardrail Monitor automated repair",
    "",
    "### Detected failure evidence",
    failures,
    "",
    "### Root cause",
    plan.rootCause,
    "",
    "### Changes",
    files,
    "",
    "### Verification",
    verificationText,
    "",
    `Final repair gate: **${evidenceGate.finalState}**`,
    "",
    "This pull request was created by the integrated Monitor + Repair engine."
  ].join("\n").slice(0, 60_000);
}

export async function executeRepairCycle({
  owner,
  repo,
  defaultBranch = "main",
  repairBaseSha,
  baselineRef,
  objective = "Repair the guardrail regression and restore the approved control.",
  failureEvidence = [],
  repoClient,
  repairModel,
  verify,
  options = {}
} = {}) {
  if (!owner || !repo) throw new Error("owner and repo are required");
  if (!repoClient) throw new Error("repoClient is required");
  if (!repairModel?.proposeRepair) throw new Error("repairModel.proposeRepair is required");
  if (typeof verify !== "function") throw new Error("verify function is required");

  const failures = failureEvidence.map((item) => text(item, 3000)).filter(Boolean);
  if (!failures.length) {
    return {
      status: "NO_REPAIR_REQUIRED",
      finalState: "INVESTIGATION INCOMPLETE",
      reasons: ["No repair-triggering failure evidence was supplied."]
    };
  }

  const baseSha = repairBaseSha || await repoClient.getHead(defaultBranch);
  if (!baseSha) throw new Error(`Unable to resolve repair base for ${defaultBranch}`);

  const currentContext = await repoClient.readRepairContext({
    ref: baseSha,
    failureEvidence: failures
  });
  const baselineContext = baselineRef
    ? await repoClient.readRepairContext({ ref: baselineRef, failureEvidence: failures })
    : [];

  const repositoryContext = {
    baselineRef: baselineRef || null,
    currentRef: baseSha,
    baseline: baselineContext,
    current: currentContext
  };

  const proposed = await repairModel.proposeRepair({
    objective,
    failureEvidence: failures,
    repositoryContext
  });
  const validation = validateRepairPlan(proposed, {
    allowWorkflowChanges: options.allowWorkflowChanges === true
  });
  if (!validation.valid) {
    return {
      status: "PLAN_BLOCKED",
      finalState: "ROOT CAUSE FOUND, PATCH BLOCKED",
      reasons: validation.errors
    };
  }
  const plan = validation.normalized;

  const beforePatch = repairPreflight({
    failureEvidence: failures,
    rootCause: plan.rootCause,
    changedFiles: []
  });
  if (beforePatch.stage !== "READY_TO_PATCH") {
    return {
      status: "EVIDENCE_BLOCKED",
      finalState: "INVESTIGATION INCOMPLETE",
      reasons: beforePatch.missing
    };
  }

  const branch = repairBranchName(baseSha, failures);
  await repoClient.createBranch(branch, baseSha);

  const changedFiles = [];
  for (const file of plan.files) {
    await repoClient.upsertFile({
      path: file.path,
      content: file.content,
      branch,
      message: `repair: ${file.reason.slice(0, 120)}`
    });
    changedFiles.push(file.path);
  }

  const repairSha = await repoClient.getHead(branch);
  if (!repairSha) throw new Error("Repair branch head could not be resolved after patching");

  const verification = await verify({
    owner,
    repo,
    ref: repairSha,
    baseRef: baseSha,
    branch,
    failureEvidence: failures,
    plan
  });

  const checksRun = [{
    name: "Agent Guardrail Monitor branch verification",
    phase: "after patch verification",
    status: verification?.pass === true ? "passed" : "failed",
    evidence: text(verification?.evidence || verification?.summary || "AGM verification returned no detail.", 4000)
  }];

  const preliminaryGate = validateRepairEvidence({
    requestedState: verification?.pass === true ? "VERIFIED FIX" : "PATCHED, NOT VERIFIED",
    failureEvidence: failures,
    rootCause: plan.rootCause,
    changedFiles,
    checksRun,
    recurrenceReview: plan.recurrenceReview,
    deploymentInScope: false,
    residualRisks: plan.residualRisks
  });

  const pr = await repoClient.createPullRequest({
    title: `Repair guardrail regression: ${plan.summary.slice(0, 160)}`,
    body: prBody({
      failureEvidence: failures,
      plan,
      verification,
      evidenceGate: preliminaryGate
    }),
    head: branch,
    base: defaultBranch
  });

  let ci = { status: "not_checked", runs: [] };
  if (options.waitForChecks !== false) {
    ci = await repoClient.waitForChecks(repairSha, {
      timeoutMs: options.checkTimeoutMs || 180_000,
      pollMs: options.checkPollMs || 5_000
    });
    if (ci.status === "passed") {
      checksRun.push({
        name: "Repository CI checks",
        phase: "after patch verification",
        status: "passed",
        evidence: `${ci.runs.length} repository check run(s) completed without failure.`
      });
    } else if (ci.status === "failed") {
      checksRun.push({
        name: "Repository CI checks",
        phase: "after patch verification",
        status: "failed",
        evidence: `${ci.failed.length} repository check run(s) failed.`
      });
    }
  }

  const repairVerified = verification?.pass === true && ci.status !== "failed";
  const canAutoMerge = options.autoMerge === true && repairVerified;

  if (!canAutoMerge) {
    return {
      status: repairVerified ? "VERIFIED_REPAIR_PR_OPENED" : "REPAIR_PR_OPENED_NEEDS_REVIEW",
      finalState: "PATCHED, NOT VERIFIED",
      baseSha,
      repairSha,
      branch,
      pullRequest: { number: pr?.number, url: pr?.html_url || pr?.url || null },
      rootCause: plan.rootCause,
      changedFiles,
      checksRun,
      recurrenceReview: plan.recurrenceReview,
      residualRisks: plan.residualRisks
    };
  }

  const merged = await repoClient.mergePullRequest({
    number: pr.number,
    sha: repairSha,
    method: options.mergeMethod || "squash"
  });
  if (!merged?.merged) {
    return {
      status: "AUTO_MERGE_BLOCKED",
      finalState: "PATCHED, NOT VERIFIED",
      pullRequest: { number: pr?.number, url: pr?.html_url || pr?.url || null },
      reasons: [merged?.message || "GitHub did not merge the verified repair PR."]
    };
  }

  const mergedSha = merged.sha || await repoClient.getHead(defaultBranch);
  const finalVerification = await verify({
    owner,
    repo,
    ref: mergedSha,
    baseRef: baseSha,
    branch: defaultBranch,
    failureEvidence: failures,
    plan
  });
  checksRun.push({
    name: "Agent Guardrail Monitor merged-state verification",
    phase: "final verification",
    status: finalVerification?.pass === true ? "passed" : "failed",
    evidence: text(finalVerification?.evidence || finalVerification?.summary || "No merged-state detail.", 4000)
  });

  const finalGate = validateRepairEvidence({
    requestedState: finalVerification?.pass === true ? "VERIFIED FIX" : "PATCHED, NOT VERIFIED",
    failureEvidence: failures,
    rootCause: plan.rootCause,
    changedFiles,
    checksRun,
    recurrenceReview: plan.recurrenceReview,
    deploymentInScope: false,
    residualRisks: plan.residualRisks
  });

  return {
    status: finalGate.release && finalGate.finalState === "VERIFIED FIX"
      ? "AUTO_REPAIR_VERIFIED"
      : "AUTO_REPAIR_MERGED_NEEDS_VERIFICATION",
    finalState: finalGate.finalState,
    baseSha,
    repairSha,
    mergedSha,
    branch,
    pullRequest: { number: pr?.number, url: pr?.html_url || pr?.url || null },
    rootCause: plan.rootCause,
    changedFiles,
    checksRun,
    recurrenceReview: plan.recurrenceReview,
    residualRisks: plan.residualRisks,
    finalGate
  };
}
