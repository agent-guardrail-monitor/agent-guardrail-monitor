import crypto from "node:crypto";
import { hashObject } from "./policy.mjs";

export function generateSigningKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" })
  };
}

export function signPolicy(policy, privateKeyPem, { keyId = "default" } = {}) {
  const policyHash = hashObject(policy);
  const signature = crypto.sign(null, Buffer.from(policyHash, "utf8"), privateKeyPem).toString("base64");
  return {
    bundleVersion: 1,
    algorithm: "Ed25519",
    keyId,
    policyHash,
    policy,
    signature
  };
}

export function verifyPolicyBundle(bundle, publicKeyPem) {
  if (!bundle || bundle.bundleVersion !== 1 || bundle.algorithm !== "Ed25519") {
    return { valid: false, code: "BUNDLE_SCHEMA_INVALID" };
  }
  if (!bundle.policy || !bundle.signature || !bundle.policyHash) {
    return { valid: false, code: "BUNDLE_INCOMPLETE" };
  }

  const actualHash = hashObject(bundle.policy);
  if (actualHash !== bundle.policyHash) {
    return { valid: false, code: "POLICY_HASH_MISMATCH", actualHash };
  }

  try {
    const valid = crypto.verify(
      null,
      Buffer.from(bundle.policyHash, "utf8"),
      publicKeyPem,
      Buffer.from(bundle.signature, "base64")
    );
    return { valid, code: valid ? "SIGNATURE_VERIFIED" : "SIGNATURE_INVALID", policyHash: actualHash, keyId: bundle.keyId || null };
  } catch (error) {
    return { valid: false, code: "SIGNATURE_CHECK_ERROR", error: String(error.message || error) };
  }
}
