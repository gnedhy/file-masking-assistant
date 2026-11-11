import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pagination, RecordFilters, TaskRecordList, usePageSize } from "./OperationViews.jsx";
import { getOperationSyncState, retryOperationSync } from "./operationSync.js";
import { Check, DownloadSimple } from "@phosphor-icons/react";
import { Dropdown } from "./Dropdown.jsx";

export function useOperationSync() {
  const [state, setState] = useState(getOperationSyncState);
  useEffect(() => {
    const update = () => setState({ ...getOperationSyncState() });
    window.addEventListener("operation-sync-changed", update);
    update();
    return () => window.removeEventListener("operation-sync-changed", update);
  }, []);
  return state;
}

export function SyncStatus() {
  const state = useOperationSync();
  // Only speak up when something is waiting, rejected or broken.
  if (state.session && !state.pending && !state.rejected && !state.otherPending && !state.error) return null;
  return <div className="sync-status" role="status">
    <strong>{state.session ? "操作记录" : "尚未确认身份"}</strong>
    <p>待同步 {state.pending || 0} 条{state.rejected ? ` · 被拒绝 ${state.rejected} 条` : ""}。统计暂不包含未同步记录。</p>
    {state.otherPending > 0 && <p>另有 {state.otherPending} 条属于其他身份的记录，需原身份重新进入后同步。</p>}
    {state.lastConfirmed && <small>最近确认：{new Date(state.lastConfirmed).toLocaleString("zh-CN")}</small>}
    {state.error && <p>记录同步暂未完成：{state.error}{state.error.includes("文件处理不受影响") ? "" : "文件处理不受影响。"}</p>}
    <button type="button" className="text-button" onClick={() => retryOperationSync()}>重新检查同步</button>
  </div>;
}

function shanghaiDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function dateRange(days) {
  const to = shanghaiDay();
  const start = new Date(`${to}T00:00:00+08:00`);
  if (days === "month") return { from: `${to.slice(0, 7)}-01`, to };
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: shanghaiDay(start), to };
}

// Departments as an indented list, parents before children, in WeCom order.
function departmentOptions(departments) {
  const children = new Map();
  for (const d of departments) { const key = String(d.parentId ?? ""); if (!children.has(key)) children.set(key, []); children.get(key).push(d); }
  const ids = new Set(departments.map(d => String(d.id)));
  const roots = departments.filter(d => d.parentId == null || !ids.has(String(d.parentId)));
  const out = [];
  const walk = (list, depth) => [...list].sort((a, b) => (b.order ?? 0) - (a.order ?? 0)).forEach(d => { out.push({ id: String(d.id), label: d.name, depth, parentId: d.parentId == null ? "" : String(d.parentId) }); walk(children.get(String(d.id)) ?? [], depth + 1); });
  walk(roots, 0);
  return out;
}

// The department and every department under it.
function departmentScope(departments, id) {
  const ids = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const d of departments) if (ids.has(d.parentId) && !ids.has(d.id)) { ids.add(d.id); grew = true; } }
  return ids;
}

// Admins choose whose records the drawer shows: their own, or everyone, narrowed by department or person.
function ScopePicker({ scope, onScope, directory, department, person, onDepartment, onPerson, part = "all" }) {
  const options = directory ? departmentOptions(directory.departments) : [];
  const inScope = department ? departmentScope(options, department) : null;
  const people = (directory?.members ?? []).filter(m => !inScope || m.departmentIds.some(id => inScope.has(String(id)))).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return <div className="record-scope">
    {part !== "filters" && <div className="record-scope__switch" data-scope={scope} role="group" aria-label="查看范围">{[["mine", "我的"], ["all", "全部"]].map(([key, label]) => <button key={key} type="button" aria-pressed={scope === key} onClick={() => onScope(key)}>{label}</button>)}</div>}
    {part !== "switch" && scope === "all" && <div className="record-scope__filters">
      {directory?.error ? <p role="alert">{directory.error}</p> : !directory ? <p role="status">正在读取通讯录…</p> : <>
        <div className="field"><span>部门</span><Dropdown label="部门" value={department} onChange={onDepartment} options={[{ value: "", label: "全部部门" }, ...options.map(d => ({ value: d.id, label: d.label, depth: d.depth }))]} /></div>
        <div className="field"><span>人员</span><Dropdown label="人员" value={person} onChange={onPerson} options={[{ value: "", label: department ? "部门全部人员" : "全部人员" }, ...people.map(m => ({ value: m.userId, label: m.name }))]} /></div>
        {!directory.departments.length && <p className="record-scope__hint">还没有同步通讯录，可在“权限配置”里同步后按部门筛选。</p>}
      </>}
    </div>}
  </div>;
}

