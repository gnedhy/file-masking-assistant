import { clearSession, getSession } from "./session.js";
import { randomId } from "./randomId.js";

const DB_NAME = "file-masking-assistant-v2-operation-outbox";
const LIMIT = 5000;
const BYTE_LIMIT = 10 * 1024 * 1024;
let state = { session: null, pending: 0, rejected: 0, otherPending: 0, lastConfirmed: null, incomplete: false, error: "" };
let started = false, running = false, timer, failures = 0;
export const getOperationSyncState = () => ({ ...state });
const publish = change => {
  state = { ...state, ...change };
  globalThis.window?.dispatchEvent(new Event("operation-sync-changed"));
};

function openQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const events = request.result.createObjectStore("events", { keyPath: "eventId" });
      events.createIndex("ownerStatus", ["owner", "status"]);
      request.result.createObjectStore("meta");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("QUEUE_BLOCKED")); };
    request.onsuccess = () => { if (blocked) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

async function transact(mode, action) {
  const db = await openQueue();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["events", "meta"], mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || new Error("QUEUE_WRITE_FAILED"));
      tx.onerror = () => reject(tx.error);
      action(tx.objectStore("events"), tx.objectStore("meta"), next => { value = next; }, tx);
    });
  } finally { db.close(); }
}

async function refresh() {
  const summary = await transact("readonly", (events, meta, done) => {
    const result = { pending: 0, rejected: 0, otherPending: 0, lastConfirmed: null, loss: false, batch: [] };
    const owner = state.session?.userId || "";
    const index = events.index("ownerStatus");
    const pending = index.count([owner, "pending"]);
    pending.onsuccess = () => { result.pending = pending.result; };
    const rejected = index.count([owner, "rejected"]);
    rejected.onsuccess = () => { result.rejected = rejected.result; };
    const total = events.count();
    total.onsuccess = () => { result.otherPending = total.result - result.pending - result.rejected; };
    const request = index.openCursor(IDBKeyRange.only([owner, "pending"]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { done(result); return; }
      result.batch.push(cursor.value);
      if (result.batch.length < 50) cursor.continue(); else done(result);
    };
    const last = meta.get(`confirmed:${state.session?.userId}`);
    last.onsuccess = () => { result.lastConfirmed = last.result || null; };
    const loss = meta.get("loss");
    loss.onsuccess = () => { result.loss = Boolean(loss.result); };
  });
  const { batch, loss, ...counts } = summary;
  publish({ ...counts, incomplete: loss, ...(loss ? { error: "有记录未能加入同步队列，集中记录可能不完整。" } : {}) });
  return batch;
}

function schedule(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}

async function session() {
  try {
    publish({ ...(state.incomplete ? {} : { error: "" }), session: await getSession({ refresh: true }) });
    return true;
  } catch (error) {
    if (error.code !== "AUTH_REQUIRED") throw error;
    publish({ session: null, error: "登录已过期，记录会在重新进入后发送。" });
    return false;
  }
}

async function flush() {
  if (running) { schedule(100); return; }
  running = true;
  clearTimeout(timer);
  try {
    if (!await session()) { await refresh(); return; }
    const batch = await refresh();
    if (!batch.length) { failures = 0; return; }
    const owner = state.session.userId;
    const response = await fetch("/api/v1/operation-events/batch", {
      method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", "x-csrf-token": state.session.csrf },
      body: JSON.stringify({ events: batch.map(row => row.event) }),
    });
    if (response.status === 401 || response.status === 403) { clearSession(); publish({ session: null, error: "会话需要重新验证；待发送记录保留。" }); await refresh(); return; }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        await transact("readwrite", events => batch.forEach(row => {
          const existing = events.get(row.eventId);
          existing.onsuccess = () => { if (existing.result?.status === "pending") events.put({ ...existing.result, status: "rejected" }); };
        }));
        publish({ error: "记录格式被服务拒绝，已停止自动重试；文件处理不受影响。" });
        await refresh(); return;
      }
      throw new Error("SERVICE_UNAVAILABLE");
    }
    const payload = await response.json();
    if (!Array.isArray(payload.results)) throw new Error("INVALID_ACK");
    const acknowledgements = new Map(payload.results.map(result => [result.eventId, result.status]));
    if (batch.some(row => !["accepted", "duplicate", "rejected"].includes(acknowledgements.get(row.eventId)))) throw new Error("INVALID_ACK");
    const confirmed = new Date().toISOString();
    await transact("readwrite", (events, meta) => {
      let removedBytes = 0;
      for (const row of batch) {
        const existing = events.get(row.eventId);
        existing.onsuccess = () => {
          if (!existing.result || existing.result.status !== "pending") return;
          if (acknowledgements.get(row.eventId) === "rejected") events.put({ ...existing.result, status: "rejected" });
          else { events.delete(row.eventId); removedBytes += existing.result.bytes; }
        };
      }
      const bytes = meta.get("bytes");
      bytes.onsuccess = () => meta.put(Math.max(0, (bytes.result || 0) - removedBytes), "bytes");
      if (batch.some(row => acknowledgements.get(row.eventId) !== "rejected")) meta.put(confirmed, `confirmed:${owner}`);
    });
    failures = 0;
    if (!state.incomplete) publish({ error: "" });
    await refresh();
    if (state.pending) schedule(100);
  } catch {
    publish({ error: "记录暂未发送；恢复连接后将重试。" });
    await refresh().catch(() => publish({ error: "无法读取待同步记录，集中记录可能不完整；文件处理不受影响。" }));
    schedule(Math.min(60000, 1000 * 2 ** Math.min(failures++, 6)));
  } finally { running = false; }
}

export async function enqueueOperation(record) {
  if (!state.session && !await session().catch(() => false)) return false;
  const event = { version: 1, eventId: randomId(), operationId: record.operationId || randomId() };
  for (const key of ["time", "action", "result", "taskId", "marker", "format", "inputName", "outputName"]) if (record[key] !== undefined) event[key] = record[key];
  const row = { eventId: event.eventId, owner: state.session.userId, status: "pending", event };
  row.bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
  try {
    const saved = await transact("readwrite", (events, meta, done) => {
      const count = events.count();
      const bytes = meta.get("bytes");
      bytes.onsuccess = () => {
        if (count.result >= LIMIT || (bytes.result || 0) + row.bytes > BYTE_LIMIT) { meta.put(true, "loss"); done(false); }
        else { events.add(row); meta.put((bytes.result || 0) + row.bytes, "bytes"); done(true); }
      };
    });
    if (!saved) publish({ error: "待同步队列已满，新记录未加入；集中记录可能不完整。" });
    await refresh();
    schedule();
    return saved;
  } catch {
    publish({ error: "待同步记录保存失败，集中记录可能不完整；文件处理不受影响。" });
    await transact("readwrite", (_events, meta) => meta.put(true, "loss")).catch(() => {});
    return false;
  }
}

export function retryOperationSync() { failures = 0; schedule(); }
export function startOperationSync() {
  if (started) return;
  started = true;
  window.addEventListener("online", retryOperationSync);
  window.addEventListener("focus", retryOperationSync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) retryOperationSync(); });
  schedule();
}
