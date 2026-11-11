import { aliasWithGap, createEntityToken, parseEntityToken, replaceAliases, tokenPattern, tokenOccurrence } from "./tokenFormat.js";

export { tokenPattern };

const NARRATIVE_HEADER_PATTERN = /(反馈|备注|说明|描述|原因|计划|进展|推进|意见|要求|情况|feedback|notes?|remarks?|comments?|description|followup|progress|plan)/i;

const CATEGORY_RULES = [
  { category: "customer", prefix: "C", pattern: /^(?:客户(?:中文|英文)?(?:名称|全称|全名|姓名|编码|编号|简称|k码|名|单位|公司)?|经销商(?:名称|全称)?|供应商(?:名称|全称)?|公司(?:名称|全称)|企业(?:名称|全称)|单位(?:名称|全称)|往来单位|竞品厂家|customer(?:name|id|code)?|client(?:name|id|code)?|account(?:name|id|code)?)$/i },
  { category: "product", prefix: "P", pattern: /^(?:(?:推荐)?产品(?:内部)?(?:名称|编码|编号|型号|内编|对外名称)?|物料(?:名称|编码|编号)?|sku|大货编码|品名|货号|product(?:name|code|id|model)?|item(?:name|code|id)?|material(?:name|code|id)?)$/i },
  { category: "contact", prefix: "X", pattern: /^(?:手机(?:号码|号)?|电话(?:号码)?|联系电话|联系手机|联系方式|固话|座机|微信(?:号)?|邮箱|电子邮箱|e-?mail|身份证(?:号码|号)?|证件号(?:码)?|银行(?:账号|账户|卡号)|银行卡(?:号)?|卡号|(?:收货|送货|发货|详细|联系|通讯|公司|注册|办公|家庭|邮寄|收件)?地址|开户(?:行|银行)(?:及账号)?|(?:对公|收款|付款)?(?:账号|帐号|账户)|税号|纳税人识别号|统一社会信用代码|信用代码|车牌(?:号码|号)?|qq(?:号)?|传真|工号|员工(?:编号|工号)|护照(?:号码|号)?|phone|mobile|tel|address|fax)$/i },
  { category: "sales", prefix: "S", pattern: /^(?:销售(?:人员|员|代表|负责人)|业务(?:员|代表|负责人|经理)|客户经理|区域经理|负责人|对接人|经办人|跟单(?:员|人)?|联系人|姓名|实验员|产品经理|跟进人|sales(?:rep|representative|owner|person)?|accountmanager)$/i },
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

// Cells that only say "nothing here" (/, -, 无, N/A …) are not names: they stay as they are and are never
// treated as real values, otherwise the leftover check finds "/" all over the file.
export function isPlaceholderValue(value) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return true;
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) return true;
  // 合计 / 小计 at the foot of a name column label the row; they are not a customer or a person.
  return /^(?:无|空|暂无|未知|不详|待定|n\/?a|none|null|nil|合计|小计|总计|累计|汇总|total|subtotal)$/i.test(text);
}

// How a selected value is looked for when checking that nothing real is left behind. Numbers and short codes
// (100, 2026, A1, K) occur all over a workbook by chance, so they only count when a whole text equals them;
// names and longer codes count wherever they appear inside a text.
export function residualMatches(text, value) {
  const needle = String(value ?? "").trim();
  if (!needle) return false;
  const haystack = String(text ?? "");
  if (isLongNumber(needle)) {
    // Phone, ID and account numbers count inside longer text too, but not as part of a longer run of digits.
    for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) {
      if (!/\d/.test(haystack[index - 1] ?? "") && !/\d/.test(haystack[index + needle.length] ?? "")) return true;
    }
    return false;
  }
  const exactOnly = /^[\d\s.,%+\-]+$/.test(needle) || (/^[\x00-\x7F]+$/.test(needle) && needle.length < 4) || needle.length < 2;
  return exactOnly ? haystack.trim() === needle : haystack.includes(needle);
}

