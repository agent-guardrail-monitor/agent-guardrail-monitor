import crypto from "node:crypto";

export const OAUTH_SCOPE = "cognitive:use";
export const OAUTH_COOKIE = "cb_install_identity";

function signingSecret() {
  const secret = String(process.env.OAUTH_SIGNING_SECRET || "");
  if (!secret) {
    throw Object.assign(new Error("oauth_signing_secret_not_configured"), {
      code: "OAUTH_NOT_CONFIGURED"
    });
  }
  return secret;
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

function signedValue(payload) {
  const body = encode(JSON.stringify(payload));
  return body + "." + sign(body);
}

function verifySignedValue(value) {
  const [body, signature] = String(value || "").split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(decode(body));
  } catch {
    return null;
  }
}

export function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) throw new Error("public_host_unavailable");
  return proto + "://" + host;
}

export function validRedirectUri(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeRedirectUris(values) {
  if (!Array.isArray(values) || !values.length || values.length > 20) return null;
  const normalized = [...new Set(values.map((value) => String(value).trim()))];
  return normalized.length && normalized.every(validRedirectUri) ? normalized : null;
}

export function normalizeScope(scope) {
  const requested = String(scope || "").split(/\s+/).filter(Boolean);
  if (!requested.length) return OAUTH_SCOPE;
  return requested.every((item) => item === OAUTH_SCOPE) ? OAUTH_SCOPE : null;
}

export function createInstallIdentity() {
  return "install_" + crypto.randomBytes(24).toString("base64url");
}

export function serializeIdentityCookie(identity) {
  const value = signedValue({
    identity,
    issuedAt: Date.now()
  });
  return [
    OAUTH_COOKIE + "=" + value,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=" + String(365 * 24 * 60 * 60)
  ].join("; ");
}

export function identityFromCookie(cookieHeader) {
  const cookies = Object.fromEntries(
    String(cookieHeader || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), part.slice(index + 1)];
      })
  );
  const payload = verifySignedValue(cookies[OAUTH_COOKIE]);
  return typeof payload?.identity === "string" ? payload.identity : null;
}

export function createConsentTicket(input) {
  return signedValue({
    ...input,
    expiresAt: Date.now() + 10 * 60 * 1000
  });
}

export function readConsentTicket(ticket) {
  const payload = verifySignedValue(ticket);
  if (!payload || Number(payload.expiresAt || 0) < Date.now()) return null;
  return payload;
}

export function validateAuthorizationRequest(searchParams, client) {
  const responseType = String(searchParams.get("response_type") || "");
  const clientId = String(searchParams.get("client_id") || "");
  const redirectUri = String(searchParams.get("redirect_uri") || "");
  const state = String(searchParams.get("state") || "");
  const codeChallenge = String(searchParams.get("code_challenge") || "");
  const codeChallengeMethod = String(searchParams.get("code_challenge_method") || "");
  const scope = normalizeScope(searchParams.get("scope"));
  const resource = String(searchParams.get("resource") || "");

  if (responseType !== "code") return { error: "unsupported_response_type" };
  if (!client || client.client_id !== clientId) return { error: "invalid_client" };
  if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) {
    return { error: "invalid_redirect_uri" };
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") return { error: "invalid_request" };
  if (!scope) return { error: "invalid_scope" };

  return {
    value: {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      scope,
      resource: resource || null
    }
  };
}

export function appendQuery(url, values) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  }
  return target.toString();
}

export function protectedResourceMetadata(baseUrl) {
  return {
    resource: baseUrl + "/mcp",
    authorization_servers: [baseUrl],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Bloqueando Alucinações"
  };
}

export function authorizationServerMetadata(baseUrl) {
  return {
    issuer: baseUrl,
    authorization_endpoint: baseUrl + "/oauth/authorize",
    token_endpoint: baseUrl + "/oauth/token",
    registration_endpoint: baseUrl + "/oauth/register",
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"]
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function consentHtml({ ticket, clientName }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bloqueando Alucinações</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#090b0a;color:#f5f7f6;margin:0;display:grid;place-items:center;min-height:100vh}
main{width:min(520px,calc(100% - 40px));background:#111513;border:1px solid #28312d;border-radius:24px;padding:32px}
h1{font-size:26px;margin:0 0 8px}p{color:#b8c2bd;line-height:1.5}.box{background:#0b0e0c;border:1px solid #242b27;border-radius:16px;padding:16px;margin:22px 0}
button{width:100%;border:0;border-radius:14px;padding:15px 18px;background:#1677ff;color:white;font-size:17px;font-weight:700;cursor:pointer}
small{display:block;margin-top:16px;color:#7e8a84}
</style>
</head>
<body><main>
<h1>Bloqueando Alucinações</h1>
<p>Conecte o plugin para proteger contexto, decisões e verificações da sua instalação.</p>
<div class="box"><strong>Solicitação de acesso</strong><p>${escapeHtml(clientName || "ChatGPT")} poderá usar o motor de bloqueios e a memória isolada desta instalação.</p></div>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
<button type="submit" name="decision" value="allow">Autorizar plugin</button>
</form>
<small>A autorização cria uma instância isolada. Respostas bloqueadas não são consolidadas como memória válida.</small>
</main></body></html>`;
}

export function oauthConfigured() {
  return Boolean(process.env.OAUTH_SIGNING_SECRET);
}
