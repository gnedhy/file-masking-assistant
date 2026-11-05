import pg from "pg";
import { timingSafeEqual } from "node:crypto";

// Two roles only: admins see everyone's operation records and manage this list; everyone else is an ordinary user.
// The first person to sign in after deployment becomes the first admin; later newcomers are ordinary users.

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (code, status) => Object.assign(new Error(code), { status });
const MESSAGES = {
  ADMIN_REQUIRED: "只有管理员可以配置权限。",
  LAST_ADMIN: "至少要保留一位管理员。",
  NOT_IN_DIRECTORY: "通讯录里没有这个人，请先同步通讯录。",
  DIRECTORY_EMPTY: "没有从企业微信读到任何成员，请检查应用可见范围和企业可信 IP。",
  DIRECTORY_FAILED: "同步通讯录失败，请稍后重试；多次失败请检查企业可信 IP 和应用 Secret。",
  DIRECTORY_UNAVAILABLE: "当前环境没有连接企业微信通讯录。",
  INVALID_REQUEST: "请求未通过检查。",
};

export class PgAccessRepository {
  constructor({ connectionString }) { this.pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 }); }
  async transaction(work) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      // One lock for every write, so "at least one admin" and "first login" cannot race.
      await c.query("SELECT pg_advisory_xact_lock(64382200)");
      const result = await work(c);
      await c.query("COMMIT");
      return result;
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  async initialize(schema) { await this.transaction(c => c.query(schema)); }
  async admins() { return new Set((await this.pool.query("SELECT user_id FROM app_admins")).rows.map(r => r.user_id)); }
  async claimFirst(session) {
    return this.transaction(async c => {
      if ((await c.query("SELECT 1 FROM app_admins LIMIT 1")).rowCount) return false;
      await c.query("INSERT INTO app_admins(user_id, granted_by) VALUES($1, $1)", [session.userId]);
      await c.query("INSERT INTO admin_changes(actor_user_id, actor_name, target_user_id, target_name, change) VALUES($1, $2, $1, $2, 'first_login')", [session.userId, session.userName]);
      return true;
    });
  }
  async setAdmin(actor, userId, isAdmin) {
    return this.transaction(async c => {
      const member = (await c.query("SELECT name FROM directory_members WHERE user_id = $1", [userId])).rows[0];
      const current = (await c.query("SELECT 1 FROM app_admins WHERE user_id = $1", [userId])).rowCount > 0;
      if (isAdmin === current) return;
      if (isAdmin && !member) throw fail("NOT_IN_DIRECTORY", 404);
      if (!isAdmin && (await c.query("SELECT count(*)::int AS n FROM app_admins")).rows[0].n <= 1) throw fail("LAST_ADMIN", 409);
      await c.query(isAdmin ? "INSERT INTO app_admins(user_id, granted_by) VALUES($1, $2)" : "DELETE FROM app_admins WHERE user_id = $1", isAdmin ? [userId, actor.userId] : [userId]);
      await c.query("INSERT INTO admin_changes(actor_user_id, actor_name, target_user_id, target_name, change) VALUES($1, $2, $3, $4, $5)", [actor.userId, actor.userName, userId, member?.name ?? userId, isAdmin ? "grant" : "revoke"]);
    });
  }
  async replaceDirectory({ departments, members }) {
    await this.transaction(async c => {
      await c.query("DELETE FROM directory_departments");
      await c.query("DELETE FROM directory_members");
      await c.query("INSERT INTO directory_departments SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, name text, parent_id bigint, sort_order bigint)", [JSON.stringify(departments.map(d => ({ id: d.id, name: d.name, parent_id: d.parentId, sort_order: d.order })))]);
      await c.query("INSERT INTO directory_members SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(user_id text, name text, department_ids jsonb)", [JSON.stringify(members.map(m => ({ user_id: m.userId, name: m.name, department_ids: m.departmentIds })))]);
      await c.query("INSERT INTO directory_sync(id, synced_at) VALUES(1, now()) ON CONFLICT (id) DO UPDATE SET synced_at = now()");
    });
  }
  async overview() {
    const q = sql => this.pool.query(sql).then(r => r.rows);
    const [sync, departments, members, admins, changes] = await Promise.all([
      q("SELECT synced_at FROM directory_sync WHERE id = 1"),
      q(`SELECT id::text, name, parent_id::text AS "parentId" FROM directory_departments ORDER BY sort_order DESC, id`),
      q(`SELECT user_id AS "userId", name, department_ids AS "departmentIds" FROM directory_members ORDER BY name, user_id`),
      q(`SELECT a.user_id AS "userId", coalesce(m.name, a.user_id) AS name, a.granted_at AS "grantedAt" FROM app_admins a LEFT JOIN directory_members m USING (user_id) ORDER BY a.granted_at`),
      q(`SELECT changed_at AS time, actor_name AS "actorName", target_name AS "targetName", change FROM admin_changes ORDER BY id DESC LIMIT 30`),
    ]);
    return { syncedAt: sync[0]?.synced_at ?? null, departments, members: members.map(m => ({ ...m, departmentIds: m.departmentIds.map(String) })), admins, changes };
  }
  async close() { await this.pool.end(); }
}