// A number long enough to be a phone, ID or account number rather than a quantity or an amount.
export function isLongNumber(value) {
  const text = String(value ?? "").trim();
  return /^\d[\d\s\-]*\d$/.test(text) && text.replace(/\D/g, "").length >= 8;
}

// Job words people put where a name belongs; they are not names and occur all over a file.
const ROLE_WORD = /^(?:销售|采购|财务|会计|出纳|老板|老板娘|经理|总经理|副总|厂长|主管|助理|文员|仓库|仓管|前台|客服|技术|研发|生产|品质|品管|行政|人事|跟单|业务|司机|工程师|负责人|联系人|总监|董事长|法人|股东|店长|店员|门卫|保安)$/;

// A name column often holds more than one name or a name with a remark: "张伟/刘洋", "甲公司、乙公司",
// "张伟（经理）", "李娜 赵敏", "张伟、刘洋等". Returns the pieces in order, names at the even places and the text
// between or after them at the odd places, or null when the cell is simply one name. Only Chinese names are
// split, so "Foo Co., Ltd." stays whole; people (not companies) are also split at spaces.
export function splitNames(value, category = "sales") {
  if (typeof value !== "string") return null;
  let parts = value.trim().split(/(\s*[、，,；;\/／]\s*)/);
  if (category === "sales") {
    parts = parts.flatMap((part, index) => {
      if (index % 2) return [part];
      const words = part.split(/(\s+)/);
      return words.length > 1 && words.every((word, at) => at % 2 || /^[一-龥]{2,4}$/.test(word)) ? words : [part];
    });
  }
  const pieces = [];
  let peeled = false;
  for (let index = 0; index < parts.length; index += 2) {
    const match = /^(.*?)(\s*(?:[（(][^（()）]*[）)])?(?:等人?)?)$/.exec(parts[index]);
    // A remark in brackets belongs to a company's name (某公司（香港）) but not to a person's (张伟（经理）).
    let name = category === "sales" ? match[1] : parts[index], tail = category === "sales" ? match[2] : "";
    // "何等" is a name; only a longer piece ends in the word 等.
    if (!name || (name.length < 2 && tail)) { name = parts[index]; tail = ""; }
    const open = (name.match(/[（(]/g) ?? []).length, close = (name.match(/[）)]/g) ?? []).length;
    if (name.length < 2 || !/[一-龥]/.test(name) || open !== close || (category === "sales" && open) || isPlaceholderValue(name) || ROLE_WORD.test(name) || tokenPattern("").test(name)) return null;
    if (tail) peeled = true;
    pieces.push(name, tail + (parts[index + 1] ?? ""));
  }
  if (pieces.length === 2 && !peeled) return null;
  if (!pieces.at(-1)) pieces.pop();
  return pieces;
}

// Hidden sheets, rows and columns are protected like everything else but a person cannot see them, so the
// result is reported before generating. Null when nothing is hidden.
export function hiddenContent(workbook) {
  const hidden = { sheets: 0, rows: 0, columns: 0 };
  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    if (worksheet.state === "hidden" || worksheet.state === "veryHidden") hidden.sheets += 1;
    worksheet.eachRow({ includeEmpty: false }, (row) => { if (row.hidden) hidden.rows += 1; });
    for (const column of worksheet.columns ?? []) if (column?.hidden) hidden.columns += 1;
  });
  return hidden.sheets + hidden.rows + hidden.columns ? hidden : null;
}

// A cell that names a field rather than holding a value (业务员, 姓名, 序号 …).
function looksLikeFieldLabel(value) {
  const text = normalizeHeader(value);
  return Boolean(text) && (classifyHeader(value).category !== "custom" || /^(?:序号|姓名|职位|职务|部门|角色|身份|岗位|项目经理|负责人|联系人|电话|手机|微信|邮箱|地址|日期|备注)$/.test(text));
}

export function classifyHeader(header) {
  const match = CATEGORY_RULES.find((rule) => rule.pattern.test(normalizeHeader(header)));
  return match ? { category: match.category, prefix: match.prefix } : { category: "custom", prefix: "X" };
}

