import path from "node:path";
import {
  buildSnapshot,
  compareSnapshots,
  loadSnapshot,
  saveSnapshot
} from "./core.mjs";
import { proveInstalled } from "./prove.mjs";
import { runEnforcementCommand } from "./enforcement/cli.mjs";
import { buildRepairRequest, saveRepairRequest } from "./repair-handoff.mjs";

const DEFAULT_DIR = ".agent-guardrail-monitor";

function has(args, flag) {
  return args.includes(flag);
}

function value(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function statusRank(status) {
  return status === "FAIL" ? 2 : status === "UNKNOWN" ? 1 : 0;
}

function printRuntime(runtime) {
  const state = runtime.installed ? `installed ${runtime.version || "version unknown"}` : "not detected";
  console.log(`  ${runtime.name.padEnd(8)} ${state}`);
}

function printSnapshot(snapshot) {
  console.log(`Agent Guardrail Monitor ${snapshot.product.version}`);
  console.log(`Project: ${snapshot.cwd}`);
  console.log("Runtimes:");
  for (const runtime of snapshot.runtimes) printRuntime(runtime);

  console.log(`Configs: ${snapshot.configs.length}`);
  for (const config of snapshot.configs) {
    const events = config.events.length ? config.events.join(", ") : "no hook events detected";
    const state = config.valid ? "valid" : "INVALID";
    console.log(`  [${state}] ${config.runtime} ${config.path} :: ${events}`);
  }

  if (snapshot.proofs?.length) {
    console.log("Runtime proofs:");
    for (const proof of snapshot.proofs) {
      console.log(`  [${proof.status}] ${proof.runtime}: ${proof.reason}`);
    }
  }

  if (!snapshot.findings.length) {
    console.log("Findings: none");
  } else {
    console.log("Findings:");
    for (const item of [...snapshot.findings].sort((a, b) => statusRank(b.severity) - statusRank(a.severity))) {
      console.log(`  [${item.severity}] ${item.runtime}/${item.code}: ${item.message}`);
    }
  }
}

function printDiff(diff) {
  console.log(`Gate verdict: ${diff.verdict}`);
  for (const change of diff.changes) {
    if (change.code === "RUNTIME_VERSION_CHANGED") {
      console.log(`  [CHANGE] ${change.runtime}: ${change.before || "none"} -> ${change.after || "none"}`);
    } else {
      console.log(`  [CHANGE] ${change.runtime}: ${change.code}${change.path ? " " + change.path : ""}`);
    }
  }
  for (const regression of diff.regressions) {
    console.log(`  [REGRESSION] ${regression.runtime}: ${regression.code} - ${regression.message}`);
  }
}

function failCount(snapshot) {
  return (snapshot.findings || []).filter((item) => item.severity === "FAIL").length +
    (snapshot.proofs || []).filter((item) => item.status === "FAIL").length;
}

function help() {
  console.log(`
Agent Guardrail Monitor - vendor-neutral regression gate for coding-agent controls

Usage:
  agm doctor [--cwd DIR] [--json]
  agm prove [--live] [--json]
  agm snapshot [--cwd DIR] [--out FILE] [--prove] [--live]
  agm baseline [--cwd DIR] [--out FILE] [--prove] [--live]
  agm diff BASELINE CURRENT [--json]
  agm gate --baseline FILE [--cwd DIR] [--prove] [--live] [--json] [--repair-request FILE]
  agm policy validate|compile|check ...
  agm hook --runtime RUNTIME --policy POLICY.json
  agm install-hook --runtime claude|copilot|codex [--cwd DIR] [--policy POLICY.json]
  agm audit verify --file AUDIT.jsonl

Rules:
  PASS     execution or static evidence supports the control.
  FAIL     a regression or invalid control was observed.
  UNKNOWN  the tool does not have enough evidence to claim success.
`.trim());
}

async function makeSnapshot(args) {
  const cwd = path.resolve(value(args, "--cwd", process.cwd()));
  let snapshot = buildSnapshot(cwd);
  if (has(args, "--prove") || has(args, "--live")) {
    const proofs = proveInstalled(snapshot.runtimes, { live: has(args, "--live") });
    snapshot = buildSnapshot(cwd, proofs);
  }
  return snapshot;
}

export async function main(args) {
  const command = args[0] || "help";
  const rest = args.slice(1);
  const json = has(rest, "--json");

  if (["help", "--help", "-h"].includes(command)) {
    help();
    return;
  }

  const enforcementHandled = await runEnforcementCommand(command, rest);
  if (enforcementHandled) return;

  if (command === "doctor") {
    const snapshot = await makeSnapshot(rest);
    console.log(json ? JSON.stringify(snapshot, null, 2) : "");
    if (!json) printSnapshot(snapshot);
    if (failCount(snapshot)) process.exitCode = 1;
    return;
  }

  if (command === "prove") {
    const snapshot = buildSnapshot(process.cwd());
    const proofs = proveInstalled(snapshot.runtimes, { live: has(rest, "--live") });
    if (json) console.log(JSON.stringify(proofs, null, 2));
    else {
      console.log("Agent Guardrail Monitor runtime proof");
      for (const item of proofs) console.log(`  [${item.status}] ${item.runtime}: ${item.reason}`);
    }
    if (proofs.some((item) => item.status === "FAIL")) process.exitCode = 1;
    return;
  }

  if (command === "snapshot" || command === "baseline") {
    const snapshot = await makeSnapshot(rest);
    const defaultName = command === "baseline" ? "baseline.json" : "snapshot.json";
    const file = path.resolve(value(rest, "--out", path.join(DEFAULT_DIR, defaultName)));
    saveSnapshot(snapshot, file);
    if (json) console.log(JSON.stringify(snapshot, null, 2));
    else {
      printSnapshot(snapshot);
      console.log(`Saved: ${file}`);
    }
    if (failCount(snapshot)) process.exitCode = 1;
    return;
  }

  if (command === "diff") {
    const baselineFile = rest.find((item) => !item.startsWith("-"));
    const currentFile = rest.slice(rest.indexOf(baselineFile) + 1).find((item) => !item.startsWith("-"));
    if (!baselineFile || !currentFile) throw new Error("diff requires BASELINE and CURRENT snapshot files.");
    const diff = compareSnapshots(loadSnapshot(baselineFile), loadSnapshot(currentFile));
    if (json) console.log(JSON.stringify(diff, null, 2));
    else printDiff(diff);
    if (diff.verdict === "FAIL") process.exitCode = 1;
    return;
  }

  if (command === "gate") {
    const baselineFile = value(rest, "--baseline");
    if (!baselineFile) throw new Error("gate requires --baseline FILE.");
    const baseline = loadSnapshot(baselineFile);
    const current = await makeSnapshot(rest);
    const diff = compareSnapshots(baseline, current);
    const gateFailed = diff.verdict === "FAIL" || failCount(current) > 0;
    let repairRequest = null;
    let repairRequestFile = null;

    if (gateFailed) {
      repairRequest = buildRepairRequest({
        regressions: diff.regressions,
        findings: current.findings,
        proofs: current.proofs,
        context: {
          cwd: current.cwd,
          baselineGeneratedAt: baseline.generatedAt,
          currentGeneratedAt: current.generatedAt
        }
      });
      const repairRequestPath = value(
        rest,
        "--repair-request",
        value(rest, "--repair-handoff", path.join(DEFAULT_DIR, "repair-request.json"))
      );
      repairRequestFile = saveRepairRequest(repairRequest, repairRequestPath);
    }

    if (json) {
      console.log(JSON.stringify({ current, diff, repairRequest, repairRequestFile }, null, 2));
    } else {
      printSnapshot(current);
      console.log("");
      printDiff(diff);
      if (repairRequestFile) console.log(`Repair request: ${repairRequestFile}`);
    }
    if (gateFailed) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}