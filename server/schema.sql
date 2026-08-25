CREATE TABLE IF NOT EXISTS vault_tasks (
  owner_user_id TEXT NOT NULL,
  task_id CHAR(8) NOT NULL,
  task_name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
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

CREATE INDEX IF NOT EXISTS vault_tasks_expiry_idx ON vault_tasks (expires_at);

CREATE TABLE IF NOT EXISTS vault_audit (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  task_id CHAR(8) NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','read','delete')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
