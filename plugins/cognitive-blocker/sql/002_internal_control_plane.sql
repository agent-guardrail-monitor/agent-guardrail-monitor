BEGIN;

ALTER TABLE cognitive_instances
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'OWNER';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cognitive_instances_role_check'
  ) THEN
    ALTER TABLE cognitive_instances
      ADD CONSTRAINT cognitive_instances_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CLIENT'));
  END IF;
END $$;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cognitive_task_contracts_id_account_unique'
  ) THEN
    ALTER TABLE cognitive_task_contracts
      ADD CONSTRAINT cognitive_task_contracts_id_account_unique UNIQUE (id, account_id);
  END IF;
END $;

ALTER TABLE cognitive_guard_events
  DROP CONSTRAINT IF EXISTS cognitive_guard_events_task_contract_id_fkey;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cognitive_guard_events_task_account_fk'
  ) THEN
    ALTER TABLE cognitive_guard_events
      ADD CONSTRAINT cognitive_guard_events_task_account_fk
      FOREIGN KEY (task_contract_id, account_id)
      REFERENCES cognitive_task_contracts(id, account_id)
      ON DELETE RESTRICT;
  END IF;
END $;

CREATE TABLE IF NOT EXISTS cognitive_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL,
  updated_by_role text NOT NULL CHECK (updated_by_role IN ('OWNER','ADMIN','MANAGER','CLIENT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, feature_key)
);

CREATE TABLE IF NOT EXISTS cognitive_error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  project_id uuid,
  source text NOT NULL,
  error_code text NOT NULL,
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  stack_fingerprint text,
  request_fingerprint text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (project_id, account_id)
    REFERENCES cognitive_projects(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cognitive_feature_flags_account
  ON cognitive_feature_flags(account_id, feature_key);

CREATE INDEX IF NOT EXISTS idx_cognitive_error_reports_account_created
  ON cognitive_error_reports(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION cognitive_current_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '')::uuid
$$;

ALTER TABLE cognitive_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_memory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_frozen_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_frozen_elements FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_task_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_task_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_guard_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_guard_events FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_feature_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_error_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_error_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cognitive_projects_tenant ON cognitive_projects;
CREATE POLICY cognitive_projects_tenant ON cognitive_projects
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_memory_items_tenant ON cognitive_memory_items;
CREATE POLICY cognitive_memory_items_tenant ON cognitive_memory_items
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_decisions_tenant ON cognitive_decisions;
CREATE POLICY cognitive_decisions_tenant ON cognitive_decisions
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_frozen_elements_tenant ON cognitive_frozen_elements;
CREATE POLICY cognitive_frozen_elements_tenant ON cognitive_frozen_elements
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_task_contracts_tenant ON cognitive_task_contracts;
CREATE POLICY cognitive_task_contracts_tenant ON cognitive_task_contracts
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_guard_events_tenant ON cognitive_guard_events;
CREATE POLICY cognitive_guard_events_tenant ON cognitive_guard_events
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_feature_flags_tenant ON cognitive_feature_flags;
CREATE POLICY cognitive_feature_flags_tenant ON cognitive_feature_flags
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_error_reports_tenant ON cognitive_error_reports;
CREATE POLICY cognitive_error_reports_tenant ON cognitive_error_reports
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

COMMIT;
