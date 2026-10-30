import { useEffect, useState } from "react";
import { X, ClockCounterClockwise } from "@phosphor-icons/react";
import { hasOperationWriteFailure, listOperations } from "./operationLog.js";
import { RecordFilters, RecordList, ExportRecords } from "./OperationViews.jsx";
import { filterOperations } from "./operationReports.js";
import CentralOperations, { useOperationSync, SyncStatus } from "./CentralOperations.jsx";

export function OperationDrawer({ drawerRef, closeButtonRef, onClose, onPreview }) {
  const sync = useOperationSync();
  const [filters, setFilters] = useState({});
  const [state, setState] = useState({ loading: true, records: [], error: false });
  const [incomplete, setIncomplete] = useState(hasOperationWriteFailure);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = async () => {
      const current = ++sequence;
      try {
        const records = await listOperations();
        if (active && current === sequence) setState({ loading: false, records, error: false });
      } catch {
        if (active && current === sequence) setState({ loading: false, records: [], error: true });
      }
      if (active) setIncomplete(hasOperationWriteFailure());
    };
    refresh();
    window.addEventListener("operation-log-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("operation-log-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  const filtered = filterOperations(state.records, filters);
  return <aside className="security-drawer operation-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="operation-title">
    <div className="drawer-head"><div><h2 id="operation-title">操作记录</h2><p>{sync.session ? "我的记录 · 已识别测试身份" : "本机记录 · 尚未登录"}</p></div><button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭操作记录"><X /></button></div>
    <div className="drawer-body">
      {sync.session ? <>{sync.session.isAdmin && <button className="operation-preview-entry" type="button" onClick={() => onPreview("central")}>使用统计<span aria-hidden="true">→</span></button>}<CentralOperations compact /></> : <>
      <SyncStatus />
      <p className="operation-scope">最近 500 条 · 仅当前浏览器<br/>包含文件名，不记录正文、映射或凭据内容。</p>
      {import.meta.env.DEV && <button className="operation-preview-entry" type="button" onClick={() => onPreview("example")}><span>使用统计 · 设计预览<small>查看虚构示例，不读取本机任务</small></span><span aria-hidden="true">→</span></button>}
      <RecordFilters value={filters} onChange={setFilters}/>
      {!state.loading && !state.error && <div className="record-toolbar"><p className="operation-scope">符合条件 {filtered.length} 条</p><ExportRecords records={filtered}/></div>}
      {incomplete && <p className="drawer-note drawer-note--warning" role="alert">本次使用中有操作记录未能保存，列表可能不完整；文件处理结果不受此提示影响。</p>}
      {state.loading ? <p role="status">正在读取操作记录…</p> : state.error ? <p role="alert">无法读取本机操作记录，请关闭后重试。已有映射未改动。</p> : !state.records.length ? <div className="operation-empty"><ClockCounterClockwise size={32} /><strong>暂无操作记录</strong><p>检查文件或生成文件后，记录会出现在这里。旧操作不会补记。</p></div> : !filtered.length ? <p role="status">没有符合筛选条件的记录。</p> : <RecordList records={filtered}/>}
      <details className="operation-boundary"><summary>记录的保存方式与限制</summary><p>文件名可能含敏感信息。记录仅保存在当前浏览器，清除浏览器数据会丢失；不具备防篡改或企业合规审计能力。“已发起”不代表文件已保存到磁盘。</p></details>
      </>}
    </div>
  </aside>;
}
