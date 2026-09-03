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

test("Vault API 强制会话、CSRF 和任务所有者边界", async () => {
  const rows = new Map();
  const repository = {
    async create(owner, vault) { rows.set(`${owner}:${vault.taskId}`, vault); return { expiresAt: "2026-09-24T00:00:00.000Z" }; },
    async list(owner) { return [...rows.entries()].filter(([key]) => key.startsWith(`${owner}:`)).map(([, value]) => value); },
    async load(owner, taskId) { return rows.get(`${owner}:${taskId}`) ?? null; },
    async delete(owner, taskId) { return rows.delete(`${owner}:${taskId}`); },
  };
  const auth = { authenticate: (request) => request.headers.get("authorization") === "owner-a" ? { userId: "A", csrf: "csrf-a" } : request.headers.get("authorization") === "owner-b" ? { userId: "B", csrf: "csrf-b" } : null };
  const handle = createVaultHandler({ repository, auth });
  assert.equal((await handle(new Request("https://vault.test/api/v1/session"))).status, 401);
  const vault = { version: 2, taskId: "A1B2C3D4", taskName: "测试任务", sourceFormat: "csv", createdAt: new Date().toISOString(), mapping: { "[[C001@A1B2C3D4]]": "客户甲" }, occurrenceBaseline: { "[[C001@A1B2C3D4]]": 2 } };
  const unauthorized = await handle(new Request("https://vault.test/api/v1/vault-tasks", { method: "POST", headers: { authorization: "owner-a", "content-type": "application/json" }, body: JSON.stringify(vault) }));
  assert.equal(unauthorized.status, 403);
  const created = await handle(new Request("https://vault.test/api/v1/vault-tasks", { method: "POST", headers: { authorization: "owner-a", "x-csrf-token": "csrf-a", "content-type": "application/json" }, body: JSON.stringify(vault) }));
  assert.equal(created.status, 201);
  const semanticVault = { ...vault, taskId: "E5F6A7B8", mapping: { "[[客户名称:C001@E5F6A7B8]]": "客户乙" }, occurrenceBaseline: { "[[客户名称:C001@E5F6A7B8]]": 1 } };
  const semanticCreated = await handle(new Request("https://vault.test/api/v1/vault-tasks", { method: "POST", headers: { authorization: "owner-a", "x-csrf-token": "csrf-a", "content-type": "application/json" }, body: JSON.stringify(semanticVault) }));
  assert.equal(semanticCreated.status, 201);
  assert.equal((await handle(new Request("https://vault.test/api/v1/vault-tasks/A1B2C3D4/mapping", { headers: { authorization: "owner-b" } }))).status, 404);
  assert.equal((await handle(new Request("https://vault.test/api/v1/vault-tasks/A1B2C3D4/mapping", { headers: { authorization: "owner-a" } }))).status, 200);
});
