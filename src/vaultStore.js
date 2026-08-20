const DB_NAME = "ai-safe-file-vault";
const DB_VERSION = 1;
const KEY_ID = "device-aes-key";
let keyCreationPromise = null;

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
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("本机存储事务已中止"));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
      writeTransaction.objectStore("settings").put(key, KEY_ID);
      await transactionDone(writeTransaction);
      return key;
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
  let database;
  try {
    database = await openDatabase();
    const key = await getOrCreateKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(vault));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const transaction = database.transaction("vaults", "readwrite");
    transaction.objectStore("vaults").put({
      taskId: vault.taskId,
      taskName: vault.taskName,
      createdAt: vault.createdAt,
      uniqueValues: Object.keys(vault.mapping).length,
      iv,
      ciphertext,
    });
    await transactionDone(transaction);
  } catch (error) {
    if (error?.code) throw error;
    const message = error?.name === "QuotaExceededError"
      ? "本机存储空间不足，无法保存还原映射。"
      : "无法保存本机还原映射。";
    throw new VaultStoreError("VAULT_SAVE_FAILED", message, error);
  } finally {
    database?.close();
  }
}

export async function loadVault(taskId) {
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
  let database;
  try {
    database = await openDatabase();
    const transaction = database.transaction("vaults", "readwrite");
    transaction.objectStore("vaults").delete(taskId);
    await transactionDone(transaction);
  } catch (error) {
    if (error?.code) throw error;
    throw new VaultStoreError("VAULT_DELETE_FAILED", "无法删除本机映射。", error);
  } finally {
    database?.close();
  }
}

export async function listVaultSummaries() {
  let database;
  try {
    database = await openDatabase();
    const transaction = database.transaction("vaults", "readonly");
    const records = await requestResult(transaction.objectStore("vaults").getAll());
    await transactionDone(transaction);
    return records
      .map(({ taskId, taskName, createdAt, uniqueValues }) => ({ taskId, taskName, createdAt, uniqueValues }))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  } catch (error) {
    if (error?.code) throw error;
    throw new VaultStoreError("VAULT_READ_FAILED", "无法读取本机任务记录。", error);
  } finally {
    database?.close();
  }
}
