import pg from "pg";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { decryptFile, encryptFile } from "./crypto.mjs";

// Feedback: anyone can send it, admins handle it and reply, and the sender sees the reply.
// Attachments may only be files that carry aliases (the protected file, the file the AI returned); the page never offers
// originals or restored files. They are encrypted with the Vault master key all the same, since unselected content may be sensitive.

export const FEEDBACK_LIMITS = { files: 2, bytes: 20 * 1024 * 1024, content: 2000, reply: 2000, context: 4096 };
const ATTACHMENT = /\.(xlsx|csv|txt|md|docx|pptx|html?)$/i;
const FORMATS = ["xlsx", "csv", "txt", "md", "docx", "pptx", "html"];
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MESSAGES = {
  ADMIN_REQUIRED: "只有管理员可以处理反馈。",
  NOT_FOUND: "找不到这条反馈。",
  ALREADY_RESOLVED: "这条反馈已经处理过了。",
  TOO_LARGE: `附件最多 ${FEEDBACK_LIMITS.files} 个，合计不超过 20 MB。`,
  INVALID_ATTACHMENT: "附件只能是本工具支持的文件格式。",
  INVALID_REQUEST: "请求未通过检查。",
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

// Checks a submission and returns the stored fields; throws INVALID_REQUEST otherwise.
export function validateFeedback(fields) {
  const kind = fields.kind;
  const content = clean(fields.content, FEEDBACK_LIMITS.content + 1);
  if (!["usage", "result"].includes(kind) || !content || content.length > FEEDBACK_LIMITS.content) throw fail("INVALID_REQUEST");
  const item = { kind, content, mode: null, taskId: null, marker: null, format: null, context: {} };
  if (kind === "result") {
    if (!["protect", "restore"].includes(fields.mode)) throw fail("INVALID_REQUEST");
    item.mode = fields.mode;
    if (fields.taskId) { if (!(/^[a-f0-9]{8}$/i.test(fields.taskId) || UUID.test(fields.taskId))) throw fail("INVALID_REQUEST"); item.taskId = fields.taskId; }
    if (fields.marker) { if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(fields.marker)) throw fail("INVALID_REQUEST"); item.marker = fields.marker; }
    if (fields.format) { if (!FORMATS.includes(fields.format)) throw fail("INVALID_REQUEST"); item.format = fields.format; }
  }
  if (fields.context) {
    if (String(fields.context).length > FEEDBACK_LIMITS.context) throw fail("INVALID_REQUEST");
    let context;
    try { context = JSON.parse(fields.context); } catch { throw fail("INVALID_REQUEST"); }
    if (!context || typeof context !== "object" || Array.isArray(context)) throw fail("INVALID_REQUEST");
    item.context = context;
  }
  return item;
}

export function validateAttachments(files) {
  if (files.length > FEEDBACK_LIMITS.files || files.reduce((sum, file) => sum + file.size, 0) > FEEDBACK_LIMITS.bytes) throw fail("TOO_LARGE", 413);
  for (const file of files) if (!ATTACHMENT.test(file.name) || !file.size) throw fail("INVALID_ATTACHMENT");
  return files.map(file => ({ name: clean(file.name.split(/[\\/]/).pop(), 255), bytes: file.bytes, size: file.size }));
}

const columns = `f.id, f.owner_user_id AS "ownerUserId", f.owner_name AS "ownerName", f.kind, f.mode, f.task_id AS "taskId", f.marker, f.format, f.content, f.context,
  f.status, f.reply, f.resolved_name AS "resolvedName", f.resolved_at AS "resolvedAt", f.reply_seen_at IS NOT NULL AS "replySeen", f.created_at AS "createdAt",
  coalesce((SELECT json_agg(json_build_object('index', a.position, 'name', a.name, 'size', a.size) ORDER BY a.position) FROM feedback_attachments a WHERE a.feedback_id = f.id), '[]') AS attachments`;

