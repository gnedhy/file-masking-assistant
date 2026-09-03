import { parseEntityToken } from "../src/tokenFormat.js";

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

function validVault(vault) {
  return vault && /^[A-F0-9]{8}$/.test(vault.taskId)
    && typeof vault.taskName === "string" && vault.taskName.length <= 200
    && typeof vault.sourceFormat === "string" && vault.sourceFormat.length <= 12
    && vault.mapping && typeof vault.mapping === "object"
    && Object.keys(vault.mapping).length > 0
    && Object.keys(vault.mapping).every((token) => parseEntityToken(token)?.taskId === vault.taskId)
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
        return json({ userId: session.userId, csrfToken: session.csrf, vaultMode: "enterprise" });
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.get("x-csrf-token") !== session.csrf) {
        return json({ code: "CSRF_FAILED", message: "页面会话已失效，请刷新后重试。" }, 403);
      }
      if (url.pathname === "/api/v1/vault-tasks" && request.method === "GET") return json({ tasks: await repository.list(session.userId) });
      if (url.pathname === "/api/v1/vault-tasks" && request.method === "POST") {
        const vault = await requestJson(request);
        if (!validVault(vault)) return json({ code: "INVALID_VAULT", message: "任务映射格式不正确。" }, 400);
        const created = await repository.create(session.userId, vault);
        return json({ taskId: vault.taskId, ...created }, 201);
      }
      const match = url.pathname.match(/^\/api\/v1\/vault-tasks\/([A-F0-9]{8})(?:\/mapping)?$/);
      if (match && request.method === "GET" && url.pathname.endsWith("/mapping")) {
        const vault = await repository.load(session.userId, match[1]);
        return vault ? json(vault) : json({ code: "VAULT_NOT_FOUND", message: "任务不存在或已经到期。" }, 404);
      }
      if (match && request.method === "DELETE" && !url.pathname.endsWith("/mapping")) {
        return (await repository.delete(session.userId, match[1])) ? new Response(null, { status: 204 }) : json({ code: "VAULT_NOT_FOUND", message: "任务不存在或已经到期。" }, 404);
      }
      return json({ code: "NOT_FOUND", message: "接口不存在。" }, 404);
    } catch (error) {
      if (error?.code === "23505") return json({ code: "TASK_EXISTS", message: "任务编号已存在，请重新生成。" }, 409);
      if (error instanceof SyntaxError) return json({ code: "INVALID_JSON", message: "请求内容不是有效 JSON。" }, 400);
      return json({ code: "VAULT_SERVICE_FAILED", message: error.message || "企业 Vault 暂时不可用。" }, error.status || 500);
    }
  };
}
