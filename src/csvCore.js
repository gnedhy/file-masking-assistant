import { classifyHeader, findKnownShortTokens, recommendedProcessingMode } from "./xlsxCore.js";
import { createEntityToken, parseEntityToken, tokenPattern, tokenOccurrence } from "./tokenFormat.js";

const DELIMITER_CANDIDATES = [",", "\t", ";"];
export const CSV_LIMITS = { rows: 200_000, columns: 500, cells: 5_000_000 };

function parseRows(text, delimiter, limits, sample = false) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  let cells = 0;
  const pushValue = () => {
    if (!sample && (rows.length >= limits.rows || row.length >= limits.columns || cells >= limits.cells)) {
      throw Object.assign(new Error("CSV 超出当前安全处理范围，已停止解析。"), {
        code: "CSV_LIMIT_EXCEEDED",
        details: [`第 ${rows.length + 1} 行，第 ${row.length + 1} 列`, `限制：${limits.rows} 行、${limits.columns} 列、${limits.cells} 个字段`],
      });
    }
    row.push(value);
    cells += 1;
    value = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    // ponytail: bounded dialect sample; ambiguous CSV still requires a consistent delimiter.
    if (sample && (rows.length >= 20 || index >= 64 * 1024)) return rows.length ? rows : [[...row, value]];
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"' && value === "") {
      quoted = true;
    } else if (character === delimiter) {
      pushValue();
    } else if (character === "\r" || character === "\n") {
      pushValue();
      rows.push(row);
      row = [];
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      value += character;
    }
  }

  if (quoted && !sample) throw new Error("CSV 中存在未闭合的引号");
  if (row.length || value !== "" || !/(?:\r\n|\r|\n)$/.test(text)) {
    pushValue();
    rows.push(row);
  }
  return rows;
}

function delimiterScore(rows) {
  const sample = rows.slice(0, 20).filter((row) => row.some((value) => String(value).trim()));
  if (!sample.length) return -1;
  const widths = new Map();
  for (const row of sample) widths.set(row.length, (widths.get(row.length) ?? 0) + 1);
  const [width, frequency] = [...widths.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0];
  if (width < 2) return -1;
  return frequency * 100 + width - (sample.length - frequency) * 10;
}

export function parseCsvText(input, limits = CSV_LIMITS) {
  const hadBom = String(input).startsWith("\uFEFF");
  const text = String(input).replace(/^\uFEFF/, "");
  const newline = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const trailingNewline = /(?:\r\n|\r|\n)$/.test(text);
  let best = null;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const rows = parseRows(text, delimiter, limits, true);
    const score = delimiterScore(rows);
    if (!best || score > best.score) best = { delimiter, rows, score };
  }

  return {
    rows: parseRows(text, best?.delimiter ?? ",", limits),
    delimiter: best?.delimiter ?? ",",
    newline,
    trailingNewline,
    hadBom,
  };
}

