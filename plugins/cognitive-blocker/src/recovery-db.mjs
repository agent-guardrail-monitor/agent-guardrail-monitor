import { withAccountContext } from "./db.mjs";

export async function createRecoverySession(accountId, input) {
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `INSERT INTO cognitive_recovery_sessions
         (account_id, project_id, root_fingerprint, last_request_fingerprint,
          phase, attempt, max_attempts, last_violations, invalid_resources)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       RETURNING id, account_id, project_id, root_fingerprint, last_request_fingerprint,
                 phase, attempt, max_attempts, last_violations, invalid_resources,
                 created_at, updated_at, closed_at`,
      [
        accountId,
        input.projectId || null,
        input.rootFingerprint,
        input.lastRequestFingerprint,
        input.plan.phase,
        input.plan.attempt,
        input.plan.maxAttempts,
        JSON.stringify(input.result.violations || []),
        JSON.stringify(input.plan.invalidResources || [])
      ]
    );
    return result.rows[0];
  });
}

export async function getRecoverySession(accountId, recoverySessionId) {
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `SELECT id, account_id, project_id, root_fingerprint, last_request_fingerprint,
              phase, attempt, max_attempts, last_violations, invalid_resources,
              created_at, updated_at, closed_at
         FROM cognitive_recovery_sessions
         WHERE id = $1 AND account_id = $2`,
      [recoverySessionId, accountId]
    );
    return result.rows[0] || null;
  });
}

export async function updateRecoverySession(accountId, recoverySessionId, input) {
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `UPDATE cognitive_recovery_sessions
       SET last_request_fingerprint = $3,
           phase = $4,
           attempt = $5,
           last_violations = $6::jsonb,
           invalid_resources = $7::jsonb,
           updated_at = now(),
           closed_at = CASE
             WHEN $4 IN ('ALLOW','SAFE_STOP') THEN COALESCE(closed_at, now())
             ELSE NULL
           END
       WHERE id = $1 AND account_id = $2
       RETURNING id, account_id, project_id, root_fingerprint, last_request_fingerprint,
                 phase, attempt, max_attempts, last_violations, invalid_resources,
                 created_at, updated_at, closed_at`,
      [
        recoverySessionId,
        accountId,
        input.lastRequestFingerprint,
        input.plan.phase,
        input.plan.attempt,
        JSON.stringify(input.result.violations || []),
        JSON.stringify(input.plan.invalidResources || [])
      ]
    );
    return result.rows[0] || null;
  });
}
