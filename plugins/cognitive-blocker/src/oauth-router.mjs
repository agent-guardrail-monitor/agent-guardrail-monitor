import {
  appendQuery,
  authorizationServerMetadata,
  consentHtml,
  createConsentTicket,
  createInstallIdentity,
  identityFromCookie,
  normalizeRedirectUris,
  protectedResourceMetadata,
  publicBaseUrl,
  readConsentTicket,
  serializeIdentityCookie,
  validateAuthorizationRequest
} from "./oauth.mjs";
import {
  createAuthorizationCode,
  ensureOAuthAccount,
  getOAuthClient,
  redeemAuthorizationCode,
  refreshOAuthAccessToken,
  registerOAuthClient
} from "./oauth-db.mjs";

function sendJson(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    ...extraHeaders
  });
  res.end(data);
}

function sendHtml(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

async function readBody(req, limit = 256 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw Object.assign(new Error("request_too_large"), { code: "REQUEST_TOO_LARGE" });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = String(req.headers["content-type"] || "").toLowerCase();
  if (type.includes("application/json")) {
    return raw ? JSON.parse(raw) : {};
  }
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function oauthError(res, status, error, description) {
  return sendJson(res, status, {
    error,
    ...(description ? { error_description: description } : {})
  }, {
    "cache-control": "no-store",
    pragma: "no-cache"
  });
}

function clientRedirectUris(client) {
  return Array.isArray(client?.redirect_uris) ? client.redirect_uris : [];
}

export function oauthChallenge(baseUrl, error = "invalid_token", description = "Authentication required") {
  return `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="cognitive:use", error="${error}", error_description="${description.replaceAll('"', "'")}"`;
}

export async function handleOAuthRequest(req, res, url) {
  const baseUrl = publicBaseUrl(req);
  const expectedResource = baseUrl + "/mcp";

  if (
    req.method === "GET" &&
    (url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp")
  ) {
    sendJson(res, 200, protectedResourceMetadata(baseUrl), {
      "cache-control": "public, max-age=300"
    });
    return true;
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/.well-known/oauth-authorization-server" ||
      url.pathname === "/.well-known/openid-configuration")
  ) {
    sendJson(res, 200, authorizationServerMetadata(baseUrl), {
      "cache-control": "public, max-age=300"
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/oauth/register") {
    const body = await readBody(req);
    const redirectUris = normalizeRedirectUris(body.redirect_uris);
    if (!redirectUris) {
      oauthError(res, 400, "invalid_redirect_uri", "At least one valid HTTPS redirect URI is required.");
      return true;
    }

    const tokenMethod = String(body.token_endpoint_auth_method || "none");
    if (tokenMethod !== "none") {
      oauthError(res, 400, "invalid_client_metadata", "This public client supports token_endpoint_auth_method=none.");
      return true;
    }

    const client = await registerOAuthClient({
      redirectUris,
      clientName: body.client_name ? String(body.client_name).slice(0, 200) : null
    });

    sendJson(res, 201, {
      client_id: client.client_id,
      client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
      client_name: client.client_name || undefined,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"]
    }, {
      "cache-control": "no-store"
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/oauth/authorize") {
    const clientId = String(url.searchParams.get("client_id") || "");
    const client = clientId ? await getOAuthClient(clientId) : null;
    const validated = validateAuthorizationRequest(url.searchParams, client, expectedResource);
    if (validated.error) {
      oauthError(res, 400, validated.error, "Invalid OAuth authorization request.");
      return true;
    }

    let identity = identityFromCookie(req.headers.cookie);
    let setCookie = null;
    if (!identity) {
      identity = createInstallIdentity();
      setCookie = serializeIdentityCookie(identity);
    }

    const ticket = createConsentTicket({
      ...validated.value,
      identity,
      clientName: client?.client_name || "ChatGPT"
    });

    sendHtml(res, 200, consentHtml({
      ticket,
      clientName: client?.client_name || "ChatGPT"
    }), setCookie ? { "set-cookie": setCookie, "cache-control": "no-store" } : {
      "cache-control": "no-store"
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/oauth/authorize") {
    const body = await readBody(req);
    const ticket = readConsentTicket(body.ticket);
    if (!ticket) {
      oauthError(res, 400, "invalid_request", "The authorization request expired or is invalid.");
      return true;
    }

    const client = await getOAuthClient(ticket.clientId);
    if (!client || !clientRedirectUris(client).includes(ticket.redirectUri)) {
      oauthError(res, 400, "invalid_client", "OAuth client or redirect URI is no longer valid.");
      return true;
    }

    if (String(body.decision || "") !== "allow") {
      res.writeHead(302, {
        location: appendQuery(ticket.redirectUri, {
          error: "access_denied",
          state: ticket.state,
          iss: baseUrl
        }),
        "cache-control": "no-store"
      });
      res.end();
      return true;
    }

    const account = await ensureOAuthAccount(
      "oauth:" + ticket.identity,
      "ChatGPT plugin installation"
    );
    const code = await createAuthorizationCode({
      clientId: ticket.clientId,
      accountId: account.id,
      redirectUri: ticket.redirectUri,
      codeChallenge: ticket.codeChallenge,
      scope: ticket.scope,
      resource: ticket.resource
    });

    res.writeHead(302, {
      location: appendQuery(ticket.redirectUri, {
        code,
        state: ticket.state,
        iss: baseUrl
      }),
      "cache-control": "no-store"
    });
    res.end();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/oauth/token") {
    const body = await readBody(req);
    const grantType = String(body.grant_type || "");
    const clientId = String(body.client_id || "");
    const resource = String(body.resource || "");

    if (!clientId) {
      oauthError(res, 400, "invalid_client", "client_id is required.");
      return true;
    }
    if (resource !== expectedResource) {
      oauthError(res, 400, "invalid_target", "The OAuth resource does not match this MCP server.");
      return true;
    }

    if (grantType === "authorization_code") {
      if (!body.code || !body.redirect_uri || !body.code_verifier) {
        oauthError(res, 400, "invalid_request", "code, redirect_uri and code_verifier are required.");
        return true;
      }

      const token = await redeemAuthorizationCode({
        code: String(body.code),
        clientId,
        redirectUri: String(body.redirect_uri),
        codeVerifier: String(body.code_verifier),
        resource
      });

      if (!token) {
        oauthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, already used, or failed PKCE.");
        return true;
      }

      sendJson(res, 200, {
        access_token: token.accessToken,
        token_type: "Bearer",
        expires_in: token.expiresIn,
        refresh_token: token.refreshToken,
        scope: token.scope,
        resource: token.resource
      }, {
        "cache-control": "no-store",
        pragma: "no-cache"
      });
      return true;
    }

    if (grantType === "refresh_token") {
      if (!body.refresh_token) {
        oauthError(res, 400, "invalid_request", "refresh_token is required.");
        return true;
      }

      const token = await refreshOAuthAccessToken({
        refreshToken: String(body.refresh_token),
        clientId,
        resource
      });

      if (!token) {
        oauthError(res, 400, "invalid_grant", "Refresh token is invalid, expired, revoked, or for another resource.");
        return true;
      }

      sendJson(res, 200, {
        access_token: token.accessToken,
        token_type: "Bearer",
        expires_in: token.expiresIn,
        refresh_token: token.refreshToken,
        scope: token.scope,
        resource: token.resource
      }, {
        "cache-control": "no-store",
        pragma: "no-cache"
      });
      return true;
    }

    oauthError(res, 400, "unsupported_grant_type", "Supported grants are authorization_code and refresh_token.");
    return true;
  }

  return false;
}
