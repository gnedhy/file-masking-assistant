import { useEffect, useRef, useState } from "react";
import { RecordFilters, RecordList, RecordFilename, ExportRecords } from "./OperationViews.jsx";
import { filterOperations, localDay, summarizeOperations } from "./operationReports.js";
import { OPERATION_LABELS, OPERATION_RESULTS } from "./operationLog.js";

export function createExampleRecords(now = new Date()) {
  const rows = [];
  const add = (user, day, task, action, result, format = "xlsx") => rows.push({ id: rows.length + 1, userId: `example-${user}`, userName: `示例员工${user}`, taskId: `DEMO000${task}`, time: new Date(new Date(now).setDate(now.getDate() - day)).toISOString(), action, result, format,
    inputName: `示例_业务文件_${task}.${format}`, outputName: ["protect", "restore", "download_protect", "download_restore"].includes(action) ? `示例_处理结果_${task}.${format}` : undefined });
  for (const [user, task, day] of [["甲",1,2],["乙",2,5],["丙",3,10]]) {
    add(user,day,task,"import_protect","requested"); add(user,day,task,"protect","success"); add(user,day,task,"download_protect","requested");
  }
  add("甲",1,1,"import_restore","requested","docx"); add("甲",1,1,"restore","success","docx");
  add("甲",1,1,"download_restore","requested","docx"); add("甲",1,1,"download_restore","requested","docx");
  add("甲",0,1,"restore","missing","pptx"); add("乙",3,2,"restore","partial","html");
  add("丙",2,3,"inspect_restore","waiting"); add("丙",1,3,"inspect_restore","failed");
  add("甲",45,4,"protect","success","txt");
  return rows.sort((a,b) => b.time.localeCompare(a.time) || b.id-a.id);
}
export default function UsagePreview({ onBack }) {
  const [records] = useState(() => createExampleRecords());
  const [filters, setFilters] = useState(() => { const from = new Date(); from.setDate(from.getDate()-29); return { from: localDay(from), to: localDay(new Date()) }; });
  const heading = useRef(null);
  const [page, setPage] = useState(1);
  useEffect(() => { heading.current?.focus(); }, []);
  const users = [...new Map(records.map(r => [r.userId, { id:r.userId, name:r.userName }])).values()];
  const filtered = filterOperations(records, filters);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const pageRecords = filtered.slice((page - 1) * 10, page * 10);
  const totals = summarizeOperations(filtered);
  return <section className="usage-preview" aria-label="使用统计设计预览">
    <div className="usage-heading"><div><h1 ref={heading} tabIndex={-1}>使用统计 <small>设计预览</small></h1><p>管理员视图 · 仅用于确认布局和统计口径</p></div><button type="button" className="secondary-button" onClick={onBack}>返回文件处理</button></div>
    <p className="usage-example-notice" role="note"><strong>示例数据</strong><span>尚未接入企业身份和全员记录；不读取本机任务。</span></p>
    <RecordFilters value={filters} onChange={next => { setFilters(next); setPage(1); }} users={users} />
    <dl className="usage-metrics">{[
      ["使用人数",totals.users,"所选范围内有业务文件操作的用户，同一人只计一次。"],
      ["成功脱敏任务",totals.protected,"按用户与任务编号去重，仅计成功生成脱敏文件的任务。"],
      ["有还原结果的任务",totals.restored,"同一任务多次还原只计一次，包含部分还原与内容缺失。没有还原记录不等于失败。"],
      ["失败操作",totals.failed,"按未完成的操作计次；部分还原、内容缺失和待导入钥匙文件不计为失败。"]
    ].map(([label,value,note]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><details className="metric-help"><summary aria-label={`${label}统计说明`}>ⓘ <span>统计说明</span></summary><p>{note}</p></details></div>)}</dl>
    <section><h2>按用户汇总</h2><p className="operation-scope">导入仅计实际选文件；下载请求不代表已保存文件或交给 AI。</p><div className="usage-user-grid">{users.filter(u => filtered.some(r => r.userId===u.id)).map(u => { const s=summarizeOperations(filtered.filter(r=>r.userId===u.id)); return <article key={u.id}><h3>{u.name}</h3><p>脱敏任务 {s.protected} · 还原任务 {s.restored}</p><p>导入 {s.imports} 次 · 下载请求 {s.downloads} 次 · 失败 {s.failed} 次</p></article>; })}</div></section>
    <section><div className="usage-heading"><h2>操作明细 · {filtered.length} 条</h2><ExportRecords records={filtered} example /></div>
    {!filtered.length ? <p role="status">没有符合筛选条件的示例记录。</p> : <><div className="usage-table"><table><thead><tr>{["用户 / 时间","任务","输入 / 输出文件","格式","操作","结果"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{pageRecords.map(r=><tr key={r.id}><td>{r.userName}<small>{new Date(r.time).toLocaleString("zh-CN")}</small></td><td>{r.taskId}</td><td><RecordFilename label="输入" name={r.inputName}/><RecordFilename label="输出" name={r.outputName}/></td><td>{r.format.toUpperCase()}</td><td>{OPERATION_LABELS[r.action]}</td><td>{OPERATION_RESULTS[r.result]}</td></tr>)}</tbody></table></div><div className="usage-mobile"><RecordList records={pageRecords}/></div></>}
    {filtered.length > 0 && <nav className="record-pagination" aria-label="操作明细分页"><span role="status">第 {page} / {pageCount} 页 · 共 {filtered.length} 条</span><div><button type="button" className="secondary-button" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><button type="button" className="secondary-button" disabled={page === pageCount} onClick={() => setPage(page + 1)}>下一页</button></div></nav>}
    </section>
  </section>;
}
