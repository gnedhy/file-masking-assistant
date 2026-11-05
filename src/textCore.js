import { sensitiveNumberCandidates } from "./sensitivePatterns.js";
import { classifyHeader, findKnownShortTokens, isPlaceholderValue } from "./xlsxCore.js";
import { createEntityToken, parseEntityToken, tokenPattern, tokenOccurrence } from "./tokenFormat.js";

function splitMarkdownRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function isMarkdownSeparator(line) {
  const cells = splitMarkdownRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isIndependentMatch(text, source, index) {
    const before = text[index - 1] ?? "";
    const after = text[index + source.length] ?? "";
    const leftBlocked = /[A-Za-z0-9]/.test(source[0]) && /[A-Za-z0-9]/.test(before);
    const rightBlocked = /[A-Za-z0-9]/.test(source.at(-1)) && /[A-Za-z0-9]/.test(after);
  return !leftBlocked && !rightBlocked;
}

function occurrenceIndexes(text, source) {
  const indexes = [];
  let cursor = 0;
  while (cursor <= text.length - source.length) {
    const index = text.indexOf(source, cursor);
    if (index < 0) break;
    if (isIndependentMatch(text, source, index)) indexes.push(index);
    cursor = index + Math.max(1, source.length);
  }
  return indexes;
}

function contextAt(text, index, length) {
  const start = Math.max(0, text.lastIndexOf("\n", index - 1) + 1);
  const endIndex = text.indexOf("\n", index + length);
  return text.slice(start, endIndex < 0 ? text.length : endIndex).trim().slice(0, 180);
}

// kind overrides the category guessed from the label (form labels such as 法人 are not column headers).
export function buildTextCandidate(value, label, text, manual = false, kind = null) {
  const normalized = String(value).trim();
  const indexes = occurrenceIndexes(text, normalized);
  if (!normalized || !indexes.length || tokenPattern("").test(normalized)) return null;
  const classification = kind ?? (manual ? { category: "custom", prefix: "X" } : classifyHeader(label));
  return {
    id: `TEXT::${encodeURIComponent(normalized)}`,
    value: normalized,
    label: label || "手动添加",
    category: classification.category,
    prefix: classification.prefix,
    count: indexes.length,
    contexts: indexes.slice(0, 3).map((index) => contextAt(text, index, normalized.length)),
    suggested: !manual,
    manual,
  };
}

export function analyzeText(text, format) {
  const found = new Map();
  const add = (value, label) => {
    if (isPlaceholderValue(value)) return;
    const item = buildTextCandidate(value, label, text);
    if (item && !found.has(item.value)) found.set(item.value, item);
  };
  const lines = text.split(/\r\n|\r|\n/);

  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]\s*)?([^:：|]{1,32})\s*[:：]\s*(.+?)\s*$/);
    if (match && classifyHeader(match[1]).category !== "custom") add(match[2], match[1]);
  }

  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index].includes("|") || !isMarkdownSeparator(lines[index + 1])) continue;
    const headers = splitMarkdownRow(lines[index]);
    const sensitive = headers.map((header, column) => ({ header, column, ...classifyHeader(header) })).filter((item) => item.category !== "custom");
    if (!sensitive.length) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length && lines[rowIndex].includes("|"); rowIndex += 1) {
      const cells = splitMarkdownRow(lines[rowIndex]);
      sensitive.forEach(({ header, column }) => add(cells[column], header));
    }
  }

  // Phone, ID, bank card and e-mail numbers anywhere in the text.
  for (const item of sensitiveNumberCandidates(text)) if (!found.has(item.value)) found.set(item.value, item);

  const candidates = [...found.values()];
  return {
    kind: "text",
    format,
    sourceText: text,
    candidates,
    suggestedCandidateIds: candidates.map((item) => item.id),
  };
}

export function addManualCandidate(analysis, value) {
  const item = buildTextCandidate(value, "手动添加", analysis.sourceText, true);
  if (!item) throw Object.assign(new Error("文件中没有找到这段完整文字。"), { code: "TEXT_VALUE_NOT_FOUND" });
  if (analysis.candidates.some((entry) => entry.value === item.value)) {
    throw Object.assign(new Error("这段内容已经在候选列表中。"), { code: "TEXT_VALUE_EXISTS" });
  }
  return item;
}

export function tokenizeText(text, selectedCandidates, taskId) {
  const counters = { C: 0, P: 0, S: 0, X: 0 };
  const mapping = {};
  const entries = [...selectedCandidates]
    .sort((left, right) => right.value.length - left.value.length)
    .map((item) => {
      const prefix = item.prefix || "X";
      counters[prefix] += 1;
      return { ...item, token: createEntityToken({ label: item.label, category: item.category, prefix, sequence: counters[prefix], taskId }), used: false };
    });
  let output = "";
  let replacedOccurrences = 0;
  for (let cursor = 0; cursor < text.length;) {
    const item = entries.find((entry) => text.startsWith(entry.value, cursor) && isIndependentMatch(text, entry.value, cursor));
    if (!item) {
      output += text[cursor];
      cursor += 1;
      continue;
    }
    output += item.token;
    item.used = true;
    replacedOccurrences += 1;
    cursor += item.value.length;
  }
  entries.filter((item) => item.used).forEach((item) => {
    mapping[item.token] = { value: { type: "string", value: item.value }, category: item.category, header: item.label };
  });
  return { text: output, mapping, replacedOccurrences, uniqueValues: Object.keys(mapping).length };
}

export function inspectTextTokens(text) {
  const occurrences = [...text.matchAll(tokenPattern())].map((match) => ({ ...tokenOccurrence(match[0]), index: match.index }));
  return {
    occurrences,
    taskIds: [...new Set(occurrences.map((item) => item.taskId))],
    uniqueTokens: [...new Set(occurrences.map((item) => item.token))],
  };
}

export function inspectAlteredTextTokens(text, mapping) {
  const knownShortTokens = new Set(Object.keys(mapping).map((token) => parseEntityToken(token)?.shortToken).filter(Boolean));
  const withoutFull = text.replace(tokenPattern(), " ");
  const malformed = [...withoutFull.matchAll(/\[\[[^\]]{1,80}(?:\]\]|$)/g)].map((match) => ({ value: match[0], index: match.index }));
  if (malformed.length) return malformed;
  return findKnownShortTokens(withoutFull, knownShortTokens).map((value) => ({ value, index: withoutFull.indexOf(value) }));
}

export function restoreText(text, mapping) {
  const inspection = inspectTextTokens(text);
  const unresolved = inspection.occurrences.filter((item) => !mapping[item.token]);
  if (unresolved.length) return { text, restoredOccurrences: 0, unresolved, inspection };
  let restoredOccurrences = 0;
  const restored = text.replace(tokenPattern(), (token) => {
    restoredOccurrences += 1;
    return String(mapping[token].value?.value ?? "");
  });
  return { text: restored, restoredOccurrences, unresolved: [], inspection };
}
