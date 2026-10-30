import { useEffect, useRef, useState } from "react";
import { RecordFilters, RecordList, RecordFilename, ExportRecords, activeFilterCount } from "./OperationViews.jsx";
import { ArrowLeft, FunnelSimple, X } from "@phosphor-icons/react";
import { ISSUE_RESULTS, bucketActivity, dailyActivity, filterOperations, localDay, outcomeSummary, rankBy, summarizeOperations } from "./operationReports.js";
import { OPERATION_LABELS, OPERATION_RESULTS } from "./operationLog.js";
import { OutcomeCard, RankBars, StatTile, TrendChart } from "./UsageCharts.jsx";

// Fictional and deterministic, so the preview reads the same on every open.
export function createExampleRecords(now = new Date()) {
  const rows = [];
  const users = ["甲", "乙", "丙", "丁", "戊", "己"];
  const formats = ["xlsx", "docx", "xlsx", "csv", "xlsx", "docx", "xlsx", "txt", "csv", "xlsx", "pptx", "docx", "md"];
  let task = 0;
  const add = (user, day, id, action, result, format) => rows.push({ id: rows.length + 1, userId: `example-${user}`, userName: `示例员工${user}`, taskId: `DEMO${String(id).padStart(4, "0")}`, time: new Date(new Date(now).setDate(now.getDate() - day)).toISOString(), action, result, format,
    inputName: `示例_业务文件_${id}.${format}`, outputName: ["protect", "restore", "download_protect", "download_restore"].includes(action) ? `示例_处理结果_${id}.${format}` : undefined });
  for (let day = 59; day >= 0; day--) {
    const weekday = new Date(new Date(now).setDate(now.getDate() - day)).getDay();
    const count = weekday === 0 || weekday === 6 ? day % 3 === 0 ? 1 : 0 : 2 + ((day * 7) % 5) + (day < 25 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      task += 1;
      const user = users[[0, 0, 1, 1, 2, 3, 4, 0, 5, 1][(task * 3) % 10]];
      const format = formats[task % formats.length];
      add(user, day, task, "import_protect", "requested", format);
      if (task % 17 === 0) { add(user, day, task, "inspect_protect", "failed", format); continue; }
      add(user, day, task, "protect", "success", format);
      add(user, day, task, "download_protect", "requested", format);
      if (task % 4 === 0) continue;
      const later = Math.max(0, day - (task % 3));
      if (task % 13 === 0) { add(user, later, task, "inspect_restore", "waiting", format); continue; }
      add(user, later, task, "import_restore", "requested", format);
      add(user, later, task, "restore", task % 11 === 0 ? "partial" : task % 19 === 0 ? "missing" : "success", format);
      add(user, later, task, "download_restore", "requested", format);
    }
  }
  return rows.sort((a, b) => b.time.localeCompare(a.time) || b.id - a.id);
}

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

