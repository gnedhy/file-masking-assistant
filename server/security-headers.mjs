export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

// Fetch Headers -> Node writeHead object. Each Set-Cookie must stay separate: flattening the
// Headers keeps only the last one, which dropped the sign-in cookie after WeCom login.
export function nodeHeaders(headers, base = {}) {
  const out = { ...base, ...Object.fromEntries(headers) };
  const cookies = headers.getSetCookie();
  if (cookies.length) out["set-cookie"] = cookies;
  return out;
}
