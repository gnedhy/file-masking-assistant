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
    <p>清除浏览器数据可能丢失映射；持久保存不是备份。</p>
    {lowSpace && <p role="alert">本站存储接近配额。请先处理无需保留的任务；不要直接清除全部浏览器数据。</p>}
    {state.status === "ready" && state.persisted !== true && navigator.storage?.persist && <button className="secondary-button" type="button" disabled={requesting} onClick={requestPersistence}>{requesting ? "正在申请" : "申请持久保存"}</button>}
    <details><summary>保存方式与限制</summary>
      <p>固定使用 http://127.0.0.1:5174/ 和同一浏览器。在右侧内置浏览器生成的任务，不会自动出现在 Chrome、Edge、其他浏览器配置或地址中。</p>
      <p>映射以 AES-GCM 加密保存在浏览器 IndexedDB，解密密钥也由同一浏览器保存，不是独立硬件密钥库。</p>
      <p>任务名来自原文件名；任务名、编号、时间和映射数量等摘要未加密。请避免在原文件名中包含敏感信息。</p>
      <p>脱敏文件、还原文件和 JSON 凭据只有点击下载后才发起保存到磁盘；JSON 凭据不包含映射，不能用于恢复丢失的映射。</p>
      <p>持久保存可降低自动清理风险，但不是备份。清除本站浏览器数据或使用隐私窗口，仍可能丢失映射；请保留原文件。</p>
      <small>{capacityKnown ? `本站存储估算：已用 ${(estimate.usage / 1048576).toFixed(1)} MB / 配额 ${(estimate.quota / 1048576).toFixed(1)} MB（不是磁盘剩余空间）` : "暂时无法取得存储容量估算；不代表存储不可用。"}</small>
    </details>
    <p role="status">{notice}</p>
  </section>;
}