// A column with no values at all (not even unsupported cells) has nothing to replace.
export function isEmptyColumn(column) {
  return column.valueCount === 0 && !column.complexCount;
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

// ---- Table regions -------------------------------------------------------------------------------------------
// A sheet may hold a form on top and a table below, or several small tables side by side. A table is a run of
// short text cells (the header) with filled rows under it; everything else is "not a table" and is searched by keyword.
const MAX_SCAN_ROWS = 20000;
const MAX_SCAN_COLUMNS = 120;
const FORM_LABEL_ENDING = /(?:名称|时间|人数|日期|电话|地址|类型|占比|产量|情况|习惯|金额|备注|姓名|职务|职位|部门)\s*[*＊]?\s*[:：]?$/;
// Words a column name tends to end with; used to tell a new table's header from a data row that merely looks like one.
const FIELD_ENDING = /(?:名称|简称|全称|编号|编码|代码|日期|时间|数量|单价|金额|总额|价格|类型|类别|区域|地区|省份|部门|姓名|备注|说明|状态|序号|占比|比例|用量|产量|销量|销售额|品种|产品|客户|业务员|负责人|联系人)\s*[*＊]?$/;
const headerish = (text) => FIELD_ENDING.test(text) || classifyHeader(text).category !== "custom";
const COMPANY_LIKE = /(?:有限公司|有限责任公司|股份|集团|公司|工厂|商行)$/;

function headerText(cell) {
  if (cell.isMerged && cell.master !== cell) return null;
  const value = cell.value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 30 || /^[\d\s.,%+\-/:：]+$/.test(text) || COMPANY_LIKE.test(text)) return null;
  return text;
}

function filled(cell) {
  if (cell.isMerged && cell.master !== cell) return false;
  return Boolean(valueAsText(cell.value).trim());
}

export function detectTableBlocks(worksheet) {
  const lastRow = Math.min(worksheet.rowCount, MAX_SCAN_ROWS);
  const lastColumn = Math.min(worksheet.columnCount, MAX_SCAN_COLUMNS);
  if (lastRow < 2 || lastColumn < 1) return [];
  const cellAt = (row, column) => worksheet.getRow(row).getCell(column);
  const filledIn = (row, from, to) => { let count = 0; for (let column = from; column <= to; column += 1) if (filled(cellAt(row, column))) count += 1; return count; };

  // Runs of adjacent header-like cells on one row; a run is a header when it is long enough or names something we know.
  const headerRuns = (row) => {
    const runs = [];
    let current = null;
    for (let column = 1; column <= lastColumn + 1; column += 1) {
      const text = column <= lastColumn ? headerText(cellAt(row, column)) : null;
      if (text) { (current ??= { start: column, end: column, texts: [] }).end = column; current.texts.push(text); }
      else if (current) { runs.push(current); current = null; }
    }
    return runs.filter((run) => run.texts.length >= 3 || run.texts.some((text) => classifyHeader(text).category !== "custom"));
  };

  const blocks = [];
  const claimed = (row, start, end) => blocks.some((block) => row >= block.headerRow && row <= block.endRow && start <= block.endColumn && end >= block.startColumn);
  for (let row = 1; row < lastRow; row += 1) {
    for (const run of headerRuns(row)) {
      if (claimed(row, run.start, run.end)) continue;
      const known = run.texts.some((text) => classifyHeader(text).category !== "custom");
      // The rows under the header: contiguous, with at most one blank row in between.
      let dataRows = 0;
      let blanks = 0;
      let firstData = 0;
      for (let next = row + 1; next <= lastRow && blanks < 2; next += 1) {
        if (filledIn(next, run.start, run.end)) { dataRows += 1; firstData ||= next; blanks = 0; } else if (dataRows) blanks += 1; else blanks += 1;
      }
      if (dataRows < (known ? 1 : 2)) continue;
      if (!known && filledIn(firstData, run.start, run.end) < Math.ceil(run.texts.length / 2)) continue;
      // A narrow "table" whose first column is made of field names is a form (label, value, label, value …).
      if (run.end - run.start < 2) {
        let labels = 0, total = 0;
        for (let next = row + 1; next <= Math.min(lastRow, row + 30); next += 1) {
          const value = cellAt(next, run.start).value;
          if (typeof value === "string" && value.trim()) { total += 1; if (looksLikeFieldLabel(value) || FORM_LABEL_ENDING.test(value.trim())) labels += 1; }
        }
        if (total && labels * 2 >= total) continue;
      }
      // The table runs down to the last filled row, or stops before the next table's title / header.
      let endRow = row;
      for (let next = row + 1; next <= lastRow; next += 1) {
        if (filledIn(next, run.start, run.end)) endRow = next;
        const startsTable = next > row + 1 && headerRuns(next).some((other) => other.start <= run.end && other.end >= run.start && other.texts.filter(headerish).length >= 2 && filledIn(next + 1, other.start, other.end))
          && filledIn(next - 1, run.start, run.end) <= 1;
        if (startsTable) {
          endRow = next - 1;
          // A single filled cell right above the next header is that table's title; blank rows before it are not data.
          if (endRow > row && filledIn(endRow, run.start, run.end) === 1) endRow -= 1;
          while (endRow > row && !filledIn(endRow, run.start, run.end)) endRow -= 1;
          break;
        }
      }
      if (endRow <= row) continue;
      blocks.push({ headerRow: row, startColumn: run.start, endColumn: run.end, endRow });
    }
  }
  return blocks;
}

