import fs from "node:fs";
import path from "node:path";
import { compileDirective, evaluatePolicy, validatePolicy, VERDICTS } from "./policy.mjs";
import { evaluateHook, hookOutput, loadPolicy } from "./hook.mjs";
import { AuditLog } from "./audit.mjs";
import { installHook } from "./install.mjs";

function value(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
    if (process.stdin.isTTY) resolve("");
  });
}

function enforcementHelp() {
  console.log([
    "Enforcement commands:",
    "  agm policy validate --file POLICY.json",
    "  agm policy compile --file DIRECTIVE.json",
    "  agm policy check --file POLICY.json --event EVENT.json [--runtime claude|codex|copilot]",
    "  agm hook --runtime claude|codex|copilot --policy POLICY.json [--task TASK.json] [--skills SKILLS.json]",
    "  agm install-hook --runtime claude|copilot|codex [--cwd DIR] [--policy POLICY.json]",
    "  agm audit verify --file AUDIT.jsonl"
  ].join("\n"));
}

function exitForDecision(decision) {
  if (decision === VERDICTS.BLOCK) process.exitCode = 1;
  if ([VERDICTS.UNKNOWN, VERDICTS.REQUIRE_REVIEW].includes(decision)) process.exitCode = 2;
}

export async function runEnforcementCommand(command, args) {
  if (command === "policy") {
    const sub = args[0] || "help";
    const rest = args.slice(1);

    if (["help", "--help", "-h"].includes(sub)) {
      enforcementHelp();
      return true;
    }

    if (sub === "validate") {
      const file = value(rest, "--file");
      if (!file) throw new Error("policy validate requires --file POLICY.json");
      const policy = loadPolicy(path.resolve(file));
      const result = validatePolicy(policy);
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
      return true;
    }

    if (sub === "compile") {
      const file = value(rest, "--file");
      if (!file) throw new Error("policy compile requires --file DIRECTIVE.json");
      const result = compileDirective(readJson(file));
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "COMPILED") process.exitCode = 2;
      return true;
    }

    if (sub === "check") {
      const file = value(rest, "--file");
      const eventFile = value(rest, "--event");
      const runtime = value(rest, "--runtime");
      if (!file || !eventFile) throw new Error("policy check requires --file POLICY.json --event EVENT.json");
      const policy = loadPolicy(path.resolve(file));
      const event = readJson(eventFile);
      const result = runtime ? evaluateHook(policy, runtime, event) : evaluatePolicy(policy, event);
      console.log(JSON.stringify(result, null, 2));
      exitForDecision(result.decision);
      return true;
    }

    throw new Error("Unknown policy command: " + sub);
  }

  if (command === "hook") {
    const runtime = value(args, "--runtime");
    const policyFile = value(args, "--policy");
    if (!runtime) throw new Error("hook requires --runtime claude|codex|copilot");

    try {
      if (!policyFile) throw new Error("Missing --policy");
      const raw = await readStdin();
      const input = raw.trim() ? JSON.parse(raw) : {};
      const taskFile = value(args, "--task");
      const skillsFile = value(args, "--skills");
      if (taskFile) input.agmTask = readJson(taskFile);
      if (skillsFile) input.agmSkills = readJson(skillsFile);
      const policy = loadPolicy(path.resolve(policyFile));
      const decision = evaluateHook(policy, runtime, input);
      console.log(JSON.stringify(hookOutput(runtime, decision)));
    } catch (error) {
      const blocked = {
        decision: VERDICTS.BLOCK,
        code: "HOOK_FAIL_CLOSED",
        reasons: ["Agent Guardrail Monitor could not prove policy evaluation: " + String(error.message || error)]
      };
      console.log(JSON.stringify(hookOutput(runtime, blocked)));
    }
    return true;
  }

  if (command === "install-hook") {
    const runtime = value(args, "--runtime");
    if (!runtime) throw new Error("install-hook requires --runtime claude|copilot|codex");
    const result = installHook({
      runtime,
      cwd: value(args, "--cwd", process.cwd()),
      policy: value(args, "--policy")
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "INSTALLED") process.exitCode = 2;
    return true;
  }

  if (command === "audit") {
    const sub = args[0] || "help";
    const rest = args.slice(1);
    if (sub === "verify") {
      const file = value(rest, "--file");
      if (!file) throw new Error("audit verify requires --file AUDIT.jsonl");
      const result = new AuditLog(file).verify();
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
      return true;
    }
    enforcementHelp();
    return true;
  }

  return false;
}
