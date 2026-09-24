BEGIN;

ALTER TABLE cognitive_instances
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS cognitive_oauth_clients (
  client_id text PRIMARY KEY,
  redirect_uris jsonb NOT NULL,
  client_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cognitive_oauth_authorization_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES cognitive_oauth_clients(client_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
  scope text NOT NULL DEFAULT '',
  resource text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cognitive_oauth_codes_expiry
  ON cognitive_oauth_authorization_codes(expires_at);

CREATE TABLE IF NOT EXISTS cognitive_oauth_refresh_tokens (
  token_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES cognitive_oauth_clients(client_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT '',
  resource text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cognitive_oauth_refresh_account
  ON cognitive_oauth_refresh_tokens(account_id, expires_at DESC);

COMMIT;
