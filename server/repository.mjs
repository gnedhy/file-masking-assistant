import pg from "pg";
import { decryptMapping, encryptMapping } from "./crypto.mjs";

const { Pool } = pg;

export class PgVaultRepository {
  constructor({ connectionString, masterKey, keyVersion = "v1" }) {
    this.pool = new Pool({ connectionString });
    this.masterKey = masterKey;
    this.keyVersion = keyVersion;
  }

  async initialize(schema) {
    await this.pool.query(schema);
  }

  async create(ownerUserId, vault) {
    const encrypted = encryptMapping(vault.mapping, this.masterKey, this.keyVersion);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    await this.pool.query(
      `INSERT INTO vault_tasks
       (owner_user_id, task_id, task_name, source_format, created_at, expires_at, mapping_count,
        ciphertext, data_iv, data_tag, wrapped_key, wrap_iv, wrap_tag, key_version, occurrence_baseline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [ownerUserId, vault.taskId, vault.taskName, vault.sourceFormat, vault.createdAt, expiresAt,
        Object.keys(vault.mapping).length, encrypted.ciphertext, encrypted.iv, encrypted.tag,
        encrypted.wrappedKey.ciphertext, encrypted.wrappedKey.iv, encrypted.wrappedKey.tag,
        encrypted.keyVersion, JSON.stringify(vault.occurrenceBaseline ?? {})],
    );
    await this.audit(ownerUserId, vault.taskId, "create");
    return { expiresAt: expiresAt.toISOString() };
  }

  async list(ownerUserId) {
    const { rows } = await this.pool.query(
      `SELECT task_id, task_name, source_format, created_at, expires_at, mapping_count, occurrence_baseline
       FROM vault_tasks WHERE owner_user_id=$1 AND expires_at > now() ORDER BY created_at DESC LIMIT 200`,
      [ownerUserId],
    );
    return rows.map((row) => ({
      taskId: row.task_id, taskName: row.task_name, sourceFormat: row.source_format,
      createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
      uniqueValues: row.mapping_count, occurrenceBaseline: row.occurrence_baseline ?? {},
    }));
  }

  async load(ownerUserId, taskId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM vault_tasks WHERE owner_user_id=$1 AND task_id=$2 AND expires_at > now()`,
      [ownerUserId, taskId],
    );
    if (!rows[0]) return null;
    const row = rows[0];
    const mapping = decryptMapping({
      ciphertext: row.ciphertext, iv: row.data_iv, tag: row.data_tag,
      wrappedKey: { ciphertext: row.wrapped_key, iv: row.wrap_iv, tag: row.wrap_tag },
    }, this.masterKey);
    await this.audit(ownerUserId, taskId, "read");
    return {
      version: 2, taskId, taskName: row.task_name, sourceFormat: row.source_format,
      createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
      occurrenceBaseline: row.occurrence_baseline ?? {}, mapping,
    };
  }

  async delete(ownerUserId, taskId) {
    const result = await this.pool.query("DELETE FROM vault_tasks WHERE owner_user_id=$1 AND task_id=$2", [ownerUserId, taskId]);
    if (result.rowCount) await this.audit(ownerUserId, taskId, "delete");
    return result.rowCount > 0;
  }

  async cleanupExpired() {
    const result = await this.pool.query("DELETE FROM vault_tasks WHERE expires_at <= now()");
    return result.rowCount;
  }

  async audit(ownerUserId, taskId, action) {
    await this.pool.query("INSERT INTO vault_audit (owner_user_id, task_id, action) VALUES ($1,$2,$3)", [ownerUserId, taskId, action]);
  }

  async close() {
    await this.pool.end();
  }
}
