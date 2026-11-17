import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAccess, MemoryAccessRepository } from "../server/access.mjs";
import { MemoryFeedbackRepository, PgFeedbackRepository } from "../server/feedback.mjs";
import { createAppHandler } from "../server/handler.mjs";

const origin = "http://127.0.0.1:4175";
const USERS = { zhang: "张三", li: "李四", wang: "王五" };
// A cookie names the signed-in user; zhang is the admin.
const auth = { authenticate: request => { const user = /session=([a-z]+)/.exec(request.headers.get("cookie") || "")?.[1]; return USERS[user] ? { userId: user, userName: USERS[user], csrf: `csrf-${user}` } : null; } };

async function setup(feedbackRepository = new MemoryFeedbackRepository()) {
  const access = await createAccess({ repository: new MemoryAccessRepository({ admins: ["zhang"] }), auth, origin });
  const handle = createAppHandler({ vaultRepository: {}, operationsRepository: { ready: async () => {} }, feedbackRepository, access, origin });
  const send = (user, path, { method = "GET", body, headers = {} } = {}) => handle(new Request(origin + path, {
    method, body,
    headers: { cookie: `session=${user}`, ...(method === "GET" ? {} : { origin, "x-csrf-token": `csrf-${user}` }), ...headers },
  }));
  const submit = (user, fields, files = []) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const file of files) form.append("files", file);
    const request = new Request(origin, { method: "POST", body: form });
    return request.arrayBuffer().then(body => send(user, "/api/v1/feedback", { method: "POST", body, headers: { "content-type": request.headers.get("content-type"), "content-length": String(body.byteLength) } }));
  };
  const read = async (user, path) => (await send(user, path)).json();
  return { send, submit, read };
}

const resultFields = { kind: "result", mode: "protect", taskId: "0f8fad5b-d9cb-469f-a165-70867728950e", marker: "K7M4", format: "xlsx", content: "客户列有一列没替换", context: JSON.stringify({ outcome: "dislike", replaced: 12 }) };

test("倒赞反馈带上含代号的附件，只有管理员能看到并下载", async () => {
  const { submit, send, read } = await setup();
  const created = await submit("li", resultFields, [new File(["客户-K7M4-01"], "脱敏文件_K7M4.xlsx")]);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const mine = await read("li", "/api/v1/feedback");
  assert.equal(mine.items.length, 1);
  assert.deepEqual(mine.items[0].attachments, [{ index: 0, name: "脱敏文件_K7M4.xlsx", size: 14 }]);
  assert.equal(mine.items[0].context.replaced, 12);
  assert.equal((await read("wang", "/api/v1/feedback")).items.length, 0);
  assert.equal((await send("li", `/api/v1/feedback/${id}/attachments/0`)).status, 403);
  const download = await send("zhang", `/api/v1/feedback/${id}/attachments/0`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "客户-K7M4-01");
});

