import JSZip from "jszip";
import { FILE_SIZE_LIMITS } from "./filePreflight.js";
import { classifyHeader, findKnownShortTokens } from "./xlsxCore.js";
import { analyzeText } from "./textCore.js";
import { createEntityToken, parseEntityToken, tokenPattern, tokenOccurrence } from "./tokenFormat.js";

export const OFFICE_LIMITS = {
  compressedBytes: FILE_SIZE_LIMITS.docx,
  uncompressedBytes: 250 * 1024 * 1024,
  entries: 5000,
};

export const OFFICE_FORMATS = {
  docx: {
    label: "Word",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mainContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    textTag: "w:t",
    paragraphTag: "w:p",
    supported: [
      { pattern: /^word\/document\.xml$/i, area: "正文、表格和文本框" },
      { pattern: /^word\/header\d*\.xml$/i, area: "页眉" },
      { pattern: /^word\/footer\d*\.xml$/i, area: "页脚" },
    ],
    unchecked: ["图片中的文字", "批注、图表、SmartArt 和嵌入对象"],
  },
  pptx: {
    label: "PowerPoint",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    mainContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    textTag: "a:t",
    paragraphTag: "a:p",
    supported: [
      { pattern: /^ppt\/slides\/slide\d+\.xml$/i, area: "幻灯片文字和表格" },
      { pattern: /^ppt\/notesSlides\/notesSlide\d+\.xml$/i, area: "演讲者备注" },
    ],
    unchecked: ["图片中的文字", "批注、图表、SmartArt、动画文本和嵌入对象"],
  },
};

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapedTag(tag) {
  return tag.replace(":", "\\:");
}

function collectTextNodes(fragment, tag) {
  const name = escapedTag(tag);
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi");
  const nodes = [];
  for (const match of fragment.matchAll(pattern)) {
    const innerOffset = match[0].indexOf(match[1]);
    nodes.push({
      start: match.index + innerOffset,
      end: match.index + innerOffset + match[1].length,
      text: decodeXml(match[1]),
    });
  }
  return nodes;
}

function collectParagraphs(xml, config) {
  const name = escapedTag(config.paragraphTag);
  const pattern = new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, "gi");
  const paragraphs = [];
  for (const match of xml.matchAll(pattern)) {
    const nodes = collectTextNodes(match[0], config.textTag);
    if (nodes.length) paragraphs.push({ start: match.index, end: match.index + match[0].length, raw: match[0], nodes });
  }
  return paragraphs;
}

function textStreams(xml, config) {
  const paragraphs = collectParagraphs(xml, config);
  const streams = paragraphs.map((paragraph) => paragraph.nodes.map((node) => node.text).join(""));
  if (!paragraphs.length) {
    const nodes = collectTextNodes(xml, config.textTag);
    if (nodes.length) streams.push(nodes.map((node) => node.text).join(""));
  }
  return streams;
}

function isIndependentMatch(text, source, index) {
  const before = text[index - 1] ?? "";
  const after = text[index + source.length] ?? "";
  return !(/[A-Za-z0-9]/.test(source[0]) && /[A-Za-z0-9]/.test(before))
    && !(/[A-Za-z0-9]/.test(source.at(-1)) && /[A-Za-z0-9]/.test(after));
}

export function allXmlText(xml) {
  const values = [];
  for (const match of xml.matchAll(/>([^<>]+)</g)) values.push(decodeXml(match[1]));
  return values.join("");
}

function supportedArea(path, config) {
  return config.supported.find((item) => item.pattern.test(path));
}

function serializedValueAsText(entry) {
  if (!entry?.value) return "";
  if (entry.value.type === "date") return new Date(entry.value.value).toISOString().slice(0, 10);
  if (entry.value.type === "richText") return String(entry.value.text ?? "");
  return String(entry.value.value);
}

