import { SHORT_MARKER_ALPHABET, parseEntityToken } from "../src/tokenFormat.js";

const MARKER = new RegExp(`^[${SHORT_MARKER_ALPHABET}]{4}$`);
const TASK_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

async function requestJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 2 * 1024 * 1024) throw Object.assign(new Error("请求超过 2 MB"), { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Object.assign(new Error("请求超过 2 MB"), { status: 413 });
  return JSON.parse(text);
}

function validTokens(vault) {
  const tokens = Object.keys(vault.mapping);
  if (vault.tokenFormat === "short") return TASK_UUID.test(vault.taskId) && MARKER.test(vault.marker) && tokens.every((token) => parseEntityToken(token)?.marker === vault.marker);
  return /^[A-F0-9]{8}$/.test(vault.taskId) && tokens.every((token) => parseEntityToken(token)?.taskId === vault.taskId);
}

function validVault(vault) {
  return vault
    && typeof vault.taskName === "string" && vault.taskName.length <= 200
    && typeof vault.sourceFormat === "string" && vault.sourceFormat.length <= 12
    && vault.mapping && typeof vault.mapping === "object"
    && Object.keys(vault.mapping).length > 0
    && validTokens(vault)
    && (!vault.occurrenceBaseline || Object.entries(vault.occurrenceBaseline).every(([token, count]) => vault.mapping[token] && Number.isInteger(count) && count >= 0));
}

export function createVaultHandler({ repository, auth }) {
  return async function handle(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/healthz") return json({ status: "ok" });
      if (url.pathname === "/auth/wecom/start") return auth.start(request);
      if (url.pathname === "/auth/wecom/callback") return auth.callback(request);
      if (!url.pathname.startsWith("/api/")) return null;

      const session = auth.authenticate(request);
      if (!session) return json({ code: "AUTH_REQUIRED", message: "请从企业微信工作台重新进入应用。" }, 401);
      if (url.pathname === "/api/v1/session" && request.method === "GET") {
        return json({ userId: session.userId, userName: session.userName, isAdmin: session.isAdmin === true, csrf: session.csrf });
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.get("x-csrf-token") !== session.csrf) {
        return json({ code: "CSRF_FAILED", message: "页面会话已失效，请刷新后重试。" }, 403);
      }
      if (url.pathname === "/api/v1/vault-tasks" && request.method === "GET") return json({ tasks: await repository.list(session.userId) });
      if (url.pathname === "/api/v1/vault-tasks" && request.method === "POST") {
        const vault = await requestJson(request);
        if (!validVault(vault)) return json({ code: "INVALID_VAULT", message: "任务映射格式不正确。" }, 400);
        if (vault.tokenFormat === "short" && await repository.markerOwner(session.userId, vault.marker) !== vault.taskId) return json({ code: "MARKER_NOT_RESERVED", message: "任务编号未占用，请重新生成。" }, 409);
        await repository.create(session.userId, vault);
        return json({ taskId: vault.taskId }, 201);
      }
      if (url.pathname === "/api/v1/vault-markers" && request.method === "POST") {
        const { marker, taskId } = await requestJson(request);
        if (!MARKER.test(marker) || !TASK_UUID.test(taskId)) return json({ code: "INVALID_MARKER", message: "任务编号格式不正确。" }, 400);
        return await repository.reserveMarker(session.userId, marker, taskId) ? json({ marker }, 201) : json({ code: "MARKER_TAKEN", message: "任务编号已被占用。" }, 409);
      }
      const markerMatch = url.pathname.match(/^\/api\/v1\/vault-markers\/([^/]+)$/);
      if (markerMatch && request.method === "GET") {
        const taskId = MARKER.test(markerMatch[1]) ? await repository.markerOwner(session.userId, markerMatch[1]) : null;
        return taskId ? json({ taskId }) : json({ code: "VAULT_NOT_FOUND", message: "找不到这个任务编号。" }, 404);
      }
      const match = url.pathname.match(/^\/api\/v1\/vault-tasks\/([A-F0-9]{8}|[a-f0-9-]{36})(?:\/mapping)?$/);
      if (match && request.method === "GET" && url.pathname.endsWith("/mapping")) {
        const vault = await repository.load(session.userId, match[1]);
        return vault ? json(vault) : json({ code: "VAULT_NOT_FOUND", message: "任务不存在或已被删除。" }, 404);
      }
      if (match && request.method === "DELETE" && !url.pathname.endsWith("/mapping")) {
        return (await repository.delete(session.userId, match[1])) ? new Response(null, { status: 204 }) : json({ code: "VAULT_NOT_FOUND", message: "任务不存在或已被删除。" }, 404);
      }
      return json({ code: "NOT_FOUND", message: "接口不存在。" }, 404);
    } catch (error) {
      if (error?.code === "23505") return json({ code: "TASK_EXISTS", message: "任务编号已存在，请重新生成。" }, 409);
      if (error instanceof SyntaxError) return json({ code: "INVALID_JSON", message: "请求内容不是有效 JSON。" }, 400);
      return json({ code: "VAULT_SERVICE_FAILED", message: error.message || "企业 Vault 暂时不可用。" }, error.status || 500);
    }
  };
}
