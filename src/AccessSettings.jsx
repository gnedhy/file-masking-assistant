import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { getSession } from "./session.js";

const DAY = 24 * 60 * 60 * 1000;
// About as tall as the admin and history cards beside it.
const PAGE_SIZE = 10;
const CHANGE_LABELS = { first_login: "首次登录成为管理员", grant: "设为管理员", revoke: "取消管理员" };
const formatTime = value => new Date(value).toLocaleString("zh-CN", { hour12: false });

async function accessRequest(path, method = "GET", body) {
  const session = await getSession();
  const response = await fetch(path, {
    method, cache: "no-store", signal: AbortSignal.timeout(60000),
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-csrf-token": session.csrf },
    body: body && JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? "登录状态已过期，请重新进入应用。" : data.message || "权限服务暂不可用，请稍后重试。");
  return data;
}

// Departments in tree order with their depth, for the filter list.
function departmentTree(departments) {
  const children = new Map();
  for (const d of departments) children.set(d.parentId, [...(children.get(d.parentId) ?? []), d]);
  const ids = new Set(departments.map(d => d.id));
  const roots = departments.filter(d => !ids.has(d.parentId));
  const ordered = [];
  const walk = (d, depth) => { ordered.push({ ...d, depth }); for (const child of children.get(d.id) ?? []) walk(child, depth + 1); };
  roots.forEach(d => walk(d, 0));
  return ordered;
}

function descendants(departments, id) {
  const result = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const d of departments) if (result.has(d.parentId) && !result.has(d.id)) { result.add(d.id); grew = true; } }
  return result;
}