export default function UsagePreview({ onBack }) {
  const [records] = useState(() => createExampleRecords());
  const [filters, setFilters] = useState(() => rangeOf(30));
  const [focus, setFocus] = useState(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const heading = useRef(null);
  const detail = useRef(null);
  const [page, setPage] = useState(1);
  useEffect(() => { heading.current?.focus(); }, []);
  const users = [...new Map(records.map(r => [r.userId, { id:r.userId, name:r.userName }])).values()];
  const filtered = filterOperations(records, filters);
  const detailRecords = filtered.filter((r) => (!focus || focus.test(r)) && (!onlyIssues || ISSUE_RESULTS.includes(r.result)));
  const pageCount = Math.max(1, Math.ceil(detailRecords.length / 10));
  const pageRecords = detailRecords.slice((page - 1) * 10, page * 10);
  const totals = summarizeOperations(filtered);
  const outcome = outcomeSummary(filtered);
  const span = filters.from && filters.to ? Math.round((new Date(filters.to) - new Date(filters.from)) / 86400000) + 1 : 0;
  const before = (date, offset) => { const value = new Date(`${date}T00:00:00`); value.setDate(value.getDate() - offset); return localDay(value); };
  const previous = span > 0 ? summarizeOperations(filterOperations(records, { ...filters, from: before(filters.from, span), to: before(filters.from, 1) })) : null;
  const days = span > 0 ? dailyActivity(filtered, filters.from, filters.to) : [];
  const buckets = bucketActivity(days, span > 30 ? 7 : 1);
  const activeDays = days.filter((day) => day.protected || day.restored).length;
  const activeRange = RANGES.find(([, length]) => { const range = rangeOf(length); return range.from === filters.from && range.to === filters.to; })?.[1];
  const filterCount = activeFilterCount({ ...filters, from: "", to: "" }) + (filters.user ? 1 : 0) + (filters.format ? 1 : 0);
  const prior = (key) => previous ? previous[key] : null;
  const change = percentChange(totals.protected, prior("protected"));
  const summary = `${span ? `近 ${span} 天` : "所选范围内"}处理 ${totals.protected} 个任务${change === null ? "" : change === 0 ? `，与前 ${span} 天持平` : `，比前 ${span} 天${change > 0 ? "多" : "少"} ${Math.abs(change)}%`}`;
  const showDetail = (next, issues = false) => {
    setFocus(next); setOnlyIssues(issues); setPage(1); setDetailOpen(true);
    requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const changeFilters = (next) => { setFilters(next); setFocus(null); setPage(1); };
  return <section className="usage-preview" aria-label="使用统计设计预览">
    <button type="button" className="usage-back" onClick={onBack}><ArrowLeft aria-hidden="true" />返回文件处理</button>
    <div className="usage-title"><h1 ref={heading} tabIndex={-1}>使用统计</h1><span>示例数据</span></div>
    <p className="usage-summary">{summary}{outcome.attention ? <>；<button type="button" onClick={() => showDetail(null, true)}>{outcome.attention} 项需要关注</button></> : "；没有需要关注的异常"}</p>
    <div className="usage-controls">
      <div className="usage-ranges" role="group" aria-label="时间范围">{RANGES.map(([label, length]) => <button key={length} type="button" aria-pressed={activeRange === length} onClick={() => changeFilters({ ...filters, ...rangeOf(length) })}>{label}</button>)}</div>
      <details className="usage-filters"><summary><FunnelSimple aria-hidden="true" />{filterCount ? `筛选（${filterCount}）` : "筛选"}</summary><RecordFilters value={filters} onChange={changeFilters} users={users} /></details>
    </div>
    {!filtered.length ? <p className="usage-empty" role="status">这段时间没有处理记录，可以换一个时间范围。</p> : <>
    <dl className="usage-metrics usage-tiles">
      <StatTile primary label="成功脱敏任务" value={totals.protected} delta={compareText(totals.protected, prior("protected"), span)} tone={compareTone(totals.protected, prior("protected"))} trend={days.length >= 21 ? bucketActivity(days.slice(days.length % 7), 7).map((bucket) => bucket.protected) : null} />
      <StatTile label="有还原结果的任务" value={totals.restored} delta={compareText(totals.restored, prior("restored"), span)} tone={compareTone(totals.restored, prior("restored"))} />
      <StatTile label="使用人数" value={totals.users} delta={compareText(totals.users, prior("users"), span)} tone={compareTone(totals.users, prior("users"))} />
      <StatTile label="失败操作" value={totals.failed} delta={compareText(totals.failed, prior("failed"), span)} tone={compareTone(totals.failed, prior("failed"), true)} action={totals.failed > 0 && <button type="button" className="usage-tile__link" onClick={() => showDetail({ label: "失败操作", test: (r) => r.result === "failed" })}>查看</button>} />
    </dl>
    <div className="usage-grid">
      {activeDays >= MIN_ACTIVE_DAYS ? <TrendChart buckets={buckets} onSelect={(bucket) => { const to = bucket.to ?? bucket.day; showDetail({ label: to === bucket.day ? bucket.label : `${bucket.label} 起一周`, test: (r) => localDay(r.time) >= bucket.day && localDay(r.time) <= to }); }} /> : <figure className="usage-trend usage-trend--empty"><figcaption><h2>处理趋势</h2></figcaption><p>累计 {MIN_ACTIVE_DAYS} 天有数据后显示趋势。</p></figure>}
      <OutcomeCard rate={outcome.rate} issues={outcome.issues} onSelect={(key, label) => showDetail({ label, test: (r) => r.result === key })} />
      <RankBars title="活跃用户" unit="个任务" items={rankBy(filtered, (r) => r.userId, (r) => r.userName)} onSelect={(key, label) => showDetail({ label, test: (r) => r.userId === key })} />
      <RankBars title="文件格式" unit="个任务" items={rankBy(filtered, (r) => r.format, (r) => r.format.toUpperCase())} onSelect={(key, label) => showDetail({ label: `${label} 文件`, test: (r) => r.format === key })} />
    </div>
    <details ref={detail} className="usage-detail" open={detailOpen} onToggle={(event) => setDetailOpen(event.currentTarget.open)}><summary>操作明细 · {detailRecords.length} 条</summary>
      <div className="usage-detail__tools">
        {focus && <button type="button" className="usage-chip" onClick={() => { setFocus(null); setPage(1); }} aria-label={`取消筛选 ${focus.label}`}>{focus.label}<X aria-hidden="true" /></button>}
        <label className="usage-toggle"><input type="checkbox" checked={onlyIssues} onChange={(event) => { setOnlyIssues(event.target.checked); setPage(1); }} />只看异常</label>
        <ExportRecords records={detailRecords} example />
      </div>
      {!detailRecords.length ? <p role="status">没有符合条件的示例记录。</p> : <><div className="usage-table"><table><thead><tr>{["用户 / 时间","任务","输入 / 输出文件","格式","操作","结果"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{pageRecords.map(r=><tr key={r.id}><td>{r.userName}<small>{new Date(r.time).toLocaleString("zh-CN")}</small></td><td>{r.taskId}</td><td><RecordFilename label="输入" name={r.inputName}/><RecordFilename label="输出" name={r.outputName}/></td><td>{r.format.toUpperCase()}</td><td>{OPERATION_LABELS[r.action]}</td><td>{OPERATION_RESULTS[r.result]}</td></tr>)}</tbody></table></div><div className="usage-mobile"><RecordList records={pageRecords}/></div></>}
      {detailRecords.length > 0 && <nav className="record-pagination" aria-label="操作明细分页"><span role="status">第 {page} / {pageCount} 页 · 共 {detailRecords.length} 条</span><div><button type="button" className="secondary-button" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><button type="button" className="secondary-button" disabled={page === pageCount} onClick={() => setPage(page + 1)}>下一页</button></div></nav>}
    </details>
    </>}
    <details className="usage-notes"><summary>统计口径</summary><dl>{NOTES.map(([label, note]) => <div key={label}><dt>{label}</dt><dd>{note}</dd></div>)}</dl></details>
  </section>;
}
