CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('usage', 'result')),
  mode TEXT CHECK (mode IN ('protect', 'restore')),
  task_id TEXT,
  marker TEXT,
  format TEXT,
  content TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  reply TEXT,
  resolved_by TEXT,
  resolved_name TEXT,
  resolved_at TIMESTAMPTZ,
  reply_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_owner ON feedback (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_status ON feedback (status, created_at DESC);
-- Attachments are files that only carry aliases; they are still encrypted like the restore records.
CREATE TABLE IF NOT EXISTS feedback_attachments (
  feedback_id UUID NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  ciphertext BYTEA NOT NULL,
  data_iv BYTEA NOT NULL,
  data_tag BYTEA NOT NULL,
  wrapped_key BYTEA NOT NULL,
  wrap_iv BYTEA NOT NULL,
  wrap_tag BYTEA NOT NULL,
  key_version TEXT NOT NULL,
  PRIMARY KEY (feedback_id, position)
);
