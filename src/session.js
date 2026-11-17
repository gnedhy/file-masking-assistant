let sessionPromise = null;

export class AuthRequiredError extends Error {
  constructor() {
    super("登录已过期，请重新进入应用。");
    this.name = "AuthRequiredError";
    this.code = "AUTH_REQUIRED";
  }
}

// One cached identity for the page; a 401 anywhere clears it so the next call asks again.
export function getSession({ refresh = false } = {}) {
  if (refresh) sessionPromise = null;
  sessionPromise ??= fetch("/api/v1/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) })
    .then(async response => {
      if (response.status === 401) throw new AuthRequiredError();
      if (!response.ok) throw new Error("SERVICE_UNAVAILABLE");
      const session = await response.json();
      if (typeof session.userId !== "string" || !session.userId || typeof session.csrf !== "string" || !session.csrf) throw new Error("INVALID_SESSION");
      return { userId: session.userId, userName: session.userName || session.userId, isAdmin: session.isAdmin === true, csrf: session.csrf };
    })
    .catch(error => { sessionPromise = null; throw error; });
  return sessionPromise;
}

export function clearSession() {
  sessionPromise = null;
}

export function signIn() {
  window.location.assign("/auth/wecom/start");
}
