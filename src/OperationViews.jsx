import { useState } from "react";
import { CaretRight, CheckCircle, Circle, MinusCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { Dropdown } from "./Dropdown.jsx";
import { failureReason } from "./errorPresentation.js";
import { OPERATION_LABELS, OPERATION_RESULTS } from "./operationLog.js";
import { isFileTask } from "./operationTasks.js";

const PAGE_SIZE_KEY = "file-mask-page-size";
export const PAGE_SIZE_OPTIONS = [20, 50, 100];
// Rows per page for the record lists; a per-browser convenience, so storage failures just fall back to 20.
export function usePageSize() {
  const [size, setSize] = useState(() => { try { const saved = Number(localStorage.getItem(PAGE_SIZE_KEY)); return PAGE_SIZE_OPTIONS.includes(saved) ? saved : 20; } catch { return 20; } });
  const choose = next => { setSize(next); try { localStorage.setItem(PAGE_SIZE_KEY, String(next)); } catch { /* not remembered */ } };
  return [size, choose];
}

export function Pagination({ label, page, total, pageSize, unit, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="record-pagination" aria-label={label}>
    <span role="status">第 {page} / {pages} 页 · 共 {total} {unit}</span>
    <div className="record-pagination__controls">
      <div className="record-pagination__size"><span>每页</span><Dropdown label="每页条数" value={String(pageSize)} onChange={next => onPageSize(Number(next))} options={PAGE_SIZE_OPTIONS.map(n => ({ value: String(n), label: `${n} 条` }))} /></div>
      <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <button type="button" className="secondary-button" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  </nav>;
}


export const activeFilterCount = (value) => ["from", "to", "action", "result", "query"].filter(key => value[key]).length;

export function RecordFilters({ value, onChange, users, collapsible = false, shortcuts = null, extra = null, extraCount = 0, hideDates = false }) {
  const control = (key, next) => onChange({ ...value, [key]: next });
  const fields = <>
    {!hideDates && <>
    <label>开始日期<input type="date" value={value.from || ""} onChange={e => control("from", e.target.value)} /></label>
    <label>结束日期<input type="date" value={value.to || ""} onChange={e => control("to", e.target.value)} /></label>
    </>}
    {extra}
    {users ? <><div className="field"><span>用户</span><Dropdown label="用户" value={value.user || ""} onChange={next => control("user", next)} options={[{ value: "", label: "全部用户" }, ...users.map(u => ({ value: u.id, label: u.name }))]} /></div><div className="field"><span>格式</span><Dropdown label="格式" value={value.format || ""} onChange={next => control("format", next)} options={[{ value: "", label: "全部格式" }, ...["xlsx", "csv", "txt", "md", "docx", "pptx", "html"].map(f => ({ value: f, label: f.toUpperCase() }))]} /></div></> : <div className="field"><span>操作类型</span><Dropdown label="操作类型" value={value.action || ""} onChange={next => control("action", next)} options={[{ value: "", label: "全部操作" }, ...Object.entries(OPERATION_LABELS).map(([k, v]) => ({ value: k, label: v }))]} /></div>}
    <div className="field"><span>结果</span><Dropdown label="结果" value={value.result || ""} onChange={next => control("result", next)} options={[{ value: "", label: "全部结果" }, ...Object.entries(OPERATION_RESULTS).filter(([k]) => ["success", "partial", "missing", "failed"].includes(k)).map(([k, v]) => ({ value: k, label: v }))]} /></div>
  </>;
  const rangeError = value.from && value.to && value.from > value.to && <p role="alert">开始日期不能晚于结束日期。</p>;
  if (collapsible) {
    const count = activeFilterCount({ ...value, query: "" }) + extraCount;
    return <div className="record-filters-compact">
      <label className="record-search"><span className="visually-hidden">搜索</span><input type="search" placeholder="搜索文件名或任务编号" value={value.query || ""} onChange={e => control("query", e.target.value)} /></label>
      <details className="record-filters-more"><summary><span>筛选</span>{count ? <b aria-label={`已设置 ${count} 项`}>{count}</b> : null}</summary>{shortcuts}<div className="record-filters">{fields}</div></details>
      {rangeError}
    </div>;
  }
  return <div className="record-filters">
    {fields}
    <label className="record-search">搜索<input type="search" placeholder="文件名或任务编号" value={value.query || ""} onChange={e => control("query", e.target.value)} /></label>
    {rangeError}
  </div>;
}
export function RecordFilename({ label, name }) {
  return <div className="record-filename"><span>{label}</span>{name ? <details><summary title="点击展开或收起完整文件名">{name}</summary></details> : <span>未记录</span>}</div>;
}
export function RecordList({ records, compact = false, withinTask = false }) {
  return <ol className="operation-list">{records.map(r => <li key={r.id}>
    <div className="operation-list__head"><strong>{OPERATION_LABELS[r.action] || "操作"}</strong><span data-result={r.result}>{OPERATION_RESULTS[r.result] || "未知状态"}</span></div>
    {r.result === "failed" && failureReason(r.errorCode) && <p className="operation-list__reason">原因：{failureReason(r.errorCode)}</p>}
    {!compact && !/credential|mapping|export_records|view_all_records|rate_|feedback/.test(r.action) && <><RecordFilename label="输入" name={r.inputName} />{(r.outputName || /^(protect|restore|download_)/.test(r.action)) && <RecordFilename label="输出" name={r.outputName} />}</>}
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

const STAGE = {
  done: { text: "完成", icon: CheckCircle },
  partial: { text: "部分完成", icon: WarningCircle },
  failed: { text: "失败", icon: XCircle },
  none: { text: "未进行", icon: Circle },
};
const STEP_TONE = { success: "done", partial: "partial", missing: "partial", failed: "failed", waiting: "partial" };
const shortTime = time => new Date(time).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const initial = name => (name || "?").trim().slice(-2);

function StageChip({ label, state }) {
  const { text, icon: Icon } = STAGE[state] ?? STAGE.none;
  return <span className="task-stage" data-state={state}><Icon weight={state === "none" ? "regular" : "fill"} aria-hidden="true" />{label}{text}</span>;
}

// One step in the opened task: what happened, its result, when, and the file names involved.
function StepRow({ step }) {
  const tone = STEP_TONE[step.result] ?? "neutral";
  const reason = step.result === "failed" ? failureReason(step.errorCode) : "";
  const files = !/credential|mapping|export_records|view_all_records|rate_|feedback/.test(step.action) ? [["输入", step.inputName], ["输出", step.outputName]].filter(([, name]) => name) : [];
  return <li className="task-step" data-tone={tone}>
    <span className="task-step__dot" aria-hidden="true" />
    <div className="task-step__body">
      <div className="task-step__head"><strong>{OPERATION_LABELS[step.action] || "操作"}</strong><span className="task-step__result">{OPERATION_RESULTS[step.result] || "未知状态"}</span><time dateTime={step.time}>{new Date(step.time).toLocaleTimeString("zh-CN", { hour12: false })}</time></div>
      {reason && <p className="task-step__reason">原因：{reason}</p>}
      {files.map(([label, name]) => <p key={label} className="task-step__file"><span>{label}</span><span title={name}>{name}</span></p>)}
    </div>
  </li>;
}

// The statistics page lists tasks as a table: one row per task, steps open as a timeline underneath.
export function TaskTable({ tasks, showUser = false }) {
  const [openKey, setOpenKey] = useState(null);
  return <div className="task-table" data-people={showUser}>
    <div className="task-table__head" aria-hidden="true"><span>任务</span>{showUser && <span>使用人</span>}<span>进度</span><span>最近操作</span><span /></div>
    <ol>{tasks.map(task => {
      const open = openKey === task.key;
      const failed = task.events.filter(e => e.result === "failed").length;
      return <li key={task.key} className="task-row" data-open={open}>
        <button type="button" className="task-row__main" aria-expanded={open} onClick={() => setOpenKey(open ? null : task.key)}>
          <span className="task-row__file">
            <span className="task-row__format" data-format={task.format || "other"}>{task.format ? task.format.toUpperCase() : "—"}</span>
            <span className="task-row__title"><strong title={task.title}>{task.title}</strong><small>{[task.marker && `任务 ${task.marker}`, `${task.events.length} 步`, failed && `${failed} 步失败`].filter(Boolean).join(" · ")}</small></span>
          </span>
          {showUser && <span className="task-row__user"><i aria-hidden="true">{initial(task.userName)}</i><span>{task.userName}</span></span>}
          <span className="task-row__stages">{task.fileTask ? <><StageChip label="脱敏" state={task.protect} /><StageChip label="还原" state={task.restore} /></> : <span className="task-stage" data-state="none"><MinusCircle aria-hidden="true" />非文件操作</span>}</span>
          <time className="task-row__time" dateTime={task.lastTime}>{shortTime(task.lastTime)}</time>
          <CaretRight className="task-row__caret" weight="bold" aria-hidden="true" />
        </button>
        {open && <ol className="task-steps" aria-label={`${task.title}的操作步骤`}>{task.events.map(step => <StepRow key={step.id ?? step.eventId} step={step} />)}</ol>}
      </li>;
    })}</ol>
  </div>;
}
