import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { evaluateForAccount } from "./service.mjs";
import { RULESET_VERSION, RULE_CATALOG } from "./rule-catalog.mjs";
import {
  databaseConfigured,
  installAccount,
  listErrors,
  listFeatureFlags,
  listMemory,
  recordError,
  resolveInstanceToken,
  setFeatureFlag,
  upsertMemory
} from "./db.mjs";
import { createCognitiveBlockerMcpNodeHandler } from "./mcp.mjs";
import { resolveFeatures, isFeatureEnabled } from "./feature-catalog.mjs";
import { buildInternalErrorReport } from "./internal-errors.mjs";
import { assertPermission, PERMISSIONS, permissionMatrix } from "./rbac.mjs";
import { RECOVERY_MAX_ATTEMPTS } from "./recovery.mjs";
import { beginAccountTurn } from "./context-rehydration.mjs";
import { handleOAuthRequest, oauthChallenge } from "./oauth-router.mjs";
import { oauthConfigured, publicBaseUrl } from "./oauth.mjs";
import { publicPage } from "./public-pages.mjs";

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";
const CLAIM_STATES = new Set(["EVIDENCE","INFERENCE","HYPOTHESIS","ESTIMATE","UNKNOWN","REFUTED"]);

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data)
  });
  res.end(data);
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req, limit = 1024 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error("request_too_large"), { code: "REQUEST_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function authenticated(req, res) {
  const baseUrl = publicBaseUrl(req);
  const instance = await resolveInstanceToken(bearer(req));
  if (!instance) {
    res.setHeader("www-authenticate", oauthChallenge(baseUrl));
    send(res, 401, { error: "authentication_required" });
    return null;
  }

  if (instance.oauth_resource && instance.oauth_resource !== baseUrl + "/mcp") {
    res.setHeader("www-authenticate", oauthChallenge(
      baseUrl,
      "invalid_token",
      "The access token was issued for another resource."
    ));
    send(res, 401, { error: "invalid_token_resource" });
    return null;
  }

  if (
    instance.oauth_scope &&
    !String(instance.oauth_scope).split(/\s+/).includes("cognitive:use")
  ) {
    res.setHeader("www-authenticate", oauthChallenge(
      baseUrl,
      "insufficient_scope",
      "The cognitive:use scope is required."
    ));
    send(res, 403, { error: "insufficient_scope" });
    return null;
  }

  return instance;
}

function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function authorize(instance, permission) {
  assertPermission(instance.role, permission);
}

