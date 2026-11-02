import { useEffect, useRef, useState } from "react";
import { RecordFilters, RecordList } from "./OperationViews.jsx";
import { getOperationSyncState, retryOperationSync } from "./operationSync.js";
import { DownloadSimple } from "@phosphor-icons/react";

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
  return <div className="sync-status" role="status">
    <strong>{state.session ? "操作记录" : "尚未确认身份"}</strong>
    <p>待同步 {state.pending || 0} 条{state.rejected ? ` · 被拒绝 ${state.rejected} 条` : ""}。统计暂不包含未同步记录。</p>
    {state.otherPending > 0 && <p>另有 {state.otherPending} 条属于其他身份的记录，需原身份重新进入后同步。</p>}
    {state.lastConfirmed && <small>最近确认：{new Date(state.lastConfirmed).toLocaleString("zh-CN")}</small>}
    {state.error && <p>记录同步暂未完成：{state.error}。文件处理不受影响。</p>}
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

export default function CentralOperations({ onBack, compact = false }) {
  const sync = useOperationSync();
  const [filters, setFilters] = useState(() => dateRange(30));
  const [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(filters.query || ""), 300); return () => clearTimeout(timer); }, [filters.query]);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState({ loading: true, records: [], total: 0, stats: null, error: "" });
  const [users, setUsers] = useState([]);
  const [exportState, setExportState] = useState("");
  const [exporting, setExporting] = useState(false);
  const details = useRef(null);
  const heading = useRef(null);
  useEffect(() => { if (!compact) heading.current?.focus(); }, [compact]);
  useEffect(() => {
    const controller = new AbortController();
    setData(old => ({ ...old, loading: true, error: "" }));
    const params = new URLSearchParams({ ...filters, query, ...(compact ? { user: sync.session?.userId || "" } : {}), page });
    const read = async path => {
      const response = await fetch(`${path}?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "登录状态已过期，请重新进入应用。" : "暂时无法读取记录，请稍后重试。");
      return response.json();
    };
    Promise.all([read("/api/v1/operation-events"), read("/api/v1/operation-statistics")]).then(([list, stats]) => {
      if (controller.signal.aborted) return;
      setData({ loading: false, records: list.records, total: list.total, stats, error: "" });
      setUsers(old => [...new Map([...old, ...stats.users.map(u => ({ id: u.userId, name: u.userName }))].map(u => [u.id, u])).values()]);
    }).catch(error => {
      if (!controller.signal.aborted) setData({ loading: false, records: [], total: 0, stats: null, error: error.name === "TimeoutError" ? "读取超时，请重试；文件处理状态已保留。" : error.message });
    });
    return () => controller.abort();
  }, [filters.from, filters.to, filters.user, filters.format, filters.result, filters.action, query, page, reload, compact, sync.session?.userId, sync.session?.isAdmin, sync.lastConfirmed]);
  const changeFilters = next => { setFilters(next); setPage(1); setExportState(""); };
  async function exportRecords() {
    setExporting(true); setExportState("");
    try {
      const sessionResponse = await fetch("/api/v1/session", { cache: "no-store" });
      if (!sessionResponse.ok) throw new Error("登录状态已过期，请重新进入应用。");
      const session = await sessionResponse.json();
      if (session.userId !== sync.session?.userId) throw new Error("身份已变化，请重新打开记录页面。");
      const response = await fetch("/api/v1/operation-events/export", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": session.csrf }, body: JSON.stringify({ ...filters, ...(compact ? { user: session.userId } : {}) }) });
      if (!response.ok) throw new Error("导出失败，请重试；未生成下载文件。");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `集中操作记录_${filters.from || "全部"}_${filters.to || "至今"}.csv`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState("已发起下载，请在下载列表确认。文件名可能包含敏感信息。");
    } catch (error) { setExportState(error.message); }
    finally { setExporting(false); }
  }
  const totals = data.stats?.totals;
  return <section className={compact ? "central-records" : "usage-preview"} aria-label="集中操作记录">
    {!compact && <div className="usage-heading"><h1 ref={heading} tabIndex={-1}>{sync.session?.isAdmin ? "使用统计" : "我的记录"}</h1><button className="secondary-button" type="button" onClick={onBack}>返回文件处理</button></div>}
    <p className="operation-scope">{sync.session?.userName} · {!compact && sync.session?.isAdmin ? "管理员可查看全部记录" : "仅显示本人记录"} · 按北京时间筛选 · 保留 180 天</p>
    <SyncStatus />
    <div className="record-date-shortcuts" aria-label="快捷日期">{[[7,"最近 7 天"],[30,"最近 30 天"],["month","本月"]].map(([days,label]) => <button className="secondary-button" type="button" key={days} onClick={() => changeFilters({ ...filters, ...dateRange(days) })}>{label}</button>)}</div>
    <RecordFilters value={filters} onChange={changeFilters} users={!compact && sync.session?.isAdmin ? users : undefined} />
    {!compact && sync.session?.isAdmin ? <label className="central-search">文件名／任务搜索<input type="search" value={filters.query || ""} onChange={e => changeFilters({ ...filters, query: e.target.value })}/></label> : <label className="central-search">格式<select value={filters.format || ""} onChange={e => changeFilters({ ...filters, format:e.target.value })}><option value="">全部格式</option>{["xlsx","csv","txt","md","docx","pptx","html"].map(f=><option key={f}>{f}</option>)}</select></label>}
    {data.loading ? <p role="status">正在读取集中记录…</p> : data.error ? <div role="alert"><p>{data.error}</p><button type="button" className="secondary-button" onClick={() => setReload(v => v + 1)}>重新读取</button></div> : <>
      {!compact && totals && <dl className="usage-metrics">{[["使用人数",totals.users],["成功脱敏任务",totals.protected],["有还原结果的任务",totals.restored],["失败操作",totals.failed]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {!compact && sync.session?.isAdmin && <section><h2>按用户汇总</h2><div className="usage-user-grid">{data.stats.users.map(u => <article key={u.userId}><h3>{u.userName}</h3><p>脱敏 {u.protected} · 还原 {u.restored}</p><p>导入 {u.imports} · 下载请求 {u.downloads} · 失败 {u.failed}</p></article>)}</div></section>}
      <div className="record-toolbar" ref={details} tabIndex={-1}><strong>操作明细 · {data.total} 条</strong><button className="secondary-button record-export-button" type="button" disabled={!data.total || exporting || query !== (filters.query || "")} onClick={exportRecords}><DownloadSimple size={18} aria-hidden="true"/>{exporting ? "正在导出…" : "导出记录"}</button></div>
      <p className="operation-scope">导出全部筛选结果，共 {data.total} 条；不只当前页。下载仅代表发起请求。</p>
      <p role="status">{exportState}</p>
      {data.records.length ? <RecordList records={data.records}/> : <p role="status">当前筛选范围暂无记录。可调整日期或等待记录同步。</p>}
      {data.total > 0 && <nav className="record-pagination" aria-label="操作明细分页"><span>第 {page} / {Math.ceil(data.total / 10)} 页</span><div>{[[-1,"上一页"],[1,"下一页"]].map(([delta,label]) => <button className="secondary-button" type="button" key={label} disabled={delta < 0 ? page === 1 : page * 10 >= data.total} onClick={() => { setPage(page + delta); details.current?.scrollIntoView({ block:"start" }); details.current?.focus({ preventScroll:true }); }}>{label}</button>)}</div></nav>}
    </>}
  </section>;
}
