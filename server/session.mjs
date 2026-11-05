import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function signedValue(payload, secret) {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

function verifySignedValue(value, secret) {
  const [encoded, signature] = String(value ?? "").split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded, secret);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

// Names are shown in the page and stored; drop control characters and cap the length.
function cleanName(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) : "";
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.get("cookie") ?? "").split(";").map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function cookie(name, value, { maxAge, secure }) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function createWeComAuth(config) {
  let tokenCache = null;

  async function accessToken() {
    if (tokenCache?.expiresAt > Date.now() + 60_000) return tokenCache.value;
    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    url.searchParams.set("corpid", config.corpId);
    url.searchParams.set("corpsecret", config.corpSecret);
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok || result.errcode) throw new Error(`企业微信令牌获取失败：${result.errmsg ?? response.status}`);
    tokenCache = { value: result.access_token, expiresAt: Date.now() + Number(result.expires_in ?? 7200) * 1000 };
    return tokenCache.value;
  }

  async function call(path, params) {
    const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`);
    url.searchParams.set("access_token", await accessToken());
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || result.errcode) throw new Error(`企业微信接口失败：${path} ${result.errcode ?? response.status}`);
    return result;
  }

  // The display name comes from the member directory; any failure falls back to the userId so sign-in still works.
  async function memberName(userId) {
    try {
      const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/user/get");
      url.searchParams.set("access_token", await accessToken());
      url.searchParams.set("userid", userId);
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const result = await response.json();
      const name = cleanName(result.name);
      return response.ok && !result.errcode && name ? name : userId;
    } catch {
      return userId;
    }
  }

  return {
    async start(request) {
      const state = randomBytes(18).toString("base64url");
      const redirect = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
      redirect.searchParams.set("appid", config.corpId);
      redirect.searchParams.set("redirect_uri", `${config.publicOrigin}/auth/wecom/callback`);
      redirect.searchParams.set("response_type", "code");
      redirect.searchParams.set("scope", "snsapi_base");
      redirect.searchParams.set("agentid", config.agentId);
      redirect.searchParams.set("state", state);
      const headers = new Headers({ location: `${redirect.toString()}#wechat_redirect` });
      headers.append("set-cookie", cookie("wecom_state", signedValue({ state, exp: Date.now() + 10 * 60_000 }, config.sessionSecret), { maxAge: 600, secure: config.cookieSecure }));
      return new Response(null, { status: 302, headers });
    },

    async callback(request) {
      const url = new URL(request.url);
      const stateRecord = verifySignedValue(cookies(request).wecom_state, config.sessionSecret);
      if (!stateRecord || stateRecord.state !== url.searchParams.get("state")) return new Response("企业微信登录状态无效", { status: 400 });
      const code = url.searchParams.get("code");
      if (!code) return new Response("缺少企业微信授权码", { status: 400 });
      const infoUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo");
      infoUrl.searchParams.set("access_token", await accessToken());
      infoUrl.searchParams.set("code", code);
      const response = await fetch(infoUrl);
      const result = await response.json();
      if (!response.ok || result.errcode || !result.userid) return new Response("无法确认企业微信用户", { status: 401 });
      const payload = { userId: result.userid, userName: await memberName(result.userid), csrf: randomBytes(18).toString("base64url"), exp: Date.now() + 8 * 60 * 60_000 };
      const headers = new Headers({ location: "/" });
      headers.append("set-cookie", cookie("vault_session", signedValue(payload, config.sessionSecret), { maxAge: 8 * 60 * 60, secure: config.cookieSecure }));
      headers.append("set-cookie", cookie("wecom_state", "", { maxAge: 0, secure: config.cookieSecure }));
      return new Response(null, { status: 302, headers });
    },

    authenticate(request) {
      const session = verifySignedValue(cookies(request).vault_session, config.sessionSecret);
      return session && { ...session, userName: session.userName || session.userId };
    },

    // Every department and member inside the app's visible range; set the range to the whole company to see everyone.
    async directory() {
      const departments = (await call("department/list", {})).department.map(d => ({ id: d.id, name: cleanName(d.name) || String(d.id), parentId: d.parentid || null, order: d.order ?? 0 }));
      const members = new Map();
      for (let i = 0; i < departments.length; i += 5) {
        const lists = await Promise.all(departments.slice(i, i + 5).map(d => call("user/simplelist", { department_id: d.id })));
        for (const user of lists.flatMap(list => list.userlist ?? [])) {
          const known = members.get(user.userid);
          members.set(user.userid, { userId: user.userid, name: cleanName(user.name) || user.userid, departmentIds: [...new Set([...(known?.departmentIds ?? []), ...(user.department ?? [])])] });
        }
      }
      return { departments, members: [...members.values()] };
    },
  };
}
