BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cognitive_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('chatgpt','claude','gemini','other')),
  external_account_ref text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_account_ref)
);

CREATE TABLE IF NOT EXISTS cognitive_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  ruleset_version text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cognitive_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  external_project_ref text,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE',
  current_version text,
  important boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name),
  UNIQUE (id, account_id)
);

CREATE TABLE IF NOT EXISTS cognitive_memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  project_id uuid,
  scope_key text NOT NULL DEFAULT 'account',
  memory_key text NOT NULL,
  memory_type text NOT NULL,
  value jsonb NOT NULL,
  claim_state text NOT NULL CHECK (claim_state IN ('EVIDENCE','INFERENCE','HYPOTHESIS','ESTIMATE','UNKNOWN','REFUTED')),
  status text NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT','SUPERSEDED','CONFLICTING','REFUTED')),
  source text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, account_id) REFERENCES cognitive_projects(id, account_id) ON DELETE CASCADE,
  UNIQUE (account_id, scope_key, memory_key)
);

CREATE TABLE IF NOT EXISTS cognitive_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  project_id uuid,
  decision_key text NOT NULL,
  decision jsonb NOT NULL,
  status text NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED','SUPERSEDED','CONFLICTING')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, account_id) REFERENCES cognitive_projects(id, account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cognitive_frozen_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  project_id uuid,
  element_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, account_id) REFERENCES cognitive_projects(id, account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cognitive_task_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  project_id uuid,
  objective text NOT NULL,
  authorized_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, account_id) REFERENCES cognitive_projects(id, account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cognitive_guard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  project_id uuid,
  task_contract_id uuid REFERENCES cognitive_task_contracts(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('ALLOW','BLOCK')),
  ruleset_version text NOT NULL,
  violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ignored_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  request_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, account_id) REFERENCES cognitive_projects(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cognitive_memory_account_status
  ON cognitive_memory_items(account_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cognitive_guard_events_account_created
  ON cognitive_guard_events(account_id, created_at DESC);

COMMIT;
