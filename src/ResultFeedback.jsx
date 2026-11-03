import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import { submitFeedback } from "./feedbackApi.js";
import { recordOperation } from "./operationLog.js";

// Only files that carry aliases may go to the admin: the protected file, or the file the AI returned.
// The original and the restored file hold real data and are never offered.
function attachableFiles(mode, result, sourceFile) {
  if (mode === "protect") return [{ key: "protected", label: "脱敏版文件", hint: "只含代号", file: () => new File([result.buffer], result.outputName, { type: result.mimeType || "application/octet-stream" }) }];
  return sourceFile ? [{ key: "returned", label: "AI 返回的文件", hint: "只含代号", file: () => sourceFile, name: sourceFile.name }] : [];
}

function FeedbackDialog({ mode, result, sourceFile, summary, onClose }) {
  const dialogRef = useRef(null), fieldRef = useRef(null);
  const options = attachableFiles(mode, result, sourceFile);
  const [content, setContent] = useState("");
  const [picked, setPicked] = useState(() => new Set(options.map(o => o.key)));
  const [state, setState] = useState({ busy: false, error: "" });
  useEffect(() => {
    const previous = document.activeElement;
    fieldRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(false); return; }
      if (event.key !== "Tab") return;
      const focusable = [...dialogRef.current.querySelectorAll("button, textarea, input")].filter(el => !el.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [onClose]);

  async function send(event) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const files = options.filter(o => picked.has(o.key)).map(o => o.file());
      await submitFeedback({ kind: "result", mode, taskId: result.taskId, marker: result.marker, format: result.format, content, context: { summary } }, files);
      recordOperation("submit_feedback", "success", { taskId: result.taskId, marker: result.marker, format: result.format, operationId: result.operationId });
      onClose(true);
    } catch (error) { setState({ busy: false, error: error.message }); }
  }

  return createPortal(<>
    <button className="drawer-scrim confirm-scrim" type="button" tabIndex={-1} onClick={() => onClose(false)} aria-label="取消" />
    <form className="confirm-dialog feedback-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="feedback-dialog-title" onSubmit={send}>
      <h2 id="feedback-dialog-title">哪里不满意？</h2>
      <p>反馈会发给管理员，处理结果会回复到右上角的“反馈”。</p>
      <label className="feedback-dialog__field"><span>问题描述</span><textarea ref={fieldRef} value={content} maxLength={2000} required onChange={e => setContent(e.target.value)} placeholder="例如：客户名称列有几行没有替换" /></label>
      <fieldset className="feedback-dialog__files">
        <legend>一并发送</legend>
        <label className="feedback-dialog__auto"><input type="checkbox" checked disabled /><span>本次检查结果<small>{summary}</small></span></label>
        {options.map(o => <label key={o.key}><input type="checkbox" checked={picked.has(o.key)} onChange={e => setPicked(old => { const next = new Set(old); if (e.target.checked) next.add(o.key); else next.delete(o.key); return next; })} /><span>{o.label}<small>{o.name || result.outputName} · {o.hint}</small></span></label>)}
        <p>原文件和还原后的文件含真实信息，不会发送。</p>
      </fieldset>
      {state.error && <p className="feedback-dialog__error" role="alert">{state.error}</p>}
      <div className="confirm-dialog__actions">
        <button className="secondary-button" type="button" onClick={() => onClose(false)}>取消</button>
        <button className="primary-button primary-button--small" type="submit" disabled={state.busy || !content.trim()}>{state.busy ? "正在发送…" : "发送反馈"}</button>
      </div>
    </form>
  </>, document.body);
}

// "Was this result OK?" under a finished protect or restore. A thumbs-down opens the feedback dialog.
export default function ResultFeedback({ mode, result, sourceFile, summary }) {
  const [choice, setChoice] = useState(null);
  const [dialog, setDialog] = useState(false);
  const [sent, setSent] = useState(false);
  const rate = value => {
    setChoice(value);
    recordOperation(value === "up" ? "rate_up" : "rate_down", "success", { taskId: result.taskId, marker: result.marker, format: result.format, operationId: result.operationId });
    if (value === "down") setDialog(true);
  };
  return <div className="result-feedback">
    <span>{sent ? "已收到反馈，管理员处理后会回复你。" : choice === "up" ? "感谢反馈。" : "这次结果满意吗？"}</span>
    <div role="group" aria-label="结果评价">
      <button type="button" aria-pressed={choice === "up"} title="满意" onClick={() => rate("up")}><ThumbsUp weight={choice === "up" ? "fill" : "bold"} aria-hidden="true" /><span>满意</span></button>
      <button type="button" aria-pressed={choice === "down"} title="不满意" onClick={() => rate("down")}><ThumbsDown weight={choice === "down" ? "fill" : "bold"} aria-hidden="true" /><span>不满意</span></button>
    </div>
    {dialog && <FeedbackDialog mode={mode} result={result} sourceFile={sourceFile} summary={summary} onClose={ok => { setDialog(false); if (ok) setSent(true); }} />}
  </div>;
}
