import { useEffect, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { OPERATION_LABELS, OPERATION_RESULTS, recordOperation } from "./operationLog.js";
import { operationsCsv } from "./operationReports.js";
import { isFileTask } from "./operationTasks.js";

export const activeFilterCount = (value) => ["from", "to", "action", "result", "query"].filter(key => value[key]).length;

export function RecordFilters({ value, onChange, users, collapsible = false, shortcuts = null }) {
  const control = (key, next) => onChange({ ...value, [key]: next });
  const fields = <>
    <label>开始日期<input type="date" value={value.from || ""} onChange={e => control("from", e.target.value)} /></label>
    <label>结束日期<input type="date" value={value.to || ""} onChange={e => control("to", e.target.value)} /></label>
    {users ? <><label>用户<select aria-label="用户" value={value.user || ""} onChange={e => control("user", e.target.value)}><option value="">全部用户</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>格式<select aria-label="格式" value={value.format || ""} onChange={e => control("format", e.target.value)}><option value="">全部格式</option>{["xlsx", "csv", "txt", "md", "docx", "pptx", "html"].map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select></label></> : <label>操作类型<select aria-label="操作类型" value={value.action || ""} onChange={e => control("action", e.target.value)}><option value="">全部操作</option>{Object.entries(OPERATION_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
    <label>结果<select aria-label="结果" value={value.result || ""} onChange={e => control("result", e.target.value)}><option value="">全部结果</option>{Object.entries(OPERATION_RESULTS).filter(([k]) => k !== "warning").map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
  </>;
  const rangeError = value.from && value.to && value.from > value.to && <p role="alert">开始日期不能晚于结束日期。</p>;
  if (collapsible) {
    const count = activeFilterCount({ ...value, query: "" });
    return <div className="record-filters-compact">
      <label className="record-search"><span className="visually-hidden">搜索</span><input type="search" placeholder="搜索文件名或任务编号" value={value.query || ""} onChange={e => control("query", e.target.value)} /></label>
      <details className="record-filters-more"><summary>{count ? `筛选（${count}）` : "筛选"}</summary>{shortcuts}<div className="record-filters">{fields}</div></details>
      {rangeError}
    </div>;
  }
  return <div className="record-filters">
    {fields}
    {!users && <label className="record-search">搜索<input type="search" placeholder="文件名或任务编号" value={value.query || ""} onChange={e => control("query", e.target.value)} /></label>}
    {rangeError}
  </div>;
}
export function RecordFilename({ label, name }) {
  return <div className="record-filename"><span>{label}</span>{name ? <details><summary title="点击展开或收起完整文件名">{name}</summary></details> : <span>未记录</span>}</div>;
}
export function RecordList({ records, compact = false, withinTask = false }) {
  return <ol className="operation-list">{records.map(r => <li key={r.id}>
    <div className="operation-list__head"><strong>{OPERATION_LABELS[r.action] || "操作"}</strong><span data-result={r.result}>{OPERATION_RESULTS[r.result] || "未知状态"}</span></div>
    {!compact && !/credential|mapping|export_records|view_all_records/.test(r.action) && <><RecordFilename label="输入" name={r.inputName} />{(r.outputName || /^(protect|restore|download_)/.test(r.action)) && <RecordFilename label="输出" name={r.outputName} />}</>}
    <time dateTime={r.time}>{new Date(r.time).toLocaleString("zh-CN", { hour12: false })}</time>
    {!compact && !withinTask && <p>{[r.userName, r.format?.toUpperCase(), r.taskId && `任务 ${r.marker || r.taskId}`].filter(Boolean).join(" · ")}</p>}
  </li>)}</ol>;
}
const DOT_LABELS = { done: "已完成", partial: "部分完成", failed: "失败", none: "未进行" };

// One row per task; the two dots are masking and restoring, the steps open underneath.
export function TaskRecordList({ tasks, showUser = false }) {
  return <ol className="operation-tasks">{tasks.map(task => <li key={task.key}>
    <div className="operation-tasks__head">
      <strong title={task.title}>{task.title}</strong>
      {isFileTask(task.events) && <span className="task-progress" role="img" aria-label={`脱敏${DOT_LABELS[task.protect]}，还原${DOT_LABELS[task.restore]}`}>
        <i data-state={task.protect} title={`脱敏：${DOT_LABELS[task.protect]}`} />
        <i data-state={task.restore} title={`还原：${DOT_LABELS[task.restore]}`} />
      </span>}
    </div>
    <p className="operation-tasks__meta">{[showUser && task.userName, task.format?.toUpperCase(), task.marker && `任务 ${task.marker}`, new Date(task.lastTime).toLocaleString("zh-CN", { hour12: false })].filter(Boolean).join(" · ")}</p>
    <details className="operation-tasks__steps"><summary>操作明细（{task.events.length} 条）</summary><RecordList records={task.events} withinTask /></details>
  </li>)}</ol>;
}

const GROUP_RESULTS = { ...OPERATION_RESULTS, idle: "未生成文件" };

export function OperationGroups({ days }) {
  return days.map(({ day, label, groups }) => <section className="operation-day" key={day} aria-label={label}>
    <h3>{label}</h3>
    <ol className="operation-cards">{groups.map(group => <li key={group.key}>
      <div className="operation-list__head"><strong>{group.title}</strong><span data-result={group.result}>{GROUP_RESULTS[group.result] || "未知状态"}</span></div>
      {group.kind !== "other" && <><RecordFilename label="输入" name={group.inputName} />{(group.outputName || group.steps.some(step => ["protect", "restore"].includes(step.action))) && <RecordFilename label="输出" name={group.outputName} />}</>}
      <p className="operation-cards__meta">{[new Date(group.time).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" }), group.format?.toUpperCase(), group.taskLabel && `任务 ${group.taskLabel}`].filter(Boolean).join(" · ")}</p>
      {group.steps.length > 1 && <details className="operation-steps"><summary>查看 {group.steps.length} 个步骤</summary><RecordList records={group.steps} compact /></details>}
    </li>)}</ol>
  </section>);
}

export function ExportRecords({ records, example = false, label = "导出记录" }) {
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([operationsCsv(records, example)], { type: "text/csv;charset=utf-8" }));
    setUrl(url); return () => URL.revokeObjectURL(url);
  }, [records, example]);
  return <div className="record-export"><a className="secondary-button" href={url || undefined} download={example ? "示例_使用统计明细.csv" : "本机操作记录.csv"} aria-disabled={!url || !records.length} onClick={e => {
    if (!url || !records.length) { e.preventDefault(); return; }
    if (!example) recordOperation("export_records", "requested");
    setNotice("已发起记录导出，请在下载列表确认。");
  }}><DownloadSimple size={18} aria-hidden="true" /><span>{example ? "导出示例记录" : label}</span></a><small role="status">{notice}</small></div>;
}
