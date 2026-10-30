import { enqueueOperation } from "./operationSync.js";
const DB_NAME = "file-masking-assistant-v2-operations";
export const OPERATION_LIMIT = 500;
export const OPERATION_LABELS = {
  import_protect: "导入待脱敏文件", import_restore: "导入待还原文件", export_records: "请求导出记录",
  inspect_protect: "检查待脱敏文件", inspect_restore: "检查待还原文件",
  protect: "生成脱敏文件", restore: "生成还原文件",
  save_mapping: "保存本机还原记录", delete_mapping: "删除本机还原记录",
  download_protect: "请求下载脱敏文件", download_restore: "请求下载还原文件",
  import_credential: "读取还原钥匙文件（仅格式检查）", download_credential: "请求下载还原钥匙文件",
};
export const OPERATION_RESULTS = { success: "完成", partial: "部分还原", missing: "内容缺失", warning: "需留意（历史记录）", failed: "未完成", waiting: "待导入还原钥匙文件", requested: "已发起" };
let writeFailed = false;
export const hasOperationWriteFailure = () => writeFailed;

function openLog() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("events", { keyPath: "id", autoIncrement: true });
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("操作记录暂时被其他页面占用")); };
  });
}

// Keep basenames only; contents, credentials and raw errors never enter the log.
function safeRecord(action, result, metadata) {
  if (!Object.hasOwn(OPERATION_LABELS, action) || !Object.hasOwn(OPERATION_RESULTS, result)) throw new Error("无效操作记录");
  const record = { action, result, time: new Date().toISOString() };
  if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(metadata.operationId ?? "")) record.operationId = metadata.operationId;
  if (/^(?:[A-F0-9]{8}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(metadata.taskId ?? "")) record.taskId = metadata.taskId;
  if (/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(metadata.marker ?? "")) record.marker = metadata.marker;
  if (["xlsx", "csv", "txt", "md", "docx", "pptx", "html"].includes(metadata.format)) record.format = metadata.format;
  if (!action.includes("credential")) for (const key of ["inputName", "outputName"]) {
    if (typeof metadata[key] === "string") record[key] = metadata[key].split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512);
  }
  return record;
}

export async function recordOperation(action, result, metadata = {}) {
  let database;
  try {
    const record = safeRecord(action, result, metadata);
    // Queue persistence is independent of the 500-row local history and never blocks file processing on failure.
    await enqueueOperation(record);
    database = await openLog();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("events", "readwrite");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      const store = transaction.objectStore("events");
      store.add(record);
      const count = store.count();
      count.onsuccess = () => {
        let excess = count.result - OPERATION_LIMIT;
        if (excess <= 0) return;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          if (cursor.result && excess-- > 0) { cursor.result.delete(); cursor.result.continue(); }
        };
      };
    });
    globalThis.window?.dispatchEvent(new Event("operation-log-changed"));
    return true;
  } catch {
    // Log failure must not turn a completed mapping write into a file-processing failure.
    writeFailed = true;
    globalThis.window?.dispatchEvent(new Event("operation-log-changed"));
    return false;
  } finally { database?.close(); }
}

export async function listOperations() {
  const database = await openLog();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("events", "readonly");
      const records = [];
      transaction.oncomplete = () => resolve(records);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      const request = transaction.objectStore("events").openCursor(null, "prev");
      request.onsuccess = () => {
        if (request.result) { records.push(request.result.value); request.result.continue(); }
      };
    });
  } finally { database.close(); }
}