// Same behaviour in memory, for the dev server and unit tests.
export class MemoryAccessRepository {
  constructor({ admins = [], directory = null } = {}) {
    this.adminMap = new Map(admins.map(userId => [userId, { grantedAt: new Date().toISOString() }]));
    this.directory = directory;
    this.syncedAt = null;
    this.changeLog = [];
  }
  async initialize() {}
  async admins() { return new Set(this.adminMap.keys()); }
  log(actor, userId, name, change) { this.changeLog.unshift({ time: new Date().toISOString(), actorName: actor.userName, targetName: name, change, userId }); }
  async claimFirst(session) {
    if (this.adminMap.size) return false;
    this.adminMap.set(session.userId, { grantedAt: new Date().toISOString() });
    this.log(session, session.userId, session.userName, "first_login");
    return true;
  }
  async setAdmin(actor, userId, isAdmin) {
    const member = this.directory?.members.find(m => m.userId === userId);
    if (isAdmin === this.adminMap.has(userId)) return;
    if (isAdmin && !member) throw fail("NOT_IN_DIRECTORY", 404);
    if (!isAdmin && this.adminMap.size <= 1) throw fail("LAST_ADMIN", 409);
    if (isAdmin) this.adminMap.set(userId, { grantedAt: new Date().toISOString() }); else this.adminMap.delete(userId);
    this.log(actor, userId, member?.name ?? userId, isAdmin ? "grant" : "revoke");
  }
  async replaceDirectory(directory) { this.directory = structuredClone(directory); this.syncedAt = new Date().toISOString(); }
  async overview() {
    const members = this.directory?.members ?? [];
    const name = userId => members.find(m => m.userId === userId)?.name ?? userId;
    return {
      syncedAt: this.syncedAt,
      departments: (this.directory?.departments ?? []).map(d => ({ id: String(d.id), name: d.name, parentId: d.parentId == null ? null : String(d.parentId) })),
      members: members.map(m => ({ userId: m.userId, name: m.name, departmentIds: m.departmentIds.map(String) })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      admins: [...this.adminMap].map(([userId, v]) => ({ userId, name: name(userId), grantedAt: v.grantedAt })),
      changes: this.changeLog.slice(0, 30).map(({ userId, ...change }) => change),
    };
  }
}

// Wraps the sign-in provider: sessions carry isAdmin from the admin list, and /api/v1/access* serves the settings page.
export async function createAccess({ repository, auth, directorySource, origin }) {
  let admins = await repository.admins();
  let syncing = null;
  const reload = async () => { admins = await repository.admins(); };
  const authenticate = request => {
    const session = auth.authenticate(request);
    return session && { ...session, isAdmin: admins.has(session.userId) };
  };
  async function overview(session) {
    const data = await repository.overview();
    const adminIds = new Set(data.admins.map(a => a.userId));
    return { me: session.userId, ...data, members: data.members.map(m => ({ ...m, isAdmin: adminIds.has(m.userId) })) };
  }
  async function sync() {
    if (!directorySource) throw fail("DIRECTORY_UNAVAILABLE", 501);
    syncing ??= (async () => {
      let directory;
      try { directory = await directorySource(); } catch { throw fail("DIRECTORY_FAILED", 502); }
      // An empty answer usually means a permission problem; keep the last good copy instead of wiping it.
      if (!directory.members.length) throw fail("DIRECTORY_EMPTY", 502);
      await repository.replaceDirectory(directory);
    })().finally(() => { syncing = null; });
    return syncing;
  }
  async function body(request) {
    if (!(request.headers.get("content-type") || "").startsWith("application/json")) throw fail("INVALID_REQUEST", 415);
    const text = await request.text();
    if (text.length > 4096) throw fail("INVALID_REQUEST", 413);
    try { return JSON.parse(text); } catch { throw fail("INVALID_REQUEST", 400); }
  }

  // A department filter covers the department and every department under it.
  async function departmentUserIds(departmentId) {
    const { departments, members } = await repository.overview();
    const ids = new Set([String(departmentId)]);
    for (let grew = true; grew;) {
      grew = false;
      for (const d of departments) if (d.parentId != null && ids.has(String(d.parentId)) && !ids.has(String(d.id))) { ids.add(String(d.id)); grew = true; }
    }
    return members.filter(m => m.departmentIds.some(id => ids.has(String(id)))).map(m => m.userId);
  }

  return {
    authenticate,
    departmentUserIds,
    start: request => auth.start(request),
    callback: request => auth.callback(request),
    // Runs before /api/v1/session answers, so the very first visitor sees themself as admin straight away.
    async claimFirst(request) {
      if (admins.size) return;
      const session = auth.authenticate(request);
      if (session && await repository.claimFirst(session)) await reload();
    },
    async handle(request) {
      const url = new URL(request.url), path = url.pathname;
      if (path !== "/api/v1/access" && !path.startsWith("/api/v1/access/")) return null;
      try {
        if (request.headers.get("origin") && request.headers.get("origin") !== origin) throw fail("INVALID_REQUEST", 403);
        const session = authenticate(request);
        if (!session) return json({ code: "AUTH_REQUIRED", message: "请从企业微信工作台重新进入应用。" }, 401);
        if (!session.isAdmin) throw fail("ADMIN_REQUIRED", 403);
        if (request.method === "GET" && path === "/api/v1/access") return json(await overview(session));
        if (request.method !== "POST" || request.headers.get("origin") !== origin || !equal(request.headers.get("x-csrf-token"), session.csrf)) throw fail("INVALID_REQUEST", 403);
        if (path === "/api/v1/access/sync") { await sync(); return json(await overview(session)); }
        if (path === "/api/v1/access/admins") {
          const { userId, isAdmin } = await body(request);
          if (typeof userId !== "string" || !userId || userId.length > 128 || typeof isAdmin !== "boolean") throw fail("INVALID_REQUEST", 400);
          await repository.setAdmin(session, userId, isAdmin);
          await reload();
          return json(await overview(session));
        }
        throw fail("INVALID_REQUEST", 404);
      } catch (e) {
        const code = MESSAGES[e.message] ? e.message : "ACCESS_UNAVAILABLE";
        return json({ code, message: MESSAGES[code] ?? "权限服务暂不可用，请稍后重试。" }, e.status ?? 503);
      }
    },
  };
}
