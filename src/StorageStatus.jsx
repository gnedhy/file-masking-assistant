import { useEffect, useState } from "react";

export function StorageStatus() {
  const [state, setState] = useState({ status: "loading" });
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState("");

  async function inspect() {
    const storage = navigator.storage;
    const [persisted, estimate] = await Promise.all([
      storage?.persisted ? storage.persisted().catch(() => null) : null,
      storage?.estimate ? storage.estimate().catch(() => null) : null,
    ]);
    return { status: "ready", persisted, estimate };
  }

  useEffect(() => {
    let active = true;
    inspect().then(result => { if (active) setState(result); });
    return () => { active = false; };
  }, []);

  async function requestPersistence() {
    setRequesting(true);
    try {
      const granted = await navigator.storage.persist();
      setState(await inspect());
      setNotice(granted ? "浏览器已允许持久保存。" : "浏览器暂未批准；现有任务仍保留，但可能被自动清理。");
    } catch {
      setNotice("申请未完成，现有任务未改动。请检查浏览器设置后重试。");
    } finally { setRequesting(false); }
  }

  const estimate = state.estimate;
  const capacityKnown = Number.isFinite(estimate?.usage) && Number.isFinite(estimate?.quota) && estimate.quota > 0;
  const lowSpace = capacityKnown && estimate.usage / estimate.quota >= 0.9;
  return <section className="storage-status" aria-label="本机存储状态">
    <strong>{state.status === "loading" ? "正在检查保存状态" : state.persisted === true ? "已获准持久保存" : state.persisted === false ? "尚未获准持久保存" : "浏览器未提供持久保存状态"}</strong>
    <p>清除浏览器数据会丢失还原记录；持久保存不是备份。</p>
    {lowSpace && <p role="alert">本站存储接近配额。请先处理无需保留的任务；不要直接清除全部浏览器数据。</p>}
    {state.status === "ready" && state.persisted !== true && navigator.storage?.persist && <button className="secondary-button" type="button" disabled={requesting} onClick={requestPersistence}>{requesting ? "正在申请" : "申请持久保存"}</button>}
    <details><summary>保存方式与限制</summary>
      <ul>
        <li>只在当前地址（{window.location.origin}）和当前浏览器可用，换浏览器或地址看不到这些任务。</li>
        <li>持久保存只降低自动清理的风险，不是备份；清除浏览器数据或使用隐私窗口会丢失记录，请保留原文件。</li>
        <li>任务名取自原文件名且不加密，请避免在文件名中写敏感信息。</li>
      </ul>
      <p>技术细节：还原记录以 AES-GCM 加密保存在 IndexedDB，密钥由同一浏览器保存；还原钥匙文件不含还原记录，不能用来恢复。</p>
      <small>{capacityKnown ? `本站存储估算：已用 ${(estimate.usage / 1048576).toFixed(1)} MB / 配额 ${(estimate.quota / 1048576).toFixed(1)} MB（不是磁盘剩余空间）` : "暂时无法取得存储容量估算；不代表存储不可用。"}</small>
    </details>
    <p role="status">{notice}</p>
  </section>;
}