export class PgFeedbackRepository {
  constructor({ connectionString, masterKey, keyVersion = "v1" }) { this.pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 }); this.masterKey = masterKey; this.keyVersion = keyVersion; }
  async initialize(schema) { await this.pool.query(schema); }
  async create(session, item, files) {
    const id = randomUUID(), c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`INSERT INTO feedback(id, owner_user_id, owner_name, kind, mode, task_id, marker, format, content, context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, session.userId, session.userName, item.kind, item.mode, item.taskId, item.marker, item.format, item.content, JSON.stringify(item.context)]);
      for (const [position, file] of files.entries()) {
        const e = encryptFile(file.bytes, this.masterKey, this.keyVersion);
        await c.query(`INSERT INTO feedback_attachments VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, position, file.name, file.size, e.ciphertext, e.iv, e.tag, e.wrappedKey.ciphertext, e.wrappedKey.iv, e.wrappedKey.tag, e.keyVersion]);
      }
      await c.query("COMMIT");
      return id;
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  async list(session, { status } = {}) {
    const values = [], where = [];
    if (!session.isAdmin) { values.push(session.userId); where.push(`f.owner_user_id = $${values.length}`); }
    if (status) { values.push(status); where.push(`f.status = $${values.length}`); }
    return (await this.pool.query(`SELECT ${columns} FROM feedback f ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY f.created_at DESC LIMIT 200`, values)).rows;
  }
  async summary(session) {
    const [{ open }] = (await this.pool.query(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open FROM feedback`)).rows;
    const [{ replies }] = (await this.pool.query(`SELECT count(*)::int AS replies FROM feedback WHERE owner_user_id = $1 AND status = 'resolved' AND reply_seen_at IS NULL`, [session.userId])).rows;
    return { open: session.isAdmin ? open : 0, replies };
  }
  async resolve(session, id, reply) {
    const { rows } = await this.pool.query(`UPDATE feedback SET status = 'resolved', reply = $3, resolved_by = $2, resolved_name = $4, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [id, session.userId, reply, session.userName]);
    if (rows.length) return;
    throw fail((await this.pool.query("SELECT 1 FROM feedback WHERE id = $1", [id])).rowCount ? "ALREADY_RESOLVED" : "NOT_FOUND", 409);
  }
  async markSeen(session, id) { await this.pool.query(`UPDATE feedback SET reply_seen_at = now() WHERE id = $1 AND owner_user_id = $2 AND status = 'resolved' AND reply_seen_at IS NULL`, [id, session.userId]); }
  async attachment(id, position) {
    const row = (await this.pool.query(`SELECT * FROM feedback_attachments WHERE feedback_id = $1 AND position = $2`, [id, position])).rows[0];
    if (!row) return null;
    return { name: row.name, bytes: decryptFile({ ciphertext: row.ciphertext, iv: row.data_iv, tag: row.data_tag, wrappedKey: { ciphertext: row.wrapped_key, iv: row.wrap_iv, tag: row.wrap_tag } }, this.masterKey) };
  }
  async cleanupExpired() { return (await this.pool.query("DELETE FROM feedback WHERE created_at < now() - interval '180 days'")).rowCount; }
  async close() { await this.pool.end(); }
}

// Same behaviour in memory, for the dev server and unit tests.
export class MemoryFeedbackRepository {
  constructor() { this.items = []; }
  async initialize() {}
  view(item) { const { files, ownerUserId, ...rest } = item; return { ...structuredClone(rest), ownerUserId, attachments: files.map((f, index) => ({ index, name: f.name, size: f.size })) }; }
  async create(session, item, files) {
    const id = randomUUID();
    this.items.unshift({ id, ownerUserId: session.userId, ownerName: session.userName, ...structuredClone(item), status: "open", reply: null, resolvedName: null, resolvedAt: null, replySeen: false, createdAt: new Date().toISOString(), files });
    return id;
  }
  async list(session, { status } = {}) { return this.items.filter(i => (session.isAdmin || i.ownerUserId === session.userId) && (!status || i.status === status)).map(i => this.view(i)); }
  async summary(session) { return { open: session.isAdmin ? this.items.filter(i => i.status === "open").length : 0, replies: this.items.filter(i => i.ownerUserId === session.userId && i.status === "resolved" && !i.replySeen).length }; }
  async resolve(session, id, reply) {
    const item = this.items.find(i => i.id === id);
    if (!item) throw fail("NOT_FOUND", 409);
    if (item.status !== "open") throw fail("ALREADY_RESOLVED", 409);
    Object.assign(item, { status: "resolved", reply, resolvedName: session.userName, resolvedAt: new Date().toISOString() });
  }
  async markSeen(session, id) { const item = this.items.find(i => i.id === id && i.ownerUserId === session.userId && i.status === "resolved"); if (item) item.replySeen = true; }
  async attachment(id, position) { const file = this.items.find(i => i.id === id)?.files[position]; return file ? { name: file.name, bytes: file.bytes } : null; }
  async cleanupExpired() { return 0; }
}