// The text of every value in the given columns (rich-text cells included), so names already covered by a chosen column are not listed again.
export function coveredValues(workbook, columns) {
  const covered = new Set();
  for (const column of columns) {
    const sheet = workbook.getWorksheet(column.sheetName);
    if (!sheet) continue;
    for (let row = column.headerRow + 1; row <= (column.endRow ?? sheet.rowCount); row += 1) {
      const cell = sheet.getRow(row).getCell(column.columnNumber);
      if (cell.isMerged && cell.master !== cell) continue;
      // Text, rich text, and cells holding a formula or link: what shows in the cell is covered by the column.
      const value = cell.value;
      if (typeof value === "string" || (value && typeof value === "object" && !(value instanceof Date))) {
        const text = typeof cell.text === "string" ? cell.text.trim() : "";
        if (text) covered.add(text);
        if (column.category === "customer" || column.category === "sales") {
          for (const [index, piece] of (splitNames(text, column.category) ?? []).entries()) if (index % 2 === 0) covered.add(piece);
        }
      }
    }
  }
  return covered;
}

function candidateId(sheetName, headerRow, columnNumber) {
  return `${sheetName}::${headerRow}::${columnNumber}`;
}

export function analyzeWorkbook(workbook) {
  const sheets = [];
  const columns = [];

  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    // Tables found as regions; a sheet with none keeps the old reading (one header row, data to the end).
    const detected = detectTableBlocks(worksheet);
    const blocks = detected.length ? detected : [{ headerRow: detectHeaderRow(worksheet), startColumn: 1, endColumn: Math.max(worksheet.columnCount, 1), endRow: worksheet.rowCount }];
    const sheetColumns = [];

    for (const block of blocks) {
    const { headerRow, endRow } = block;
    worksheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (columnNumber < block.startColumn || columnNumber > block.endColumn) return;
      const header = valueAsText(cell.value).trim();
      if (!header) return;
      const classification = classifyHeader(header);
      const samples = [];
      let valueCount = 0;
      let complexCount = 0;
      let labelCount = 0;

      for (let rowNumber = headerRow + 1; rowNumber <= endRow; rowNumber += 1) {
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
        if (typeof value === "string" && looksLikeFieldLabel(value)) labelCount += 1;
        if (samples.length < 3) samples.push(valueAsText(value));
      }

      const candidate = {
        id: candidateId(worksheet.name, headerRow, columnNumber),
        sheetName: worksheet.name,
        headerRow,
        endRow,
        columnNumber,
        header,
        category: classification.category,
        prefix: classification.prefix,
        suggested: classification.category !== "custom" && labelCount * 10 < Math.max(1, valueCount) * 3,
        recommendedMode: recommendedProcessingMode(header),
        valueCount,
        complexCount,
        samples,
      };
      sheetColumns.push(candidate);
      columns.push(candidate);
    });
    }

    sheets.push({ name: worksheet.name, headerRow: blocks[0].headerRow, rowCount: worksheet.rowCount, columns: sheetColumns.length });
  });

  return {
    sheets,
    columns,
    // An empty column has nothing to replace, so it is never pre-selected.
    suggestedColumnIds: columns.filter((column) => column.suggested && !isEmptyColumn(column)).map((column) => column.id),
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
    // An alias ends in digits, so a letter, digit or hyphen right after it would be read as part of it and the
    // alias could not be restored ("宏图2026年" → "客户-K7M4-012026年"). A space keeps them apart.
    parts.push({ text: aliasWithGap(token, text.slice(index + source.length)), protected: true });
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

// A link cell ({ text, hyperlink }) is turned into its plain text: the address (a mailbox, a web page, a file
// path) can itself name someone, and the AI does not need it. Returns how many links were removed.
export function flattenHyperlinks(workbook) {
  let removed = 0;
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        // =HYPERLINK("mailto:…","发邮件") keeps the address inside the formula; only what the cell shows stays.
        if (formulaCellValue(value) && /^\s*HYPERLINK\s*\(/i.test(String(value.formula ?? ""))) {
          cell.value = value.result == null || typeof value.result === "object" ? "" : String(value.result);
          removed += 1;
          return;
        }
        if (!value || typeof value !== "object" || !("hyperlink" in value) || formulaCellValue(value)) return;
        const text = value.text;
        cell.value = text && typeof text === "object" && Array.isArray(text.richText) ? { richText: text.richText } : String(text ?? "");
        removed += 1;
      });
    });
  });
  return removed;
}

