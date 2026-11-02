import { OPERATION_LABELS } from "./operationLog.js";

const PROTECT_STEPS = new Set(["import_protect", "inspect_protect", "protect", "save_mapping", "download_protect"]);
const RESTORE_STEPS = new Set(["import_restore", "inspect_restore", "restore", "download_restore"]);

// Each task shows two dots: masking, then restoring. Values: done, partial, failed or none.
function protectState(events) {
  if (events.some(e => e.action === "protect" && e.result === "success")) return "done";
  return events.some(e => PROTECT_STEPS.has(e.action) && e.result === "failed") ? "failed" : "none";
}

function restoreState(events) {
  const restores = events.filter(e => e.action === "restore");
  if (restores.some(e => e.result === "success")) return "done";
  if (restores.some(e => e.result === "partial" || e.result === "missing")) return "partial";
  return events.some(e => RESTORE_STEPS.has(e.action) && e.result === "failed") ? "failed" : "none";
}

// Only file tasks get progress dots; an export of the records is not one.
export const isFileTask = events => events.some(e => PROTECT_STEPS.has(e.action) || RESTORE_STEPS.has(e.action));

// events are one task's steps in time order.
export function summarizeTask(key, events) {
  const named = events.find(e => PROTECT_STEPS.has(e.action) && e.inputName) ?? events.find(e => e.inputName);
  const tagged = events.find(e => e.marker) ?? events.find(e => e.taskId) ?? {};
  return {
    key,
    userId: events[0].userId,
    userName: events[0].userName,
    taskId: tagged.taskId ?? null,
    marker: tagged.marker ?? null,
    title: named?.inputName ?? OPERATION_LABELS[events[0].action] ?? "操作",
    format: events.find(e => e.format)?.format ?? null,
    lastTime: events.reduce((last, e) => (String(e.time) > String(last) ? e.time : last), events[0].time),
    fileTask: isFileTask(events),
    protect: protectState(events),
    restore: restoreState(events),
    events,
  };
}

// Same grouping as the SQL: steps of one operation join the task that operation produced.
export function taskKeyResolver(events) {
  const taskByOperation = new Map();
  for (const e of events) if (e.taskId && e.operationId) taskByOperation.set(`${e.userId}:${e.operationId}`, e.taskId);
  return e => `${e.userId}:${e.taskId ?? taskByOperation.get(`${e.userId}:${e.operationId}`) ?? e.operationId}`;
}
