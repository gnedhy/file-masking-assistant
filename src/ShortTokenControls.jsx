import { useState } from "react";

export function TaskIdentityDetails({ taskId }) {
  const [notice, setNotice] = useState("");
  return <details className="task-identity-details"><summary>完整任务编号</summary><code>{taskId}</code>
    <button className="text-button" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(taskId); setNotice("任务编号已复制"); }
      catch { setNotice("自动复制失败，请选中上方完整编号手动复制。"); }
    }}>复制任务编号</button><small role="status">{notice}</small>
  </details>;
}
