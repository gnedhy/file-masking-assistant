CREATE TABLE IF NOT EXISTS vault_tasks (
  owner_user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  token_format TEXT,
  marker TEXT,
  mapping_count INTEGER NOT NULL,
  ciphertext BYTEA NOT NULL,
  data_iv BYTEA NOT NULL,
  data_tag BYTEA NOT NULL,
  wrapped_key BYTEA NOT NULL,
  wrap_iv BYTEA NOT NULL,
  wrap_tag BYTEA NOT NULL,
  key_version TEXT NOT NULL,
  occurrence_baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (owner_user_id, task_id)
);

CREATE TABLE IF NOT EXISTS vault_audit (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','read','delete')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_task_markers (
  owner_user_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, marker)
);

-- Upgrade databases created before short tokens; every statement is safe to repeat.
ALTER TABLE vault_tasks ALTER COLUMN task_id TYPE TEXT;
ALTER TABLE vault_audit ALTER COLUMN task_id TYPE TEXT;
ALTER TABLE vault_tasks ADD COLUMN IF NOT EXISTS token_format TEXT;
ALTER TABLE vault_tasks ADD COLUMN IF NOT EXISTS marker TEXT;
ALTER TABLE vault_tasks DROP COLUMN IF EXISTS expires_at;
