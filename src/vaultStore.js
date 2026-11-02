import { recordOperation } from "./operationLog.js";
import { AuthRequiredError, clearSession, getSession } from "./session.js";

const API = "/api/v1";

export class VaultStoreError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "VaultStoreError";
    this.code = code;
  }
}

function notifyVaultChange() {
  globalThis.window?.dispatchEvent(new Event("vault-changed"));
}

// Every failure becomes a VaultStoreError; callers never see raw network errors.
async function request(path, { method = "GET", body, allow = [] } = {}) {
  let response;
  try {
    const session = await getSession();
    response = await fetch(`${API}${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(method === "GET" ? {} : { "x-csrf-token": session.csrf }) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) throw new VaultStoreError("AUTH_REQUIRED", error.message, error);
    throw new VaultStoreError("VAULT_SERVICE_UNAVAILABLE", "暂时无法连接公司服务器，请检查网络后重试。", error);
  }
  if (response.status === 401) {
    clearSession();
    throw new VaultStoreError("AUTH_REQUIRED", "登录已过期，请重新进入应用。");
  }
  if (allow.includes(response.status)) return { status: response.status, data: null };
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new VaultStoreError(data?.code || "VAULT_SERVICE_FAILED", data?.message || "公司服务器暂时不可用，请稍后重试。");
  return { status: response.status, data };
}

export async function saveVault(vault) {
  try {
    await request("/vault-tasks", { method: "POST", body: vault });
    notifyVaultChange();
    await recordOperation("save_mapping", "success", vault);
  } catch (error) {
    await recordOperation("save_mapping", "failed");
    if (error.code === "TASK_EXISTS") throw new VaultStoreError("VAULT_TASK_EXISTS", "任务编号已存在，原还原记录未改动。请重新生成脱敏文件。", error);
    throw error;
  }
}

export async function loadVault(taskId) {
  const { status, data } = await request(`/vault-tasks/${encodeURIComponent(taskId)}/mapping`, { allow: [404] });
  return status === 404 ? null : data;
}

export async function deleteVault(taskId) {
  try {
    await request(`/vault-tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
    notifyVaultChange();
    await recordOperation("delete_mapping", "success", { taskId });
  } catch (error) {
    await recordOperation("delete_mapping", "failed", { taskId });
    throw error;
  }
}

export async function listVaultSummaries() {
  return (await request("/vault-tasks")).data.tasks;
}

export async function getMarkerOwner(marker) {
  const { status, data } = await request(`/vault-markers/${encodeURIComponent(marker)}`, { allow: [404] });
  return status === 404 ? null : data.taskId;
}

export async function reserveTaskMarker(marker, taskId) {
  const { status } = await request("/vault-markers", { method: "POST", body: { marker, taskId }, allow: [409] });
  return status !== 409;
}
