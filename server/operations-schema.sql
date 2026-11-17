CREATE TABLE IF NOT EXISTS operation_schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operation_events (
  owner_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version = 1),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  task_id TEXT,
  marker TEXT,
  format TEXT,
  input_name TEXT,
  output_name TEXT,
  payload JSONB NOT NULL,
  PRIMARY KEY (owner_user_id, event_id)
);
CREATE INDEX IF NOT EXISTS operation_events_owner_time ON operation_events (owner_user_id, occurred_at DESC, event_id DESC);
CREATE INDEX IF NOT EXISTS operation_events_time ON operation_events (occurred_at DESC, event_id DESC);
INSERT INTO operation_schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING;
