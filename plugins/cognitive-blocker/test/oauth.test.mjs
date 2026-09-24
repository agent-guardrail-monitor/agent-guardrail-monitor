import test from "node:test";
import assert from "node:assert/strict";
import {
  OAUTH_SCOPE,
  appendQuery,
  authorizationServerMetadata,
  createConsentTicket,
  createInstallIdentity,
  identityFromCookie,
  normalizeRedirectUris,
  normalizeScope,
  protectedResourceMetadata,
  readConsentTicket,
  serializeIdentityCookie,
  validRedirectUri,
  validateAuthorizationRequest
} from "../src/oauth.mjs";

process.env.OAUTH_SIGNING_SECRET = "test-secret-" + "x".repeat(32);

test("OAuth redirect validation accepts HTTPS and loopback HTTP only", () => {
  assert.equal(validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"), true);
  assert.equal(validRedirectUri("http://127.0.0.1:3000/callback"), true);
  assert.equal(validRedirectUri("http://localhost:3000/callback"), true);
  assert.equal(validRedirectUri("http://example.com/callback"), false);
  assert.equal(validRedirectUri("javascript:alert(1)"), false);
});

test("OAuth redirect list is normalized and rejects unsafe values", () => {
  assert.deepEqual(
    normalizeRedirectUris(["https://a.example/cb", "https://a.example/cb"]),
    ["https://a.example/cb"]
  );
  assert.equal(normalizeRedirectUris([]), null);
  assert.equal(normalizeRedirectUris(["http://evil.example/cb"]), null);
});

test("OAuth scope is fixed to cognitive:use", () => {
  assert.equal(normalizeScope(""), OAUTH_SCOPE);
  assert.equal(normalizeScope("cognitive:use"), OAUTH_SCOPE);
  assert.equal(normalizeScope("cognitive:use other"), null);
});

test("installation identity cookie is signed and tamper-evident", () => {
  const identity = createInstallIdentity();
  const cookie = serializeIdentityCookie(identity);
  assert.equal(identityFromCookie(cookie), identity);
  const pair = cookie.split(";")[0];
  const index = pair.indexOf("=");
  const value = pair.slice(index + 1);
  const tamperedValue = value.slice(0, -1) + (value.endsWith("a") ? "b" : "a");
  assert.equal(identityFromCookie(pair.slice(0, index + 1) + tamperedValue), null);
});

test("consent tickets round-trip only while signed", () => {
  const ticket = createConsentTicket({
    clientId: "client",
    redirectUri: "https://example.com/cb",
    identity: "install_1"
  });
  assert.equal(readConsentTicket(ticket).clientId, "client");
  const tampered = ticket.slice(0, -1) + (ticket.endsWith("a") ? "b" : "a");
  assert.equal(readConsentTicket(tampered), null);
});

test("authorization request enforces client redirect PKCE scope and exact resource", () => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    scope: "cognitive:use",
    resource: "https://plugin.example/mcp",
    state: "state-1"
  });
  const client = {
    client_id: "client-1",
    redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"]
  };
  const valid = validateAuthorizationRequest(params, client, "https://plugin.example/mcp");
  assert.equal(valid.error, undefined);
  assert.equal(valid.value.resource, "https://plugin.example/mcp");

  params.set("resource", "https://other.example/mcp");
  assert.equal(
    validateAuthorizationRequest(params, client, "https://plugin.example/mcp").error,
    "invalid_target"
  );
});

test("OAuth metadata advertises DCR PKCE issuer identification and protected resource", () => {
  const base = "https://plugin.example";
  const auth = authorizationServerMetadata(base);
  assert.equal(auth.issuer, base);
  assert.equal(auth.registration_endpoint, base + "/oauth/register");
  assert.deepEqual(auth.code_challenge_methods_supported, ["S256"]);
  assert.equal(auth.authorization_response_iss_parameter_supported, true);

  const resource = protectedResourceMetadata(base);
  assert.equal(resource.resource, base + "/mcp");
  assert.deepEqual(resource.authorization_servers, [base]);
  assert.deepEqual(resource.scopes_supported, ["cognitive:use"]);
});

test("OAuth callback query preserves code state and issuer", () => {
  const url = appendQuery("https://client.example/cb", {
    code: "abc",
    state: "xyz",
    iss: "https://plugin.example"
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("code"), "abc");
  assert.equal(parsed.searchParams.get("state"), "xyz");
  assert.equal(parsed.searchParams.get("iss"), "https://plugin.example");
});
