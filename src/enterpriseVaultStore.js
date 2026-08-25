const API = "/api/v1";
let sessionPromise;

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: "same-origin", ...options });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || "企业 Vault 暂时不可用。"), { code: data.code || "VAULT_SERVICE_FAILED" });
  return data;
}

async function session() {
  sessionPromise ??= request("/session").catch((error) => { sessionPromise = null; throw error; });
  return sessionPromise;
}

export async function saveEnterpriseVault(vault) {
  const { csrfToken } = await session();
  return request("/vault-tasks", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(vault) });
}

export async function loadEnterpriseVault(taskId) {
  await session();
  try { return await request(`/vault-tasks/${taskId}/mapping`); }
  catch (error) { if (error.code === "VAULT_NOT_FOUND") return null; throw error; }
}

export async function listEnterpriseVaultSummaries() {
  await session();
  return (await request("/vault-tasks")).tasks;
}

export async function deleteEnterpriseVault(taskId) {
  const { csrfToken } = await session();
  await request(`/vault-tasks/${taskId}`, { method: "DELETE", headers: { "x-csrf-token": csrfToken } });
}