export const noteText = note => typeof note === "string" ? note : Array.isArray(note?.texts) ? note.texts.map(part => part.text ?? "").join("") : "";
// Rewrites a cell note with the given text function, keeping its formatting runs.
function rewriteNote(cell, change) {
  const note = cell.note;
  if (typeof note === "string") cell.note = change(note);
  else if (Array.isArray(note?.texts)) cell.note = { ...note, texts: note.texts.map(part => ({ ...part, text: change(String(part.text ?? "")) })) };
}

// Names outside the cells: notes get the aliases too (and are restored), names in page headers and footers are
// masked, and a drop-down list that offers a name is removed. None of these can be fixed by choosing columns.
function replaceOutsideCells(workbook, dictionary, notices) {
  if (!dictionary.length) return 0;
  const sources = dictionary.map(({ source }) => source);
  let changed = 0;
  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const text = noteText(cell.note);
        if (!text || !sources.some(source => text.includes(source))) return;
        // A name split across two formatting runs cannot be replaced run by run, so the note becomes plain text.
        const whole = replaceKnownEntities(text, dictionary);
        let perRun = 0;
        rewriteNote(cell, part => { const replaced = replaceKnownEntities(part, dictionary); perRun += replaced.replacements; return replaced.text; });
        if (perRun < whole.replacements) cell.note = whole.text;
        notices.push({ location: `${worksheet.name}!${cell.address}`, reason: "批注里的已选名称已替换" });
        changed += 1;
      });
    });
    const headerFooter = worksheet.headerFooter ?? {};
    for (const key of ["oddHeader", "oddFooter", "evenHeader", "evenFooter", "firstHeader", "firstFooter"]) {
      const text = headerFooter[key];
      if (typeof text !== "string" || !sources.some(source => text.includes(source))) continue;
      headerFooter[key] = sources.reduce((result, source) => result.split(source).join("***"), text);
      notices.push({ location: worksheet.name, reason: "页眉页脚里的已选名称已隐去" });
      changed += 1;
    }
    const validations = worksheet.dataValidations?.model;
    for (const [address, rule] of Object.entries(validations ?? {})) {
      if (!(rule?.formulae ?? []).some(formula => typeof formula === "string" && sources.some(source => formula.includes(source)))) continue;
      delete validations[address];
      notices.push({ location: `${worksheet.name}!${address}`, reason: "下拉选项里有已选名称，已去掉这个下拉列表" });
      changed += 1;
    }
  });
  return changed;
}

