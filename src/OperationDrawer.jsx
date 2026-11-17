import { useState } from "react";
import { ChartBar, X } from "@phosphor-icons/react";
import CentralOperations, { useOperationSync, SyncStatus } from "./CentralOperations.jsx";

export function OperationDrawer({ drawerRef, closeButtonRef, onClose, onPreview }) {
  const sync = useOperationSync();
  // The pagination renders into this footer, so it stays at the bottom of the drawer.
  const [foot, setFoot] = useState(null);
  return <aside className="security-drawer operation-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="operation-title">
    <div className="drawer-head">
      <div><h2 id="operation-title">操作记录</h2><p>{sync.session ? `${sync.session.userName} · 只记录操作和文件名` : "正在确认身份"}</p></div>
      <div className="drawer-head__actions">
        {/* Everyone gets statistics; the server limits ordinary users to their own records. */}
        {sync.session && <button className="drawer-stats-button" type="button" title={sync.session.isAdmin ? "查看全部人员的使用统计" : "查看本人的使用统计"} onClick={() => onPreview("stats")}><ChartBar aria-hidden="true" weight="bold" />使用统计</button>}
        <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭操作记录"><X /></button>
      </div>
    </div>
    <div className="drawer-body">
      {sync.session ? <CentralOperations compact footTarget={foot} /> : <SyncStatus />}
    </div>
    <div className="drawer-foot drawer-foot--pager" ref={setFoot} />
  </aside>;
}
