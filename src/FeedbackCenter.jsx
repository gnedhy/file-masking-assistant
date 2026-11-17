import { useEffect, useRef, useState } from "react";
import { Paperclip } from "@phosphor-icons/react";
import { feedbackRequest, notifyFeedbackChanged, submitFeedback } from "./feedbackApi.js";
import { recordOperation } from "./operationLog.js";

const formatTime = value => new Date(value).toLocaleString("zh-CN", { hour12: false }).slice(0, -3);
const kindLabel = item => item.kind === "usage" ? "使用反馈" : `结果反馈 · ${item.mode === "protect" ? "脱敏" : "还原"}`;
const formatSize = size => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

function FeedbackItem({ item, admin, onResolved }) {
  const [reply, setReply] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  async function resolve(event) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      await feedbackRequest(`/api/v1/feedback/${item.id}/resolve`, { method: "POST", json: { reply } });
      recordOperation("resolve_feedback", "success");
      notifyFeedbackChanged();
      onResolved();
    } catch (error) { setState({ busy: false, error: error.message }); }
  }
  const fresh = !admin && item.status === "resolved" && !item.replySeen;
  return <li className="feedback-item" data-status={item.status} data-fresh={fresh || undefined}>
    <div className="feedback-item__head">
      <span className="feedback-pill" data-kind={item.kind}>{kindLabel(item)}</span>
      <span className="feedback-status" data-status={item.status}>{item.status === "open" ? "待处理" : "已处理"}</span>
      <small>{admin ? `${item.ownerName} · ` : ""}{formatTime(item.createdAt)}</small>
    </div>
    <p className="feedback-item__content">{item.content}</p>
    {(item.marker || item.taskId || item.format || item.context?.summary) && <p className="feedback-item__meta">{[item.marker || item.taskId?.slice(0, 8) ? `任务 ${item.marker || item.taskId.slice(0, 8)}` : "", item.format?.toUpperCase(), item.context?.summary].filter(Boolean).join(" · ")}</p>}
    {admin && item.attachments.length > 0 && <ul className="feedback-attachments">{item.attachments.map(file => <li key={file.index}><a href={`/api/v1/feedback/${item.id}/attachments/${file.index}`} download={file.name}><Paperclip aria-hidden="true" weight="bold" />{file.name}</a><small>{formatSize(file.size)}</small></li>)}</ul>}
    {!admin && item.attachments.length > 0 && <p className="feedback-item__meta">已附 {item.attachments.length} 个文件</p>}
    {item.status === "resolved"
      ? <div className="feedback-reply"><strong>{fresh ? "新回复 · " : ""}{item.resolvedName} 的处理结果</strong><p>{item.reply}</p><small>{formatTime(item.resolvedAt)}</small></div>
      : admin && <form className="feedback-resolve" onSubmit={resolve}>
        <label><span>处理结果（会发给 {item.ownerName}）</span><textarea value={reply} maxLength={2000} required onChange={event => setReply(event.target.value)} placeholder="例如：已修复，下个版本生效；或说明处理方式" /></label>
        {state.error && <p role="alert">{state.error}</p>}
        <button className="access-action" type="submit" disabled={state.busy || !reply.trim()}>{state.busy ? "正在提交…" : "标记为已处理"}</button>
      </form>}
  </li>;
}

export default function FeedbackCenter({ admin, onBack }) {
  const heading = useRef(null);
  const [tab, setTab] = useState(admin ? "open" : "mine");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let alive = true;
    setError("");
    feedbackRequest(`/api/v1/feedback${admin ? `?status=${tab}` : ""}`).then(async ({ items: next }) => {
      if (!alive) return;
      setItems(next);
      // Opening the page counts as reading the replies: highlight them this time, clear the badge for next time.
      const unseen = admin ? [] : next.filter(item => item.status === "resolved" && !item.replySeen);
      if (unseen.length) { await Promise.all(unseen.map(item => feedbackRequest(`/api/v1/feedback/${item.id}/seen`, { method: "POST" }).catch(() => {}))); notifyFeedbackChanged(); }
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [admin, tab, reload]);

  async function send(event) {
    event.preventDefault();
    setSending(true); setNotice(""); setError("");
    try {
      await submitFeedback({ kind: "usage", content: draft });
      recordOperation("submit_feedback", "success");
      setDraft(""); setNotice("反馈已发送给管理员，处理后会在这里回复你。"); setReload(v => v + 1);
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  return <section className="usage-preview access-settings feedback-center" aria-label="反馈">
    <div className="usage-heading"><h1 ref={heading} tabIndex={-1}>{admin ? "反馈处理" : "反馈"}</h1><button className="secondary-button" type="button" onClick={onBack}>返回文件处理</button></div>
    <p className="access-intro">{admin ? "员工提交的使用反馈和结果反馈。处理后，处理结果会回复给提交人；未处理的数量显示在右上角的反馈按钮上。" : "遇到问题或有建议都可以告诉管理员。处理结果会回复到这里，右上角的反馈按钮会提示新回复。"}</p>
    {error && <p className="access-message" role="alert">{error}</p>}
    {notice && !error && <p className="access-message access-message--ok" role="status">{notice}</p>}
    <div className="feedback-layout">
      {!admin && <form className="access-card feedback-compose" onSubmit={send}>
        <h2>提交反馈</h2>
        <label><span>遇到的问题或建议</span><textarea value={draft} maxLength={2000} required onChange={event => setDraft(event.target.value)} placeholder="例如：Word 文件里的表格没有被替换" /></label>
        <div className="feedback-compose__foot"><small>{draft.length} / 2000 · 请不要填写真实客户信息</small><button className="access-action access-action--primary" type="submit" disabled={sending || !draft.trim()}>{sending ? "正在发送…" : "发送给管理员"}</button></div>
      </form>}
      <section className="access-card feedback-list-card" aria-labelledby="feedback-list-title">
        <div className="access-card__head">
          <h2 id="feedback-list-title">{admin ? "反馈列表" : "我的反馈"}</h2>
          {admin && <div className="usage-ranges" role="group" aria-label="处理状态">{[["open", "待处理"], ["resolved", "已处理"]].map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => { setItems(null); setTab(key); }}>{label}</button>)}</div>}
        </div>
        {!items ? !error && <p className="access-empty" role="status">正在读取反馈…</p>
          : !items.length ? <p className="access-empty" role="status">{admin ? tab === "open" ? "没有待处理的反馈。" : "还没有处理过的反馈。" : "你还没有提交过反馈。"}</p>
          : <ol className="feedback-list">{items.map(item => <FeedbackItem key={item.id} item={item} admin={admin} onResolved={() => setReload(v => v + 1)} />)}</ol>}
      </section>
    </div>
  </section>;
}