// candidates: names confirmed from forms and text (see workbookCandidates.js), each { value, label, category, prefix }.
export function tokenizeWorkbook(workbook, selectedColumns, taskId, candidates = []) {
  const counters = { C: 0, P: 0, S: 0, X: 0 };
  const tokenByValue = new Map();
  const mapping = {};
  const warnings = [];
  const notices = [];
  const dictionaryBySource = new Map();
  let replacedCells = 0;
  const handled = new Set();

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

    for (let rowNumber = column.headerRow + 1; rowNumber <= (column.endRow ?? worksheet.rowCount); rowNumber += 1) {
      const cell = worksheet.getRow(rowNumber).getCell(column.columnNumber);
      // Only the top-left cell of a merged area holds the value; the others just show it.
      if (cell.isMerged && cell.master !== cell) continue;
      handled.add(`${worksheet.name}!${cell.address}`);
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
      if (visibleValue === "" || (typeof visibleValue === "string" && isPlaceholderValue(visibleValue))) continue;
      if (typeof visibleValue === "string" && tokenPattern("").test(visibleValue)) {
        warnings.push({ location: `${worksheet.name}!${cell.address}`, reason: "原文件已含本工具代号，未重复处理" });
        continue;
      }

      const prefix = column.prefix || "X";
      const aliasFor = (keyValue, stored) => {
        const key = `${prefix}:${valueKey(keyValue)}`;
        let alias = tokenByValue.get(key);
        if (!alias) {
          counters[prefix] += 1;
          alias = createEntityToken({ label: column.header, category: column.category, prefix, sequence: counters[prefix], taskId });
          tokenByValue.set(key, alias);
          mapping[alias] = { value: stored, category: column.category, header: column.header };
        }
        return alias;
      };
      // Several names in one cell each get their own alias, so one of them written elsewhere is replaced too.
      // A bare place name in an address column (广州, 佛山南海) is a region, not an address: it stays, so the
      // word is not replaced all over the file.
      if (typeof visibleValue === "string" && /地址|address/i.test(column.header) && visibleValue.trim().length < 6 && !/\d/.test(visibleValue)) continue;
      const pieces = column.category === "customer" || column.category === "sales" ? splitNames(visibleValue, column.category) : null;
      if (pieces) {
        cell.value = pieces.map((piece, index) => {
          if (index % 2) return piece;
          const alias = aliasFor(piece, { type: "string", value: piece });
          if (!dictionaryBySource.has(piece)) dictionaryBySource.set(piece, alias);
          return alias;
        }).join("");
        if (richTextCellValue(value)) notices.push({ location: `${worksheet.name}!${cell.address}`, reason: "一格里的多个名称已分别替换，局部文字样式已统一" });
        replacedCells += 1;
        continue;
      }
      const token = aliasFor(visibleValue, serializeValue(value));
      const source = String(visibleValue);
      if (inlineDictionaryEligible(source) && !dictionaryBySource.has(source)) dictionaryBySource.set(source, token);
      cell.value = token;
      replacedCells += 1;
    }
  }

  // Confirmed names get their own alias unless a selected column already gave them one; the user picked them,
  // so they are replaced across the workbook whatever their length.
  const forced = new Set();
  const tokenByText = new Map(Object.entries(mapping).map(([token, entry]) => [String(entry.value?.text ?? entry.value?.value ?? ""), token]));
  for (const item of candidates) {
    const source = String(item.value ?? "").trim();
    if (!source || isPlaceholderValue(source)) continue;
    let token = tokenByText.get(source);
    if (!token) {
      const prefix = item.prefix || "X";
      counters[prefix] += 1;
      token = createEntityToken({ label: item.label, category: item.category, prefix, sequence: counters[prefix], taskId });
      mapping[token] = { value: { type: "string", value: source }, category: item.category, header: item.label };
      tokenByText.set(source, token);
    }
    dictionaryBySource.set(source, token);
    forced.add(source);
  }

  // Excel starts a note with its author ("刘妍妍:" in bold on the first line). That is a person's name too.
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: true }, (cell) => {
      const author = /^([^\n:：]{2,20})[:：][ \t]*\n/.exec(noteText(cell.note))?.[1].trim();
      if (!author || !/[一-龥A-Za-z]/.test(author) || isPlaceholderValue(author) || dictionaryBySource.has(author)) return;
      let token = tokenByText.get(author);
      if (!token) {
        counters.S += 1;
        token = createEntityToken({ label: "批注作者", category: "sales", prefix: "S", sequence: counters.S, taskId });
        mapping[token] = { value: { type: "string", value: author }, category: "sales", header: "批注作者" };
        tokenByText.set(author, token);
      }
      dictionaryBySource.set(author, token);
      forced.add(author);
    }));
  });

  const dictionary = Array.from(dictionaryBySource, ([source, token]) => ({ source, token, force: forced.has(source) }))
    .sort((left, right) => right.source.length - left.source.length);

  for (const column of columnsByMode.inline) {
    const worksheet = workbook.getWorksheet(column.sheetName);
    if (!worksheet) {
      warnings.push({ location: column.sheetName, reason: "工作表不存在" });
      continue;
    }
    for (let rowNumber = column.headerRow + 1; rowNumber <= (column.endRow ?? worksheet.rowCount); rowNumber += 1) {
      const cell = worksheet.getRow(rowNumber).getCell(column.columnNumber);
      // Only the top-left cell of a merged area holds the value; the others just show it.
      if (cell.isMerged && cell.master !== cell) continue;
      handled.add(`${worksheet.name}!${cell.address}`);
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

  // A text cell that is exactly one of the selected values is that value, however short: "A1" in a summary
  // sheet is the same code as "A1" in the chosen column.
  const exact = new Map();
  for (const [token, entry] of Object.entries(mapping)) {
    const text = entry.value?.type === "richText" ? entry.value.text : entry.value?.type === "string" ? entry.value.value : null;
    if (typeof text === "string" && text.trim() && !exact.has(text.trim())) exact.set(text.trim(), token);
  }
  const elsewhere = replaceAcrossWorkbook(workbook, dictionary, handled, notices, exact);
  replacedCells += elsewhere.cells;
  replaceOutsideCells(workbook, dictionary.filter(({ source, force }) => force || spreadsAcrossWorkbook(source)), notices);

  return { mapping, replacedCells, uniqueValues: Object.keys(mapping).length, warnings, notices, elsewhere };
}

// People pick the columns that hold names; the names themselves must not reach the AI wherever they appear.
// So every cell outside the selected columns, on every sheet (headers, summaries, cross tables, notes), is checked:
// a cell that is exactly one of the names becomes its alias, longer text has the names replaced in place, and a
// formula whose cached result shows a name loses that cache (Excel recalculates on opening).
// Only names and longer codes are in the dictionary (see inlineDictionaryEligible): numbers and short codes stay
// in their own columns so a quantity that happens to equal a code is never touched.
// Only names (any Chinese) and letter-bearing codes of four or more characters (K5204) are looked for outside
// the selected columns; plain numbers and short codes could equal a quantity or a grade by chance.
export function spreadsAcrossWorkbook(source) {
  const text = String(source ?? "").trim();
  if (isLongNumber(text)) return true;
  if (/[^\x00-\x7F]/.test(text)) return text.length >= 2 && !/^[\d\s.,%+\-]+$/.test(text);
  return text.length >= 4 && /[A-Za-z]/.test(text);
}

function replaceAcrossWorkbook(workbook, allEntries, handled, notices, exactValues = new Map()) {
  const elsewhere = { cells: 0, sheets: new Map() };
  const dictionary = allEntries.filter(({ source, force }) => force || spreadsAcrossWorkbook(source));
  if (!dictionary.length && !exactValues.size) return { cells: 0, sheets: [] };
  const tokenBySource = new Map([...exactValues, ...dictionary.map(({ source, token }) => [source, token])]);
  const count = sheetName => { elsewhere.cells += 1; elsewhere.sheets.set(sheetName, (elsewhere.sheets.get(sheetName) ?? 0) + 1); };
  workbook.eachSheet(worksheet => {
    if (worksheet.name === "__AI安全任务") return;
    worksheet.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.isMerged && cell.master !== cell) return;
        if (handled.has(`${worksheet.name}!${cell.address}`)) return;
        const value = cell.value;
        if (formulaCellValue(value)) {
          const cached = value.result;
          if (typeof cached === "string" && dictionary.some(({ source }) => cached.includes(source))) {
            const { result, ...formulaOnly } = value;
            cell.value = formulaOnly;
            notices.push({ location: `${worksheet.name}!${cell.address}`, reason: "公式结果里有已选名称，缓存结果已清除，打开时重新计算" });
            count(worksheet.name);
          }
          return;
        }
        if (!plainCellValue(value) && !richTextCellValue(value)) return;
        if (!richTextCellValue(value) && typeof value !== "string") return;
        const text = valueAsText(value);
        if (typeof text !== "string" || !text || tokenPattern("").test(text)) return;
        const exact = tokenBySource.get(text.trim());
        if (exact) { cell.value = exact; count(worksheet.name); return; }
        const replaced = replaceKnownEntities(text, dictionary);
        if (!replaced.replacements) return;
        cell.value = replaced.text;
        count(worksheet.name);
      });
    });
  });
  return { cells: elsewhere.cells, sheets: [...elsewhere.sheets].map(([sheet, cells]) => ({ sheet, cells })) };
}

