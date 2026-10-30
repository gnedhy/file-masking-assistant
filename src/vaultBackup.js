import { validateCredential } from "./taskIdentity.js";
import { VaultStoreError, getMarkerOwner, listVaultSummaries, loadVault, reserveTaskMarker, saveVault } from "./vaultStore.js";

const BACKUP_FORMAT = "file-masking-assistant-backup";
const BACKUP_VERSION = 1;
const BACKUP_SIZE_LIMIT = 50 * 1024 * 1024;
const TASK_ID_PATTERN = /^(?:[A-F0-9]{8}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

const invalid = (message) => new VaultStoreError("INVALID_BACKUP", message);
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function backupTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

// The device key cannot leave the browser, so a portable backup holds decrypted records (ADR 0004).
export async function exportVaultBackup(appVersion) {
  const tasks = [];
  let failed = 0;
  for (const { taskId } of await listVaultSummaries()) {
    try {
      const vault = await loadVault(taskId);
      if (vault) tasks.push(vault); else failed += 1;
    } catch { failed += 1; }
  }
  const now = new Date();
  const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), appVersion, tasks };
  return {
    buffer: new TextEncoder().encode(JSON.stringify(backup)),
    outputName: `还原记录备份_含真实信息_${backupTimestamp(now)}.json`,
    mimeType: "application/json",
    exported: tasks.length,
    failed,
  };
}

function validateTask(task) {
  if (!isPlainObject(task) || !TASK_ID_PATTERN.test(task.taskId ?? "") || !isPlainObject(task.mapping)
    || typeof task.taskName !== "string" || typeof task.createdAt !== "string") throw invalid("备份文件中有无法识别的任务，没有导入任何内容。");
  if (task.tokenFormat !== "short") return;
  try {
    validateCredential(task.credential);
  } catch { throw invalid("备份文件中有不完整的简短代号任务，没有导入任何内容。"); }
  if (task.credential.taskId !== task.taskId || task.credential.marker !== task.marker) throw invalid("备份文件中有不完整的简短代号任务，没有导入任何内容。");
}

export async function readVaultBackup(file) {
  if (!file || file.size > BACKUP_SIZE_LIMIT) throw invalid("备份文件不能超过 50 MB。");
  let backup;
  try { backup = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); }
  catch { throw invalid("无法读取这个文件，请选择本工具导出的备份文件。"); }
  if (!isPlainObject(backup) || backup.format !== BACKUP_FORMAT) throw invalid("这不是本工具导出的备份文件。");
  if (backup.version !== BACKUP_VERSION) throw invalid("备份文件的版本不受支持。");
  if (!Array.isArray(backup.tasks)) throw invalid("备份文件内容不完整，没有导入任何内容。");
  backup.tasks.forEach(validateTask);
  return backup;
}

// Add-only, like every other task write: existing tasks stay untouched and a short marker is never shared.
export async function importVaultBackup(backup) {
  const existing = new Set((await listVaultSummaries()).map(({ taskId }) => taskId));
  const result = { imported: 0, skipped: 0, conflicts: 0, failed: 0 };
  for (const task of backup.tasks) {
    if (existing.has(task.taskId)) { result.skipped += 1; continue; }
    try {
      if (task.tokenFormat === "short" && !await reserveTaskMarker(task.marker, task.taskId) && await getMarkerOwner(task.marker) !== task.taskId) {
        result.conflicts += 1;
        continue;
      }
      await saveVault(task);
      existing.add(task.taskId);
      result.imported += 1;
    } catch (error) {
      if (error?.code === "VAULT_TASK_EXISTS") result.skipped += 1; else result.failed += 1;
    }
  }
  return result;
}