export default function CentralOperations({ onBack, compact = false, footTarget = null }) {
  const sync = useOperationSync();
  const [customDates, setCustomDates] = useState(false);
  const [filters, setFilters] = useState(() => dateRange(30));
  const [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(filters.query || ""), 300); return () => clearTimeout(timer); }, [filters.query]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState({ loading: true, tasks: [], total: 0, stats: null, error: "" });
  const [users, setUsers] = useState([]);
  const admin = sync.session?.isAdmin === true;
  const [scope, setScope] = useState("mine");
  const [department, setDepartment] = useState("");
  const [person, setPerson] = useState("");
  const [directory, setDirectory] = useState(null);
  const allScope = compact && admin && scope === "all";
  // Who the records belong to: in the drawer that is me, unless an admin picked "全部".
  const owner = compact ? (allScope ? { user: person, department: person ? "" : department } : { user: sync.session?.userId || "" }) : {};
  useEffect(() => {
    if (!allScope || directory) return;
    fetch("/api/v1/access", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => setDirectory({ departments: data.departments, members: data.members }))
      .catch(() => setDirectory({ departments: [], members: [], error: "读取通讯录失败，可以先查看全部人员的记录。" }));
  }, [allScope, directory]);
  // Success shows briefly on the button itself; only a failure gets a line of text.
  const [exportState, setExportState] = useState({ kind: "", text: "" });
  useEffect(() => {
    if (exportState.kind !== "done") return undefined;
    const timer = setTimeout(() => setExportState({ kind: "", text: "" }), 3000);
    return () => clearTimeout(timer);
  }, [exportState]);
  const [exporting, setExporting] = useState(false);
  const details = useRef(null);
  const heading = useRef(null);
  useEffect(() => { if (!compact) heading.current?.focus(); }, [compact]);
  useEffect(() => {
    const controller = new AbortController();
    setData(old => ({ ...old, loading: true, error: "" }));
    const params = new URLSearchParams(Object.entries({ ...filters, query, ...owner, page, pageSize }).filter(([, v]) => v !== "" && v != null));
    const read = async path => {
      const response = await fetch(`${path}?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "登录状态已过期，请重新进入应用。" : "暂时无法读取记录，请稍后重试。");
      return response.json();
    };
    Promise.all([read("/api/v1/operation-tasks"), read("/api/v1/operation-statistics")]).then(([list, stats]) => {
      if (controller.signal.aborted) return;
      setData({ loading: false, tasks: list.tasks, total: list.total, stats, error: "" });
      setUsers(old => [...new Map([...old, ...stats.users.map(u => ({ id: u.userId, name: u.userName }))].map(u => [u.id, u])).values()]);
    }).catch(error => {
      if (!controller.signal.aborted) setData({ loading: false, tasks: [], total: 0, stats: null, error: error.name === "TimeoutError" ? "读取超时，请重试；文件处理状态已保留。" : error.message });
    });
    return () => controller.abort();
  }, [filters.from, filters.to, filters.user, filters.format, filters.result, filters.action, query, page, reload, compact, sync.session?.userId, sync.session?.isAdmin, sync.lastConfirmed, scope, department, person, pageSize]);
  const changeFilters = next => { setFilters(next); setPage(1); setExportState({ kind: "", text: "" }); };
  async function exportRecords() {
    setExporting(true); setExportState({ kind: "", text: "" });
    try {
      const sessionResponse = await fetch("/api/v1/session", { cache: "no-store" });
      if (!sessionResponse.ok) throw new Error("登录状态已过期，请重新进入应用。");
      const session = await sessionResponse.json();
      if (session.userId !== sync.session?.userId) throw new Error("身份已变化，请重新打开记录页面。");
      const response = await fetch("/api/v1/operation-events/export", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": session.csrf }, body: JSON.stringify(Object.fromEntries(Object.entries({ ...filters, ...(compact ? (allScope ? owner : { user: session.userId }) : {}) }).filter(([, v]) => v !== "" && v != null))) });
      if (!response.ok) throw new Error("导出失败，请重试；未生成下载文件。");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `使用统计明细_${filters.from || "全部"}_${filters.to || "至今"}.xlsx`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState({ kind: "done", text: "" });
    } catch (error) { setExportState({ kind: "error", text: error.message }); }
    finally { setExporting(false); }
  }
  const totals = data.stats?.totals;
  const sameRange = (days) => { const range = dateRange(days); return range.from === filters.from && range.to === filters.to; };
  const dateShortcuts = <div className={compact ? "record-date-shortcuts record-date-shortcuts--compact" : "record-date-shortcuts"} aria-label="快捷日期">{[[7,"最近 7 天"],[30,"最近 30 天"],["month","本月"]].map(([days,label]) => <button className="secondary-button" type="button" key={days} aria-pressed={!customDates && sameRange(days)} onClick={() => { setCustomDates(false); changeFilters({ ...filters, ...dateRange(days) }); }}>{label}</button>)}{compact && <button className="secondary-button" type="button" aria-pressed={customDates} aria-expanded={customDates} onClick={() => setCustomDates(open => !open)}>自定义</button>}</div>;
  const pager = <Pagination label="操作记录分页" page={page} total={data.total} pageSize={pageSize} unit="个任务" onPage={next => { setPage(next); details.current?.scrollIntoView({ block: "start" }); details.current?.focus({ preventScroll: true }); }} onPageSize={next => { setPageSize(next); setPage(1); }} />;
  return <section className={compact ? "central-records" : "usage-preview"} aria-label="集中操作记录">
    {!compact && <div className="usage-heading"><h1 ref={heading} tabIndex={-1}>使用统计</h1><button className="secondary-button" type="button" onClick={onBack}>返回文件处理</button></div>}
    {!compact && <p className="operation-scope">{sync.session?.userName} · {sync.session?.isAdmin ? "管理员 · 统计全部人员" : "仅统计本人的记录"} · 按北京时间筛选 · 保留 180 天</p>}
    <SyncStatus />
    {compact && admin && <ScopePicker part="switch" scope={scope} directory={directory} department={department} person={person}
      onScope={next => { setScope(next); setPage(1); }} onDepartment={next => { setDepartment(next); setPerson(""); setPage(1); }} onPerson={next => { setPerson(next); setPage(1); }} />}
    {!compact && dateShortcuts}
    <RecordFilters hideDates={compact && !customDates} extra={compact && admin && scope === "all" ? <ScopePicker part="filters" scope={scope} directory={directory} department={department} person={person}
      onScope={next => { setScope(next); setPage(1); }} onDepartment={next => { setDepartment(next); setPerson(""); setPage(1); }} onPerson={next => { setPerson(next); setPage(1); }} /> : null} extraCount={(department ? 1 : 0) + (person ? 1 : 0)} value={filters} onChange={changeFilters} users={!compact && sync.session?.isAdmin ? users : undefined} collapsible={compact} shortcuts={compact ? dateShortcuts : null} />
    {compact ? null : sync.session?.isAdmin ? <label className="central-search">文件名／任务搜索<input type="search" value={filters.query || ""} onChange={e => changeFilters({ ...filters, query: e.target.value })}/></label> : <label className="central-search">格式<select value={filters.format || ""} onChange={e => changeFilters({ ...filters, format:e.target.value })}><option value="">全部格式</option>{["xlsx","csv","txt","md","docx","pptx","html"].map(f=><option key={f}>{f}</option>)}</select></label>}
    {data.loading ? <p role="status">正在读取集中记录…</p> : data.error ? <div role="alert"><p>{data.error}</p><button type="button" className="secondary-button" onClick={() => setReload(v => v + 1)}>重新读取</button></div> : <>
      {!compact && totals && <dl className="usage-metrics" data-count={sync.session?.isAdmin ? 4 : 3}>{[...(sync.session?.isAdmin ? [["使用人数",totals.users]] : []),["成功脱敏任务",totals.protected],["有还原结果的任务",totals.restored],["失败操作",totals.failed]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {!compact && sync.session?.isAdmin && <section><h2>按用户汇总</h2><div className="usage-user-grid">{data.stats.users.map(u => <article key={u.userId}><h3>{u.userName}</h3><p>脱敏 {u.protected} · 还原 {u.restored}</p><p>导入 {u.imports} · 下载请求 {u.downloads} · 失败 {u.failed}</p></article>)}</div></section>}
      <div className="record-toolbar" ref={details} tabIndex={-1}><strong>操作记录 · {data.total} 个任务</strong><button className={compact ? "text-button record-export-button record-export-button--compact" : "secondary-button record-export-button"} data-done={exportState.kind === "done" || undefined} type="button" title="导出的文件名可能包含敏感信息，请妥善保管" disabled={!data.total || exporting || query !== (filters.query || "")} onClick={exportRecords}>{exportState.kind === "done" ? <Check size={18} weight="bold" aria-hidden="true"/> : <DownloadSimple size={18} aria-hidden="true"/>}{exporting ? "正在导出…" : exportState.kind === "done" ? "已开始下载" : "导出记录"}</button></div>
      {!compact && <p className="operation-scope">导出筛选范围内的全部操作明细，不只当前页。下载仅代表发起请求。</p>}
      <p className="record-export-status" role={exportState.kind === "error" ? "alert" : "status"}>{exportState.kind === "error" ? exportState.text : exportState.kind === "done" ? <span className="visually-hidden">已开始下载</span> : null}</p>
      {data.tasks.length ? <TaskRecordList key={scope} tasks={data.tasks} showUser={allScope || (!compact && sync.session?.isAdmin)} /> : <p role="status">当前筛选范围暂无记录。可调整日期或等待记录同步。</p>}
      {data.total > 0 && !(compact && footTarget) && pager}
    </>}
    {data.total > 0 && compact && footTarget && createPortal(pager, footTarget)}
  </section>;
}
