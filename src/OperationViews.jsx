import { useEffect, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { OPERATION_LABELS, OPERATION_RESULTS, recordOperation } from "./operationLog.js";
import { operationsCsv } from "./operationReports.js";

export function RecordFilters({ value, onChange, users }) {
  const control = (key, next) => onChange({ ...value, [key]: next });
  return <div className="record-filters">
    <label>开始日期<input type="date" value={value.from || ""} onChange={e => control("from", e.target.value)} /></label>
    <label>结束日期<input type="date" value={value.to || ""} onChange={e => control("to", e.target.value)} /></label>
    {users ? <><label>用户<select aria-label="用户" value={value.user || ""} onChange={e => control("user", e.target.value)}><option value="">全部用户</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>格式<select aria-label="格式" value={value.format || ""} onChange={e => control("format", e.target.value)}><option value="">全部格式</option>{["xlsx", "csv", "txt", "md", "docx", "pptx", "html"].map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select></label></> : <label>操作类型<select aria-label="操作类型" value={value.action || ""} onChange={e => control("action", e.target.value)}><option value="">全部操作</option>{Object.entries(OPERATION_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
    <label>结果<select aria-label="结果" value={value.result || ""} onChange={e => control("result", e.target.value)}><option value="">全部结果</option>{Object.entries(OPERATION_RESULTS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    {!users && <label className="record-search">搜索<input type="search" placeholder="文件名或任务标记" value={value.query || ""} onChange={e => control("query", e.target.value)} /></label>}
    {value.from && value.to && value.from > value.to && <p role="alert">开始日期不能晚于结束日期。</p>}
  </div>;
}
export function RecordFilename({ label, name }) {
  return <div className="record-filename"><span>{label}</span>{name ? <details><summary title="点击展开或收起完整文件名">{name}</summary></details> : <span>未记录</span>}</div>;
}
export function RecordList({ records }) {
  return <ol className="operation-list">{records.map(r => <li key={r.id}>
    <div className="operation-list__head"><strong>{OPERATION_LABELS[r.action] || "操作"}</strong><span data-result={r.result}>{OPERATION_RESULTS[r.result] || "未知状态"}</span></div>
    {!/credential|mapping|export_records/.test(r.action) && <><RecordFilename label="输入" name={r.inputName} />{(r.outputName || /^(protect|restore|download_)/.test(r.action)) && <RecordFilename label="输出" name={r.outputName} />}</>}
    <time dateTime={r.time}>{new Date(r.time).toLocaleString("zh-CN", { hour12: false })}</time>
    <p>{[r.userName, r.format?.toUpperCase(), r.taskId && `任务 ${r.marker || r.taskId}`].filter(Boolean).join(" · ")}</p>
  </li>)}</ol>;
}
export function ExportRecords({ records, example = false }) {
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
  }}><DownloadSimple size={18} aria-hidden="true" /><span>{example ? "导出示例记录" : "导出记录"}</span></a><small role="status">{notice}</small></div>;
}
