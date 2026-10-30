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
const RESTORE_ACTIONS = new Set(["import_restore", "inspect_restore", "restore", "download_restore", "import_credential"]);
const PROTECT_ACTIONS = new Set(["import_protect", "inspect_protect", "protect", "download_protect", "save_mapping", "download_credential", "delete_mapping"]);
const operationKind = action => RESTORE_ACTIONS.has(action) ? "restore" : PROTECT_ACTIONS.has(action) ? "protect" : "other";
const KIND_TITLES = { protect: "制作脱敏文件", restore: "还原处理文件" };

// Display only: one card per file flow. Records without operationId join the flow of their task; CSV stays row by row.
export function groupOperations(records) {
  const protectFlow = new Map();
  for (const r of records) if (r.operationId && r.taskId && ["protect", "download_protect"].includes(r.action)) protectFlow.set(r.taskId, r.operationId);
  const groups = new Map();
  for (const record of records) {
    const kind = operationKind(record.action);
    const key = record.operationId
      || (record.taskId && kind === "protect" && protectFlow.get(record.taskId))
      || (record.taskId && kind !== "other" ? `task:${record.taskId}:${kind}` : `single:${record.id ?? record.time}`);
    if (!groups.has(key)) groups.set(key, { key, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].map(({ key, records: steps }) => {
    const kinds = new Set(steps.map(step => operationKind(step.action)));
    const kind = kinds.has("restore") ? "restore" : kinds.has("protect") ? "protect" : "other";
    const generated = steps.find(step => ["protect", "restore"].includes(step.action));
    const latest = steps[0];
    const named = steps.find(step => step.inputName) ?? {};
    const output = generated ?? steps.find(step => step.outputName) ?? {};
    const tagged = steps.find(step => step.marker) ?? steps.find(step => step.taskId) ?? {};
    const result = generated?.result ?? (kind === "other" || ["failed", "waiting"].includes(latest.result) ? latest.result : "idle");
    return {
      key, kind, result, steps,
      title: KIND_TITLES[kind] ?? OPERATION_LABELS[latest.action] ?? "操作",
      time: latest.time,
      inputName: named.inputName,
      outputName: output.outputName,
      format: steps.find(step => step.format)?.format,
      taskLabel: tagged.marker || tagged.taskId,
    };
  });
}

export function groupByDay(groups, now = new Date()) {
  const today = localDay(now);
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days = new Map();
  for (const group of groups) {
    const day = localDay(group.time);
    if (!days.has(day)) {
      const date = new Date(group.time);
      const label = day === today ? "今天" : day === yesterday ? "昨天"
        : `${date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
      days.set(day, { day, label, groups: [] });
    }
    days.get(day).groups.push(group);
  }
  return [...days.values()];
}

const RESTORED = ["success", "partial", "missing"];

// Dashboard aggregates: counts distinct user + task per day, matching summarizeOperations.
export function dailyActivity(records, from, to) {
  const days = [];
  for (const cursor = new Date(`${from}T00:00:00`); localDay(cursor) <= to; cursor.setDate(cursor.getDate() + 1)) {
    const day = localDay(cursor);
    const rows = records.filter((r) => localDay(r.time) === day);
    const tasks = (action, results) => new Set(rows.filter((r) => r.action === action && results.includes(r.result) && r.taskId).map((r) => `${r.userId}:${r.taskId}`)).size;
    days.push({ day, label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, protected: tasks("protect", ["success"]), restored: tasks("restore", RESTORED), users: new Set(rows.map((r) => r.userId).filter(Boolean)).size, failed: rows.filter((r) => r.result === "failed").length });
  }
  return days;
}

export function bucketActivity(days, size) {
  if (size <= 1) return days;
  const buckets = [];
  // Whole buckets end on the latest day, so only the oldest bucket can be short.
  for (let end = days.length; end > 0; end -= size) {
    const slice = days.slice(Math.max(0, end - size), end);
    const total = (key) => slice.reduce((sum, day) => sum + day[key], 0);
    buckets.unshift({ day: slice[0].day, to: slice[slice.length - 1].day, label: slice[0].label, protected: total("protected"), restored: total("restored") });
  }
  return buckets;
}

export const ISSUE_RESULTS = ["failed", "partial", "missing", "waiting"];
const ISSUE_LABELS = { failed: "失败", partial: "部分还原", missing: "内容缺失", waiting: "待导入钥匙文件" };
const isFinalStep = (r) => ["protect", "restore", "inspect_protect", "inspect_restore"].includes(r.action);

// Share of finished steps that completed fully; a task that was never restored does not count against it.
export function outcomeSummary(records) {
  const finals = records.filter(isFinalStep);
  const completed = finals.filter((r) => r.result === "success" && ["protect", "restore"].includes(r.action)).length;
  const issues = ISSUE_RESULTS.map((key) => ({ key, label: ISSUE_LABELS[key], count: finals.filter((r) => r.result === key).length })).filter((item) => item.count);
  const attention = issues.reduce((sum, item) => sum + item.count, 0);
  const total = completed + attention;
  return { rate: total ? Math.round((completed / total) * 100) : 100, attention, issues };
}

export function rankBy(records, keyOf, labelOf, limit = 6) {
  const counts = new Map();
  for (const r of records) {
    if (r.action !== "protect" || r.result !== "success") continue;
    const key = keyOf(r); counts.set(key, { key, label: labelOf(r), count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
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