export function createFeedbackHandler({ repository, auth, origin }) {
  return async request => {
    const url = new URL(request.url), path = url.pathname;
    if (path !== "/api/v1/feedback" && !path.startsWith("/api/v1/feedback/")) return null;
    try {
      if (request.headers.get("origin") && request.headers.get("origin") !== origin) throw fail("INVALID_REQUEST", 403);
      const session = auth.authenticate(request);
      if (!session) return json({ code: "AUTH_REQUIRED", message: "请从企业微信工作台重新进入应用。" }, 401);
      const parts = path.split("/").slice(4);
      if (request.method === "GET") {
        if (path === "/api/v1/feedback") {
          const status = url.searchParams.get("status");
          if (status && !["open", "resolved"].includes(status)) throw fail("INVALID_REQUEST");
          return json({ items: await repository.list(session, { status }) });
        }
        if (path === "/api/v1/feedback/summary") return json(await repository.summary(session));
        if (parts.length === 3 && parts[1] === "attachments" && UUID.test(parts[0]) && /^\d$/.test(parts[2])) {
          if (!session.isAdmin) throw fail("ADMIN_REQUIRED", 403);
          const file = await repository.attachment(parts[0], Number(parts[2]));
          if (!file) throw fail("NOT_FOUND", 404);
          return new Response(file.bytes, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
        }
        throw fail("INVALID_REQUEST", 404);
      }
      if (request.method !== "POST" || request.headers.get("origin") !== origin || !equal(request.headers.get("x-csrf-token"), session.csrf)) throw fail("INVALID_REQUEST", 403);
      if (path === "/api/v1/feedback") {
        // The form is read whole, so its size must be known and bounded first.
        const length = Number(request.headers.get("content-length"));
        if (!length) throw fail("INVALID_REQUEST", 411);
        if (length > FEEDBACK_LIMITS.bytes + 256 * 1024) throw fail("TOO_LARGE", 413);
        if (!(request.headers.get("content-type") || "").startsWith("multipart/form-data")) throw fail("INVALID_REQUEST", 415);
        const form = await request.formData();
        const fields = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
        const item = validateFeedback(fields);
        const uploads = await Promise.all(form.getAll("files").filter(value => typeof value !== "string").map(async file => ({ name: file.name, size: file.size, bytes: Buffer.from(await file.arrayBuffer()) })));
        const files = validateAttachments(uploads);
        if (item.kind === "usage" && files.length) throw fail("INVALID_ATTACHMENT");
        return json({ id: await repository.create(session, item, files) }, 201);
      }
      if (parts.length === 2 && UUID.test(parts[0]) && parts[1] === "resolve") {
        if (!session.isAdmin) throw fail("ADMIN_REQUIRED", 403);
        let body;
        try { body = JSON.parse(await request.text()); } catch { throw fail("INVALID_REQUEST"); }
        const reply = clean(body?.reply, FEEDBACK_LIMITS.reply + 1);
        if (!reply || reply.length > FEEDBACK_LIMITS.reply) throw fail("INVALID_REQUEST");
        await repository.resolve(session, parts[0], reply);
        return json({ ok: true });
      }
      if (parts.length === 2 && UUID.test(parts[0]) && parts[1] === "seen") { await repository.markSeen(session, parts[0]); return json({ ok: true }); }
      throw fail("INVALID_REQUEST", 404);
    } catch (e) {
      const code = MESSAGES[e.message] ? e.message : "FEEDBACK_UNAVAILABLE";
      return json({ code, message: MESSAGES[code] ?? "反馈服务暂不可用，请稍后重试。" }, e.status ?? 503);
    }
  };
}
