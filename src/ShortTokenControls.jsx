import { useEffect, useRef, useState } from "react";
import { downloadCredentialForTask } from "./taskIdentity.js";
import { recordOperation } from "./operationLog.js";

export function CredentialDownload({ result, taskId, marker, onRequested }) {
  const download = result || null;
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestedUrl = useRef(null);
  useEffect(() => () => { if (requestedUrl.current) URL.revokeObjectURL(requestedUrl.current); }, []);
  useEffect(() => {
    if (!download) return;
    const next = URL.createObjectURL(new Blob([download.buffer], { type: "application/json" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [download]);
  return <div className="credential-download">
    {url ? <a className="secondary-button" href={url} download={download.outputName} onClick={() => { recordOperation("download_credential", "requested", { taskId, marker }); setMessage("已发起下载，请在下载列表确认还原钥匙文件。"); onRequested?.(); }}>下载还原钥匙文件</a>
      : <button className="text-button" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const next = await downloadCredentialForTask(taskId);
          if (requestedUrl.current) URL.revokeObjectURL(requestedUrl.current);
          requestedUrl.current = URL.createObjectURL(new Blob([next.buffer], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = requestedUrl.current;
          link.download = next.outputName;
          document.body.append(link);
          link.click();
          link.remove();
          recordOperation("download_credential", "requested", { taskId, marker });
          setMessage("已发起下载，请在下载列表确认还原钥匙文件。");
          onRequested?.();
        }
        catch (error) { recordOperation("download_credential", "failed", { taskId, marker }); setMessage(error.message); }
        finally { setBusy(false); }
      }}>{busy ? "正在读取还原钥匙文件" : "下载还原钥匙文件"}</button>}
    {message && <small role="status">{message}</small>}
  </div>;
}

export function TokenFormatChoice({ value, onChange }) {
  return <fieldset className="short-token-panel"><legend>代号格式</legend>
    <p>决定替换后的代号长什么样，不改变替换范围。</p>
    <label><input type="radio" name="token-format" checked={value !== "short"} onChange={() => onChange("legacy")} />标准代号（默认）</label>
    <label><input type="radio" name="token-format" checked={value === "short"} onChange={() => onChange("short")} />简短代号（试验）</label>
    {value !== "short" && <small>示例：[[产品名称:P001@7F2A9C4D]]。还原时使用当前浏览器中的还原记录。</small>}
    {value === "short" && <p>示例：产品-K7M4-01。还原时需导入还原钥匙文件并确认配套任务；请让 AI 原样保留代号。</p>}
  </fieldset>;
}

export function CredentialInput({ credential, disabled, required, error, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef(null);
  const open = required || Boolean(credential) || Boolean(error) || expanded;
  return <section className="short-token-panel" aria-label="简短代号还原钥匙文件">
    {!open ? <button className="text-button" type="button" disabled={disabled} onClick={() => setExpanded(true)}>使用简短代号？导入还原钥匙文件</button> : <>
      <p>选择与简短代号配套的还原钥匙文件</p>
      <button className="secondary-button" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>选择还原钥匙文件</button>
      <input ref={inputRef} className="visually-hidden" tabIndex={-1} aria-hidden="true" aria-label="选择还原钥匙文件" type="file" accept=".json" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) onChange(file); event.target.value = ""; }} />
      <small>{credential ? `已导入任务 ${credential.marker} 的还原钥匙文件，还需核对返回文件。` : "标准代号不需要钥匙文件。钥匙文件不是备份，本机还原记录丢失后无法还原。"}</small>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}

export function TaskIdentityDetails({ taskId }) {
  const [notice, setNotice] = useState("");
  return <details className="task-identity-details"><summary>完整任务编号</summary><code>{taskId}</code>
    <button className="text-button" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(taskId); setNotice("任务编号已复制"); }
      catch { setNotice("自动复制失败，请选中上方完整编号手动复制。"); }
    }}>复制任务编号</button><small role="status">{notice}</small>
  </details>;
}

export function PairingConfirmation({ inspection, checked, onChange }) {
  return <section className="short-token-panel" aria-label="确认文件与任务配套">
    <strong>请核对来源任务 · {inspection.marker}</strong>
    <p>{inspection.taskName} · {new Date(inspection.createdAt).toLocaleString("zh-CN")}</p>
    <small>本机任务：{inspection.taskId}</small>
    <p>还原钥匙文件只核验本机任务，不能证明返回文件来自该任务；被改写的代号可能无法识别。</p>
    <label><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />我确认此文件与以上任务配套</label>
  </section>;
}
