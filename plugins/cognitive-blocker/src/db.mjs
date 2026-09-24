import crypto from "node:crypto";
import pg from "pg";
import { RULESET_VERSION } from "./rule-catalog.mjs";
import { validateFeatureChange } from "./feature-catalog.mjs";
import { normalizeRole } from "./rbac.mjs";

const { Pool } = pg;
const databaseSsl = process.env.DATABASE_SSL === "false"
  ? false
  : { rejectUnauthorized: false };
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl })
  : null;

export function databaseConfigured() {
  return Boolean(pool);
}

export async function closeDatabase() {
  if (pool) await pool.end();
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export async function query(text, params = []) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool.query(text, params);
}

export async function withDatabaseTransaction(operation) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withAccountContext(accountId, operation) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  if (!accountId) throw new Error("account_id_required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_account_id', $1, true)",
      [String(accountId)]
    );
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function installAccount({ platform, externalAccountRef, label }) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query(
      `INSERT INTO cognitive_accounts(platform, external_account_ref, label)
       VALUES ($1,$2,$3)
       ON CONFLICT(platform, external_account_ref)
       DO UPDATE SET label = COALESCE(EXCLUDED.label, cognitive_accounts.label), updated_at = now()
       RETURNING id, platform, external_account_ref, label`,
      [platform, externalAccountRef, label || null]
    );
    const accountId = account.rows[0].id;
    const instance = await client.query(
      `INSERT INTO cognitive_instances(account_id, token_hash, ruleset_version)
       VALUES ($1,$2,$3)
       ON CONFLICT(account_id)
       DO UPDATE SET token_hash = EXCLUDED.token_hash, ruleset_version = EXCLUDED.ruleset_version,
                     role = 'OWNER', status = 'ACTIVE', updated_at = now()
       RETURNING id, account_id, role, ruleset_version, status,
                 activation_mode, auto_register_conversations`,
      [accountId, tokenHash, RULESET_VERSION]
    );
    await client.query("COMMIT");
    return { ...instance.rows[0], token };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveInstanceToken(token) {
  if (!token || !pool) return null;
  const result = await pool.query(
    `SELECT i.id AS instance_id, i.account_id, i.role,
            i.activation_mode, i.auto_register_conversations,
            i.oauth_client_id, i.oauth_scope, i.oauth_resource,
            a.platform, a.external_account_ref
       FROM cognitive_instances i
       JOIN cognitive_accounts a ON a.id = i.account_id
       WHERE i.token_hash = $1
         AND i.status = 'ACTIVE'
         AND (i.access_token_expires_at IS NULL OR i.access_token_expires_at > now())`,
    [hashToken(token)]
  );
  const row = result.rows[0];
  return row ? { ...row, role: normalizeRole(row.role) } : null;
}

export async function upsertMemory(accountId, input) {
  const projectId = input.projectId || null;
  const scopeKey = projectId ? "project:" + projectId : "account";
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `INSERT INTO cognitive_memory_items
         (account_id, project_id, scope_key, memory_key, memory_type, value, claim_state, status, source)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'CURRENT',$8)
       ON CONFLICT(account_id, scope_key, memory_key)
       DO UPDATE SET
         value = EXCLUDED.value,
         memory_type = EXCLUDED.memory_type,
         claim_state = EXCLUDED.claim_state,
         source = EXCLUDED.source,
         status = 'CURRENT',
         version = cognitive_memory_items.version + 1,
         updated_at = now()
       RETURNING id, project_id, scope_key, memory_key, memory_type, value,
                 claim_state, status, version, updated_at`,
      [accountId, projectId, scopeKey, input.key, input.type, JSON.stringify(input.value),
       input.claimState, input.source || null]
    );
    return result.rows[0];
  });
}

export async function listMemory(accountId, projectId = null) {
  const scopeKey = projectId ? "project:" + projectId : "account";
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `SELECT id, project_id, memory_key, memory_type, value, claim_state,
              status, version, updated_at
         FROM cognitive_memory_items
         WHERE account_id = $1 AND scope_key = $2 AND status = 'CURRENT'
         ORDER BY updated_at DESC`,
      [accountId, scopeKey]
    );
    return result.rows;
  });
}

export async function appendGuardEvent(accountId, payload) {
  return withAccountContext(accountId, async (client) => {
    await client.query(
      `INSERT INTO cognitive_guard_events
         (account_id, project_id, task_contract_id, decision, ruleset_version,
          violations, ignored_signals, request_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
      [
        accountId,
        payload.projectId || null,
        payload.taskContractId || null,
        payload.result.decision,
        payload.result.rulesetVersion,
        JSON.stringify(payload.result.violations),
        JSON.stringify(payload.result.ignoredSignals),
        payload.requestFingerprint || null
      ]
    );
  });
}

export async function listFeatureFlags(accountId) {
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `SELECT feature_key, enabled, updated_by_role, updated_at
         FROM cognitive_feature_flags
         WHERE account_id = $1
         ORDER BY feature_key`,
      [accountId]
    );
    return result.rows;
  });
}

export async function setFeatureFlag(accountId, role, key, enabled) {
  const validated = validateFeatureChange(key, enabled);
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `INSERT INTO cognitive_feature_flags
         (account_id, feature_key, enabled, updated_by_role)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT(account_id, feature_key)
       DO UPDATE SET enabled = EXCLUDED.enabled,
                     updated_by_role = EXCLUDED.updated_by_role,
                     updated_at = now()
       RETURNING feature_key, enabled, updated_by_role, updated_at`,
      [accountId, validated.feature.key, validated.enabled, normalizeRole(role)]
    );
    return result.rows[0];
  });
}

export async function recordError(accountId, report) {
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `INSERT INTO cognitive_error_reports
         (account_id, project_id, source, error_code, message, context,
          stack_fingerprint, request_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       RETURNING id, project_id, source, error_code, message, context,
                 status, created_at`,
      [
        accountId,
        report.projectId || null,
        report.source,
        report.errorCode,
        report.message,
        JSON.stringify(report.context || {}),
        report.stackFingerprint || null,
        report.requestFingerprint || null
      ]
    );
    return result.rows[0];
  });
}

export async function listErrors(accountId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `SELECT id, project_id, source, error_code, message, context,
              status, created_at, resolved_at
         FROM cognitive_error_reports
         WHERE account_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
      [accountId, safeLimit]
    );
    return result.rows;
  });
}