test("角标：提交后管理员加一，处理后管理员减一、反馈人加一，查看回复后清零", async () => {
  const { submit, send, read } = await setup();
  const { id } = await (await submit("li", { kind: "usage", content: "希望支持 PDF" })).json();
  assert.deepEqual(await read("zhang", "/api/v1/feedback/summary"), { open: 1, replies: 0 });
  assert.deepEqual(await read("li", "/api/v1/feedback/summary"), { open: 0, replies: 0 });
  const reply = body => send("zhang", `/api/v1/feedback/${id}/resolve`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  assert.equal((await send("li", `/api/v1/feedback/${id}/resolve`, { method: "POST", body: JSON.stringify({ reply: "我自己处理" }), headers: { "content-type": "application/json" } })).status, 403);
  assert.equal((await reply({ reply: "" })).status, 400);
  assert.equal((await reply({ reply: "已排期，下个版本支持" })).status, 200);
  assert.equal((await reply({ reply: "再处理一次" })).status, 409);
  assert.deepEqual(await read("zhang", "/api/v1/feedback/summary"), { open: 0, replies: 0 });
  assert.deepEqual(await read("li", "/api/v1/feedback/summary"), { open: 0, replies: 1 });
  const [item] = (await read("li", "/api/v1/feedback")).items;
  assert.equal(item.reply, "已排期，下个版本支持");
  assert.equal(item.resolvedName, "张三");
  // Someone else cannot clear the badge for the sender.
  await send("wang", `/api/v1/feedback/${id}/seen`, { method: "POST" });
  assert.deepEqual(await read("li", "/api/v1/feedback/summary"), { open: 0, replies: 1 });
  await send("li", `/api/v1/feedback/${id}/seen`, { method: "POST" });
  assert.deepEqual(await read("li", "/api/v1/feedback/summary"), { open: 0, replies: 0 });
});

test("拒绝不合规的反馈：空内容、非本工具格式的附件、超过两个附件、使用反馈带附件", async () => {
  const { submit } = await setup();
  assert.equal((await submit("li", { ...resultFields, content: "  " })).status, 400);
  assert.equal((await submit("li", resultFields, [new File(["x"], "合同.pdf")])).status, 400);
  assert.equal((await submit("li", resultFields, [1, 2, 3].map(i => new File(["x"], `f${i}.txt`)))).status, 413);
  assert.equal((await submit("li", { kind: "usage", content: "建议" }, [new File(["x"], "a.txt")])).status, 400);
  assert.equal((await submit("li", { ...resultFields, mode: "other" })).status, 400);
  assert.equal((await submit("li", { ...resultFields, context: "[1]" })).status, 400);
});

test("写操作要求同源和 CSRF 令牌，未登录返回 401", async () => {
  const { send } = await setup();
  assert.equal((await send("nobody", "/api/v1/feedback")).status, 401);
  const post = headers => send("li", "/api/v1/feedback", { method: "POST", body: "x", headers });
  assert.equal((await post({ "x-csrf-token": "wrong" })).status, 403);
  assert.equal((await post({ origin: "https://evil.example" })).status, 403);
});

test("PostgreSQL 反馈表：附件加密保存，可解密下载，处理流程与角标一致", { skip: !process.env.OPERATIONS_TEST_DATABASE_URL }, async () => {
  const url = process.env.OPERATIONS_TEST_DATABASE_URL;
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("Test database required");
  const repository = new PgFeedbackRepository({ connectionString: url, masterKey: Buffer.alloc(32, 9) });
  await repository.initialize(await readFile(new URL("../server/feedback-schema.sql", import.meta.url), "utf8"));
  await repository.pool.query("DELETE FROM feedback");
  try {
    const { submit, send, read } = await setup(repository);
    const { id } = await (await submit("li", resultFields, [new File(["客户-K7M4-01"], "脱敏文件_K7M4.xlsx")])).json();
    const stored = (await repository.pool.query("SELECT ciphertext FROM feedback_attachments WHERE feedback_id = $1", [id])).rows[0];
    assert.ok(!stored.ciphertext.toString("utf8").includes("客户-K7M4-01"));
    assert.equal(await (await send("zhang", `/api/v1/feedback/${id}/attachments/0`)).text(), "客户-K7M4-01");
    assert.deepEqual(await read("zhang", "/api/v1/feedback/summary"), { open: 1, replies: 0 });
    await send("zhang", `/api/v1/feedback/${id}/resolve`, { method: "POST", body: JSON.stringify({ reply: "已修复" }), headers: { "content-type": "application/json" } });
    assert.deepEqual(await read("li", "/api/v1/feedback/summary"), { open: 0, replies: 1 });
    assert.equal((await read("zhang", "/api/v1/feedback?status=resolved")).items[0].reply, "已修复");
    await send("li", `/api/v1/feedback/${id}/seen`, { method: "POST" });
    assert.deepEqual(await read("li", "/api/v1/feedback/summary"), { open: 0, replies: 0 });
  } finally { await repository.pool.query("DELETE FROM feedback"); await repository.close(); }
});