function replaceParagraph(paragraph, mapping) {
  const combined = paragraph.nodes.map((node) => node.text).join("");
  const replacements = [];
  for (const match of combined.matchAll(tokenPattern())) {
    const entry = mapping[match[0]];
    if (entry) replacements.push({ start: match.index, end: match.index + match[0].length, value: serializedValueAsText(entry) });
  }
  if (!replacements.length) return { xml: paragraph.raw, count: 0 };

  const values = paragraph.nodes.map((node) => node.text);
  const offsets = [];
  let cursor = 0;
  for (const value of values) {
    offsets.push({ start: cursor, end: cursor + value.length });
    cursor += value.length;
  }

  for (const replacement of replacements.reverse()) {
    const startIndex = offsets.findIndex((range) => replacement.start >= range.start && replacement.start < range.end);
    const endIndex = offsets.findIndex((range) => replacement.end > range.start && replacement.end <= range.end);
    if (startIndex < 0 || endIndex < 0) continue;
    const startOffset = replacement.start - offsets[startIndex].start;
    const endOffset = replacement.end - offsets[endIndex].start;
    const prefix = values[startIndex].slice(0, startOffset);
    const suffix = values[endIndex].slice(endOffset);
    values[startIndex] = `${prefix}${replacement.value}${startIndex === endIndex ? suffix : ""}`;
    for (let index = startIndex + 1; index < endIndex; index += 1) values[index] = "";
    if (endIndex !== startIndex) values[endIndex] = suffix;
  }

  let output = paragraph.raw;
  for (let index = paragraph.nodes.length - 1; index >= 0; index -= 1) {
    const node = paragraph.nodes[index];
    output = `${output.slice(0, node.start)}${encodeXml(values[index])}${output.slice(node.end)}`;
  }
  return { xml: output, count: replacements.length };
}

export function replaceSupportedXml(xml, format, mapping) {
  const config = OFFICE_FORMATS[format];
  const paragraphs = collectParagraphs(xml, config);
  let output = xml;
  let count = 0;
  for (const paragraph of paragraphs.reverse()) {
    const replaced = replaceParagraph(paragraph, mapping);
    output = `${output.slice(0, paragraph.start)}${replaced.xml}${output.slice(paragraph.end)}`;
    count += replaced.count;
  }
  return { xml: output, count };
}

function replaceParagraphValues(paragraph, replacementsByValue) {
  const combined = paragraph.nodes.map((node) => node.text).join("");
  const entries = [...replacementsByValue].sort((left, right) => right[0].length - left[0].length);
  const replacements = [];
  for (let cursor = 0; cursor < combined.length;) {
    const entry = entries.find(([source]) => combined.startsWith(source, cursor) && isIndependentMatch(combined, source, cursor));
    if (!entry) { cursor += 1; continue; }
    replacements.push({ start: cursor, end: cursor + entry[0].length, value: entry[1] });
    cursor += entry[0].length;
  }
  if (!replacements.length) return { xml: paragraph.raw, count: 0 };

  const values = paragraph.nodes.map((node) => node.text);
  const offsets = [];
  let cursor = 0;
  for (const value of values) {
    offsets.push({ start: cursor, end: cursor + value.length });
    cursor += value.length;
  }
  for (const replacement of replacements.reverse()) {
    const startIndex = offsets.findIndex((range) => replacement.start >= range.start && replacement.start < range.end);
    const endIndex = offsets.findIndex((range) => replacement.end > range.start && replacement.end <= range.end);
    if (startIndex < 0 || endIndex < 0) continue;
    const prefix = values[startIndex].slice(0, replacement.start - offsets[startIndex].start);
    const suffix = values[endIndex].slice(replacement.end - offsets[endIndex].start);
    values[startIndex] = `${prefix}${replacement.value}${startIndex === endIndex ? suffix : ""}`;
    for (let index = startIndex + 1; index < endIndex; index += 1) values[index] = "";
    if (endIndex !== startIndex) values[endIndex] = suffix;
  }
  let output = paragraph.raw;
  for (let index = paragraph.nodes.length - 1; index >= 0; index -= 1) {
    const node = paragraph.nodes[index];
    output = `${output.slice(0, node.start)}${encodeXml(values[index])}${output.slice(node.end)}`;
  }
  return { xml: output, count: replacements.length };
}

function replaceSupportedValues(xml, replacementsByValue) {
  const paragraphs = collectParagraphs(xml, OFFICE_FORMATS.docx);
  let output = xml;
  let count = 0;
  for (const paragraph of paragraphs.reverse()) {
    const replaced = replaceParagraphValues(paragraph, replacementsByValue);
    output = `${output.slice(0, paragraph.start)}${replaced.xml}${output.slice(paragraph.end)}`;
    count += replaced.count;
  }
  return { xml: output, count };
}

