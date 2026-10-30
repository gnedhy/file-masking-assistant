import { createEntityToken, parseEntityToken, tokenPattern, tokenOccurrence } from "./tokenFormat.js";

export { tokenPattern };

const NARRATIVE_HEADER_PATTERN = /(反馈|备注|说明|描述|原因|计划|进展|推进|意见|要求|情况|feedback|notes?|remarks?|comments?|description|followup|progress|plan)/i;

const CATEGORY_RULES = [
  { category: "customer", prefix: "C", pattern: /^(?:客户(?:名称|姓名|编码|编号|简称|k码|名|单位|公司)?|经销商(?:名称)?|供应商(?:名称)?|公司名称|竞品厂家|customer(?:name|id|code)?|client(?:name|id|code)?|account(?:name|id|code)?)$/i },
  { category: "product", prefix: "P", pattern: /^(?:(?:推荐)?产品(?:内部)?(?:名称|编码|编号|型号|内编|对外名称)?|物料(?:名称|编码|编号)?|sku|大货编码|品名|货号|product(?:name|code|id|model)?|item(?:name|code|id)?|material(?:name|code|id)?)$/i },
  { category: "sales", prefix: "S", pattern: /^(?:销售(?:人员|员|代表|负责人)|业务(?:员|代表|负责人)|客户经理|实验员|产品经理|跟进人|sales(?:rep|representative|owner|person)?|accountmanager)$/i },
];

function normalizeHeader(header) {
  return String(header)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .split(/[\n（(【[\/／|]/, 1)[0]
    .replace(/[\s_：:\-—]+/g, "");
}

export function findKnownShortTokens(text, knownShortTokens) {
  const findings = [];
  for (const match of String(text).matchAll(/(?:客户|产品|人员|信息)(?:[\-－—–_][a-z0-9]{1,8}(?:[\s\-－—–_]+[a-z0-9]*)?|\s+[a-z0-9]{4}[\s\-－—–_]+[0-9]+)/gi)) findings.push(match[0]);
  for (const match of String(text).matchAll(/(^|[^A-Z0-9])([CPSX]\d{3,})(?=[^A-Z0-9]|$)/g)) {
    if (knownShortTokens.has(match[2])) findings.push(match[2]);
  }
  return findings;
}

export function classifyHeader(header) {
  const match = CATEGORY_RULES.find((rule) => rule.pattern.test(normalizeHeader(header)));
  return match ? { category: match.category, prefix: match.prefix } : { category: "custom", prefix: "X" };
}

export function recommendedProcessingMode(header) {
  const normalized = String(header).trim();
  const primaryHeader = normalizeHeader(normalized);
  if (/(?:日期|时间|计数|数量|金额|价格|率|date|time|count|qty|quantity|amount|price|rate|revenue)$/.test(primaryHeader)) return "whole";
  return NARRATIVE_HEADER_PATTERN.test(normalized) ? "inline" : "whole";
}

function richTextCellValue(value) {
  return value && typeof value === "object" && Array.isArray(value.richText);
}

function plainCellValue(value) {
  return (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  );
}

function formulaCellValue(value) {
  return value && typeof value === "object" && ("formula" in value || "sharedFormula" in value);
}

function valueAsText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (richTextCellValue(value)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return String(value);
}

function serializeValue(value) {
  if (value instanceof Date) return { type: "date", value: value.toISOString() };
  if (richTextCellValue(value)) return { type: "richText", value, text: valueAsText(value) };
  return { type: typeof value, value };
}

function deserializeValue(serialized) {
  if (serialized.type === "date") return new Date(serialized.value);
  return serialized.value;
}

function valueKey(value) {
  const serialized = serializeValue(value);
  return `${serialized.type}:${JSON.stringify(serialized.type === "richText" ? serialized.text : serialized.value)}`;
}

function nonEmptyCount(row) {
  let count = 0;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (valueAsText(cell.value).trim()) count += 1;
  });
  return count;
}

function detectHeaderRow(worksheet) {
  const maximum = Math.min(worksheet.rowCount, 20);
  let best = { rowNumber: 1, score: -1, sensitiveHits: -1 };
  for (let rowNumber = 1; rowNumber <= maximum; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let sensitiveHits = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const classification = classifyHeader(valueAsText(cell.value));
      if (classification.category !== "custom") sensitiveHits += 1;
    });
    const score = nonEmptyCount(row);
    if (sensitiveHits > best.sensitiveHits || (sensitiveHits === best.sensitiveHits && score > best.score)) {
      best = { rowNumber, score, sensitiveHits };
    }
  }
  return best.rowNumber;
}

function candidateId(sheetName, headerRow, columnNumber) {
  return `${sheetName}::${headerRow}::${columnNumber}`;
}

