import createDOMPurify from "dompurify";
import { FILE_SIZE_LIMITS } from "./filePreflight.js";
import { findKnownShortTokens } from "./xlsxCore.js";
import { parseEntityToken, tokenPattern, tokenOccurrence } from "./tokenFormat.js";

export const HTML_LIMITS = { bytes: FILE_SIZE_LIMITS.html, nodes: 50000 };

const BLOCKED_ELEMENTS = new Set([
  "script", "link", "base", "iframe", "frame", "frameset", "form", "input", "button",
  "textarea", "select", "option", "object", "embed", "applet", "svg", "math", "template",
]);
const TOKEN_FORBIDDEN_ELEMENTS = new Set([...BLOCKED_ELEMENTS, "style"]);
const ALLOWED_TOKEN_ATTRIBUTES = new Set(["title", "alt", "aria-label"]);
const RESOURCE_ATTRIBUTES = new Set(["src", "srcset", "href", "xlink:href", "action", "formaction", "poster"]);
// AI reports draw charts with an inline script plus a library from a public CDN. Those scripts are kept, and
// the page runs inside a sandboxed frame: the policy blocks requests, the sandbox blocks popups and navigating
// the window, and the frame's own navigation is checked against the wrapper's policy.
const SCRIPT_SOURCES = ["https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"];
const SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
const SCRIPT_ATTRIBUTES = ["src", "type", "integrity", "crossorigin", "defer", "async", "nomodule"];
const STATIC_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// The sandboxed page inherits the wrapper's policy, so both carry the same one.
const SCRIPT_POLICY = `default-src 'none'; script-src 'unsafe-inline' ${SCRIPT_SOURCES.join(" ")}; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
// Runs before the page's scripts. WebRTC ignores the policy, so it is removed, along with the ways a script could
// get a fresh copy of it: a nested frame (also through document.write or a shadow root).
const SCRIPT_PRELUDE = `(() => {
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) delete window[name];
  for (const name of ["open", "write", "writeln"]) Document.prototype[name] = () => {};
  Element.prototype.attachShadow = () => { throw new DOMException("Shadow roots are disabled.", "NotSupportedError"); };
  const frames = "iframe,frame,object,embed,fencedframe,portal";
  const strip = (node) => { if (node.matches?.(frames)) node.remove(); node.querySelectorAll?.(frames).forEach((child) => child.remove()); };
  new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(strip))).observe(document, { childList: true, subtree: true });
})();`;

function safeError(code, message, details = []) {
  return Object.assign(new Error(message), { code, details });
}

function decodeText(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength > HTML_LIMITS.bytes) throw safeError("FILE_TOO_LARGE", "HTML 文件超过 10 MB，已停止处理。");
  if (view.some((byte) => byte === 0)) throw safeError("FORMAT_MISMATCH", "文件包含二进制内容，不是安全的静态 HTML。");
  return new TextDecoder("utf-8", { fatal: true }).decode(view).replace(/^\uFEFF/, "");
}

function serializedValueAsText(entry) {
  if (!entry?.value) return "";
  if (entry.value.type === "date") return new Date(entry.value.value).toISOString().slice(0, 10);
  if (entry.value.type === "richText") return String(entry.value.text ?? "");
  return String(entry.value.value ?? "");
}

function scanValue(value, location) {
  return [...String(value).matchAll(tokenPattern())].map((match) => ({
    ...tokenOccurrence(match[0]), location,
  }));
}

function keptScript(element) {
  if (element.tagName.toLowerCase() !== "script") return false;
  if (!SCRIPT_TYPES.has((element.getAttribute("type") ?? "").trim().toLowerCase())) return false;
  if (!element.hasAttribute("src")) return true;
  const src = element.getAttribute("src").trim();
  return SCRIPT_SOURCES.some((origin) => src.startsWith(`${origin}/`)) && !/[\s"'<>\\]/.test(src);
}

// Only an inline script's own text can be restored; tokens in a CDN script's text or address are not.
function restorableScriptText(element) {
  return keptScript(element) && !element.hasAttribute("src");
}

function takeKeptScripts(document) {
  return [...document.querySelectorAll("script")].filter(keptScript).map((element) => {
    element.remove();
    return {
      attributes: SCRIPT_ATTRIBUTES.filter((name) => element.hasAttribute(name)).map((name) => [name, element.getAttribute(name)]),
      text: element.hasAttribute("src") ? "" : element.textContent,
    };
  });
}

// A restored value may land inside any kind of string literal, so every character that could end one is escaped.
function scriptLiteralText(value) {
  return value.replace(/[\\'"`$<>\n\r\p{Zl}\p{Zp}]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function inspectDocument(document, mapping = null) {
  const occurrences = [];
  const unsupportedOccurrences = [];
  const altered = [];
  const knownShortTokens = new Set(Object.keys(mapping ?? {}).map((token) => parseEntityToken(token)?.shortToken).filter(Boolean));
  let nodeCount = 0;

  const walker = document.createTreeWalker(document, 0xFFFFFFFF);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodeCount += 1;
    if (nodeCount > HTML_LIMITS.nodes) throw safeError("PACKAGE_TOO_LARGE", "HTML 页面节点超过 50,000 个，已停止处理。");
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      const script = parent && restorableScriptText(parent);
      const location = script ? "<script> 图表脚本" : parent ? `<${parent.tagName.toLowerCase()}> 可见文字` : "可见文字";
      const matches = scanValue(node.nodeValue, location);
      if (parent && !script && TOKEN_FORBIDDEN_ELEMENTS.has(parent.tagName.toLowerCase())) unsupportedOccurrences.push(...matches);
      else occurrences.push(...matches);
      if (mapping) {
        const withoutFull = String(node.nodeValue).replace(tokenPattern(), " ");
        for (const malformed of withoutFull.matchAll(/\[\[[^\]]{1,80}(?:\]\]|$)/g)) altered.push({ location, value: malformed[0] });
        for (const shortToken of findKnownShortTokens(withoutFull, knownShortTokens)) altered.push({ location, value: shortToken });
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const location = `<${node.tagName.toLowerCase()}> 的 ${name} 属性`;
      const matches = scanValue(attribute.value, location);
      if (ALLOWED_TOKEN_ATTRIBUTES.has(name) && !TOKEN_FORBIDDEN_ELEMENTS.has(node.tagName.toLowerCase())) occurrences.push(...matches);
      else unsupportedOccurrences.push(...matches);
      if (mapping) {
        const withoutFull = String(attribute.value).replace(tokenPattern(), " ");
        for (const malformed of withoutFull.matchAll(/\[\[[^\]]{1,80}(?:\]\]|$)/g)) altered.push({ location, value: malformed[0] });
        for (const shortToken of findKnownShortTokens(withoutFull, knownShortTokens)) altered.push({ location, value: shortToken });
      }
    }
  }
  return {
    occurrences,
    unsupportedOccurrences,
    altered,
    nodeCount,
    taskIds: [...new Set([...occurrences, ...unsupportedOccurrences].map((item) => item.taskId))],
    uniqueTokens: [...new Set([...occurrences, ...unsupportedOccurrences].map((item) => item.token))],
  };
}