export function findWorkbookResiduals(workbook, values) {
  const sources = [...new Set(values.filter(Boolean))];
  const findings = [];
  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const value = cell.value;
        const raw = formulaCellValue(value) ? `${value.formula ?? ""} ${value.result ?? ""}` : valueAsText(value);
        const text = raw.replace(tokenPattern(), " ");
        const matched = sources.filter((source) => residualMatches(text, source) || (formulaCellValue(value) && residualMatches(String(value.result ?? ""), source)));
        if (!matched.length) return;
        findings.push({
          location: `${worksheet.name}!${cell.address}`,
          reason: "已选真实值仍出现在此处",
          sheetName: worksheet.name,
          row: rowNumber,
          columnNumber,
          eligible: matched.every(inlineDictionaryEligible),
        });
      });
    });
  });
  return findings;
}

export function addTaskMarker(workbook, metadata) {
  const previous = workbook.getWorksheet("__AI安全任务");
  if (previous) workbook.removeWorksheet(previous.id);
  const sheet = workbook.addWorksheet("__AI安全任务", { state: "veryHidden" });
  sheet.addRows([
    ["文件脱敏助手", "请勿修改此页"],
    ["版本", 1],
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
        } else if (value && typeof value === "object" && "hyperlink" in value && typeof value.text === "string") {
          text = value.text;
          kind = "link";
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

  const restoreText = (text) => replaceAliases(text, (token) => {
    const entry = mapping[token];
    if (!entry) return token;
    restoredOccurrences += 1;
    return replacementText(entry.value);
  });
  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        // Notes carry aliases too; they are put back but not counted as restored cells.
        if (cell.note && tokenPattern("").test(noteText(cell.note))) {
          const counted = restoredOccurrences;
          rewriteNote(cell, restoreText);
          restoredOccurrences = counted;
        }
        const value = cell.value;
        if (value && typeof value === "object" && "hyperlink" in value && typeof value.text === "string" && !("formula" in value)) {
          cell.value = { ...value, text: restoreText(value.text) };
          return;
        }
        if (typeof value === "string") {
          const exact = mapping[value];
          if (exact) {
            cell.value = deserializeValue(exact.value);
            restoredOccurrences += 1;
            return;
          }
          cell.value = replaceAliases(value, (token) => {
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
              text: replaceAliases(part.text ?? "", (token) => {
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