function tableCandidates(xml, sourceText) {
  const values = [];
  for (const table of xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/gi)) {
    const rows = [...table[0].matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi)].map((row) =>
      [...row[0].matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/gi)].map((cell) => collectTextNodes(cell[0], "w:t").map((node) => node.text).join("").trim()));
    if (rows.length < 2) continue;
    const headers = rows[0].map((header, column) => ({ header, column, ...classifyHeader(header) })).filter((item) => item.category !== "custom");
    for (const row of rows.slice(1)) headers.forEach(({ header, column, category, prefix }) => {
      const value = row[column]?.trim();
      if (!value || tokenPattern("").test(value)) return;
      const count = sourceText.split(value).length - 1;
      if (count) values.push({ value, label: header, category, prefix, count });
    });
  }
  return values;
}

export async function validateDocxProtectionStructure(zip) {
  const details = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/^word\/.*\.(?:xml|rels)$/i.test(entry.name)) continue;
    const xml = await entry.async("string");
    if (/^word\/comments\d*\.xml$/i.test(entry.name) && /<w:comment\b/i.test(xml)) details.push(`${entry.name}：批注`);
    if (/<w:(?:ins|del|moveFrom|moveTo|sdt|fldSimple|instrText|trackRevisions)\b/i.test(xml)) details.push(`${entry.name}：修订、内容控件或域`);
    if (/^word\/(?:footnotes|endnotes)\.xml$/i.test(entry.name) && /<w:(?:footnote|endnote)\b[^>]*w:id="(?:[1-9]\d*)"/i.test(xml)) details.push(`${entry.name}：脚注或尾注`);
    if (/\.rels$/i.test(entry.name) && /TargetMode=["']External["']/i.test(xml)) details.push(`${entry.name}：外部链接或远程模板`);
  }
  if (details.length) throw Object.assign(new Error("DOCX 包含暂时无法完整脱敏的结构。"), { code: "UNSUPPORTED_DOCX_STRUCTURE", details });
}

export async function assertNoSensitiveValuesInOfficePackage(zip, mapping) {
  const values = [...new Set(Object.values(mapping).map(serializedValueAsText).filter(Boolean))];
  const findings = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(?:xml|rels)$/i.test(entry.name)) continue;
    const text = allXmlText(await entry.async("string"));
    for (const value of values) if (text.includes(value)) findings.push(`${entry.name}：仍包含已选真实值`);
  }
  if (findings.length) throw Object.assign(new Error("Word 文件的未处理区域仍包含已选真实值，已停止生成。"), { code: "SENSITIVE_RESIDUALS", details: findings.slice(0, 50) });
}

export async function scrubOfficeMetadata(zip) {
  const core = zip.file("docProps/core.xml");
  if (core) {
    let xml = await core.async("string");
    xml = xml.replace(/<(?:dc:title|dc:subject|dc:creator|cp:keywords|dc:description|cp:lastModifiedBy|cp:revision|cp:category|cp:contentStatus|dc:identifier|dc:language|cp:version)\b[^>]*>[\s\S]*?<\/(?:dc:title|dc:subject|dc:creator|cp:keywords|dc:description|cp:lastModifiedBy|cp:revision|cp:category|cp:contentStatus|dc:identifier|dc:language|cp:version)>/gi, "");
    zip.file("docProps/core.xml", xml);
  }
  const app = zip.file("docProps/app.xml");
  if (app) {
    let xml = await app.async("string");
    xml = xml.replace(/<(Company|Manager|HyperlinkBase|Template)>[\s\S]*?<\/\1>/gi, "<$1></$1>");
    zip.file("docProps/app.xml", xml);
  }
  const custom = zip.file("docProps/custom.xml");
  if (custom) {
    let sequence = 0;
    let xml = await custom.async("string");
    xml = xml.replace(/name="[^"]*"/gi, () => `name="Property${++sequence}"`);
    xml = xml.replace(/<vt:[A-Za-z0-9]+\b[^>]*>[\s\S]*?<\/vt:[A-Za-z0-9]+>/gi, (match) => match.replace(/>[^<]*</, "></"));
    zip.file("docProps/custom.xml", xml);
  }
}

