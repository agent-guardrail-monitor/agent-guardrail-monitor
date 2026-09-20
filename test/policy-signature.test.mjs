import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateSigningKeyPair, signPolicy, verifyPolicyBundle } from "../src/enforcement/signature.mjs";
import { loadPolicy } from "../src/enforcement/hook.mjs";
import { installHook } from "../src/enforcement/install.mjs";

function policy() {
  return {
    schemaVersion: 1,
    policyId: "signed-test",
    version: 1,
    strict: true,
    rules: []
  };
}

test("Ed25519 policy bundle verifies with matching public key", () => {
  const keys = generateSigningKeyPair();
  const bundle = signPolicy(policy(), keys.privateKeyPem, { keyId: "org-key-1" });
  const result = verifyPolicyBundle(bundle, keys.publicKeyPem);
  assert.equal(result.valid, true);
  assert.equal(result.code, "SIGNATURE_VERIFIED");
  assert.equal(result.keyId, "org-key-1");
});

test("tampered signed policy is rejected", () => {
  const keys = generateSigningKeyPair();
  const bundle = signPolicy(policy(), keys.privateKeyPem);
  bundle.policy.version = 2;
  const result = verifyPolicyBundle(bundle, keys.publicKeyPem);
  assert.equal(result.valid, false);
  assert.equal(result.code, "POLICY_HASH_MISMATCH");
});

test("signed policy load requires public key and verifies before returning policy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agm-signed-load-"));
  try {
    const keys = generateSigningKeyPair();
    const bundle = signPolicy(policy(), keys.privateKeyPem);
    const file = path.join(root, "policy.bundle.json");
    fs.writeFileSync(file, JSON.stringify(bundle));

    assert.throws(() => loadPolicy(file), /requires a public key/i);
    const loaded = loadPolicy(file, { publicKey: keys.publicKeyPem });
    assert.equal(loaded.policyId, "signed-test");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer refuses signed policy without public key and wires key when supplied", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agm-signed-install-"));
  try {
    const keys = generateSigningKeyPair();
    const bundle = signPolicy(policy(), keys.privateKeyPem);
    const bundlePath = path.join(root, "policy.bundle.json");
    const publicKeyPath = path.join(root, "policy-public.pem");
    fs.writeFileSync(bundlePath, JSON.stringify(bundle));
    fs.writeFileSync(publicKeyPath, keys.publicKeyPem);

    assert.throws(
      () => installHook({ runtime: "copilot", cwd: root, policy: bundlePath }),
      /requires --public-key/i
    );

    const installed = installHook({
      runtime: "copilot",
      cwd: root,
      policy: bundlePath,
      publicKey: publicKeyPath
    });
    const config = JSON.parse(fs.readFileSync(installed.configPath, "utf8"));
    const args = config.hooks.preToolUse[0].args;
    assert.ok(args.includes("--public-key"));
    assert.ok(args.includes(publicKeyPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
