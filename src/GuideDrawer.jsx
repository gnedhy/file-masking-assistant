import { useEffect, useState } from "react";
import { ArrowRight, ChatCircleDots, CheckCircle, Info, ShieldCheck, Sparkle, ThumbsDown, Tray, Warning, Wrench, X } from "@phosphor-icons/react";
import { CHANGELOG, CURRENT_VERSION } from "./changelog.js";

const SEEN_KEY = "file-mask-guide-seen-version";
// Browser storage can be blocked; the reminder then simply shows again.
export function hasUnseenUpdate() {
  try { return localStorage.getItem(SEEN_KEY) !== CURRENT_VERSION.version; } catch { return false; }
}
function markUpdateSeen() {
  try { localStorage.setItem(SEEN_KEY, CURRENT_VERSION.version); } catch { /* reminder shows again next time */ }
}

const TABS = [["use", "使用指引"], ["feedback", "反馈指引"], ["changes", "更新日志"]];
const longDate = date => date.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, "$1 年 $2 月 $3 日");

// A small drawn circle with a number; the ①② characters sit low in Chinese fonts.
const Mark = ({ n }) => <span className="guide-mark" aria-hidden="true">{n}</span>;

// caption: [number, text] or plain text.
function Shot({ name, width, height, alt, caption }) {
  const [n, text] = Array.isArray(caption) ? caption : [null, caption];
  return <figure className="guide-shot">{caption && <figcaption>{n && <Mark n={n} />}{text}</figcaption>}<img src={`/guide/${name}.jpg`} width={width} height={height} alt={alt} loading="lazy" decoding="async" /></figure>;
}

// A numbered card: title, what it is for, the actions in order, then the screenshots that show them.
function Step({ number, icon: Icon, title, hint, actions, shots = [], children }) {
  return <li className="guide-step">
    <h3>{number ? <span className="guide-num">{number}</span> : <span className="guide-num guide-num--icon"><Icon weight="bold" aria-hidden="true" /></span>}{title}</h3>
    {hint && <p className="guide-hint">{hint}</p>}
    {actions && <ol className="guide-actions">{actions.map((action, index) => <li key={index}><Mark n={index + 1} /><span>{action}</span></li>)}</ol>}
    {shots.map(([name, width, height, alt, caption]) => <Shot key={name} name={name} width={width} height={height} alt={alt} caption={caption} />)}
    {children}
  </li>;
}

function Tips({ title, items }) {
  return <section className="guide-tips" aria-label={title}>
    <h3>{title}</h3>
    <ul>{items.map(([tone, text], index) => { const Icon = tone === "warn" ? Warning : tone === "info" ? Info : CheckCircle; return <li key={index} data-tone={tone}><Icon weight="fill" aria-hidden="true" /><span>{text}</span></li>; })}</ul>
  </section>;
}

function UseGuide() {
  return <>
    <p className="guide-lead">真实内容先在本机换成代号，再交给 AI；AI 处理完，回到这里换回真实内容。</p>
    <ol className="guide-steps">
      <Step number={1} title="选择文件，生成脱敏文件"
        actions={[<>点 <kbd>制作脱敏文件</kbd>，选择或拖入文件。</>, <>核对要替换的内容，需要增减就点「查看并调整」。</>, <>确认无误后点 <kbd>生成脱敏文件</kbd>。</>]}
        shots={[["use-1-review", 774, 304, "核对替换内容后，点生成脱敏文件"]]} />
      <Step number={2} title="下载脱敏文件，交给 AI 处理"
        actions={[<>点 <kbd>下载脱敏文件</kbd>。文件里的真实内容已换成代号，例如 <b className="nowrap">客户-K7M4-01</b>。</>, <>点 <kbd>复制 AI 处理说明</kbd>，把说明和文件一起发给常用的 AI。说明会提醒 AI 原样保留代号。</>]}
        shots={[["use-2-download", 774, 290, "下载脱敏文件按钮", [1, "下载脱敏文件"]], ["use-3-copy", 774, 299, "复制 AI 处理说明按钮", [2, "复制 AI 处理说明"]]]} />
      <Step number={3} title="导入 AI 结果，下载还原文件"
        actions={[<>保存 AI 返回的文件，点 <kbd>导入 AI 处理后的文件</kbd> 选择它，检查通过后点 <kbd>生成还原文件</kbd>。</>, <>点 <kbd>下载还原文件</kbd>，代号已换回真实内容，这就是最终文件。</>]}
        shots={[["use-4-import", 774, 360, "检查通过后点生成还原文件", [1, "生成还原文件"]], ["use-5-restore", 774, 334, "下载还原文件按钮", [2, "下载还原文件"]]]}>
        <p className="guide-hint">稍后再还原，也可以从左侧「还原处理文件」进入。</p>
      </Step>
    </ol>
    <Tips title="注意事项" items={[
      ["ok", <>原文件只在本机浏览器里处理，<b>不上传、不修改</b>。</>],
      ["ok", <>还原记录加密保存在公司服务器，<b>稍后再还原、换电脑还原都可以</b>。</>],
      ["ok", <>表格按<b>列</b>替换，其他内容（表单、说明文字、Word、TXT）按<b>关键词</b>替换；系统认不全简称和昵称，可以在「查看并调整」里手动补充。</>],
      ["ok", <>手机号、身份证号、银行卡号、邮箱会自动列出来，勾选后一起替换。</>],
      ["ok", <>可以脱敏 XLSX、CSV、TXT、MD、DOCX，文本类 10 MB、Office 20 MB 以内；AI 返回 PPTX 或网页也能还原。</>],
      ["warn", <>图片会原样保留，<b>图片里的文字不会被替换</b>；嵌入的附件（PDF、Word 等）不会放进脱敏文件。</>],
      ["warn", <>隐藏的工作表、行、列<b>也会交给 AI</b>，生成前请确认里面没有不该给 AI 的内容。</>],
      ["warn", <>不要改动文件里的代号，<b>改过的部分无法还原</b>。</>],
      ["warn", <><b>还原后的文件含真实信息</b>，不要再交给外部 AI。</>],
    ]} />
  </>;
}

