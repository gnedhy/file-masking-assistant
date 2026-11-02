import { X } from "@phosphor-icons/react";
import CentralOperations, { useOperationSync, SyncStatus } from "./CentralOperations.jsx";

export function OperationDrawer({ drawerRef, closeButtonRef, onClose, onPreview }) {
  const sync = useOperationSync();
  return <aside className="security-drawer operation-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="operation-title">
    <div className="drawer-head"><div><h2 id="operation-title">操作记录</h2><p>{sync.session ? `${sync.session.userName} · 只记录操作和文件名` : "正在确认身份"}</p></div><button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭操作记录"><X /></button></div>
    <div className="drawer-body">
      {sync.session ? <>{sync.session.isAdmin && <button className="operation-preview-entry" type="button" onClick={() => onPreview("central")}>使用统计<span aria-hidden="true">→</span></button>}<CentralOperations compact /></> : <SyncStatus />}
      {import.meta.env.DEV && <button className="operation-preview-entry" type="button" onClick={() => onPreview("example")}><span>使用统计 · 设计预览<small>查看虚构示例，仅开发环境显示</small></span><span aria-hidden="true">→</span></button>}
    </div>
  </aside>;
}