async function captureRequestError(instance, requestId, url, error) {
  if (!instance?.account_id || !databaseConfigured()) return;
  try {
    const overrides = await listFeatureFlags(instance.account_id);
    if (!isFeatureEnabled("internal_error_reporting", overrides)) return;
    const report = buildInternalErrorReport({
      error,
      source: "http_request",
      errorCode: error.code,
      context: {
        requestId,
        path: url?.pathname || null,
        role: instance.role
      }
    });
    await recordError(instance.account_id, report);
  } catch {
    // Error reporting must never recursively break the request path.
  }
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  let instance = null;
  let url = null;

  try {
    url = new URL(req.url, "http://localhost");

    if (req.method === "GET") {
      const page = publicPage(url.pathname);
      if (page) return sendHtml(res, 200, page);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        product: "Cognitive Blocker Plugin",
        version: "0.5.0",
        rulesetVersion: RULESET_VERSION,
        canonicalRuleCount: RULE_CATALOG.length,
        recoveryMaxAttempts: RECOVERY_MAX_ATTEMPTS,
        activationMode: "ALWAYS_ON",
        autoRegisterConversations: true,
        oauthConfigured: oauthConfigured(),
        databaseConfigured: databaseConfigured()
      });
    }

    if (await handleOAuthRequest(req, res, url)) return;

    if (req.method === "POST" && url.pathname === "/v1/install") {
      if (!process.env.INSTALL_SECRET || req.headers["x-install-secret"] !== process.env.INSTALL_SECRET) {
        return send(res, 401, { error: "invalid_install_secret" });
      }
      const body = await readJson(req);
      const platform = String(body.platform || "").toLowerCase();
      if (!["chatgpt","claude","gemini","other"].includes(platform) || !body.externalAccountRef) {
        return send(res, 400, { error: "platform_and_externalAccountRef_required" });
      }
      const installed = await installAccount({
        platform,
        externalAccountRef: String(body.externalAccountRef),
        label: body.label ? String(body.label) : null
      });
      return send(res, 201, { ...installed, tokenIssuedOnce: true });
    }

    instance = await authenticated(req, res);
    if (!instance) return;

    if (url.pathname === "/mcp") {
      const handler = createCognitiveBlockerMcpNodeHandler({
        accountId: instance.account_id,
        role: instance.role
      });
      return handler(req, res);
    }

    if (req.method === "GET" && url.pathname === "/v1/status") {
      authorize(instance, PERMISSIONS.STATUS_READ);
      const overrides = await listFeatureFlags(instance.account_id);
      return send(res, 200, {
        product: "Cognitive Blocker Plugin",
        version: "0.5.0",
        role: instance.role,
        accountScoped: true,
        rulesetVersion: RULESET_VERSION,
        canonicalRuleCount: RULE_CATALOG.length,
        recoveryMaxAttempts: RECOVERY_MAX_ATTEMPTS,
        activationMode: instance.activation_mode || "ALWAYS_ON",
        autoRegisterConversations: instance.auto_register_conversations !== false,
        features: resolveFeatures(overrides)
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/turn/begin") {
      authorize(instance, PERMISSIONS.GUARD_CHECK);
      const body = await readJson(req);
      const requestFingerprint = body.requestFingerprint || fingerprint(body);
      const context = await beginAccountTurn(instance.account_id, {
        ...body,
        requestFingerprint
      });
      return send(res, 200, context);
    }

    if (req.method === "POST" && url.pathname === "/v1/check") {
      authorize(instance, PERMISSIONS.GUARD_CHECK);
      const body = await readJson(req);
      const result = await evaluateForAccount(instance.account_id, {
        ...body,
        requestFingerprint: fingerprint(body)
      });
      return send(res, result.decision === "ALLOW" ? 200 : 409, result);
    }

    if (req.method === "PUT" && url.pathname === "/v1/memory") {
      authorize(instance, PERMISSIONS.MEMORY_WRITE);
      const body = await readJson(req);
      if (!body.key || !body.type || !CLAIM_STATES.has(body.claimState)) {
        return send(res, 400, { error: "key_type_and_valid_claimState_required" });
      }
      return send(res, 200, await upsertMemory(instance.account_id, body));
    }

    if (req.method === "GET" && url.pathname === "/v1/memory") {
      authorize(instance, PERMISSIONS.MEMORY_READ);
      const projectId = url.searchParams.get("projectId");
      return send(res, 200, { items: await listMemory(instance.account_id, projectId) });
    }

    if (req.method === "GET" && url.pathname === "/v1/features") {
      authorize(instance, PERMISSIONS.FEATURES_READ);
      return send(res, 200, {
        features: resolveFeatures(await listFeatureFlags(instance.account_id))
      });
    }

    if (req.method === "PUT" && url.pathname.startsWith("/v1/features/")) {
      authorize(instance, PERMISSIONS.FEATURES_MANAGE);
      const key = decodeURIComponent(url.pathname.slice("/v1/features/".length));
      const body = await readJson(req);
      if (typeof body.enabled !== "boolean") {
        return send(res, 400, { error: "enabled_boolean_required" });
      }
      return send(res, 200, await setFeatureFlag(
        instance.account_id,
        instance.role,
        key,
        body.enabled
      ));
    }

    if (req.method === "POST" && url.pathname === "/v1/errors") {
      authorize(instance, PERMISSIONS.ERRORS_REPORT);
      const overrides = await listFeatureFlags(instance.account_id);
      if (!isFeatureEnabled("internal_error_reporting", overrides)) {
        return send(res, 409, { error: "internal_error_reporting_disabled" });
      }
      const body = await readJson(req);
      if (!body.message) return send(res, 400, { error: "message_required" });
      const report = buildInternalErrorReport({
        ...body,
        requestFingerprint: body.requestFingerprint || requestId
      });
      return send(res, 201, await recordError(instance.account_id, report));
    }

    if (req.method === "GET" && url.pathname === "/v1/errors") {
      authorize(instance, PERMISSIONS.ERRORS_READ);
      const limit = Number(url.searchParams.get("limit") || 50);
      return send(res, 200, { items: await listErrors(instance.account_id, limit) });
    }

    if (req.method === "GET" && url.pathname === "/v1/permissions") {
      authorize(instance, PERMISSIONS.STATUS_READ);
      return send(res, 200, { role: instance.role, matrix: permissionMatrix() });
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    await captureRequestError(instance, requestId, url, error);

    if (error.code === "PERMISSION_DENIED") {
      return send(res, 403, {
        error: "permission_denied",
        role: error.role,
        permission: error.permission,
        requestId
      });
    }
    if (["UNKNOWN_FEATURE","REQUIRED_FEATURE","REQUEST_TOO_LARGE","PLATFORM_CONVERSATION_REF_REQUIRED","TURN_KEY_REQUIRED","OAUTH_NOT_CONFIGURED"].includes(error.code)) {
      return send(res, 400, { error: error.code.toLowerCase(), requestId });
    }

    if (error.code === "RECOVERY_SESSION_NOT_FOUND") {
      return send(res, 404, {
        error: "recovery_session_not_found",
        recoverySessionId: error.recoverySessionId,
        requestId
      });
    }

    if (error.code === "RECOVERY_SESSION_CLOSED") {
      return send(res, 409, {
        error: "recovery_session_closed",
        recoverySessionId: error.recoverySessionId,
        phase: error.phase,
        requestId
      });
    }

    if (error.code === "RECOVERY_PROJECT_MISMATCH") {
      return send(res, 409, {
        error: "recovery_project_mismatch",
        recoverySessionId: error.recoverySessionId,
        requestId
      });
    }

    console.error(JSON.stringify({
      event: "request_error",
      requestId,
      message: error.message
    }));
    if (!res.headersSent) send(res, 500, { error: "internal_error", requestId });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: "cognitive_blocker_started",
    host: HOST,
    port: PORT,
    version: "0.5.0",
    rulesetVersion: RULESET_VERSION
  }));
});