function FeedbackGuide() {
  return <>
    <p className="guide-lead">按情况选一个入口。两种方式都会发给管理员，处理后会回复你。</p>
    <ol className="guide-steps">
      <Step icon={ThumbsDown} title="结果不对：点「不满意」" hint="例如有内容没被替换、还原后不完整。"
        actions={[<>在结果页底部「这次结果满意吗？」点 <kbd>不满意</kbd>。</>, <>在弹出的窗口里写下问题，点 <kbd>发送反馈</kbd>。</>]}
        shots={[["feedback-result", 854, 475, "结果页底部的满意和不满意按钮", [1, "结果页底部"]], ["feedback-dialog", 752, 715, "不满意时弹出的反馈窗口", [2, "填写问题并发送"]]]}>
        <p className="guide-note" data-tone="ok"><ShieldCheck weight="fill" aria-hidden="true" /><span>会自动附上本次检查结果，也可以勾选附上只含代号的文件（脱敏版或 AI 返回的文件）。<b>原文件和还原后的文件含真实信息，不会发送。</b></span></p>
        <p className="guide-hint">结果没问题，也可以点 <kbd>满意</kbd>，帮助我们了解哪些文件处理得好。</p>
      </Step>
      <Step icon={ChatCircleDots} title="报错、卡住或有建议：点「反馈」" hint="右上角的「反馈」在任何页面都能打开，写下问题或建议后发送。"
        shots={[["feedback-button", 710, 178, "顶栏右上角的反馈按钮"]]} />
      <Step icon={Tray} title="查看管理员的回复"
        actions={[<>两种方式提交的反馈，都在「反馈」页的「我的反馈」里。</>, <>管理员回复后，<kbd>反馈</kbd> 按钮上会出现红色数字，查看后消失。</>]}
        shots={[["feedback-center", 896, 299, "我的反馈列表里的管理员回复"]]} />
    </ol>
    <Tips title="填写建议" items={[
      ["warn", <><b>不要写客户名称、金额等真实信息</b>，写列名或位置即可，例如「供应商列有 3 行没替换」。</>],
      ["info", <>写清楚<b>哪个文件、哪一步、看到了什么</b>，能更快定位问题。</>],
    ]} />
  </>;
}

const CHANGE_TYPES = { new: ["新增", Sparkle], improve: ["改进", ArrowRight], fix: ["修复", Wrench] };

function Changes() {
  return <ol className="guide-changes">{CHANGELOG.map((release, index) => <li key={release.version}>
    <div className="guide-changes__head"><strong>v{release.version}</strong>{index === 0 && <span className="guide-changes__current">当前版本</span>}<time dateTime={release.date}>{longDate(release.date)}</time></div>
    <div className="guide-changes__body">{Object.keys(CHANGE_TYPES).filter(type => release.items.some(([t]) => t === type)).map(type => { const [label, Icon] = CHANGE_TYPES[type]; return <section key={type} className="guide-change-group" data-type={type} aria-label={label}>
      <span className="guide-change-type"><Icon weight="bold" aria-hidden="true" />{label}</span>
      <ul>{release.items.filter(([t]) => t === type).map(([, text]) => <li key={text}>{text}</li>)}</ul>
    </section>; })}</div>
  </li>)}</ol>;
}

// 使用指南: how to use the app, how to give feedback, and what changed. Opens from the top bar.
export function GuideDrawer({ drawerRef, closeButtonRef, onClose, onSeen, initialTab = "use" }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { if (tab === "changes") { markUpdateSeen(); onSeen?.(); } }, [tab, onSeen]);
  useEffect(() => { drawerRef.current?.querySelector(".drawer-body")?.scrollTo({ top: 0 }); }, [tab, drawerRef]);
  const onTabKey = event => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === tab);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
    setTab(next);
    requestAnimationFrame(() => drawerRef.current?.querySelector(`#guide-tab-${next}`)?.focus());
  };
  return <aside className="security-drawer guide-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="guide-title">
    <div className="drawer-head">
      <div><h2 id="guide-title">使用指南</h2><p className="guide-version">应用版本<span>v{CURRENT_VERSION.version}</span><i aria-hidden="true">·</i>应用最近更新于 {longDate(CURRENT_VERSION.date)}</p></div>
      <div className="drawer-head__actions"><button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭使用指南"><X /></button></div>
    </div>
    <div className="guide-tabs" role="tablist" aria-label="使用指南内容" style={{ "--tab": TABS.findIndex(([key]) => key === tab) }} onKeyDown={onTabKey}>
      {TABS.map(([key, label]) => <button key={key} id={`guide-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls="guide-panel" tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div className="drawer-body">
      <div id="guide-panel" className="guide-panel" role="tabpanel" aria-labelledby={`guide-tab-${tab}`}>
        {tab === "use" ? <UseGuide /> : tab === "feedback" ? <FeedbackGuide /> : <Changes />}
      </div>
    </div>
  </aside>;
}
