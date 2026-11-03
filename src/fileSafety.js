import { parseEntityToken } from "./tokenFormat.js";

export function protectedOutputName(format, taskId) {
  return `脱敏文件_${taskId}.${format}`;
}

// Name restored files by the short marker when present, without repeating the task label.
export function restoredOutputName(fileName, format, vault) {
  const label = vault.marker || vault.taskId;
  const base = String(fileName).replace(/\.[^.]+$/, "").replace(/_(?:脱敏版|安全副本|还原版)(?:_[A-Za-z0-9-]+)?$/, "");
  if (base === `脱敏文件_${label}`) return `还原文件_${label}.${format}`;
  const stem = base.endsWith(`_${label}`) ? base.slice(0, -label.length - 1) : base;
  return `${stem}_还原版_${label}.${format}`;
}

export function occurrenceBaseline(occurrences) {
  return occurrences.reduce((counts, { token }) => ({ ...counts, [token]: (counts[token] || 0) + 1 }), {});
}

// A file in another format than the source (an AI summary deck from a sales sheet) is new writing, so tokens
// it leaves out are expected. Only a file in the source's own format is expected to keep every token.
export function occurrenceComparison(vault, occurrences, format) {
  const baseline = vault?.occurrenceBaseline;
  if (!baseline) return null;
  const rewritten = Boolean(vault.sourceFormat) && vault.sourceFormat !== format;
  const returned = occurrenceBaseline(occurrences);
  const tokens = new Set([...Object.keys(baseline), ...Object.keys(returned)]);
  let original = 0, current = 0, missing = 0, added = 0;
  const byToken = [];
  for (const token of tokens) {
    const before = baseline[token] || 0, after = returned[token] || 0;
    original += before; current += after;
    missing += Math.max(0, before - after); added += Math.max(0, after - before);
    byToken.push({
      token,
      semanticLabel: parseEntityToken(token)?.semanticLabel ?? null,
      original: before,
      returned: after,
      missing: Math.max(0, before - after),
      added: Math.max(0, after - before),
    });
  }
  return { original, returned: current, missing, added, rewritten, byToken };
}

export function suspiciousTextFindings(text) {
  const findings = [];
  const pattern = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
  for (const match of String(text).matchAll(pattern)) {
    findings.push(`位置 ${match.index + 1}：U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    if (findings.length >= 20) break;
  }
  return findings;
}

export function highRiskTextFindings(text) {
  const source = String(text ?? "");
  const rules = [
    ["手机号码", /(?<!\d)1[3-9]\d{9}(?!\d)/g],
    ["电子邮箱", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ["身份证号码", /(?<!\d)\d{17}[\dXx](?!\d)/g],
    ["精确地址", /[\u4e00-\u9fff]{2,}(?:省|市|区|县|镇|街道|路|街)[^\r\n,，;；]{2,30}(?:号|室|栋|单元)/g],
  ];
  return rules.flatMap(([label, pattern]) => {
    const count = [...source.matchAll(pattern)].length;
    return count ? [{ label, count }] : [];
  });
}