export function analyzeWorkbook(workbook) {
  const sheets = [];
  const columns = [];

  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    const headerRow = detectHeaderRow(worksheet);
    const row = worksheet.getRow(headerRow);
    const sheetColumns = [];

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = valueAsText(cell.value).trim();
      if (!header) return;
      const classification = classifyHeader(header);
      const samples = [];
      let valueCount = 0;
      let complexCount = 0;

      for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const value = worksheet.getRow(rowNumber).getCell(columnNumber).value;
        if (value == null || value === "") continue;
        if (richTextCellValue(value)) {
          valueCount += 1;
          if (samples.length < 3) samples.push(valueAsText(value));
          continue;
        }
        if (!plainCellValue(value)) {
          complexCount += 1;
          continue;
        }
        valueCount += 1;
        if (samples.length < 3) samples.push(valueAsText(value));
      }

      const candidate = {
        id: candidateId(worksheet.name, headerRow, columnNumber),
        sheetName: worksheet.name,
        headerRow,
        columnNumber,
        header,
        category: classification.category,
        prefix: classification.prefix,
        suggested: classification.category !== "custom",
        recommendedMode: recommendedProcessingMode(header),
        valueCount,
        complexCount,
        samples,
      };
      sheetColumns.push(candidate);
      columns.push(candidate);
    });

    sheets.push({ name: worksheet.name, headerRow, rowCount: worksheet.rowCount, columns: sheetColumns.length });
  });

  return {
    sheets,
    columns,
    suggestedColumnIds: columns.filter((column) => column.suggested).map((column) => column.id),
  };
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

function replaceKnownEntities(text, dictionary) {
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

export function tokenizeWorkbook(workbook, selectedColumns, taskId) {
  const counters = { C: 0, P: 0, S: 0, X: 0 };
  const tokenByValue = new Map();
  const mapping = {};
  const warnings = [];
  const notices = [];
  const dictionaryBySource = new Map();
  let replacedCells = 0;

  const columnsByMode = {
    whole: selectedColumns.filter((column) => (column.processingMode || "whole") === "whole"),
    inline: selectedColumns.filter((column) => column.processingMode === "inline"),
  };

  for (const column of columnsByMode.whole) {
    const worksheet = workbook.getWorksheet(column.sheetName);
    if (!worksheet) {
      warnings.push({ location: column.sheetName, reason: "工作表不存在" });
      continue;
    }

    for (let rowNumber = column.headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const cell = worksheet.getRow(rowNumber).getCell(column.columnNumber);
      const value = cell.value;
      if (value == null || value === "") continue;
      if (formulaCellValue(value)) {
        const { result: cachedResult, ...formulaWithoutCachedResult } = value;
        cell.value = formulaWithoutCachedResult;
        notices.push({
          location: `${worksheet.name}!${cell.address}`,
          reason: cachedResult == null ? "公式结构已保留" : "公式缓存结果已清除，实名还原后重新计算",
        });
        continue;
      }
      if (!plainCellValue(value) && !richTextCellValue(value)) {
        warnings.push({ location: `${worksheet.name}!${cell.address}`, reason: "暂不支持的单元格对象未替换" });
        continue;
      }

      const visibleValue = richTextCellValue(value) ? valueAsText(value) : value;
      if (visibleValue === "") continue;
      if (typeof visibleValue === "string" && tokenPattern("").test(visibleValue)) {
        warnings.push({ location: `${worksheet.name}!${cell.address}`, reason: "原文件已含本工具代号，未重复处理" });
        continue;
      }

      const prefix = column.prefix || "X";
      const key = `${prefix}:${valueKey(visibleValue)}`;
      let token = tokenByValue.get(key);
      if (!token) {
        counters[prefix] += 1;
        token = createEntityToken({ label: column.header, category: column.category, prefix, sequence: counters[prefix], taskId });
        tokenByValue.set(key, token);
        mapping[token] = {
          value: serializeValue(value),
          category: column.category,
          header: column.header,
        };
      }
      const source = String(visibleValue);
      if (inlineDictionaryEligible(source) && !dictionaryBySource.has(source)) dictionaryBySource.set(source, token);
      cell.value = token;
      replacedCells += 1;
    }
  }

  const dictionary = Array.from(dictionaryBySource, ([source, token]) => ({ source, token }))
    .sort((left, right) => right.source.length - left.source.length);

  for (const column of columnsByMode.inline) {
    const worksheet = workbook.getWorksheet(column.sheetName);
    if (!worksheet) {
      warnings.push({ location: column.sheetName, reason: "工作表不存在" });
      continue;
    }
    for (let rowNumber = column.headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const cell = worksheet.getRow(rowNumber).getCell(column.columnNumber);
      const value = cell.value;
      if (value == null || value === "") continue;
      if (formulaCellValue(value)) {
        const { result: cachedResult, ...formulaWithoutCachedResult } = value;
        cell.value = formulaWithoutCachedResult;
        notices.push({
          location: `${worksheet.name}!${cell.address}`,
          reason: cachedResult == null ? "公式结构已保留" : "公式缓存结果已清除，实名还原后重新计算",
        });
        continue;
      }
      if (!plainCellValue(value) && !richTextCellValue(value)) {
        warnings.push({ location: `${worksheet.name}!${cell.address}`, reason: "暂不支持的单元格对象未检查" });
        continue;
      }
      const sourceText = valueAsText(value);
      if (tokenPattern("").test(sourceText)) {
        warnings.push({ location: `${worksheet.name}!${cell.address}`, reason: "原文件已含本工具代号，未重复处理" });
        continue;
      }
      const replaced = replaceKnownEntities(sourceText, dictionary);
      if (!replaced.replacements) continue;
      cell.value = replaced.text;
      replacedCells += replaced.replacements;
      if (richTextCellValue(value)) {
        notices.push({ location: `${worksheet.name}!${cell.address}`, reason: "富文本中的已知实体已替换，局部文字样式已统一" });
      }
    }
  }

  return { mapping, replacedCells, uniqueValues: Object.keys(mapping).length, warnings, notices };
}

export function addTaskMarker(workbook, metadata) {
  const previous = workbook.getWorksheet("__AI安全任务");
  if (previous) workbook.removeWorksheet(previous.id);
  const sheet = workbook.addWorksheet("__AI安全任务", { state: "veryHidden" });
  sheet.addRows([
    ["文件脱敏助手", "请勿修改此页"],
    ["版本", "1"],
    ["任务指纹", metadata.taskId],
    ["生成时间", metadata.createdAt],
  ]);
  sheet.state = "veryHidden";
}

function textTokens(text) {
  const matches = [];
  for (const match of String(text).matchAll(tokenPattern())) {
    matches.push(tokenOccurrence(match[0]));
  }
  return matches;
}

export function inspectWorkbookTokens(workbook) {
  const occurrences = [];
  const taskIds = new Set();

  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        let text = "";
        let kind = "plain";
        if (typeof value === "string") text = value;
        else if (value && Array.isArray(value.richText)) {
          text = valueAsText(value);
          kind = "richText";
        } else if (value && typeof value === "object" && "formula" in value) {
          text = String(value.formula ?? "");
          kind = "formula";
        } else return;

        for (const match of textTokens(text)) {
          taskIds.add(match.taskId);
          occurrences.push({ ...match, sheetName: worksheet.name, address: cell.address, kind });
        }
      });
    });
  });

  return { occurrences, taskIds: [...taskIds], uniqueTokens: [...new Set(occurrences.map((item) => item.token))] };
}

