import { SHORT_MARKER_ALPHABET } from "./tokenFormat.js";
import { ENTERPRISE_VAULT_ENABLED, VaultStoreError, loadVault, reserveTaskMarker } from "./vaultStore.js";

const fail = (code, message) => { throw new VaultStoreError(code, message); };
const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(value => value.toString(16).padStart(2, "0")).join("");

export function validateCredential(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "marker,taskId,verification,version"
    || value.version !== 1
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.taskId)
    || !new RegExp(`^[${SHORT_MARKER_ALPHABET}]{4}$`).test(value.marker)
    || !/^[a-f0-9]{32}$/.test(value.verification)) fail("INVALID_CREDENTIAL", "还原凭据格式不正确或版本不支持，请选择本应用下载的原始凭据。");
  return value;
}

export async function readTaskCredential(file) {
  if (!file || file.size > 16 * 1024) fail("INVALID_CREDENTIAL", "还原凭据不能超过 16 KiB。");
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); }
  catch { fail("INVALID_CREDENTIAL", "无法读取还原凭据，请选择原始 JSON 文件。"); }
  return validateCredential(value);
}

export function credentialDownload(credential) {
  validateCredential(credential);
  return { buffer: new TextEncoder().encode(JSON.stringify(credential, null, 2)), outputName: `还原凭据_${credential.marker}.json`, mimeType: "application/json" };
}

export async function createProtectionIdentity(options = {}, sourceText = "") {
  if (options.tokenFormat !== "short") return { taskId: hex(4).toUpperCase() };
  if (ENTERPRISE_VAULT_ENABLED) fail("SHORT_LOCAL_ONLY", "企业模式尚未支持简短替身，请使用现有代号。");
  const taskId = crypto.randomUUID();
  for (let attempt = 0; attempt < 256; attempt += 1) {
    // Rejection sampling avoids bias with the 31-character alphabet.
    let marker = "";
    while (marker.length < 4) {
      const byte = crypto.getRandomValues(new Uint8Array(1))[0];
      if (byte < 248) marker += SHORT_MARKER_ALPHABET[byte % SHORT_MARKER_ALPHABET.length];
    }
    if (!await reserveTaskMarker(marker, taskId)) continue;
    // Reserve even rejected source collisions; abandoned markers are never reused.
    if (String(sourceText).includes(`-${marker}-`)) continue;
    const credential = { version: 1, taskId, marker, verification: hex(16) };
    return { taskId, tokenFormat: "short", marker, credential };
  }
  fail("MARKER_ALLOCATION_FAILED", "无法分配未使用的四位标记，未生成文件。请稍后重试。");
}

export function protectionTokenIdentity(identity) { return identity.tokenFormat === "short" ? identity : identity.taskId; }
export function protectionResult(identity, mapping) {
  return identity.tokenFormat === "short" ? { tokenFormat: "short", marker: identity.marker, credential: credentialDownload(identity.credential), aliases: Object.keys(mapping) } : {};
}
export function taskEvidence(vault) { return { tokenFormat: vault.tokenFormat, marker: vault.marker, createdAt: vault.createdAt }; }

export async function resolveRestoreVault(inspection, context, expectedTaskId) {
  if (inspection.taskIds.length !== 1) fail("MIXED_TASKS", "文件中没有唯一任务，或混用了新旧代号。已停止还原。");
  const reference = inspection.taskIds[0];
  let vault;
  if (reference.startsWith("short:")) {
    if (ENTERPRISE_VAULT_ENABLED) fail("SHORT_LOCAL_ONLY", "企业模式尚未支持简短替身。");
    if (!context?.credential) fail("CREDENTIAL_REQUIRED", "请先导入与简短替身配套的还原凭据，再核对来源任务。");
    const credential = validateCredential(context.credential);
    if (reference !== `short:${credential.marker}`) fail("CREDENTIAL_MISMATCH", "文件的四位标记与凭据不一致，请检查是否选错文件。");
    vault = await loadVault(credential.taskId);
    if (!vault) fail("VAULT_NOT_FOUND", "凭据对应的本机映射不存在。凭据不是映射备份，无法单独还原。");
    if (vault.tokenFormat !== "short" || vault.marker !== credential.marker || vault.credential?.verification !== credential.verification || vault.taskId !== credential.taskId) fail("CREDENTIAL_MISMATCH", "凭据未通过本机任务核验，已停止还原。");
    if (expectedTaskId && context.pairingConfirmed !== true) fail("PAIRING_REQUIRED", "请确认返回文件与所显示的本机任务配套。");
  } else { vault = await loadVault(reference); }
  if (!vault) fail("VAULT_NOT_FOUND", "本机找不到该任务的映射，无法还原。");
  if (expectedTaskId && vault.taskId !== expectedTaskId) fail("TASK_CHANGED", "文件与刚才检查通过的任务不一致。");
  return vault;
}

export async function downloadCredentialForTask(taskId) {
  const vault = await loadVault(taskId);
  if (!vault || vault.tokenFormat !== "short") fail("VAULT_NOT_FOUND", "本机没有此任务的简短替身凭据。");
  return credentialDownload(vault.credential);
}
