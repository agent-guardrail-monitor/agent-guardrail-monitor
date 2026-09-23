import crypto from "node:crypto";

export const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function sign(encoded, secret) {
  return crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function numericId(value, field) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${field} must be a numeric GitHub id`);
  return text;
}

export function createOAuthTransaction({
  installationId,
  marketplacePlanId = null,
  secret,
  now = Date.now()
}) {
  if (!secret) throw new Error("OAuth state secret is not configured");

  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const payload = {
    state,
    verifier,
    installationId: numericId(installationId, "installationId"),
    marketplacePlanId: marketplacePlanId == null || marketplacePlanId === ""
      ? null
      : numericId(marketplacePlanId, "marketplacePlanId"),
    createdAt: Number(now)
  };
  const encoded = encodeJson(payload);
  const transaction = `${encoded}.${sign(encoded, secret)}`;

  return { state, verifier, challenge, transaction };
}

export function verifyOAuthTransaction({
  transaction,
  state,
  secret,
  now = Date.now(),
  ttlMs = OAUTH_TRANSACTION_TTL_MS
}) {
  if (!secret) throw new Error("OAuth state secret is not configured");
  const [encoded, signature, extra] = String(transaction || "").split(".");
  if (!encoded || !signature || extra !== undefined) throw new Error("Invalid OAuth transaction");
  if (!safeEqual(signature, sign(encoded, secret))) throw new Error("Invalid OAuth transaction signature");

  const payload = decodeJson(encoded);
  if (!safeEqual(payload.state, state)) throw new Error("OAuth state mismatch");
  if (!Number.isFinite(payload.createdAt)) throw new Error("OAuth transaction timestamp is invalid");
  const age = Number(now) - payload.createdAt;
  if (age < 0 || age > ttlMs) throw new Error("OAuth transaction expired");

  numericId(payload.installationId, "installationId");
  if (payload.marketplacePlanId != null) numericId(payload.marketplacePlanId, "marketplacePlanId");
  if (typeof payload.verifier !== "string" || payload.verifier.length < 43) {
    throw new Error("OAuth PKCE verifier is invalid");
  }
  return payload;
}
