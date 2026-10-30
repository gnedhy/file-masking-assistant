import { useEffect, useState } from "react";

export function StorageStatus() {
  const [estimate, setEstimate] = useState(null);

  useEffect(() => {
    let active = true;
    navigator.storage?.estimate?.().then(result => { if (active) setEstimate(result); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const capacityKnown = Number.isFinite(estimate?.usage) && Number.isFinite(estimate?.quota) && estimate.quota > 0;
  if (!capacityKnown || estimate.usage / estimate.quota < 0.9) return null;
  return <p className="storage-status" role="alert">本站存储接近配额。请先处理无需保留的任务；不要直接清除全部浏览器数据。</p>;
}
