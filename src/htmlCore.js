import createDOMPurify from "dompurify";
import { findKnownShortTokens, tokenPattern } from "./xlsxCore.js";

export const HTML_LIMITS = { bytes: 10 * 1024 * 1024, nodes: 50000 };

const BLOCKED_ELEMENTS = new Set([
  "script", "link", "base", "iframe", "frame", "frameset", "form", "input", "button",
  "textarea", "select", "option", "object", "embed", "applet", "svg", "math", "template",
]);
const TOKEN_FORBIDDEN_ELEMENTS = new Set([...BLOCKED_ELEMENTS, "style"]);
const ALLOWED_TOKEN_ATTRIBUTES = new Set(["title", "alt", "aria-label"]);
const RESOURCE_ATTRIBUTES = new Set(["src", "srcset", "href", "xlink:href", "action", "formaction", "poster"]);

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
    token: match[0], shortToken: match[1], taskId: match[2], location,
  }));
}

function inspectDocument(document, mapping = null) {
  const occurrences = [];
  const unsupportedOccurrences = [];
  const altered = [];
  const knownShortTokens = new Set(Object.keys(mapping ?? {}).map((token) => token.match(/^\[\[([^@]+)@/)?.[1]).filter(Boolean));
  let nodeCount = 0;

  const walker = document.createTreeWalker(document, 0xFFFFFFFF);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodeCount += 1;
    if (nodeCount > HTML_LIMITS.nodes) throw safeError("PACKAGE_TOO_LARGE", "HTML 页面节点超过 50,000 个，已停止处理。");
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      const location = parent ? `<${parent.tagName.toLowerCase()}> 可见文字` : "可见文字";
      const matches = scanValue(node.nodeValue, location);
      if (parent && TOKEN_FORBIDDEN_ELEMENTS.has(parent.tagName.toLowerCase())) unsupportedOccurrences.push(...matches);
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

function replaceAllowedTokens(document, mapping) {
  let restoredOccurrences = 0;
  const replace = (value) => String(value).replace(tokenPattern(), (token) => {
    const entry = mapping[token];
    if (!entry) return token;
    restoredOccurrences += 1;
    return serializedValueAsText(entry);
  });
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

function ensureSecurityEnvelope(document) {
  if (!document.documentElement) document.append(document.createElement("html"));
  if (!document.head) document.documentElement.prepend(document.createElement("head"));
  for (const existing of [...document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')]) existing.remove();
  const csp = document.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  document.head.prepend(csp);
}

function serialize(document) {
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function inspectHtmlText(html, window, mapping = null) {
  const parser = new window.DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const inspection = inspectDocument(document, mapping);
  const sanitized = document.cloneNode(true);
  const removed = removeUnsafeContent(sanitized);
  const purifier = createDOMPurify(window);
  const purified = purifier.sanitize(serialize(sanitized), {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [...BLOCKED_ELEMENTS],
    FORBID_ATTR: ["srcdoc"],
    ADD_TAGS: ["style"],
    ADD_ATTR: ["style"],
  });
  return { ...inspection, removed, sanitizedHtml: purified };
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
  if (unknown.length) throw safeError("UNRESOLVED_TOKENS", "HTML 中存在本机无法确认的正式代号。", unknown);
  if (before.altered.length) throw safeError("ALTERED_TOKENS", "HTML 中存在残缺或被改写的已知代号。", before.altered.map((item) => `${item.location}：${item.value}`));
  if (!before.occurrences.length) throw safeError("NO_TOKENS", "HTML 中没有找到可还原的完整代号。");

  const removed = removeUnsafeContent(document);
  const restoredOccurrences = replaceAllowedTokens(document, mapping);
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
  if (safeStyles) {
    const style = postDocument.createElement("style");
    style.textContent = safeStyles;
    postDocument.head.append(style);
  }
  ensureSecurityEnvelope(postDocument);
  const clean = serialize(postDocument);
  const post = inspectDocument(postDocument, mapping);
  if (post.occurrences.length || post.unsupportedOccurrences.length || post.altered.length) {
    throw safeError("RESIDUAL_TOKENS", "HTML 清理并还原后仍有代号残留，已停止输出。");
  }
  return { html: clean, restoredOccurrences, usedMappings: before.uniqueTokens.length, removed };
}

export function decodeHtmlFileBytes(bytes) {
  return decodeText(bytes);
}