export function inspectWorkbookAlteredTokens(workbook, mapping) {
  const knownShortTokens = new Set(Object.keys(mapping).map((token) => parseEntityToken(token)?.shortToken).filter(Boolean));
  const findings = [];
  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        let text = "";
        let formula = false;
        if (typeof value === "string") text = value;
        else if (value && Array.isArray(value.richText)) text = valueAsText(value);
        else if (value && typeof value === "object" && "formula" in value) {
          text = String(value.formula ?? "");
          formula = true;
        }
        else return;
        const withoutFull = text.replace(tokenPattern(), " ");
        for (const malformed of withoutFull.matchAll(/\[\[[^\]]{1,80}(?:\]\]|$)/g)) {
          findings.push({ sheetName: worksheet.name, address: cell.address, value: malformed[0] });
        }
        if (formula) return;
        for (const shortToken of findKnownShortTokens(withoutFull, knownShortTokens)) {
          findings.push({ sheetName: worksheet.name, address: cell.address, value: shortToken });
        }
      });
    });
  });
  return findings;
}

function replacementText(serialized) {
  if (serialized?.type === "richText") return String(serialized.text ?? valueAsText(serialized.value));
  const value = deserializeValue(serialized);
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

export function restoreWorkbookValues(workbook, mapping) {
  const inspection = inspectWorkbookTokens(workbook);
  const unresolved = [];
  let restoredOccurrences = 0;

  for (const occurrence of inspection.occurrences) {
    if (!mapping[occurrence.token]) {
      unresolved.push({ ...occurrence, reason: "本机没有对应还原记录" });
    } else if (occurrence.kind === "formula") {
      unresolved.push({ ...occurrence, reason: "公式中的代号不自动改写" });
    }
  }
  if (unresolved.length) return { restoredOccurrences: 0, unresolved, inspection };

  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        if (typeof value === "string") {
          const exact = mapping[value];
          if (exact) {
            cell.value = deserializeValue(exact.value);
            restoredOccurrences += 1;
            return;
          }
          cell.value = value.replace(tokenPattern(), (token) => {
            const entry = mapping[token];
            if (!entry) return token;
            restoredOccurrences += 1;
            return replacementText(entry.value);
          });
        } else if (value && Array.isArray(value.richText)) {
          cell.value = {
            ...value,
            richText: value.richText.map((part) => ({
              ...part,
              text: String(part.text ?? "").replace(tokenPattern(), (token) => {
                const entry = mapping[token];
                if (!entry) return token;
                restoredOccurrences += 1;
                return replacementText(entry.value);
              }),
            })),
          };
        }
      });
    });
  });

  return { restoredOccurrences, unresolved: [], inspection };
}

export function removeTaskMarker(workbook) {
  const marker = workbook.getWorksheet("__AI安全任务");
  if (marker) workbook.removeWorksheet(marker.id);
}