function escapeCsvValue(value, delimiter) {
  const text = String(value ?? "");
  if (text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function stringifyCsv(document) {
  const body = document.rows
    .map((row) => row.map((value) => escapeCsvValue(value, document.delimiter)).join(document.delimiter))
    .join(document.newline);
  return document.trailingNewline && body ? `${body}${document.newline}` : body;
}

function detectHeaderRow(rows) {
  const maximum = Math.min(rows.length, 20);
  let best = { rowNumber: 1, score: -1, sensitiveHits: -1 };
  for (let index = 0; index < maximum; index += 1) {
    const row = rows[index];
    const sensitiveHits = row.reduce(
      (count, value) => count + (classifyHeader(value).category === "custom" ? 0 : 1),
      0,
    );
    const score = row.filter((value) => String(value).trim()).length;
    if (sensitiveHits > best.sensitiveHits || (sensitiveHits === best.sensitiveHits && score > best.score)) {
      best = { rowNumber: index + 1, score, sensitiveHits };
    }
  }
  return best.rowNumber;
}

export function analyzeCsv(document) {
  const headerRow = detectHeaderRow(document.rows);
  const headers = document.rows[headerRow - 1] ?? [];
  const columns = headers.flatMap((rawHeader, index) => {
    const header = String(rawHeader).trim();
    if (!header) return [];
    const classification = classifyHeader(header);
    const samples = [];
    let valueCount = 0;
    for (let rowIndex = headerRow; rowIndex < document.rows.length; rowIndex += 1) {
      const value = document.rows[rowIndex][index] ?? "";
      if (!String(value).trim()) continue;
      valueCount += 1;
      if (samples.length < 3) samples.push(String(value));
    }
    return [{
      id: `CSV::${headerRow}::${index + 1}`,
      sheetName: "CSV",
      headerRow,
      columnNumber: index + 1,
      header,
      category: classification.category,
      prefix: classification.prefix,
      suggested: classification.category !== "custom",
      recommendedMode: recommendedProcessingMode(header),
      valueCount,
      complexCount: 0,
      samples,
    }];
  });

  const knownEntities = columns
    .filter((column) => column.suggested && column.recommendedMode !== "inline")
    .flatMap((column) => document.rows.slice(column.headerRow).map((row) => String(row[column.columnNumber - 1] ?? "").trim()))
    .filter(inlineDictionaryEligible);
  const entityIndex = buildEntityIndex([...new Set(knownEntities)].map(source => ({ source })));
  const suggestedColumns = columns.map((column) => {
    if (column.suggested || column.recommendedMode !== "inline") return column;
    const hasKnownEntity = document.rows.slice(column.headerRow).some((row) => {
      const text = String(row[column.columnNumber - 1] ?? "");
      return !entityMatches(text, entityIndex).next().done;
    });
    return hasKnownEntity ? { ...column, suggested: true } : column;
  });

  return {
    format: "csv",
    sheets: [{ name: "CSV", headerRow, rowCount: document.rows.length, columns: suggestedColumns.length }],
    columns: suggestedColumns,
    suggestedColumnIds: suggestedColumns.filter((column) => column.suggested).map((column) => column.id),
  };
}

function valueKey(value) {
  return `string:${JSON.stringify(String(value))}`;
}

function inlineDictionaryEligible(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  if (/^[\d\s.,%+-]+$/.test(normalized)) return normalized.replace(/\D/g, "").length >= 4;
  if (/^[\x00-\x7F]+$/.test(normalized)) {
    if (!/[A-Za-z0-9]/.test(normalized)) return false;
    if (/^[A-Za-z]+$/.test(normalized)) return normalized.length >= 2;
    return normalized.length >= 2;
  }
  return normalized.length >= 2;
}

function isAsciiWordCharacter(character) {
  return Boolean(character && /[A-Za-z0-9]/.test(character));
}

function independentEntityMatch(text, start, source) {
  const before = start > 0 ? text[start - 1] : "";
  const afterIndex = start + source.length;
  const after = afterIndex < text.length ? text[afterIndex] : "";
  if (isAsciiWordCharacter(source[0]) && isAsciiWordCharacter(before)) return false;
  if (isAsciiWordCharacter(source[source.length - 1]) && isAsciiWordCharacter(after)) return false;
  return true;
}

function buildEntityIndex(entries) {
  const root = { children: new Map(), entries: [] };
  for (const entry of entries) {
    if (!entry.source) continue;
    let node = root;
    // Both construction and lookup use UTF-16 units, including surrogate pairs.
    for (const character of entry.source.split("")) {
      if (!node.children.has(character)) node.children.set(character, { children: new Map(), entries: [] });
      node = node.children.get(character);
    }
    node.entries.push(entry);
  }
  return root;
}

function* entityMatches(text, root) {
  for (let start = 0; start < text.length; start += 1) {
    let node = root;
    for (let end = start; end < text.length; end += 1) {
      node = node.children.get(text[end]);
      if (!node) break;
      for (const entry of node.entries) {
        if (independentEntityMatch(text, start, entry.source)) yield entry;
      }
    }
  }
}

function replaceEntityInSegment(text, source, token) {
  const parts = [];
  let cursor = 0;
  let copiedUntil = 0;
  let replacements = 0;

  while (cursor <= text.length - source.length) {
    const index = text.indexOf(source, cursor);
    if (index < 0) break;
    if (!independentEntityMatch(text, index, source)) {
      cursor = index + 1;
      continue;
    }
    if (index > copiedUntil) parts.push({ text: text.slice(copiedUntil, index), protected: false });
    parts.push({ text: token, protected: true });
    replacements += 1;
    copiedUntil = index + source.length;
    cursor = copiedUntil;
  }

  if (!replacements) return { parts: [{ text, protected: false }], replacements: 0 };
  if (copiedUntil < text.length) parts.push({ text: text.slice(copiedUntil), protected: false });
  return { parts, replacements };
}

function replaceKnownEntities(text, entityIndex) {
  const dictionary = [...new Set(entityMatches(String(text), entityIndex))]
    .sort((left, right) => right.source.length - left.source.length || left.order - right.order);
  let segments = [{ text: String(text), protected: false }];
  let replacements = 0;
  for (const { source, token } of dictionary) {
    if (!source) continue;
    const next = [];
    for (const segment of segments) {
      if (segment.protected || !segment.text.includes(source)) {
        next.push(segment);
        continue;
      }
      const replaced = replaceEntityInSegment(segment.text, source, token);
      next.push(...replaced.parts);
      replacements += replaced.replacements;
    }
    segments = next;
  }
  return { text: segments.map((segment) => segment.text).join(""), replacements };
}

export function tokenizeCsv(document, selectedColumns, taskId) {
  const counters = { C: 0, P: 0, S: 0, X: 0 };
  const tokenByValue = new Map();
  const mapping = {};
  const warnings = [];
  const dictionaryBySource = new Map();
  let replacedCells = 0;

  const columnsByMode = {
    whole: selectedColumns.filter((column) => (column.processingMode || "whole") === "whole"),
    inline: selectedColumns.filter((column) => column.processingMode === "inline"),
  };

  for (const column of columnsByMode.whole) {
    const columnIndex = column.columnNumber - 1;
    for (let rowIndex = column.headerRow; rowIndex < document.rows.length; rowIndex += 1) {
      const row = document.rows[rowIndex];
      const value = row[columnIndex] ?? "";
      if (!String(value).trim()) continue;
      if (tokenPattern("").test(String(value))) {
        warnings.push({ location: `第 ${rowIndex + 1} 行，第 ${column.columnNumber} 列`, reason: "原文件已含本工具代号" });
        continue;
      }

      const prefix = column.prefix || "X";
      const key = `${prefix}:${valueKey(value)}`;
      let token = tokenByValue.get(key);
      if (!token) {
        counters[prefix] += 1;
        token = createEntityToken({ label: column.header, category: column.category, prefix, sequence: counters[prefix], taskId });
        tokenByValue.set(key, token);
        mapping[token] = {
          value: { type: "string", value: String(value) },
          category: column.category,
          header: column.header,
        };
      }
      const source = String(value);
      if (inlineDictionaryEligible(source) && !dictionaryBySource.has(source)) dictionaryBySource.set(source, token);
      while (row.length <= columnIndex) row.push("");
      row[columnIndex] = token;
      replacedCells += 1;
    }
  }

  const entityIndex = buildEntityIndex(Array.from(dictionaryBySource, ([source, token], order) => ({ source, token, order })));

  for (const column of columnsByMode.inline) {
    const columnIndex = column.columnNumber - 1;
    for (let rowIndex = column.headerRow; rowIndex < document.rows.length; rowIndex += 1) {
      const row = document.rows[rowIndex];
      const value = row[columnIndex] ?? "";
      if (!String(value).trim()) continue;
      if (tokenPattern("").test(String(value))) {
        warnings.push({ location: `第 ${rowIndex + 1} 行，第 ${column.columnNumber} 列`, reason: "原文件已含本工具代号" });
        continue;
      }
      const replaced = replaceKnownEntities(value, entityIndex);
      if (!replaced.replacements) continue;
      while (row.length <= columnIndex) row.push("");
      row[columnIndex] = replaced.text;
      replacedCells += replaced.replacements;
    }
  }

  return { mapping, replacedCells, uniqueValues: Object.keys(mapping).length, warnings, notices: [] };
}

export function inspectCsvTokens(document) {
  const occurrences = [];
  const taskIds = new Set();
  document.rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      for (const match of String(value).matchAll(tokenPattern())) {
        const parsed = tokenOccurrence(match[0]);
        taskIds.add(parsed.taskId);
        occurrences.push({
          ...parsed,
          rowNumber: rowIndex + 1,
          columnNumber: columnIndex + 1,
          location: `第 ${rowIndex + 1} 行，第 ${columnIndex + 1} 列`,
          kind: "text",
        });
      }
    });
  });
  return {
    occurrences,
    taskIds: [...taskIds],
    uniqueTokens: [...new Set(occurrences.map((item) => item.token))],
  };
}

