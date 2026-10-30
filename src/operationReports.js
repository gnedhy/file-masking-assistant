import { OPERATION_LABELS, OPERATION_RESULTS } from "./operationLog.js";

export function localDay(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function filterOperations(records, filters) {
  const query = (filters.query || "").trim().toLocaleLowerCase();
  return records.filter(r => (!filters.from || localDay(r.time) >= filters.from)
    && (!filters.to || localDay(r.time) <= filters.to)
    && (!filters.action || r.action === filters.action) && (!filters.result || r.result === filters.result)
    && (!filters.user || r.userId === filters.user) && (!filters.format || r.format === filters.format)
    && (!query || [r.inputName, r.outputName, r.taskId, r.marker].filter(Boolean).join(" ").toLocaleLowerCase().includes(query)));
}
export function summarizeOperations(records) {
  const business = records.filter(r => /^(import|inspect|download)_(protect|restore)$/.test(r.action) || ["protect", "restore"].includes(r.action));
  const taskCount = action => new Set(business.filter(r => r.action === action && (r.result === "success" || action === "restore" && ["partial", "missing"].includes(r.result)) && r.taskId).map(r => `${r.userId}:${r.taskId}`)).size;
  return { users: new Set(business.map(r => r.userId).filter(Boolean)).size, protected: taskCount("protect"), restored: taskCount("restore"), failed: records.filter(r => r.result === "failed").length,
    imports: business.filter(r => r.action.startsWith("import_")).length, downloads: business.filter(r => r.action.startsWith("download_") && r.result === "requested").length };
}
export function operationsCsv(records, example = false) {
  const cell = value => {
    let text = String(value ?? "");
    if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [["数据来源", "用户", "时间", "任务", "任务编号（简短）", "输入文件名", "输出文件名", "格式", "操作", "结果"],
    ...records.map(r => [example ? "虚构示例" : "本机记录", r.userName || "本机（未登录）", r.time, r.taskId, r.marker, r.inputName || "未记录", r.outputName || "未记录", r.format?.toUpperCase(), OPERATION_LABELS[r.action], OPERATION_RESULTS[r.result]])];
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n");
}
