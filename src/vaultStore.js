const DB_NAME = "ai-safe-file-vault";
const DB_VERSION = 1;
const KEY_ID = "device-aes-key";

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
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const writeTransaction = database.transaction("settings", "readwrite");
  writeTransaction.objectStore("settings").put(key, KEY_ID);
  await transactionDone(writeTransaction);
  return key;
}

export async function saveVault(vault) {
  const database = await openDatabase();
  try {
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
  } finally {
    database.close();
  }
}

export async function loadVault(taskId) {
  const database = await openDatabase();
  try {
    const key = await getOrCreateKey(database);
    const transaction = database.transaction("vaults", "readonly");
    const record = await requestResult(transaction.objectStore("vaults").get(taskId));
    await transactionDone(transaction);
    if (!record) return null;
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, key, record.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } finally {
    database.close();
  }
}

export async function deleteVault(taskId) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("vaults", "readwrite");
    transaction.objectStore("vaults").delete(taskId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listVaultSummaries() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("vaults", "readonly");
    const records = await requestResult(transaction.objectStore("vaults").getAll());
    await transactionDone(transaction);
    return records
      .map(({ taskId, taskName, createdAt, uniqueValues }) => ({ taskId, taskName, createdAt, uniqueValues }))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  } finally {
    database.close();
  }
}
