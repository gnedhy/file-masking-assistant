import { randomId } from "./randomId.js";
import { SHORT_MARKER_ALPHABET } from "./tokenFormat.js";
import { VaultStoreError, getMarkerOwner, loadVault, reserveTaskMarker } from "./vaultStore.js";

const fail = (code, message) => { throw new VaultStoreError(code, message); };

// Every new task uses short tokens; the server keeps marker → task so restore needs no extra file.
export async function createProtectionIdentity(_options = {}, sourceText = "") {
  const taskId = randomId();
  for (let attempt = 0; attempt < 256; attempt += 1) {
    // Rejection sampling keeps the 32-character alphabet unbiased.
    let marker = "";
    while (marker.length < 4) {
      const byte = crypto.getRandomValues(new Uint8Array(1))[0];
      if (byte < 256 - (256 % SHORT_MARKER_ALPHABET.length)) marker += SHORT_MARKER_ALPHABET[byte % SHORT_MARKER_ALPHABET.length];
    }
    if (!await reserveTaskMarker(marker, taskId)) continue;
    // Reserve even rejected source collisions; abandoned markers are never reused.
    if (String(sourceText).includes(`-${marker}-`)) continue;
    return { taskId, tokenFormat: "short", marker };
  }
  fail("MARKER_ALLOCATION_FAILED", "无法分配新的任务编号，未生成文件。请稍后重试。");
}

export function protectionTokenIdentity(identity) { return identity.tokenFormat === "short" ? identity : identity.taskId; }
export function protectionResult(identity) {
  return identity.tokenFormat === "short" ? { tokenFormat: "short", marker: identity.marker } : {};
}
export function taskEvidence(vault) { return { tokenFormat: vault.tokenFormat, marker: vault.marker, createdAt: vault.createdAt }; }

export async function resolveRestoreVault(inspection, _context, expectedTaskId) {
  if (inspection.taskIds.length !== 1) fail("MIXED_TASKS", "文件中没有唯一任务，或混用了新旧代号。已停止还原。");
  const reference = inspection.taskIds[0];
  let vault;
  if (reference.startsWith("short:")) {
    const marker = reference.slice("short:".length);
    const taskId = await getMarkerOwner(marker);
    vault = taskId ? await loadVault(taskId) : null;
    if (vault && (vault.tokenFormat !== "short" || vault.marker !== marker)) fail("VAULT_NOT_FOUND", "任务编号与还原记录不一致，已停止还原。");
  } else { vault = await loadVault(reference); }
  if (!vault) fail("VAULT_NOT_FOUND", "找不到该任务的还原记录，无法还原。");
  if (expectedTaskId && vault.taskId !== expectedTaskId) fail("TASK_CHANGED", "文件与刚才检查通过的任务不一致。");
  return vault;
}
