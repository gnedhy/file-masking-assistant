import { useEffect, useRef, useState } from "react";
import { Pagination, RecordFilters, TaskTable, activeFilterCount, usePageSize } from "./OperationViews.jsx";
import { DownloadSimple, FunnelSimple, X } from "@phosphor-icons/react";
import { bucketActivity, localDay } from "./operationReports.js";
import { OutcomeCard, RankBars, StatTile, TrendChart } from "./UsageCharts.jsx";
import { useOperationSync } from "./CentralOperations.jsx";
import { getSession } from "./session.js";

const RANGES = [["最近 7 天", 7], ["最近 30 天", 30], ["最近 60 天", 60]];
const MIN_ACTIVE_DAYS = 3;
const rangeOf = (days) => { const from = new Date(); from.setDate(from.getDate() - days + 1); return { from: localDay(from), to: localDay(new Date()) }; };
const NOTES = [
  ["成功脱敏任务", "按用户与任务编号去重，仅计成功生成脱敏文件的任务。"],
  ["有还原结果的任务", "同一任务多次还原只计一次，包含部分还原与内容缺失。没有还原记录不等于失败。"],
  ["使用人数", "所选范围内有业务文件操作的用户，同一人只计一次。"],
  ["失败操作", "按失败的操作计次；部分还原、内容缺失和待导入钥匙文件不计为失败。"],
  ["完成率", "完全完成的步骤占全部处理结果的比例。没有发起还原的任务不计入，不代表失败。"],
];
const percentChange = (value, previous) => previous ? Math.round(((value - previous) / previous) * 100) : null;
const compareText = (value, previous, days) => {
  if (previous === null) return null;
  if (value === previous) return `与前 ${days} 天持平`;
  const change = percentChange(value, previous);
  return `较前 ${days} 天 ${value > previous ? "+" : "−"}${Math.abs(value - previous)}${change === null ? "" : `（${change > 0 ? "+" : "−"}${Math.abs(change)}%）`}`;
};
const compareTone = (value, previous, lowerIsBetter = false) => previous === null || value === previous ? "flat" : (value > previous) !== lowerIsBetter ? "good" : "bad";
// Query string of the non-empty filters.
const params = (values) => new URLSearchParams(Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ""));
async function readJson(path, signal) {
  const response = await fetch(path, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  if (!response.ok) throw new Error(response.status === 401 ? "登录状态已过期，请重新进入应用。" : "暂时无法读取统计，请稍后重试。");
  return response.json();
}

// One page for everyone: admins see all people, ordinary users see only themselves. The server enforces the scope.
export default function UsageStats({ onBack }) {
  const { session } = useOperationSync();
  const admin = session?.isAdmin === true;
  const [filters, setFilters] = useState(() => rangeOf(30));
  const [focus, setFocus] = useState(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [remote, setRemote] = useState({ loading: true, error: "", report: null });
  const [detailData, setDetailData] = useState({ loading: false, error: "", tasks: [], total: 0 });
  const [knownUsers, setKnownUsers] = useState([]);
  const [reload, setReload] = useState(0);
  const [exportState, setExportState] = useState({ busy: false, text: "" });
  const heading = useRef(null);
  const detail = useRef(null);
  const filtersRef = useRef(null);
  // The filter popover closes on a click elsewhere or Escape, like the other menus.
  useEffect(() => {
    const onPointerDown = event => { const el = filtersRef.current; if (el?.open && !el.contains(event.target)) el.open = false; };
    const onKeyDown = event => { const el = filtersRef.current; if (event.key === "Escape" && el?.open && !el.querySelector("[aria-expanded=\"true\"]")) { el.open = false; el.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, []);

  const range = filters.from && filters.to && filters.from <= filters.to;
  const detailFilters = { ...filters, ...(focus?.filters ?? {}), ...(onlyIssues ? { issues: "1" } : {}) };
  const filterKey = JSON.stringify(filters), detailKey = JSON.stringify(detailFilters);

  useEffect(() => {
    if (!session || !range) return;
    const controller = new AbortController();
    setRemote(old => ({ ...old, loading: true, error: "" }));
    readJson(`/api/v1/operation-report?${params(filters)}`, controller.signal)
      .then(report => { setRemote({ loading: false, error: "", report }); setKnownUsers(old => [...new Map([...old, ...report.members].map(u => [u.id, u])).values()]); })
      .catch(error => { if (!controller.signal.aborted) setRemote(old => ({ ...old, loading: false, error: error.message })); });
    return () => controller.abort();
  }, [session?.userId, session?.isAdmin, filterKey, reload]);
  useEffect(() => {
    if (!session || !detailOpen) return;
    const controller = new AbortController();
    setDetailData(old => ({ ...old, loading: true, error: "" }));
    // One row per task, like the operation records; a task shows all its steps when opened.
    readJson(`/api/v1/operation-tasks?${params({ ...detailFilters, files: "1", page, pageSize })}`, controller.signal)
      .then(result => setDetailData({ loading: false, error: "", tasks: result.tasks, total: result.total }))
      .catch(error => { if (!controller.signal.aborted) setDetailData(old => ({ ...old, loading: false, error: error.message })); });
    return () => controller.abort();
  }, [session?.userId, detailOpen, detailKey, page, reload, pageSize]);

  const report = remote.report;
  const activeRange = RANGES.find(([, length]) => { const r = rangeOf(length); return r.from === filters.from && r.to === filters.to; })?.[1];
  const filterCount = activeFilterCount({ ...filters, from: "", to: "" }) + (filters.user ? 1 : 0) + (filters.format ? 1 : 0);
  const showDetail = (next, issues = false) => {
    setFocus(next); setOnlyIssues(issues); setPage(1); setDetailOpen(true);
    requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const changeFilters = (next) => { setFilters(next); setFocus(null); setPage(1); setExportState({ busy: false, text: "" }); };

  async function exportDetail() {
    setExportState({ busy: true, text: "" });
    try {
      const current = await getSession({ refresh: true });
      if (current.userId !== session?.userId) throw new Error("身份已变化，请重新打开统计页面。");
      const response = await fetch("/api/v1/operation-events/export", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": current.csrf }, body: JSON.stringify(Object.fromEntries(params({ ...detailFilters, files: "1" }))) });
      if (!response.ok) throw new Error("导出失败，请重试；未生成下载文件。");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `使用统计明细_${filters.from || "全部"}_${filters.to || "至今"}.xlsx`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState({ busy: false, text: "已发起记录导出，请在下载列表确认。" });
    } catch (error) { setExportState({ busy: false, text: error.message }); }
  }

  const span = report?.span ?? 0;
  const totals = report?.totals;
  const prior = (key) => report?.previous ? report.previous[key] : null;
  const change = totals ? percentChange(totals.protected, prior("protected")) : null;
  const summary = report && `近 ${span} 天${admin ? "" : "你"}处理 ${totals.protected} 个任务${change === null ? "" : change === 0 ? `，与前 ${span} 天持平` : `，比前 ${span} 天${change > 0 ? "多" : "少"} ${Math.abs(change)}%`}`;
  const days = report?.days ?? [];
  const buckets = bucketActivity(days, span > 30 ? 7 : 1);
  const activeDays = days.filter((day) => day.protected || day.restored).length;
  const empty = report && !totals.protected && !totals.restored && !totals.failed && !totals.imports && !totals.downloads;

  return <section className="usage-preview" aria-label="使用统计">
    <div className="usage-heading">
      <div className="usage-title"><h1 ref={heading} tabIndex={-1}>使用统计</h1>{session && <span data-scope={admin ? "all" : "own"}>{admin ? "全部人员" : "仅本人"}</span>}</div>
      <button className="secondary-button" type="button" onClick={onBack}>返回文件处理</button>
    </div>
    {session && <p className="usage-scope">{session.userName} · {admin ? "管理员可查看全部人员" : "仅统计本人的记录"} · 按北京时间 · 记录保留 180 天</p>}
    {summary && !empty && <p className="usage-summary">{summary}{report.outcome.attention ? <>；<button type="button" onClick={() => showDetail(null, true)}>{report.outcome.attention} 项需要关注</button></> : "；没有需要关注的异常"}</p>}
    <div className="usage-controls">
      <div className="usage-ranges" role="group" aria-label="时间范围">{RANGES.map(([label, length]) => <button key={length} type="button" aria-pressed={activeRange === length} onClick={() => changeFilters({ ...filters, ...rangeOf(length) })}>{label}</button>)}</div>
      <details className="usage-filters" ref={filtersRef}><summary><FunnelSimple aria-hidden="true" />{filterCount ? `筛选（${filterCount}）` : "筛选"}</summary><RecordFilters value={filters} onChange={changeFilters} users={admin ? knownUsers : undefined} /></details>
    </div>
    {!session ? <p className="usage-empty" role="status">正在确认身份…</p>
      : !range ? <p className="usage-empty" role="status">请选择开始和结束日期，开始日期不能晚于结束日期。</p>
      : remote.error ? <div className="usage-empty" role="alert"><p>{remote.error}</p><button type="button" className="secondary-button" onClick={() => setReload(v => v + 1)}>重新读取</button></div>
      : !report ? <p className="usage-empty" role="status">正在统计…</p>
      : empty ? <p className="usage-empty" role="status">这段时间没有处理记录，可以换一个时间范围。</p> : <>
    <dl className="usage-metrics usage-tiles" data-count={admin ? 4 : 3} aria-busy={remote.loading || undefined}>
      <StatTile primary label="成功脱敏任务" value={totals.protected} delta={compareText(totals.protected, prior("protected"), span)} tone={compareTone(totals.protected, prior("protected"))} trend={days.length >= 21 ? bucketActivity(days.slice(days.length % 7), 7).map((bucket) => bucket.protected) : null} />
      <StatTile label="有还原结果的任务" value={totals.restored} delta={compareText(totals.restored, prior("restored"), span)} tone={compareTone(totals.restored, prior("restored"))} />
      {admin && <StatTile label="使用人数" value={totals.users} delta={compareText(totals.users, prior("users"), span)} tone={compareTone(totals.users, prior("users"))} />}
      <StatTile label="失败操作" value={totals.failed} delta={compareText(totals.failed, prior("failed"), span)} tone={compareTone(totals.failed, prior("failed"), true)} action={totals.failed > 0 && <button type="button" className="usage-tile__link" onClick={() => showDetail({ label: "失败操作", filters: { result: "failed" } })}>查看</button>} />
    </dl>
    <div className="usage-grid" data-people={admin}>
      {activeDays >= MIN_ACTIVE_DAYS ? <TrendChart buckets={buckets} onSelect={(bucket) => { const to = bucket.to ?? bucket.day; showDetail({ label: to === bucket.day ? bucket.label : `${bucket.label} 起一周`, filters: { from: bucket.day, to } }); }} /> : <figure className="usage-trend usage-trend--empty"><figcaption><h2>处理趋势</h2></figcaption><p>累计 {MIN_ACTIVE_DAYS} 天有数据后显示趋势。</p></figure>}
      <OutcomeCard rate={report.outcome.rate} issues={report.outcome.issues} onSelect={(key, label) => showDetail({ label, filters: { result: key } })}
        footer={<p className="usage-satisfaction">{totals.satisfaction === null ? "还没有人评价结果" : <>满意度 <strong>{totals.satisfaction}%</strong><span>满意 {totals.likes} · 不满意 {totals.dislikes}</span></>}</p>} />
      {admin && <RankBars title="活跃用户" unit="个任务" items={report.people} onSelect={(key, label) => showDetail({ label, filters: { user: key } })} />}
      <RankBars title="文件格式" unit="个任务" items={report.formats} onSelect={(key, label) => showDetail({ label: `${label} 文件`, filters: { format: key } })} />
    </div>
    <details ref={detail} className="usage-detail" open={detailOpen} onToggle={(event) => setDetailOpen(event.currentTarget.open)}><summary>操作明细{detailOpen && !detailData.loading ? ` · ${detailData.total} 个任务` : ""}</summary>
      <div className="usage-detail__tools">
        {focus && <button type="button" className="usage-chip" onClick={() => { setFocus(null); setPage(1); }} aria-label={`取消筛选 ${focus.label}`}>{focus.label}<X aria-hidden="true" /></button>}
        <label className="usage-toggle"><input type="checkbox" checked={onlyIssues} onChange={(event) => { setOnlyIssues(event.target.checked); setPage(1); }} />只看异常</label>
        <div className="record-export"><button type="button" className="secondary-button" disabled={!detailData.total || exportState.busy} title="导出的文件名可能包含敏感信息，请妥善保管" onClick={exportDetail}><DownloadSimple size={18} aria-hidden="true" /><span>{exportState.busy ? "正在导出…" : "导出明细"}</span></button><small role="status">{exportState.text}</small></div>
      </div>
      {detailData.error ? <p role="alert">{detailData.error}</p>
        : detailData.loading ? <p role="status">正在读取明细…</p>
        : !detailData.total ? <p role="status">没有符合条件的记录。</p>
        : <TaskTable tasks={detailData.tasks} showUser={admin} />}
      {detailData.total > 0 && <Pagination label="操作明细分页" page={page} total={detailData.total} pageSize={pageSize} unit="个任务" onPage={next => { setPage(next); detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} onPageSize={next => { setPageSize(next); setPage(1); }} />}
    </details>
    </>}
    <details className="usage-notes"><summary>统计口径</summary><dl>{NOTES.filter(([label]) => admin || label !== "使用人数").map(([label, note]) => <div key={label}><dt>{label}</dt><dd>{note}</dd></div>)}</dl></details>
  </section>;
}
