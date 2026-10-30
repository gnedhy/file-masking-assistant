import { deleteEnterpriseVault, listEnterpriseVaultSummaries, loadEnterpriseVault, saveEnterpriseVault } from "./enterpriseVaultStore.js";
import { recordOperation } from "./operationLog.js";

const DB_NAME = "file-masking-assistant-v2-vault";
const DB_VERSION = 2;
const KEY_ID = "device-aes-key";
let keyCreationPromise = null;
export const ENTERPRISE_VAULT_ENABLED = import.meta.env?.VITE_VAULT_MODE === "enterprise";

function notifyVaultChange() {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(DB_NAME);
    channel.postMessage("changed");
    channel.close();
  } catch { /* Focus refresh remains available without cross-tab notifications. */ }
}

export class VaultStoreError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "VaultStoreError";
    this.code = code;
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = event => reject(transaction.error || event.target?.error);
    transaction.onabort = () => reject(transaction.error || new Error("本机存储事务已中止"));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
    let blocked = false;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new VaultStoreError("VAULT_STORAGE_FAILED", "当前浏览器无法打开本机映射存储。", error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings");
      if (!database.objectStoreNames.contains("vaults")) database.createObjectStore("vaults", { keyPath: "taskId" });
      if (!database.objectStoreNames.contains("markers")) database.createObjectStore("markers", { keyPath: "marker" });
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new VaultStoreError("VAULT_UPGRADE_BLOCKED", "其他页面仍占用旧版映射库，请关闭旧版页面后重试。不会删除已有任务。")); };
  });
}

async function getOrCreateKey(database) {
  const readTransaction = database.transaction("settings", "readonly");
  const existing = await requestResult(readTransaction.objectStore("settings").get(KEY_ID));
  await transactionDone(readTransaction);
  if (existing) return existing;

  if (!keyCreationPromise) {
    keyCreationPromise = (async () => {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const writeTransaction = database.transaction("settings", "readwrite");
      const addRequest = writeTransaction.objectStore("settings").add(key, KEY_ID);
      const inserted = await new Promise((resolve, reject) => {
        addRequest.onsuccess = () => resolve(true);
        addRequest.onerror = (event) => {
          if (addRequest.error?.name !== "ConstraintError") { reject(addRequest.error); return; }
          event.preventDefault();
          event.stopPropagation();
          resolve(false);
        };
      });
      await transactionDone(writeTransaction);
      if (inserted) return key;
      const winner = await getExistingKey(database);
      if (!winner) throw new VaultStoreError("VAULT_KEY_MISSING", "无法取得本机映射密钥。");
      return winner;
    })().finally(() => { keyCreationPromise = null; });
  }
  return keyCreationPromise;
}

async function getExistingKey(database) {
  const transaction = database.transaction("settings", "readonly");
  const key = await requestResult(transaction.objectStore("settings").get(KEY_ID));
  await transactionDone(transaction);
  return key;
}

export async function saveVault(vault) {
  if (ENTERPRISE_VAULT_ENABLED && vault.tokenFormat === "short") throw new VaultStoreError("SHORT_LOCAL_ONLY", "简短替身仅用于本机试验。");
  if (ENTERPRISE_VAULT_ENABLED) return saveEnterpriseVault(vault);
  let database;
  try {
    database = await openDatabase();
    const key = await getOrCreateKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(vault));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const transaction = database.transaction("vaults", "readwrite");
    transaction.objectStore("vaults").add({
      taskId: vault.taskId,
      taskName: vault.taskName,
      createdAt: vault.createdAt,
      uniqueValues: Object.keys(vault.mapping).length,
      tokenFormat: vault.tokenFormat,
      marker: vault.marker,
      iv,
      ciphertext,
    });
    await transactionDone(transaction);
    notifyVaultChange();
    await recordOperation("save_mapping", "success", vault);
  } catch (error) {
    await recordOperation("save_mapping", "failed");
    if (error instanceof VaultStoreError) throw error;
    if (error?.name === "ConstraintError") throw new VaultStoreError("VAULT_TASK_EXISTS", "任务编号已存在，原映射未改动。请重新生成脱敏文件。", error);
    const message = error?.name === "QuotaExceededError"
      ? "本机存储空间不足，无法保存还原映射。"
      : "无法保存本机还原映射。";
    throw new VaultStoreError(error?.name === "QuotaExceededError" ? "VAULT_QUOTA_EXCEEDED" : "VAULT_SAVE_FAILED", message, error);
  } finally {
    database?.close();
  }
}