function removeUnsafeContent(document) {
  const removed = { elements: 0, attributes: 0, remoteResources: 0 };
  for (const element of [...document.querySelectorAll([...BLOCKED_ELEMENTS].join(","))]) {
    element.remove();
    removed.elements += 1;
  }
  for (const element of [...document.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        removed.attributes += 1;
        continue;
      }
      if (name === "style") {
        const cleanStyle = sanitizeCss(attribute.value);
        if (cleanStyle) element.setAttribute("style", cleanStyle);
        else element.removeAttribute("style");
        if (cleanStyle !== attribute.value) removed.attributes += 1;
        continue;
      }
      if (RESOURCE_ATTRIBUTES.has(name)) {
        const allowed = (name === "href" && value.startsWith("#")) || (name === "src" && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value));
        if (!allowed) {
          element.removeAttribute(attribute.name);
          removed.remoteResources += 1;
        }
      }
    }
  }
  for (const style of [...document.querySelectorAll("style")]) {
    const originalCss = style.textContent;
    const cleanCss = sanitizeCss(originalCss);
    if (cleanCss) style.textContent = cleanCss;
    else style.remove();
    if (cleanCss !== originalCss) removed.attributes += 1;
  }
  return removed;
}

function sanitizeCss(value) {
  return String(value ?? "")
    .replace(/@import[^;]+;?/gi, "")
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/(?:^|[;{])\s*[^;{}:]*(?:url\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:)[^;{}]*(?=;|})/gi, "")
    .replace(/javascript\s*:/gi, "")
    .trim();
}

function replaceAllowedTokens(document, scripts, mapping) {
  let restoredOccurrences = 0;
  const replace = (value, format = (text) => text) => String(value).replace(tokenPattern(), (token) => {
    const entry = mapping[token];
    if (!entry) return token;
    restoredOccurrences += 1;
    return format(serializedValueAsText(entry));
  });
  for (const script of scripts) script.text = replace(script.text, scriptLiteralText);
  const walker = document.createTreeWalker(document, 0xFFFFFFFF);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === 3 && !BLOCKED_ELEMENTS.has(node.parentElement?.tagName.toLowerCase())) node.nodeValue = replace(node.nodeValue);
    if (node.nodeType === 1) {
      for (const name of ALLOWED_TOKEN_ATTRIBUTES) if (node.hasAttribute(name)) node.setAttribute(name, replace(node.getAttribute(name)));
    }
  }
  return restoredOccurrences;
}