export function inspectCsvAlteredTokens(document, mapping) {
  const knownShortTokens = new Set(Object.keys(mapping).map((token) => parseEntityToken(token)?.shortToken).filter(Boolean));
  const findings = [];
  document.rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      const withoutFull = String(value).replace(tokenPattern(), " ");
      let malformedFound = false;
      for (const malformed of withoutFull.matchAll(/\[\[[^\]]{1,80}(?:\]\]|$)/g)) {
        malformedFound = true;
        findings.push({ location: `第 ${rowIndex + 1} 行，第 ${columnIndex + 1} 列`, value: malformed[0] });
      }
      if (malformedFound) return;
      for (const shortToken of findKnownShortTokens(withoutFull, knownShortTokens)) {
        findings.push({ location: `第 ${rowIndex + 1} 行，第 ${columnIndex + 1} 列`, value: shortToken });
      }
    });
  });
  return findings;
}

function replacementText(serialized) {
  if (serialized.type === "date") return String(serialized.value).slice(0, 10);
  if (serialized.type === "richText") return String(serialized.text ?? "");
  return String(serialized.value ?? "");
}

export function restoreCsvValues(document, mapping) {
  const inspection = inspectCsvTokens(document);
  const unresolved = inspection.occurrences
    .filter((occurrence) => !mapping[occurrence.token])
    .map((occurrence) => ({ ...occurrence, reason: "本机没有对应还原记录" }));
  if (unresolved.length) return { restoredOccurrences: 0, unresolved, inspection };

  let restoredOccurrences = 0;
  document.rows.forEach((row) => {
    row.forEach((value, columnIndex) => {
      row[columnIndex] = String(value).replace(tokenPattern(), (token) => {
        restoredOccurrences += 1;
        return replacementText(mapping[token].value);
      });
    });
  });
  return { restoredOccurrences, unresolved: [], inspection };
}