export async function analyzeDocxProtectionPackage(zip) {
  await validateDocxProtectionStructure(zip);
  const streams = [];
  const tableValues = [];
  const checkedAreas = new Set();
  for (const entry of Object.values(zip.files)) {
    const area = supportedArea(entry.name, OFFICE_FORMATS.docx);
    if (entry.dir || !area) continue;
    const xml = await entry.async("string");
    const entryStreams = textStreams(xml, OFFICE_FORMATS.docx);
    if (entryStreams.length) checkedAreas.add(area.area);
    streams.push(...entryStreams);
  }
  const sourceText = streams.join("\n");
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !supportedArea(entry.name, OFFICE_FORMATS.docx)) continue;
    tableValues.push(...tableCandidates(await entry.async("string"), sourceText));
  }
  const analysis = analyzeText(sourceText, "docx");
  const byValue = new Map(analysis.candidates.map((item) => [item.value, item]));
  tableValues.forEach((item) => {
    if (!byValue.has(item.value)) byValue.set(item.value, {
      id: `TEXT::${encodeURIComponent(item.value)}`, ...item,
      contexts: sourceText.split(/\r\n|\r|\n/).filter((line) => line.includes(item.value)).slice(0, 3),
      suggested: true, manual: false,
    });
  });
  const candidates = [...byValue.values()];
  return { ...analysis, format: "docx", formatLabel: "Word", sourceText, candidates, suggestedCandidateIds: candidates.map((item) => item.id), checkedAreas: [...checkedAreas], uncheckedAreas: OFFICE_FORMATS.docx.unchecked };
}

export async function tokenizeDocxPackage(zip, selectedCandidates, taskId) {
  const counters = { C: 0, P: 0, S: 0, X: 0 };
  const mapping = {};
  const replacements = new Map();
  selectedCandidates.forEach((item) => {
    const prefix = item.prefix || "X";
    counters[prefix] += 1;
    const token = createEntityToken({ label: item.label, category: item.category, prefix, sequence: counters[prefix], taskId });
    replacements.set(item.value, token);
    mapping[token] = { value: { type: "string", value: item.value }, category: item.category, header: item.label };
  });
  let replacedOccurrences = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !supportedArea(entry.name, OFFICE_FORMATS.docx)) continue;
    const replaced = replaceSupportedValues(await entry.async("string"), replacements);
    if (replaced.count) zip.file(entry.name, replaced.xml);
    replacedOccurrences += replaced.count;
  }
  const residual = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith(".xml")) continue;
    const xml = decodeXml(await entry.async("string"));
    for (const value of replacements.keys()) if (xml.includes(value)) residual.push(`${entry.name}：${value}`);
  }
  if (residual.length) throw Object.assign(new Error("所选敏感内容仍出现在未处理区域。"), { code: "UNSUPPORTED_CONTENT", details: residual });
  const usedTokens = new Set();
  const inspection = await inspectOfficePackage(zip, "docx", mapping);
  inspection.occurrences.forEach((item) => usedTokens.add(item.token));
  const usedMapping = Object.fromEntries(Object.entries(mapping).filter(([token]) => usedTokens.has(token)));
  return { mapping: usedMapping, replacedOccurrences, uniqueValues: Object.keys(usedMapping).length, checkedAreas: inspection.checkedAreas };
}

function scanText(text, location) {
  const occurrences = [];
  for (const match of text.matchAll(tokenPattern())) {
    occurrences.push({ ...tokenOccurrence(match[0]), location });
  }
  return occurrences;
}

export function scanOfficeXml(xml, format, location) {
  return scanText(allXmlText(xml), location);
}

export function findAlteredTokens(xml, format, mapping) {
  const texts = [allXmlText(xml)];
  const knownShortTokens = new Set(Object.keys(mapping).map((token) => parseEntityToken(token)?.shortToken).filter(Boolean));
  const findings = [];
  for (const text of texts) {
    const withoutFull = text.replace(tokenPattern(), " ");
    for (const malformed of withoutFull.matchAll(/\[\[[^\]]{1,80}(?:\]\]|$)/g)) findings.push(malformed[0]);
    findings.push(...findKnownShortTokens(withoutFull, knownShortTokens));
  }
  return [...new Set(findings)];
}

