BEGIN;

CREATE TABLE IF NOT EXISTS cognitive_recovery_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  project_id uuid,
  root_fingerprint text NOT NULL,
  last_request_fingerprint text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('CORRECT','ALLOW','SAFE_STOP')),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1 AND attempt <= 3),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts = 3),
  last_violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  invalid_resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  FOREIGN KEY (project_id, account_id)
    REFERENCES cognitive_projects(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cognitive_recovery_sessions_account_updated
  ON cognitive_recovery_sessions(account_id, updated_at DESC);

ALTER TABLE cognitive_recovery_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_recovery_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cognitive_recovery_sessions_tenant ON cognitive_recovery_sessions;
CREATE POLICY cognitive_recovery_sessions_tenant ON cognitive_recovery_sessions
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

COMMIT;