export async function loadVault(taskId) {
  if (ENTERPRISE_VAULT_ENABLED) return loadEnterpriseVault(taskId);
  let database;
  try {
    database = await openDatabase();
    const transaction = database.transaction("vaults", "readonly");
    const record = await requestResult(transaction.objectStore("vaults").get(taskId));
    await transactionDone(transaction);
    if (!record) return null;
    const key = await getExistingKey(database);
    if (!key) throw new VaultStoreError("VAULT_KEY_MISSING", "本机映射仍在，但解密密钥已经丢失。映射无法恢复。");
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, key, record.ciphertext);
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (error) {
      throw new VaultStoreError("VAULT_DECRYPT_FAILED", "本机映射已损坏或无法使用当前密钥解密。", error);
    }
  } finally {
    database?.close();
  }
}

export async function deleteVault(taskId) {
  if (ENTERPRISE_VAULT_ENABLED) return deleteEnterpriseVault(taskId);
  let database;
  try {
    database = await openDatabase();
    const transaction = database.transaction("vaults", "readwrite");
    transaction.objectStore("vaults").delete(taskId);
    await transactionDone(transaction);
    notifyVaultChange();
    await recordOperation("delete_mapping", "success", { taskId });
  } catch (error) {
    await recordOperation("delete_mapping", "failed", { taskId });
    if (error instanceof VaultStoreError) throw error;
    throw new VaultStoreError("VAULT_DELETE_FAILED", "无法删除本机映射。", error);
  } finally {
    database?.close();
  }
}

export async function listVaultSummaries() {
  if (ENTERPRISE_VAULT_ENABLED) return listEnterpriseVaultSummaries();
  let database;
  try {
    database = await openDatabase();
    const transaction = database.transaction("vaults", "readonly");
    const records = await new Promise((resolve, reject) => {
      const summaries = [];
      const request = transaction.objectStore("vaults").openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(summaries); return; }
        const { taskId, taskName, createdAt, uniqueValues, tokenFormat, marker } = cursor.value;
        summaries.push({ taskId, taskName, createdAt, uniqueValues, tokenFormat, marker });
        cursor.continue();
      };
    });
    await transactionDone(transaction);
    return records.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  } catch (error) {
    if (error instanceof VaultStoreError) throw error;
    throw new VaultStoreError("VAULT_READ_FAILED", "无法读取本机任务记录。", error);
  } finally {
    database?.close();
  }
}

export async function reserveTaskMarker(marker, taskId) {
  if (ENTERPRISE_VAULT_ENABLED) throw new VaultStoreError("SHORT_LOCAL_ONLY", "简短替身仅用于本机试验。");
  const database = await openDatabase();
  try {
    const transaction = database.transaction("markers", "readwrite");
    const done = transactionDone(transaction);
    const request = transaction.objectStore("markers").add({ marker, taskId });
    let inserted = true;
    request.onerror = (event) => {
      if (request.error?.name === "ConstraintError") {
        event.preventDefault();
        event.stopPropagation();
        inserted = false;
      }
    };
    await done;
    return inserted;
  } catch (error) {
    throw new VaultStoreError(error?.name === "QuotaExceededError" ? "VAULT_QUOTA_EXCEEDED" : "VAULT_SAVE_FAILED", "无法占用本机任务标记，未生成文件。", error);
  } finally { database.close(); }
}