export function findCsvSensitiveResiduals(document, mapping) {
  const sources = [...new Set(Object.values(mapping).map((entry) => String(entry?.value?.value ?? "")).filter(Boolean))];
  const root = buildEntityIndex(sources.map(source => ({ source })));

  const findings = [];
  document.rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const text = String(value ?? "").replace(tokenPattern(), " ");
    const location = `第 ${rowIndex + 1} 行，第 ${columnIndex + 1} 列`;
    for (const { source } of entityMatches(text, root)) {
      findings.push({ location, sheetName: "CSV", row: rowIndex + 1, columnNumber: columnIndex + 1, eligible: inlineDictionaryEligible(source), reason: inlineDictionaryEligible(source)
        ? "已选真实值仍出现在脱敏结果中"
        : "已选短名称或短编码仍出现在此处；不自动猜测替换，请将该列设为整格替换或先整理原文件" });
    }
  }));
  return findings;
}

export function findCsvFormulaCells(document) {
  const headers = document.rows[detectHeaderRow(document.rows) - 1] ?? [];
  const findings = [];
  document.rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const text = String(value ?? "");
    const trimmed = text.replace(/^[\t\r\n ]+/, "");
    if (!/^[=+\-@]/.test(trimmed) || /^[+\-]\d+(?:[.,]\d+)?%?$/.test(trimmed)) return;
    findings.push({ location: `第 ${rowIndex + 1} 行，第 ${columnIndex + 1} 列`, row: rowIndex + 1, header: String(headers[columnIndex] ?? "").trim(), value: trimmed.slice(0, 80) });
  }));
  return findings;
}
