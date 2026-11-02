#!/usr/bin/env node
// Development and test server only: the API with fixed test identities plus Vite as middleware in one process,
// so nothing is proxied between two servers. Never part of the production image.
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createServer as createViteServer } from "vite";
import { createAppHandler } from "../server/handler.mjs";
import { PgOperationsRepository, validateEvent } from "../server/operations-repository.mjs";
import { PgVaultRepository } from "../server/repository.mjs";
import { summarizeTask, taskKeyResolver } from "../src/operationTasks.js";

export const TEST_USERS = {
  admin: { userId: "test-admin", userName: "测试管理员", isAdmin: true },
  alice: { userId: "test-alice", userName: "测试员工甲", isAdmin: false },
  bob: { userId: "test-bob", userName: "测试员工乙", isAdmin: false },
};

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex > 0 ? process.argv[portIndex + 1] : process.env.DEV_PORT || 5174);
const origin = `http://127.0.0.1:${port}`;
const API_PATHS = /^\/(api|auth|__test)\/|^\/(healthz|readyz)$/;
const defaultUser = process.env.DEV_USER || "alice";
if (!Object.hasOwn(TEST_USERS, defaultUser)) throw new Error(`Unknown DEV_USER: ${defaultUser}`);
const secret = randomBytes(32);
const sign = value => createHmac("sha256", secret).update(value).digest("base64url");