export async function loadOfficePackage(input, declaredFormat, limits = OFFICE_LIMITS) {
  const byteLength = input?.byteLength ?? input?.size ?? 0;
  if (byteLength > limits.compressedBytes) throw Object.assign(new Error("文件超过 20 MB。"), { code: "FILE_TOO_LARGE" });
  let zip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch (error) {
    throw Object.assign(new Error("无法读取 Office 文件，它可能已损坏、加密或不是标准 Open XML 文件。"), { code: "INVALID_OFFICE_PACKAGE", cause: error });
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.entries) throw Object.assign(new Error("文件包含过多内部项目。"), { code: "PACKAGE_TOO_LARGE" });
  const totalSize = entries.reduce((sum, entry) => sum + (Number(entry?._data?.uncompressedSize) || 0), 0);
  if (totalSize > limits.uncompressedBytes) throw Object.assign(new Error("文件解包后的总量超过 250 MB。"), { code: "PACKAGE_TOO_LARGE" });
  const unsafeEntry = entries.find((entry) => /(^|\/)(embeddings|activeX)\//i.test(entry.name) || /vbaProject\.bin$/i.test(entry.name));
  if (unsafeEntry) throw Object.assign(new Error("文件包含宏、OLE 或嵌入包，暂不处理。"), { code: "EMBEDDED_OBJECTS", details: [unsafeEntry.name] });

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) throw Object.assign(new Error("缺少 Office 内容类型声明。"), { code: "INVALID_OFFICE_PACKAGE" });
  const contentTypes = await contentTypesFile.async("string");
  if (/macroEnabled|vnd\.ms-office\.vbaProject/i.test(contentTypes)) {
    throw Object.assign(new Error("宏格式文件暂不支持。"), { code: "EMBEDDED_OBJECTS" });
  }
  const detectedFormat = Object.entries(OFFICE_FORMATS).find(([, config]) => contentTypes.includes(config.mainContentType))?.[0];
  if (!detectedFormat) throw Object.assign(new Error("不是受支持的 DOCX 或 PPTX 文件。"), { code: "UNSUPPORTED_FILE" });
  if (declaredFormat && detectedFormat !== declaredFormat) {
    throw Object.assign(new Error("文件扩展名与内部格式不一致。"), { code: "FORMAT_MISMATCH", details: [`扩展名 ${declaredFormat.toUpperCase()}`, `内部格式 ${detectedFormat.toUpperCase()}`] });
  }
  return { zip, format: detectedFormat, entries, totalSize };
}

export async function inspectOfficePackage(zip, format, mapping = null) {
  const config = OFFICE_FORMATS[format];
  const occurrences = [];
  const unsupportedOccurrences = [];
  const altered = [];
  const checkedAreas = new Set();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(xml|rels)$/i.test(entry.name)) continue;
    const xml = await entry.async("string");
    const area = supportedArea(entry.name, config);
    const hidden = [...xml.matchAll(/\b[\w:.-]+\s*=\s*(?:"([^"]*)"|'([^']*)')|<!--[\s\S]*?-->/g)]
      .map(match => decodeXml(match[1] ?? match[2] ?? match[0])).join("\n");
    unsupportedOccurrences.push(...scanText(hidden, `${entry.name} 属性或注释`).filter(item => item.taskId.startsWith("short:")));
    if (mapping) altered.push(...findKnownShortTokens(hidden.replace(tokenPattern(), " "), new Set()).map(value => ({ location: `${entry.name} 属性或注释`, value })));
    const found = scanOfficeXml(xml, format, entry.name);
    if (area) {
      occurrences.push(...found);
      if (found.length) checkedAreas.add(area.area);
    } else if (found.length) unsupportedOccurrences.push(...found);
    if (mapping) altered.push(...findAlteredTokens(xml, format, mapping).map((value) => ({ location: entry.name, value })));
  }
  return {
    occurrences,
    unsupportedOccurrences,
    altered,
    taskIds: [...new Set([...occurrences, ...unsupportedOccurrences].map((item) => item.taskId))],
    uniqueTokens: [...new Set([...occurrences, ...unsupportedOccurrences].map((item) => item.token))],
    checkedAreas: [...checkedAreas],
    uncheckedAreas: config.unchecked,
  };
}

export async function restoreOfficePackage(zip, format, mapping) {
  const config = OFFICE_FORMATS[format];
  let restoredOccurrences = 0;
  const checkedAreas = new Set();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith(".xml")) continue;
    const area = supportedArea(entry.name, config);
    if (!area) continue;
    const xml = await entry.async("string");
    const replaced = replaceSupportedXml(xml, format, mapping);
    if (replaced.count) {
      zip.file(entry.name, replaced.xml);
      restoredOccurrences += replaced.count;
      checkedAreas.add(area.area);
    }
  }
  return { restoredOccurrences, checkedAreas: [...checkedAreas] };
}
