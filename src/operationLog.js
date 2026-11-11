import { enqueueOperation } from "./operationSync.js";
import { isErrorPlace } from "./errorPresentation.js";
export const OPERATION_LABELS = {
  import_protect: "导入待脱敏文件", import_restore: "导入待还原文件", export_records: "导出操作记录", view_all_records: "查看全员记录",
  rate_up: "结果点赞", rate_down: "结果倒赞", submit_feedback: "提交反馈", resolve_feedback: "处理反馈",
  inspect_protect: "检查待脱敏文件", inspect_restore: "检查待还原文件",
  protect: "生成脱敏文件", restore: "生成还原文件",
  save_mapping: "保存还原记录", delete_mapping: "删除还原记录",
  download_protect: "下载脱敏文件", download_restore: "下载还原文件",
  import_credential: "导入还原钥匙文件", download_credential: "下载还原钥匙文件",
  backup_export: "导出还原记录备份", backup_import: "导入还原记录备份",
};
export const OPERATION_RESULTS = { success: "完成", partial: "部分还原", missing: "内容缺失", warning: "需留意（历史记录）", failed: "失败", waiting: "待导入还原钥匙文件", requested: "已发起" };
let writeFailed = false;
export const hasOperationWriteFailure = () => writeFailed;

// Keep basenames only; contents, credentials and raw errors never enter the log.
function safeRecord(action, result, metadata) {
  if (!Object.hasOwn(OPERATION_LABELS, action) || !Object.hasOwn(OPERATION_RESULTS, result)) throw new Error("无效操作记录");
  const record = { action, result, time: new Date().toISOString() };
  if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(metadata.operationId ?? "")) record.operationId = metadata.operationId;
  if (/^(?:[A-F0-9]{8}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(metadata.taskId ?? "")) record.taskId = metadata.taskId;
  if (/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(metadata.marker ?? "")) record.marker = metadata.marker;
  if (["xlsx", "csv", "txt", "md", "docx", "pptx", "html"].includes(metadata.format)) record.format = metadata.format;
  if (result === "failed" && /^[A-Z][A-Z0-9_]{1,39}$/.test(metadata.errorCode ?? "")) record.errorCode = metadata.errorCode;
  // Kinds of place only ("comment:3"); the names and cells found there never enter the log.
  if (result === "failed" && Array.isArray(metadata.errorPlaces)) {
    const places = metadata.errorPlaces.filter(isErrorPlace).slice(0, 8);
    if (places.length) record.errorPlaces = places;
  }
  if (!action.includes("credential")) for (const key of ["inputName", "outputName"]) {
    if (typeof metadata[key] === "string") record[key] = metadata[key].split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512);
  }
  return record;
}

// Records go to the server through the outbox; a failure never blocks file processing.
export async function recordOperation(action, result, metadata = {}) {
  let saved = false;
  try { saved = await enqueueOperation(safeRecord(action, result, metadata)); } catch { saved = false; }
  if (!saved) writeFailed = true;
  globalThis.window?.dispatchEvent(new Event("operation-log-changed"));
  return saved;
}
