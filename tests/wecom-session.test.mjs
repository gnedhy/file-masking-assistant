import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { nodeHeaders } from "../server/security-headers.mjs";
import { createWeComAuth } from "../server/session.mjs";

const config = { corpId: "corp", agentId: "1000002", corpSecret: "secret", sessionSecret: "session-secret", publicOrigin: "https://mask.example.com", cookieSecure: true };

// Stub the three WeCom endpoints; `member` is what user/get answers (or throws).
function stubWeCom(member) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    calls.push(pathname);
    if (pathname.endsWith("/gettoken")) return Response.json({ errcode: 0, access_token: "token", expires_in: 7200 });
    if (pathname.endsWith("/auth/getuserinfo")) return Response.json({ errcode: 0, userid: "zhangsan" });
    if (pathname.endsWith("/user/get")) {
      assert.equal(searchParams.get("userid"), "zhangsan");
      if (member instanceof Error) throw member;
      return Response.json(member);
    }
    throw new Error(`unexpected ${url}`);
  };
  return calls;
}

async function signIn(member) {
  const original = globalThis.fetch;
  const calls = stubWeCom(member);
  try {
    const auth = createWeComAuth(config);
    const started = await auth.start(new Request(`${config.publicOrigin}/auth/wecom/start`));
    const state = new URL(started.headers.get("location").replace("#wechat_redirect", "")).searchParams.get("state");
    const stateCookie = started.headers.get("set-cookie").split(";")[0];
    const callback = await auth.callback(new Request(`${config.publicOrigin}/auth/wecom/callback?code=c&state=${state}`, { headers: { cookie: stateCookie } }));
    assert.equal(callback.status, 302);
    const sessionCookie = callback.headers.getSetCookie().find((value) => value.startsWith("vault_session=")).split(";")[0];
    return { session: auth.authenticate(new Request(config.publicOrigin, { headers: { cookie: sessionCookie } })), calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("工作台静默登录后带上企业微信通讯录里的姓名", async () => {
  const { session, calls } = await signIn({ errcode: 0, userid: "zhangsan", name: " 张三\u0007 " });
  assert.equal(session.userId, "zhangsan");
  assert.equal(session.userName, "张三");
  assert.deepEqual(calls, ["/cgi-bin/gettoken", "/cgi-bin/auth/getuserinfo", "/cgi-bin/user/get"]);
});

test("读不到姓名时退回 userId，登录不受影响", async () => {
  for (const member of [{ errcode: 60011, errmsg: "no privilege to access/modify contact/party/agent" }, { errcode: 0, name: "" }, new Error("network down")]) {
    const { session } = await signIn(member);
    assert.equal(session.userId, "zhangsan");
    assert.equal(session.userName, "zhangsan");
  }
});

test("同步通讯录：读取可见范围内的全部部门和成员，跨部门的人只出现一次", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith("/gettoken")) return Response.json({ errcode: 0, access_token: "token", expires_in: 7200 });
    if (pathname.endsWith("/department/list")) return Response.json({ errcode: 0, department: [{ id: 1, name: "公司", parentid: 0, order: 9 }, { id: 2, name: "销售部", parentid: 1, order: 1 }] });
    if (pathname.endsWith("/user/simplelist")) return Response.json({ errcode: 0, userlist: searchParams.get("department_id") === "1"
      ? [{ userid: "zhangsan", name: "张三", department: [1, 2] }]
      : [{ userid: "zhangsan", name: "张三", department: [1, 2] }, { userid: "lisi", name: "", department: [2] }] });
    throw new Error(`unexpected ${url}`);
  };
  try {
    const directory = await createWeComAuth(config).directory();
    assert.deepEqual(directory.departments, [{ id: 1, name: "公司", parentId: null, order: 9 }, { id: 2, name: "销售部", parentId: 1, order: 1 }]);
    assert.deepEqual(directory.members, [{ userId: "zhangsan", name: "张三", departmentIds: [1, 2] }, { userId: "lisi", name: "lisi", departmentIds: [2] }]);
  } finally {
    globalThis.fetch = original;
  }
});

test("企业微信接口报错时同步失败，不返回半份通讯录", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => new URL(url).pathname.endsWith("/gettoken")
    ? Response.json({ errcode: 0, access_token: "token", expires_in: 7200 })
    : Response.json({ errcode: 60020, errmsg: "not allow to access from your ip" });
  try {
    await assert.rejects(() => createWeComAuth(config).directory(), /60020/);
  } finally {
    globalThis.fetch = original;
  }
});

// Regression: the server once flattened response headers, so only the last Set-Cookie (clearing
// wecom_state) reached the browser and the sign-in cookie was lost, looping back to WeCom forever.
test("登录回调经过 HTTP 服务后，浏览器同时收到登录 Cookie 和清除 state 的 Cookie", async () => {
  const original = globalThis.fetch;
  stubWeCom({ errcode: 0, name: "张三" });
  const auth = createWeComAuth(config);
  const started = await auth.start(new Request(`${config.publicOrigin}/auth/wecom/start`));
  const state = new URL(started.headers.get("location").replace("#wechat_redirect", "")).searchParams.get("state");
  const stateCookie = started.headers.get("set-cookie").split(";")[0];
  const callback = await auth.callback(new Request(`${config.publicOrigin}/auth/wecom/callback?code=c&state=${state}`, { headers: { cookie: stateCookie } }));
  globalThis.fetch = original;
  const server = createServer((req, res) => { res.writeHead(callback.status, nodeHeaders(callback.headers, { "X-Test": "1" })); res.end(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { redirect: "manual" });
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    const session = cookies.find(value => value.startsWith("vault_session=")).split(";")[0];
    assert.ok(cookies.some(value => value.startsWith("wecom_state=;")));
    assert.equal(response.headers.get("x-test"), "1");
    assert.equal(auth.authenticate(new Request(config.publicOrigin, { headers: { cookie: session } })).userId, "zhangsan");
  } finally {
    server.close();
  }
});
