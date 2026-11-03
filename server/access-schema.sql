CREATE TABLE IF NOT EXISTS app_admins (
  user_id TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_changes (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  change TEXT NOT NULL CHECK (change IN ('first_login', 'grant', 'revoke')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS directory_departments (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id BIGINT,
  sort_order BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS directory_members (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department_ids JSONB NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS directory_sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  synced_at TIMESTAMPTZ NOT NULL
);
