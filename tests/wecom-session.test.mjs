import test from "node:test";
import assert from "node:assert/strict";
import { createWeComAuth } from "../server/session.mjs";

const config = { corpId: "corp", agentId: "1000002", corpSecret: "secret", sessionSecret: "session-secret", publicOrigin: "https://mask.example.com", cookieSecure: true, adminUserIds: ["zhangsan"] };

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
  assert.equal(session.isAdmin, true);
  assert.deepEqual(calls, ["/cgi-bin/gettoken", "/cgi-bin/auth/getuserinfo", "/cgi-bin/user/get"]);
});

test("读不到姓名时退回 userId，登录不受影响", async () => {
  for (const member of [{ errcode: 60011, errmsg: "no privilege to access/modify contact/party/agent" }, { errcode: 0, name: "" }, new Error("network down")]) {
    const { session } = await signIn(member);
    assert.equal(session.userId, "zhangsan");
    assert.equal(session.userName, "zhangsan");
  }
});
