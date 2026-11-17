import { useEffect, useState } from "react";
import { getSession } from "./session.js";

// Feedback requests and the header badge. Any change dispatches "feedback-changed" so the badge refreshes at once.
const CHANGED = "feedback-changed";
export const notifyFeedbackChanged = () => window.dispatchEvent(new Event(CHANGED));

export async function feedbackRequest(path, { method = "GET", json, form } = {}) {
  const session = await getSession();
  const headers = method === "GET" ? {} : { "x-csrf-token": session.csrf, ...(json ? { "content-type": "application/json" } : {}) };
  const response = await fetch(path, { method, headers, cache: "no-store", body: form ?? (json && JSON.stringify(json)), signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? "登录状态已过期，请重新进入应用。" : data.message || "反馈服务暂不可用，请稍后重试。");
  return data;
}

export async function submitFeedback(fields, files = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== "") form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  for (const file of files) form.append("files", file);
  const result = await feedbackRequest("/api/v1/feedback", { method: "POST", form });
  notifyFeedbackChanged();
  return result;
}

// Badge numbers: open feedback for admins, unread replies for the sender. Polls every minute while the page is visible.
export function useFeedbackSummary(enabled) {
  const [summary, setSummary] = useState({ open: 0, replies: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const refresh = () => { if (document.visibilityState === "visible") feedbackRequest("/api/v1/feedback/summary").then(next => { if (alive) setSummary(next); }).catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener(CHANGED, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); window.removeEventListener(CHANGED, refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled]);
  return summary;
}