export class MemoryVaultRepository {
  constructor() { this.tasks = new Map(); this.markers = new Map(); }
  async create(owner, vault) {
    const key = `${owner}:${vault.taskId}`;
    if (this.tasks.has(key)) throw Object.assign(new Error("duplicate"), { code: "23505" });
    this.tasks.set(key, structuredClone({ ...vault, uniqueValues: Object.keys(vault.mapping).length }));
  }
  async list(owner) {
    return [...this.tasks.entries()].filter(([key]) => key.startsWith(`${owner}:`))
      .map(([, { taskId, taskName, sourceFormat, createdAt, tokenFormat, marker, uniqueValues, occurrenceBaseline }]) => ({ taskId, taskName, sourceFormat, createdAt, tokenFormat, marker, uniqueValues, occurrenceBaseline: occurrenceBaseline ?? {} }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async load(owner, taskId) { const task = this.tasks.get(`${owner}:${taskId}`); return task ? structuredClone(task) : null; }
  async delete(owner, taskId) { return this.tasks.delete(`${owner}:${taskId}`); }
  async reserveMarker(owner, marker, taskId) {
    const key = `${owner}:${marker}`;
    if (this.markers.has(key)) return false;
    this.markers.set(key, taskId);
    return true;
  }
  async markerOwner(owner, marker) { return this.markers.get(`${owner}:${marker}`) ?? null; }
}

// Enough of the operations repository for local use; PostgreSQL covers the real filters.
export class MemoryOperationsRepository {
  constructor() { this.rows = []; }
  async append(session, event) {
    const e = validateEvent(event);
    if (this.rows.some(row => row.userId === session.userId && row.eventId === e.eventId)) return "duplicate";
    this.rows.push({ ...e, id: e.eventId, userId: session.userId, userName: session.userName, receivedAt: new Date().toISOString() });
    return "accepted";
  }
  visible(session, filters = {}) {
    const user = session.isAdmin ? filters.user : session.userId;
    const query = String(filters.query || "").toLowerCase();
    return this.rows.filter(row => (!user || row.userId === user)
      && ["action", "result", "format"].every(key => !filters[key] || row[key] === filters[key])
      && (!query || [row.inputName, row.outputName, row.taskId, row.marker].join(" ").toLowerCase().includes(query)))
      .sort((a, b) => b.time.localeCompare(a.time));
  }
  async list(session, filters = {}) {
    const page = Number(filters.page || 1), rows = this.visible(session, filters);
    return { records: rows.slice((page - 1) * 10, page * 10), total: rows.length, page, pageSize: 10 };
  }
  async listTasks(session, filters = {}) {
    const page = Number(filters.page || 1), keyOf = taskKeyResolver(this.rows), groups = new Map();
    const hits = new Set(this.visible(session, filters).map(keyOf));
    for (const row of [...this.rows].sort((a, b) => a.time.localeCompare(b.time))) {
      const key = keyOf(row);
      if (!hits.has(key)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const tasks = [...groups].map(([key, events]) => summarizeTask(key, events)).sort((a, b) => b.lastTime.localeCompare(a.lastTime));
    return { tasks: tasks.slice((page - 1) * 10, page * 10), total: tasks.length, page, pageSize: 10 };
  }
  async statistics(session, filters = {}) {
    const totals = rows => ({ users: new Set(rows.map(r => r.userId)).size, protected: rows.filter(r => r.action === "protect" && r.result === "success").length, restored: rows.filter(r => r.action === "restore" && r.result !== "failed").length, failed: rows.filter(r => r.result === "failed").length, imports: rows.filter(r => r.action.startsWith("import_")).length, downloads: rows.filter(r => r.action.startsWith("download_")).length });
    const rows = this.visible(session, filters);
    return { totals: totals(rows), users: [...new Set(rows.map(r => r.userId))].sort().map(userId => ({ userId, userName: rows.find(r => r.userId === userId).userName, ...totals(rows.filter(r => r.userId === userId)) })) };
  }
  async *exportRows(session, filters = {}, excludeEventId) { yield this.visible(session, filters).filter(row => row.eventId !== excludeEventId); }
  async ready() {}
}

const cookieValue = request => String(request.headers.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith("dev_session="))?.slice(12);
// Each new browser gets its own throwaway identity, like a fresh profile; fixed users stay available for role tests.
const identity = user => TEST_USERS[user] ?? (/^dev-[a-z0-9]{10}$/.test(user) ? { userId: user, userName: "开发测试用户", isAdmin: false } : null);
const auth = {
  authenticate(request) {
    const [user, signature] = String(cookieValue(request) || "").split(".");
    if (!identity(user) || signature !== sign(user)) return null;
    return { ...identity(user), csrf: sign(`csrf:${user}`) };
  },
  start() { return login(defaultUser, true); },
  callback() { return new Response(null, { status: 302, headers: { location: "/" } }); },
};

function sessionCookie(user) { return `dev_session=${user}.${sign(user)}; Path=/; HttpOnly; SameSite=Lax`; }

function login(user, redirect) {
  const cookie = sessionCookie(user);
  if (redirect) return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie } });
  return new Response(JSON.stringify({ ...identity(user), csrf: sign(`csrf:${user}`) }), { headers: { "content-type": "application/json", "set-cookie": cookie } });
}

let vaultRepository = new MemoryVaultRepository();
let operationsRepository = new MemoryOperationsRepository();
if (process.env.DATABASE_URL) {
  vaultRepository = new PgVaultRepository({ connectionString: process.env.DATABASE_URL, masterKey: Buffer.alloc(32, 7) });
  await vaultRepository.initialize(await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"));
  operationsRepository = new PgOperationsRepository({ connectionString: process.env.DATABASE_URL });
  await operationsRepository.initialize(await readFile(new URL("../server/operations-schema.sql", import.meta.url), "utf8"));
}
const handle = createAppHandler({ vaultRepository, operationsRepository, auth, origin });

const server = createServer(async (req, res) => {
  if (!API_PATHS.test(new URL(req.url, origin).pathname)) { vite.middlewares(req, res); return; }
  try {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Readable.toWeb(req);
    const headers = new Headers(req.headers);
    // localhost and 127.0.0.1 are the same machine here; production checks one fixed origin.
    if (headers.get("origin") === `http://localhost:${port}`) headers.set("origin", origin);
    let issued = null;
    if (req.url.startsWith("/api/") && !auth.authenticate(new Request(origin, { headers }))) {
      issued = `dev-${randomBytes(8).toString("hex").slice(0, 10)}`;
      headers.set("cookie", `dev_session=${issued}.${sign(issued)}`);
    }
    const request = new Request(new URL(req.url, origin), { method: req.method, headers, body, ...(body ? { duplex: "half" } : {}) });
    const path = new URL(request.url).pathname;
    let response;
    if (path === "/__test/session" && request.method === "POST") {
      const { user } = await request.json();
      response = Object.hasOwn(TEST_USERS, user) ? login(user, false) : new Response('{"code":"INVALID_USER"}', { status: 400 });
    } else response = await handle(request) ?? new Response("Not found", { status: 404 });
    const outgoing = Object.fromEntries(response.headers);
    if (issued) outgoing["set-cookie"] = sessionCookie(issued);
    res.writeHead(response.status, outgoing);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "DEV_SERVER_FAILED", message: error.message }));
  }
});
const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
for (const event of ["uncaughtException", "unhandledRejection"]) process.on(event, error => console.error(`Dev server ${event}:`, error));
server.listen(port, "127.0.0.1", () => console.log(`Dev server on ${origin} (${process.env.DATABASE_URL ? "PostgreSQL" : "memory"} store, default user ${defaultUser})`));
