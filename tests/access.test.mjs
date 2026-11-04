import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAccess, MemoryAccessRepository, PgAccessRepository } from "../server/access.mjs";
import { createAppHandler } from "../server/handler.mjs";

const origin = "http://127.0.0.1:4175";
const USERS = { zhang: "张三", li: "李四", wang: "王五" };
// A cookie names the signed-in user; the CSRF token is fixed per user.
const auth = { authenticate: request => { const user = /session=([a-z]+)/.exec(request.headers.get("cookie") || "")?.[1]; return USERS[user] ? { userId: user, userName: USERS[user], csrf: `csrf-${user}` } : null; } };
const DIRECTORY = {
  departments: [{ id: 1, name: "公司", parentId: null, order: 2 }, { id: 2, name: "销售部", parentId: 1, order: 1 }],
  members: [{ userId: "zhang", name: "张三", departmentIds: [1] }, { userId: "li", name: "李四", departmentIds: [2] }],
};

async function setup({ repository = new MemoryAccessRepository(), directorySource = async () => structuredClone(DIRECTORY) } = {}) {
  const access = await createAccess({ repository, auth, directorySource, origin });
  const vault = { list: async () => [] };
  const operations = { ready: async () => {} };
  const handle = createAppHandler({ vaultRepository: vault, operationsRepository: operations, access, origin });
  const call = async (user, path, { method = "GET", body } = {}) => {
    const headers = { cookie: `session=${user}` };
    if (method !== "GET") Object.assign(headers, { origin, "content-type": "application/json", "x-csrf-token": `csrf-${user}` });
    const response = await handle(new Request(origin + path, { method, headers, body: body && JSON.stringify(body) }));
    return { status: response.status, data: await response.json() };
  };
  return { access, call, repository };
}

test("部署后第一个登录的人成为管理员，之后的人都是普通用户", async () => {
  const { call } = await setup();
  assert.equal((await call("zhang", "/api/v1/session")).data.isAdmin, true);
  assert.equal((await call("li", "/api/v1/session")).data.isAdmin, false);
  assert.equal((await call("zhang", "/api/v1/session")).data.isAdmin, true);
  const overview = (await call("zhang", "/api/v1/access")).data;
  assert.deepEqual(overview.admins.map(a => a.userId), ["zhang"]);
  assert.equal(overview.changes[0].change, "first_login");
});

test("普通用户不能读取或修改权限配置", async () => {
  const { call } = await setup();
  await call("zhang", "/api/v1/session");
  assert.equal((await call("li", "/api/v1/access")).status, 403);
  assert.equal((await call("li", "/api/v1/access/sync", { method: "POST" })).status, 403);
  const grant = await call("li", "/api/v1/access/admins", { method: "POST", body: { userId: "li", isAdmin: true } });
  assert.equal(grant.status, 403);
  assert.equal(grant.data.code, "ADMIN_REQUIRED");
  assert.equal((await call("nobody", "/api/v1/access")).status, 401);
});

test("管理员同步通讯录、授予和取消管理员，并且至少保留一位", async () => {
  const { call } = await setup();
  await call("zhang", "/api/v1/session");
  const synced = (await call("zhang", "/api/v1/access/sync", { method: "POST" })).data;
  assert.ok(synced.syncedAt);
  assert.deepEqual(synced.departments.map(d => d.name), ["公司", "销售部"]);
  assert.deepEqual(synced.members.map(m => [m.userId, m.isAdmin, m.departmentIds]), [["li", false, ["2"]], ["zhang", true, ["1"]]]);

  assert.equal((await call("zhang", "/api/v1/access/admins", { method: "POST", body: { userId: "li", isAdmin: true } })).status, 200);
  assert.equal((await call("li", "/api/v1/session")).data.isAdmin, true);
  // Someone outside the synced directory cannot be made admin by typing their userId.
  assert.equal((await call("zhang", "/api/v1/access/admins", { method: "POST", body: { userId: "wang", isAdmin: true } })).data.code, "NOT_IN_DIRECTORY");

  assert.equal((await call("li", "/api/v1/access/admins", { method: "POST", body: { userId: "zhang", isAdmin: false } })).status, 200);
  assert.equal((await call("zhang", "/api/v1/session")).data.isAdmin, false);
  const last = await call("li", "/api/v1/access/admins", { method: "POST", body: { userId: "li", isAdmin: false } });
  assert.equal(last.status, 409);
  assert.equal(last.data.code, "LAST_ADMIN");
  const changes = (await call("li", "/api/v1/access")).data.changes;
  assert.deepEqual(changes.map(c => [c.actorName, c.targetName, c.change]), [["李四", "张三", "revoke"], ["张三", "李四", "grant"], ["张三", "张三", "first_login"]]);
});

