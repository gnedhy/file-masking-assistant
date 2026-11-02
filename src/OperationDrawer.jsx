import { X } from "@phosphor-icons/react";
import CentralOperations, { useOperationSync, SyncStatus } from "./CentralOperations.jsx";

export function OperationDrawer({ drawerRef, closeButtonRef, onClose, onPreview }) {
  const sync = useOperationSync();
  // Admins open the real statistics; development builds can open the fictional preview instead.
  const stats = sync.session?.isAdmin
    ? { view: "central", label: "使用统计", title: "查看全部人员的使用统计" }
    : import.meta.env.DEV ? { view: "example", label: "统计预览", title: "虚构示例，仅开发环境显示" } : null;
  return <aside className="security-drawer operation-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="operation-title">
    <div className="drawer-head">
      <div><h2 id="operation-title">操作记录</h2><p>{sync.session ? `${sync.session.userName} · 只记录操作和文件名` : "正在确认身份"}</p></div>
      <div className="drawer-head__actions">
        {stats && <button className="text-button drawer-head__link" type="button" title={stats.title} onClick={() => onPreview(stats.view)}>{stats.label}<span aria-hidden="true">→</span></button>}
        <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭操作记录"><X /></button>
      </div>
    </div>
    <div className="drawer-body">
      {sync.session ? <CentralOperations compact /> : <SyncStatus />}
    </div>
  </aside>;
}