export default function AccessSettings({ onBack }) {
  const heading = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState("");
  // Only the newest request may update the page: a slow sync must not overwrite a newer admin change.
  const latest = useRef(0);
  const load = async (...args) => { const id = ++latest.current; const overview = await accessRequest(...args); return id === latest.current ? overview : null; };
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(1);
  const directoryHead = useRef(null);
  const [confirm, setConfirm] = useState(null);

  async function sync() {
    setSyncing(true); setError("");
    try { const overview = await load("/api/v1/access/sync", "POST"); if (overview) { setData(overview); setNotice("通讯录已同步。"); } }
    catch (e) { setError(e.message); }
    finally { setSyncing(false); }
  }

  useEffect(() => {
    heading.current?.focus();
    load("/api/v1/access").then(overview => {
      if (!overview) return;
      setData(overview);
      // Pull the directory when it has never been read or is more than a day old.
      if (!overview.syncedAt || Date.now() - Date.parse(overview.syncedAt) > DAY) sync();
    }).catch(e => setError(e.message));
  }, []);

  async function change(member, isAdmin) {
    if (!isAdmin && member.userId === data.me && !await new Promise(resolve => setConfirm({ resolve }))) return;
    setBusy(member.userId); setError(""); setNotice("");
    try {
      const overview = await load("/api/v1/access/admins", "POST", { userId: member.userId, isAdmin });
      if (!overview) return;
      // Without admin rights this page and the full records are gone, so start over as an ordinary user.
      if (!isAdmin && member.userId === data.me) { window.location.reload(); return; }
      setData(overview);
      setNotice(`${member.name} 已${isAdmin ? "设为管理员" : "改为普通用户"}，对方下次打开应用时生效。`);
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  const tree = useMemo(() => departmentTree(data?.departments ?? []), [data]);
  const departmentNames = useMemo(() => new Map((data?.departments ?? []).map(d => [d.id, d.name])), [data]);
  const matches = useMemo(() => {
    if (!data) return [];
    const scope = department ? descendants(data.departments, department) : null;
    const text = query.trim().toLowerCase();
    return data.members.filter(m => (!scope || m.departmentIds.some(id => scope.has(id))) && (!text || m.name.toLowerCase().includes(text) || m.userId.toLowerCase().includes(text)));
  }, [data, department, query]);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const turnPage = next => { setPage(next); directoryHead.current?.scrollIntoView({ block: "nearest" }); };
  const onlyOneAdmin = (data?.admins.length ?? 0) <= 1;
  const departmentsOf = member => member.departmentIds.map(id => departmentNames.get(id)).filter(Boolean).join("、");

  const memberAction = member => {
    const revoke = member.isAdmin;
    const blocked = revoke && onlyOneAdmin;
    return <button className={revoke ? "access-action access-action--revoke" : "access-action"} type="button" disabled={Boolean(busy) || syncing || blocked} title={blocked ? "至少要保留一位管理员" : undefined} onClick={() => change(member, !revoke)}>{busy === member.userId ? "正在保存…" : revoke ? "取消管理员" : "设为管理员"}</button>;
  };
  const avatar = name => <span className="access-avatar" aria-hidden="true">{Array.from(name)[0]}</span>;
  const memberOf = admin => data.members.find(m => m.userId === admin.userId) ?? { ...admin, departmentIds: [], isAdmin: true };

  return <section className="usage-preview access-settings" aria-label="权限配置">
    <div className="usage-heading"><h1 ref={heading} tabIndex={-1}>权限配置</h1><button className="secondary-button" type="button" onClick={onBack}>返回文件处理</button></div>
    <p className="access-intro">决定谁能查看全部人员的操作记录和使用统计。新加入的人员默认是普通用户。</p>
    {error && <p className="access-message" role="alert">{error}</p>}
    {notice && !error && <p className="access-message access-message--ok" role="status">{notice}</p>}
    {!data ? !error && <p role="status">正在读取权限配置…</p> : <>
      <dl className="access-metrics">
        <div><dt>管理员</dt><dd>{data.admins.length}</dd></div>
        <div><dt>普通用户</dt><dd>{data.members.filter(m => !m.isAdmin).length}</dd></div>
        <div><dt>部门</dt><dd>{data.departments.length}</dd></div>
      </dl>
      <div className="access-layout">
        <section className="access-card access-directory" aria-labelledby="access-directory">
          <div className="access-card__head" ref={directoryHead}>
            <div><h2 id="access-directory">通讯录</h2><p>{data.syncedAt ? `上次同步：${formatTime(data.syncedAt)} · ${data.departments.length} 个部门 · ${data.members.length} 人` : "还没有同步过通讯录"}</p></div>
            <button className="access-action access-sync" type="button" disabled={syncing} onClick={sync}><ArrowsClockwise size={16} weight="bold" aria-hidden="true" />{syncing ? "正在同步…" : "同步通讯录"}</button>
          </div>
          <div className="access-filters">
            <label>搜索姓名或账号<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
            <label>部门<select value={department} onChange={e => { setDepartment(e.target.value); setPage(1); }}><option value="">全部部门</option>{tree.map(d => <option key={d.id} value={d.id}>{"　".repeat(d.depth)}{d.name}</option>)}</select></label>
          </div>
          {data.members.length === 0 ? <p className="access-empty" role="status">{syncing ? "正在从企业微信读取通讯录…" : "通讯录为空，请先同步。"}</p> : <>
            <ul className="access-list">{matches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(member => <li key={member.userId}>
              {avatar(member.name)}
              <div className="access-person"><strong>{member.name}</strong><small>{member.userId}</small></div>
              <span className="access-department">{departmentsOf(member) || "—"}</span>
              <span className={member.isAdmin ? "access-role access-role--admin" : "access-role"}>{member.isAdmin ? "管理员" : "普通用户"}</span>
              {memberAction(member)}
            </li>)}</ul>
            {matches.length === 0 ? <p className="access-count" role="status">没有符合条件的人员。</p> : <nav className="access-pager" aria-label="通讯录分页">
              <span role="status">共 {matches.length} 人{pages > 1 && ` · 第 ${currentPage} / ${pages} 页`}</span>
              {pages > 1 && <div><button className="access-action" type="button" disabled={currentPage === 1} onClick={() => turnPage(currentPage - 1)}>上一页</button><button className="access-action" type="button" disabled={currentPage === pages} onClick={() => turnPage(currentPage + 1)}>下一页</button></div>}
            </nav>}
          </>}
          <p className="access-note">只能读到企业微信应用可见范围内的部门和人员。超过一天未同步时，打开本页会自动同步。</p>
        </section>

        <aside className="access-side">
          <section className="access-card" aria-labelledby="access-admins">
            <div className="access-card__head"><h2 id="access-admins">管理员（{data.admins.length}）</h2></div>
            <ul className="access-list access-list--compact">{data.admins.map(admin => {
              const member = memberOf(admin);
              return <li key={admin.userId}>
                {avatar(admin.name)}
                <div className="access-person"><strong>{admin.name}{admin.userId === data.me && <small className="access-badge">我</small>}</strong><small>{departmentsOf(member) || admin.userId} · {formatTime(admin.grantedAt).slice(0, -3)} 起</small></div>
                {memberAction(member)}
              </li>;
            })}</ul>
          </section>
          <section className="access-card" aria-labelledby="access-changes">
            <div className="access-card__head"><h2 id="access-changes">变更记录</h2></div>
            {data.changes.length ? <ol className="access-timeline">{data.changes.map((c, index) => <li key={index} data-change={c.change}>
              <strong>{c.targetName} · {CHANGE_LABELS[c.change]}</strong>
              <small>{formatTime(c.time)}{c.change !== "first_login" && ` · 操作人 ${c.actorName}`}</small>
            </li>)}</ol> : <p className="access-empty">暂无变更。</p>}
          </section>
          <section className="access-card access-roles" aria-label="身份说明">
            <dl>
              <div><dt>管理员</dt><dd>查看全部人员的操作记录、使用统计，导出记录，配置权限。</dd></div>
              <div><dt>普通用户</dt><dd>只能查看自己的操作记录。</dd></div>
            </dl>
            <p>每个人的还原记录只有本人能用，管理员也看不到。变更在对方下次打开应用时生效。</p>
          </section>
        </aside>
      </div>
    </>}
    {confirm && <ConfirmDialog title="取消自己的管理员权限？" message="取消后你只能查看自己的记录，也不能再进入权限配置。" confirmLabel="确认取消" onClose={ok => { confirm.resolve(ok); setConfirm(null); }} />}
  </section>;
}