test("写操作要求同源和 CSRF 令牌", async () => {
  const { access } = await setup();
  await access.claimFirst(new Request(origin, { headers: { cookie: "session=zhang" } }));
  const post = headers => access.handle(new Request(`${origin}/api/v1/access/sync`, { method: "POST", headers: { cookie: "session=zhang", ...headers } }));
  assert.equal((await post({ origin, "x-csrf-token": "wrong" })).status, 403);
  assert.equal((await post({ origin: "https://evil.example", "x-csrf-token": "csrf-zhang" })).status, 403);
  assert.equal((await post({ "x-csrf-token": "csrf-zhang" })).status, 403);
  assert.equal((await post({ origin, "x-csrf-token": "csrf-zhang" })).status, 200);
});

test("企业微信返回空通讯录或失败时保留上一次的结果", async () => {
  let answer = structuredClone(DIRECTORY);
  const { call } = await setup({ directorySource: async () => { if (answer instanceof Error) throw answer; return structuredClone(answer); } });
  await call("zhang", "/api/v1/session");
  await call("zhang", "/api/v1/access/sync", { method: "POST" });
  answer = { departments: [], members: [] };
  assert.equal((await call("zhang", "/api/v1/access/sync", { method: "POST" })).data.code, "DIRECTORY_EMPTY");
  answer = new Error("errcode 60020");
  const failed = await call("zhang", "/api/v1/access/sync", { method: "POST" });
  assert.equal(failed.status, 502);
  assert.equal(failed.data.code, "DIRECTORY_FAILED");
  assert.doesNotMatch(failed.data.message, /60020/);
  assert.equal((await call("zhang", "/api/v1/access")).data.members.length, 2);
});

test("PostgreSQL 权限表：首个登录、并发抢占、授予、取消与通讯录替换", { skip: !process.env.OPERATIONS_TEST_DATABASE_URL }, async () => {
  const url = process.env.OPERATIONS_TEST_DATABASE_URL;
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("Test database required");
  const repository = new PgAccessRepository({ connectionString: url });
  await repository.initialize(await readFile(new URL("../server/access-schema.sql", import.meta.url), "utf8"));
  const clear = () => repository.transaction(c => c.query("DELETE FROM app_admins; DELETE FROM admin_changes; DELETE FROM directory_members; DELETE FROM directory_departments; DELETE FROM directory_sync"));
  await clear();
  try {
    const a = { userId: `a-${randomUUID()}`, userName: "甲" }, b = { userId: `b-${randomUUID()}`, userName: "乙" };
    // Two people opening the app at the same moment: exactly one becomes the first admin.
    const claims = await Promise.all([repository.claimFirst(a), repository.claimFirst(b)]);
    assert.deepEqual(claims.filter(Boolean).length, 1);
    const first = claims[0] ? a : b, second = claims[0] ? b : a;
    await repository.replaceDirectory({ departments: [{ id: 1, name: "公司", parentId: null, order: 0 }], members: [{ userId: first.userId, name: first.userName, departmentIds: [1] }, { userId: second.userId, name: second.userName, departmentIds: [1] }] });
    await repository.setAdmin(first, second.userId, true);
    await assert.rejects(() => repository.setAdmin(first, "missing", true), /NOT_IN_DIRECTORY/);
    await repository.setAdmin(second, first.userId, false);
    await assert.rejects(() => repository.setAdmin(second, second.userId, false), /LAST_ADMIN/);
    const overview = await repository.overview();
    assert.deepEqual([...await repository.admins()], [second.userId]);
    assert.deepEqual(overview.members.map(m => m.departmentIds), [["1"], ["1"]]);
    assert.deepEqual(overview.changes.map(c => c.change), ["revoke", "grant", "first_login"]);
    assert.ok(overview.syncedAt);
  } finally { await clear(); await repository.close(); }
});

test("按部门筛选时包含下级部门的人，编号按文本比较", async () => {
  const { access, call } = await setup();
  await access.claimFirst(new Request(origin, { headers: { cookie: "session=zhang" } }));
  assert.equal((await call("zhang", "/api/v1/access/sync", { method: "POST" })).status, 200);
  assert.deepEqual((await access.departmentUserIds("1")).sort(), ["li", "zhang"]);
  assert.deepEqual(await access.departmentUserIds("2"), ["li"]);
  assert.deepEqual(await access.departmentUserIds("999"), []);
});
