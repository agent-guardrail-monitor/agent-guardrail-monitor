import fs from "node:fs";
import path from "node:path";
import { compileDirective, evaluatePolicy, validatePolicy, VERDICTS } from "./policy.mjs";
import { evaluateHook, hookOutput, loadPolicy } from "./hook.mjs";
import { AuditLog } from "./audit.mjs";
import { installHook } from "./install.mjs";
import { generateSigningKeyPair, signPolicy, verifyPolicyBundle } from "./signature.mjs";

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
    "  agm policy keygen --private-out PRIVATE.pem --public-out PUBLIC.pem",
    "  agm policy sign --file POLICY.json --private-key PRIVATE.pem --out BUNDLE.json [--key-id ID]",
    "  agm policy verify --file BUNDLE.json --public-key PUBLIC.pem",
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
      const publicKeyFile = value(rest, "--public-key");
      const publicKey = publicKeyFile ? fs.readFileSync(path.resolve(publicKeyFile), "utf8") : null;
      const policy = loadPolicy(path.resolve(file), { publicKey });
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

    if (sub === "keygen") {
      const privateOut = value(rest, "--private-out");
      const publicOut = value(rest, "--public-out");
      if (!privateOut || !publicOut) throw new Error("policy keygen requires --private-out and --public-out");
      const keys = generateSigningKeyPair();
      const privatePath = path.resolve(privateOut);
      const publicPath = path.resolve(publicOut);
      fs.mkdirSync(path.dirname(privatePath), { recursive: true });
      fs.mkdirSync(path.dirname(publicPath), { recursive: true });
      fs.writeFileSync(privatePath, keys.privateKeyPem, { encoding: "utf8", mode: 0o600 });
      fs.writeFileSync(publicPath, keys.publicKeyPem, "utf8");
      console.log(JSON.stringify({ status: "CREATED", privateKeyPath: privatePath, publicKeyPath: publicPath }, null, 2));
      return true;
    }

    if (sub === "sign") {
      const file = value(rest, "--file");
      const privateKeyFile = value(rest, "--private-key");
      const out = value(rest, "--out");
      if (!file || !privateKeyFile || !out) throw new Error("policy sign requires --file, --private-key and --out");
      const policy = readJson(file);
      const privateKey = fs.readFileSync(path.resolve(privateKeyFile), "utf8");
      const bundle = signPolicy(policy, privateKey, { keyId: value(rest, "--key-id", "default") });
      const outPath = path.resolve(out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n", "utf8");
      console.log(JSON.stringify({ status: "SIGNED", out: outPath, policyHash: bundle.policyHash, keyId: bundle.keyId }, null, 2));
      return true;
    }

    if (sub === "verify") {
      const file = value(rest, "--file");
      const publicKeyFile = value(rest, "--public-key");
      if (!file || !publicKeyFile) throw new Error("policy verify requires --file and --public-key");
      const bundle = readJson(file);
      const publicKey = fs.readFileSync(path.resolve(publicKeyFile), "utf8");
      const result = verifyPolicyBundle(bundle, publicKey);
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
      return true;
    }

    if (sub === "check") {
      const file = value(rest, "--file");
      const eventFile = value(rest, "--event");
      const runtime = value(rest, "--runtime");
      if (!file || !eventFile) throw new Error("policy check requires --file POLICY.json --event EVENT.json");
      const publicKeyFile = value(rest, "--public-key");
      const publicKey = publicKeyFile ? fs.readFileSync(path.resolve(publicKeyFile), "utf8") : null;
      const policy = loadPolicy(path.resolve(file), { publicKey });
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
      const publicKeyFile = value(args, "--public-key");
      const publicKey = publicKeyFile ? fs.readFileSync(path.resolve(publicKeyFile), "utf8") : null;
      const policy = loadPolicy(path.resolve(policyFile), { publicKey });
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
      policy: value(args, "--policy"),
      publicKey: value(args, "--public-key")
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
