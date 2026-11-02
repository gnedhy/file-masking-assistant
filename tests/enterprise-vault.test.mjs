import assert from "node:assert/strict";
import test from "node:test";
import { decryptMapping, encryptMapping } from "../server/crypto.mjs";
import { createVaultHandler } from "../server/app.mjs";

test("企业映射使用独立数据密钥加密且篡改会失败", () => {
  const masterKey = Buffer.alloc(32, 7);
  const encrypted = encryptMapping({ "[[C001@A1B2C3D4]]": "浙江ABC染整" }, masterKey);
  assert.deepEqual(decryptMapping(encrypted, masterKey), { "[[C001@A1B2C3D4]]": "浙江ABC染整" });
  encrypted.ciphertext[0] ^= 1;
  assert.throws(() => decryptMapping(encrypted, masterKey));
});

function setup() {
  const rows = new Map();
  const markers = new Map();
  const repository = {
    async create(owner, vault) { rows.set(`${owner}:${vault.taskId}`, vault); },
    async list(owner) { return [...rows.entries()].filter(([key]) => key.startsWith(`${owner}:`)).map(([, value]) => value); },
    async load(owner, taskId) { return rows.get(`${owner}:${taskId}`) ?? null; },
    async delete(owner, taskId) { return rows.delete(`${owner}:${taskId}`); },
    async reserveMarker(owner, marker, taskId) { if (markers.has(`${owner}:${marker}`)) return false; markers.set(`${owner}:${marker}`, taskId); return true; },
    async markerOwner(owner, marker) { return markers.get(`${owner}:${marker}`) ?? null; },
  };
  const users = { "owner-a": { userId: "A", userName: "A", isAdmin: true, csrf: "csrf-a" }, "owner-b": { userId: "B", userName: "B", isAdmin: false, csrf: "csrf-b" } };
  const auth = { authenticate: (request) => users[request.headers.get("authorization")] ?? null };
  const handle = createVaultHandler({ repository, auth });
  const call = (path, { user, method = "GET", body, csrf = true } = {}) => handle(new Request(`https://vault.test${path}`, {
    method,
    headers: { ...(user ? { authorization: user } : {}), ...(csrf && user ? { "x-csrf-token": users[user].csrf } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  return { call };
}

test("Vault API 强制会话、CSRF 和任务所有者边界", async () => {
  const { call } = setup();
  assert.equal((await call("/api/v1/session")).status, 401);
  assert.deepEqual(await (await call("/api/v1/session", { user: "owner-a" })).json(), { userId: "A", userName: "A", isAdmin: true, csrf: "csrf-a" });
  const vault = { version: 2, taskId: "A1B2C3D4", taskName: "测试任务", sourceFormat: "csv", createdAt: new Date().toISOString(), mapping: { "[[C001@A1B2C3D4]]": "客户甲" }, occurrenceBaseline: { "[[C001@A1B2C3D4]]": 2 } };
  assert.equal((await call("/api/v1/vault-tasks", { user: "owner-a", method: "POST", body: vault, csrf: false })).status, 403);
  assert.equal((await call("/api/v1/vault-tasks", { user: "owner-a", method: "POST", body: vault })).status, 201);
  assert.equal((await call("/api/v1/vault-tasks/A1B2C3D4/mapping", { user: "owner-b" })).status, 404);
  assert.equal((await call("/api/v1/vault-tasks/A1B2C3D4/mapping", { user: "owner-a" })).status, 200);
});

test("简短代号任务必须先占用编号，编号按用户隔离且不回收", async () => {
  const { call } = setup();
  const taskId = crypto.randomUUID();
  const vault = { version: 2, taskId, tokenFormat: "short", marker: "K7M4", taskName: "简短任务", sourceFormat: "txt", createdAt: new Date().toISOString(), mapping: { "客户-K7M4-01": "客户甲" } };
  assert.equal((await call("/api/v1/vault-tasks", { user: "owner-a", method: "POST", body: vault })).status, 409);
  assert.equal((await call("/api/v1/vault-markers", { user: "owner-a", method: "POST", body: { marker: "K7M4", taskId } })).status, 201);
  assert.equal((await call("/api/v1/vault-markers", { user: "owner-a", method: "POST", body: { marker: "K7M4", taskId: crypto.randomUUID() } })).status, 409);
  assert.equal((await call("/api/v1/vault-markers", { user: "owner-a", method: "POST", body: { marker: "K7M4", taskId }, csrf: false })).status, 403);
  for (const bad of [{ marker: "k7m4", taskId }, { marker: "K7M0", taskId }, { marker: "K7M4", taskId: "A1B2C3D4" }]) {
    assert.equal((await call("/api/v1/vault-markers", { user: "owner-a", method: "POST", body: bad })).status, 400);
  }
  assert.equal((await call("/api/v1/vault-tasks", { user: "owner-a", method: "POST", body: { ...vault, mapping: { "客户-ABCD-01": "客户甲" } } })).status, 400);
  assert.equal((await call("/api/v1/vault-tasks", { user: "owner-a", method: "POST", body: vault })).status, 201);
  assert.deepEqual(await (await call("/api/v1/vault-markers/K7M4", { user: "owner-a" })).json(), { taskId });
  assert.equal((await call("/api/v1/vault-markers/K7M4", { user: "owner-b" })).status, 404);
  assert.equal((await call("/api/v1/vault-markers/K7M4")).status, 401);
  assert.equal((await call(`/api/v1/vault-tasks/${taskId}/mapping`, { user: "owner-a" })).status, 200);
  assert.equal((await call(`/api/v1/vault-tasks/${taskId}`, { user: "owner-a", method: "DELETE" })).status, 204);
  // The marker stays taken after the task is deleted.
  assert.equal((await call("/api/v1/vault-markers", { user: "owner-a", method: "POST", body: { marker: "K7M4", taskId: crypto.randomUUID() } })).status, 409);
});
