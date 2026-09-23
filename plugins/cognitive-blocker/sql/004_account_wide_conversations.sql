BEGIN;

ALTER TABLE cognitive_instances
  ADD COLUMN IF NOT EXISTS activation_mode text NOT NULL DEFAULT 'ALWAYS_ON',
  ADD COLUMN IF NOT EXISTS auto_register_conversations boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cognitive_instances_activation_mode_check'
  ) THEN
    ALTER TABLE cognitive_instances
      ADD CONSTRAINT cognitive_instances_activation_mode_check
      CHECK (activation_mode IN ('ALWAYS_ON'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cognitive_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  platform_conversation_ref text NOT NULL,
  title text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, platform_conversation_ref),
  UNIQUE (id, account_id)
);

CREATE TABLE IF NOT EXISTS cognitive_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cognitive_accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  turn_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  accepted_source text NOT NULL CHECK (accepted_source IN ('USER_EXPLICIT','ALLOW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, account_id)
    REFERENCES cognitive_conversations(id, account_id) ON DELETE CASCADE,
  UNIQUE (account_id, conversation_id, turn_key)
);

CREATE INDEX IF NOT EXISTS idx_cognitive_conversations_account_seen
  ON cognitive_conversations(account_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_cognitive_turns_conversation_created
  ON cognitive_turns(account_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cognitive_turns_search
  ON cognitive_turns
  USING gin (to_tsvector('simple', content));

ALTER TABLE cognitive_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE cognitive_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_turns FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cognitive_conversations_tenant ON cognitive_conversations;
CREATE POLICY cognitive_conversations_tenant ON cognitive_conversations
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

DROP POLICY IF EXISTS cognitive_turns_tenant ON cognitive_turns;
CREATE POLICY cognitive_turns_tenant ON cognitive_turns
  USING (account_id = cognitive_current_account_id())
  WITH CHECK (account_id = cognitive_current_account_id());

COMMIT;