function ensureSecurityEnvelope(document, scripts) {
  if (!document.documentElement) document.append(document.createElement("html"));
  if (!document.head) document.documentElement.prepend(document.createElement("head"));
  for (const existing of [...document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')]) existing.remove();
  const csp = document.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", scripts.length ? SCRIPT_POLICY : STATIC_POLICY);
  document.head.prepend(csp);
  // The sanitizer drops every <meta>; put back the two a page needs to read Chinese and fit a phone screen.
  for (const existing of [...document.head.querySelectorAll('meta[charset], meta[name="viewport" i]')]) existing.remove();
  const charset = document.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const viewport = document.createElement("meta");
  viewport.setAttribute("name", "viewport");
  viewport.setAttribute("content", "width=device-width, initial-scale=1");
  document.head.prepend(charset);
  csp.after(viewport);
  if (scripts.length) {
    const prelude = document.createElement("script");
    prelude.textContent = SCRIPT_PRELUDE;
    csp.after(prelude);
  }
  // Scripts go back in their original order after the page content, so a chart script finds its canvas.
  for (const { attributes, text } of scripts) {
    const script = document.createElement("script");
    for (const [name, value] of attributes) script.setAttribute(name, value);
    script.textContent = text;
    document.body.append(script);
  }
}

function sandboxedPage(document, parser) {
  const wrapper = parser.parseFromString("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body></body></html>", "text/html");
  wrapper.documentElement.lang = document.documentElement.lang;
  const csp = wrapper.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", SCRIPT_POLICY);
  const title = wrapper.createElement("title");
  title.textContent = document.title;
  const style = wrapper.createElement("style");
  style.textContent = "html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}";
  const frame = wrapper.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", document.title || "还原后的页面");
  frame.setAttribute("srcdoc", serialize(document));
  wrapper.head.append(csp, title, style);
  wrapper.body.append(frame);
  return serialize(wrapper);
}

function serialize(document) {
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function inspectHtmlText(html, window, mapping = null) {
  const parser = new window.DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const inspection = inspectDocument(document, mapping);
  const sanitized = document.cloneNode(true);
  const keptScripts = takeKeptScripts(sanitized).length;
  const removed = removeUnsafeContent(sanitized);
  const purifier = createDOMPurify(window);
  const purified = purifier.sanitize(serialize(sanitized), {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [...BLOCKED_ELEMENTS],
    FORBID_ATTR: ["srcdoc"],
    ADD_TAGS: ["style"],
    ADD_ATTR: ["style"],
  });
  return { ...inspection, removed, keptScripts, sanitizedHtml: purified };
}

export function restoreHtmlText(html, window, mapping) {
  const parser = new window.DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const before = inspectDocument(document, mapping);
  const unknown = before.uniqueTokens.filter((token) => !mapping[token]);
  if (!before.taskIds.length && before.altered.length) throw safeError("ALTERED_TOKENS", "HTML 中存在残缺或被改写的已知代号。", before.altered.map((item) => `${item.location}：${item.value}`));
  if (!before.taskIds.length) throw safeError("NO_TOKENS", "HTML 中没有找到可还原的完整代号。");
  if (before.taskIds.length !== 1) throw safeError("MIXED_TASKS", "HTML 中混入了多个脱敏任务的代号。", before.taskIds);
  if (before.unsupportedOccurrences.length) throw safeError("UNSUPPORTED_CONTENT", "代号出现在脚本、样式、链接或其他不安全位置，已停止输出。", before.unsupportedOccurrences.map((item) => item.location));
  if (unknown.length) throw safeError("UNRESOLVED_TOKENS", "HTML 中存在本机无法确认的代号。", unknown);
  if (before.altered.length) throw safeError("ALTERED_TOKENS", "HTML 中存在残缺或被改写的已知代号。", before.altered.map((item) => `${item.location}：${item.value}`));
  if (!before.occurrences.length) throw safeError("NO_TOKENS", "HTML 中没有找到可还原的完整代号。");

  const scripts = takeKeptScripts(document);
  const removed = removeUnsafeContent(document);
  const restoredOccurrences = replaceAllowedTokens(document, scripts, mapping);
  const safeStyles = [...document.querySelectorAll("style")].map((style) => style.textContent).filter(Boolean).join("\n");
  const purifier = createDOMPurify(window);
  const sanitized = purifier.sanitize(serialize(document), {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [...BLOCKED_ELEMENTS],
    FORBID_ATTR: ["srcdoc"],
    ADD_TAGS: ["style"],
    ADD_ATTR: ["style"],
  });
  const postDocument = parser.parseFromString(sanitized, "text/html");
  // The sanitizer may or may not keep <style>; put back exactly one copy of the cleaned styles.
  for (const style of [...postDocument.querySelectorAll("style")]) style.remove();
  if (safeStyles) {
    const style = postDocument.createElement("style");
    style.textContent = safeStyles;
    postDocument.head.append(style);
  }
  ensureSecurityEnvelope(postDocument, scripts);
  const clean = scripts.length ? sandboxedPage(postDocument, parser) : serialize(postDocument);
  const post = inspectDocument(postDocument, mapping);
  if (post.occurrences.length || post.unsupportedOccurrences.length || post.altered.length) {
    throw safeError("RESIDUAL_TOKENS", "HTML 清理并还原后仍有代号残留，已停止输出。");
  }
  return { html: clean, restoredOccurrences, usedMappings: before.uniqueTokens.length, removed, keptScripts: scripts.length, partialRestore: false, unresolved: [] };
}

export function decodeHtmlFileBytes(bytes) {
  return decodeText(bytes);
}
