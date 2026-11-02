import { useState } from "react";

const FORMAT_LABELS = { xlsx: "Excel", csv: "CSV", txt: "TXT", md: "Markdown", docx: "Word" };
const RESTORED = new Set(["success", "partial", "missing"]);

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

// Usage comes from the operation records and is read only when the details are opened.
async function readUsage(taskId) {
  const response = await fetch(`/api/v1/operation-events?query=${encodeURIComponent(taskId)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("USAGE_UNAVAILABLE");
  const records = (await response.json()).records.filter(record => record.taskId === taskId);
  const restores = records.filter(record => record.action === "restore" && RESTORED.has(record.result));
  return {
    downloads: records.filter(record => record.action === "download_protect").length,
    restores: restores.length,
    lastRestore: restores[0]?.time ?? null,
  };
}

export function TaskDetails({ task }) {
  const [usage, setUsage] = useState({ state: "idle" });
  const occurrences = Object.values(task.occurrenceBaseline ?? {}).reduce((sum, count) => sum + count, 0);
  const load = () => {
    if (usage.state !== "idle") return;
    setUsage({ state: "loading" });
    readUsage(task.taskId).then(result => setUsage({ state: "ready", ...result })).catch(() => setUsage({ state: "error" }));
  };
  return <details className="task-details" onToggle={event => { if (event.currentTarget.open) load(); }}>
    <summary>任务详情</summary>
    <dl>
      <div><dt>原文件</dt><dd>{FORMAT_LABELS[task.sourceFormat] ?? (task.sourceFormat || "未知").toUpperCase()} · 生成于 {formatTime(task.createdAt)}</dd></div>
      <div><dt>替换内容</dt><dd>{task.uniqueValues} 个真实值{occurrences ? `，文件中共 ${occurrences} 处代号` : ""}</dd></div>
      <div><dt>任务编号</dt><dd>{task.marker || task.taskId}</dd></div>
      <div><dt>使用情况</dt><dd>{usage.state === "loading" ? "正在读取…"
        : usage.state === "error" ? "暂时读不到使用记录"
        : usage.state === "ready" ? `下载 ${usage.downloads} 次 · ${usage.restores ? `还原 ${usage.restores} 次，最近 ${formatTime(usage.lastRestore)}` : "还没有还原过"}`
        : "—"}</dd></div>
    </dl>
  </details>;
}
