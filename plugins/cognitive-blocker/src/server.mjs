import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { evaluateForAccount } from "./service.mjs";
import { RULESET_VERSION, RULE_CATALOG } from "./rule-catalog.mjs";
import {
  appendGuardEvent,
  databaseConfigured,
  installAccount,
  listMemory,
  resolveInstanceToken,
  upsertMemory
} from "./db.mjs";
import { createCognitiveBlockerMcpNodeHandler } from "./mcp.mjs";

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

async function readJson(req, limit = 1024 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error("request_too_large");
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
  const instance = await resolveInstanceToken(bearer(req));
  if (!instance) {
    send(res, 401, { error: "invalid_instance_token" });
    return null;
  }
  return instance;
}

function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        product: "Cognitive Blocker Plugin",
        version: "0.1.0",
        rulesetVersion: RULESET_VERSION,
        canonicalRuleCount: RULE_CATALOG.length,
        databaseConfigured: databaseConfigured()
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/install") {
      if (!process.env.INSTALL_SECRET || req.headers["x-install-secret"] !== process.env.INSTALL_SECRET) {
        return send(res, 401, { error: "invalid_install_secret" });
      }
      const body = await readJson(req);
      const platform = String(body.platform || "").toLowerCase();
      if (!["chatgpt","claude","gemini","other"].includes(platform) || !body.externalAccountRef) {
        return send(res, 400, { error: "platform_and_externalAccountRef_required" });
      }
      const instance = await installAccount({
        platform,
        externalAccountRef: String(body.externalAccountRef),
        label: body.label ? String(body.label) : null
      });
      return send(res, 201, { ...instance, tokenIssuedOnce: true });
    }

    if (url.pathname === "/mcp") {
      const instance = await authenticated(req, res);
      if (!instance) return;
      const handler = createCognitiveBlockerMcpNodeHandler({ accountId: instance.account_id });
      return handler(req, res);
    }

    const instance = await authenticated(req, res);
    if (!instance) return;

    if (req.method === "POST" && url.pathname === "/v1/check") {
      const body = await readJson(req);
      const result = await evaluateForAccount(instance.account_id, {
        ...body,
        requestFingerprint: fingerprint(body)
      });
      return send(res, result.decision === "ALLOW" ? 200 : 409, result);
    }

    if (req.method === "PUT" && url.pathname === "/v1/memory") {
      const body = await readJson(req);
      if (!body.key || !body.type || !CLAIM_STATES.has(body.claimState)) {
        return send(res, 400, { error: "key_type_and_valid_claimState_required" });
      }
      const item = await upsertMemory(instance.account_id, body);
      return send(res, 200, item);
    }

    if (req.method === "GET" && url.pathname === "/v1/memory") {
      const projectId = url.searchParams.get("projectId");
      return send(res, 200, { items: await listMemory(instance.account_id, projectId) });
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(JSON.stringify({ event: "request_error", message: error.message }));
    if (!res.headersSent) send(res, 500, { error: "internal_error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: "cognitive_blocker_started",
    host: HOST,
    port: PORT,
    rulesetVersion: RULESET_VERSION
  }));
});
