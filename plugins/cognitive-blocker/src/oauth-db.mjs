import crypto from "node:crypto";
import { hashToken, query, withDatabaseTransaction } from "./db.mjs";
import { RULESET_VERSION } from "./rule-catalog.mjs";

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_TTL_SECONDS = 5 * 60;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function challengeFor(verifier) {
  return crypto.createHash("sha256").update(String(verifier)).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function registerOAuthClient(input) {
  const clientId = "cb_" + randomToken(24);
  const result = await query(
    `INSERT INTO cognitive_oauth_clients
       (client_id, redirect_uris, client_name)
     VALUES ($1,$2::jsonb,$3)
     RETURNING client_id, redirect_uris, client_name, created_at`,
    [clientId, JSON.stringify(input.redirectUris), input.clientName || null]
  );
  return result.rows[0];
}

export async function getOAuthClient(clientId) {
  const result = await query(
    `SELECT client_id, redirect_uris, client_name, created_at
     FROM cognitive_oauth_clients
     WHERE client_id = $1`,
    [clientId]
  );
  return result.rows[0] || null;
}

export async function ensureOAuthAccount(externalAccountRef, label = null) {
  const result = await query(
    `INSERT INTO cognitive_accounts(platform, external_account_ref, label)
     VALUES ('chatgpt',$1,$2)
     ON CONFLICT(platform, external_account_ref)
     DO UPDATE SET label = COALESCE(EXCLUDED.label, cognitive_accounts.label),
                   updated_at = now()
     RETURNING id, platform, external_account_ref, label`,
    [externalAccountRef, label]
  );
  return result.rows[0];
}

export async function createAuthorizationCode(input) {
  const code = randomToken(32);
  await query(
    `INSERT INTO cognitive_oauth_authorization_codes
       (code_hash, client_id, account_id, redirect_uri, code_challenge,
        code_challenge_method, scope, resource, expires_at)
     VALUES ($1,$2,$3,$4,$5,'S256',$6,$7,now() + ($8 * interval '1 second'))`,
    [
      hashToken(code),
      input.clientId,
      input.accountId,
      input.redirectUri,
      input.codeChallenge,
      input.scope || "",
      input.resource || null,
      AUTH_CODE_TTL_SECONDS
    ]
  );
  return code;
}

export async function redeemAuthorizationCode(input) {
  return withDatabaseTransaction(async (client) => {
    const result = await client.query(
      `SELECT code_hash, client_id, account_id, redirect_uri, code_challenge,
              scope, resource
       FROM cognitive_oauth_authorization_codes
       WHERE code_hash = $1
         AND client_id = $2
         AND used_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [hashToken(input.code), input.clientId]
    );

    const row = result.rows[0];
    if (!row) return null;
    if (row.redirect_uri !== input.redirectUri) return null;
    if ((row.resource || null) !== (input.resource || null)) return null;
    if (!safeEqual(row.code_challenge, challengeFor(input.codeVerifier))) return null;

    await client.query(
      `UPDATE cognitive_oauth_authorization_codes
       SET used_at = now()
       WHERE code_hash = $1`,
      [row.code_hash]
    );

    const accessToken = randomToken(32);
    const refreshToken = randomToken(40);

    await client.query(
      `INSERT INTO cognitive_instances
         (account_id, token_hash, ruleset_version, role, status, access_token_expires_at,
          oauth_client_id, oauth_scope, oauth_resource)
       VALUES ($1,$2,$3,'OWNER','ACTIVE',now() + ($4 * interval '1 second'),$5,$6,$7)
       ON CONFLICT(account_id)
       DO UPDATE SET token_hash = EXCLUDED.token_hash,
                     ruleset_version = EXCLUDED.ruleset_version,
                     role = 'OWNER',
                     status = 'ACTIVE',
                     access_token_expires_at = EXCLUDED.access_token_expires_at,
                     oauth_client_id = EXCLUDED.oauth_client_id,
                     oauth_scope = EXCLUDED.oauth_scope,
                     oauth_resource = EXCLUDED.oauth_resource,
                     updated_at = now()`,
      [
        row.account_id,
        hashToken(accessToken),
        RULESET_VERSION,
        ACCESS_TOKEN_TTL_SECONDS,
        row.client_id,
        row.scope || "",
        row.resource || null
      ]
    );

    await client.query(
      `INSERT INTO cognitive_oauth_refresh_tokens
         (token_hash, client_id, account_id, scope, resource, expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6 * interval '1 second'))`,
      [
        hashToken(refreshToken),
        row.client_id,
        row.account_id,
        row.scope || "",
        row.resource || null,
        REFRESH_TOKEN_TTL_SECONDS
      ]
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      scope: row.scope || "",
      resource: row.resource || null
    };
  });
}

export async function refreshOAuthAccessToken(input) {
  return withDatabaseTransaction(async (client) => {
    const result = await client.query(
      `SELECT token_hash, client_id, account_id, scope, resource
       FROM cognitive_oauth_refresh_tokens
       WHERE token_hash = $1
         AND client_id = $2
         AND revoked_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [hashToken(input.refreshToken), input.clientId]
    );

    const row = result.rows[0];
    if (!row) return null;

    await client.query(
      `UPDATE cognitive_oauth_refresh_tokens
       SET revoked_at = now()
       WHERE token_hash = $1`,
      [row.token_hash]
    );

    const accessToken = randomToken(32);
    const refreshToken = randomToken(40);

    await client.query(
      `UPDATE cognitive_instances
       SET token_hash = $2,
           ruleset_version = $3,
           role = 'OWNER',
           status = 'ACTIVE',
           access_token_expires_at = now() + ($4 * interval '1 second'),
           oauth_client_id = $5,
           oauth_scope = $6,
           oauth_resource = $7,
           updated_at = now()
       WHERE account_id = $1`,
      [
        row.account_id,
        hashToken(accessToken),
        RULESET_VERSION,
        ACCESS_TOKEN_TTL_SECONDS,
        row.client_id,
        row.scope || "",
        row.resource || null
      ]
    );

    await client.query(
      `INSERT INTO cognitive_oauth_refresh_tokens
         (token_hash, client_id, account_id, scope, resource, expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6 * interval '1 second'))`,
      [
        hashToken(refreshToken),
        row.client_id,
        row.account_id,
        row.scope || "",
        row.resource || null,
        REFRESH_TOKEN_TTL_SECONDS
      ]
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      scope: row.scope || "",
      resource: row.resource || null
    };
  });
}

export const OAUTH_TTLS = Object.freeze({
  accessTokenSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenSeconds: REFRESH_TOKEN_TTL_SECONDS,
  authorizationCodeSeconds: AUTH_CODE_TTL_SECONDS
});
