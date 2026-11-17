import JSZip from "jszip";
import { FILE_SIZE_LIMITS } from "./filePreflight.js";
import { tokenPattern } from "./tokenFormat.js";
import { findKnownShortTokens, residualMatches } from "./xlsxCore.js";

export const XLSX_LIMITS = {
  compressedBytes: FILE_SIZE_LIMITS.xlsx,
  uncompressedBytes: 250 * 1024 * 1024,
  entries: 5000,
  worksheets: 200,
};

function packageError(code, message, details = []) {
  return Object.assign(new Error(message), { code, details });
}

export async function preflightXlsxPackage(input, limits = XLSX_LIMITS) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > limits.compressedBytes) throw packageError("FILE_TOO_LARGE", "XLSX 文件超过 20 MB，已停止处理。");
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw packageError("INVALID_XLSX", "无法读取 XLSX 压缩包；文件可能已损坏、加密或格式不正确。", [String(error.message || error)]);
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.entries) throw packageError("PACKAGE_TOO_LARGE", "XLSX 包含过多内部文件项。");
  const totalSize = entries.reduce((sum, entry) => sum + (Number(entry?._data?.uncompressedSize) || 0), 0);
  if (totalSize > limits.uncompressedBytes) throw packageError("PACKAGE_TOO_LARGE", "XLSX 解包后的总量超过 250 MB。");
  const worksheetCount = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name)).length;
  if (worksheetCount > limits.worksheets) throw packageError("PACKAGE_TOO_LARGE", "XLSX 工作表超过 200 个。");
  const unsafeEntry = entries.find((entry) => /(^|\/)activeX\//i.test(entry.name) || /vbaProject\.bin$/i.test(entry.name));
  if (unsafeEntry) throw packageError("EMBEDDED_OBJECTS", "XLSX 包含宏或 ActiveX 控件，暂不处理。", [unsafeEntry.name]);
  // Pictures and attached files (an embedded PDF, Word …) can hold names the tool cannot read; the protected
  // copy leaves them out, so they are only counted here to tell the user.
  const media = { images: entries.filter((entry) => /^xl\/media\//i.test(entry.name)).length, attachments: entries.filter((entry) => /^xl\/embeddings\//i.test(entry.name)).length };
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) throw packageError("INVALID_XLSX", "XLSX 缺少内容类型声明。");
  const contentTypes = await contentTypesFile.async("string");
  if (/macroEnabled|vnd\.ms-office\.vbaProject/i.test(contentTypes)) throw packageError("EMBEDDED_OBJECTS", "宏格式 XLSX 暂不支持。");
  if (!/spreadsheetml\.sheet\.main\+xml/i.test(contentTypes)) throw packageError("FORMAT_MISMATCH", "文件扩展名是 XLSX，但内部内容不是标准工作簿。");
  for (const entry of entries.filter((item) => /\.rels$/i.test(item.name))) {
    const relationships = await entry.async("string");
    // An ordinary link in a cell only opens when someone clicks it, and a formula that reads another workbook
    // is turned into its last value when the file is read (see flattenExternalReferences). Data connections,
    // linked objects and remote pictures fetch on their own, so only those stop the file.
    const external = [...relationships.matchAll(/<Relationship\b[^>]*>/gi)].map(match => match[0]).filter(tag => /TargetMode=["']External["']/i.test(tag));
    if (external.some(tag => !/Type=["'][^"']*\/(?:hyperlink|externalLinkPath|externalLinkLongPath|xlExternalLinkPath\/[A-Za-z]+)["']/i.test(tag))) {
      throw packageError("EXTERNAL_RELATIONSHIPS", "XLSX 包含外部链接或远程连接，已停止处理。", [entry.name]);
    }
  }
  for (const entry of entries.filter(item => /\.(xml|rels)$/i.test(item.name))) {
    let xml = await entry.async("string");
    // Only ordinary cell text is restored; aliases elsewhere must not disappear during ExcelJS serialization.
    if (/^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml|comments\d*\.xml)$/i.test(entry.name)) xml = xml.replace(/(<t\b[^>]*>)[\s\S]*?(<\/t>)/g, "$1$2");
    // Link addresses are not text the tool restores, and they never hold an alias the tool wrote.
    if (/\.rels$/i.test(entry.name)) continue;
    const decoded = xml.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
    const text = `${decoded}\n${decoded.replace(/<[^>]*>/g, "")}`;
    const shortTokens = [...text.matchAll(tokenPattern())].map(match => match[0]).filter(token => !token.startsWith("[["));
    const altered = findKnownShortTokens(text.replace(tokenPattern(), " "), new Set());
    if (shortTokens.length || altered.length) throw packageError("UNSUPPORTED_CONTENT", "简短代号出现在不支持还原的 XLSX 区域，已停止处理。", [entry.name]);
  }
  return { zip, entries: entries.length, totalSize, worksheetCount, media };
}

// Attached files were never opened or checked, so the protected copy must not carry them. (Pictures stay.)
export async function assertNoAttachmentsInXlsxPackage(input) {
  const zip = await JSZip.loadAsync(input);
  const left = Object.keys(zip.files).filter((name) => !zip.files[name].dir && /^xl\/embeddings\//i.test(name));
  if (left.length) throw packageError("MEDIA_LEFT", "脱敏文件里仍有附件，已停止生成。", left);
}

export function mappingText(entry) {
  const value = entry?.value;
  if (!value) return "";
  if (value.type === "richText") return String(value.text ?? "");
  return String(value.value ?? "");
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Parts that only describe the file's structure and formatting; they never carry the user's content.
const STRUCTURE_PART = /^(?:\[Content_Types\]\.xml|.*\.rels|xl\/styles\.xml|xl\/theme\/.*|xl\/calcChain\.xml)$/i;
// Attributes that hold user text: sheet, table and defined names, pivot cache items, captions.
const CONTENT_ATTRIBUTE = /\s(?:name|v|caption|displayName|uniqueName|title|tooltip)="([^"]*)"/g;
const unescapeXml = text => text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (entity, name) => ({ lt: "<", gt: ">", quot: "\"", apos: "'", amp: "&" })[name.toLowerCase()] ?? String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)));

// A cell's <v> is a shared-string index or a number unless the cell holds a formula's text result (t="str");
// indexes like 0, 1, 2 would otherwise look like selected serial numbers.
function readableXml(name, content) {
  if (/^xl\/worksheets\//i.test(name)) return content.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (cell, attrs, body) => /\st="str"/.test(attrs) ? cell : `<c${attrs}>${body.replace(/<v>[^<]*<\/v>/g, "")}</c>`);
  if (/^xl\/drawings\/[^/]+\.xml$/i.test(name)) return [...content.matchAll(/<a:t>[^<]*<\/a:t>/g)].map(match => match[0]).join("");
  // app.xml lists counts and part names; only the sheet names (lpstr) are the user's text.
  if (/^docProps\/app\.xml$/i.test(name)) return [...content.matchAll(/<vt:lpstr>[^<]*<\/vt:lpstr>/g)].map(match => match[0]).join("");
  return content;
}

// The texts a person could read in one XML part: element text plus the content attributes above.
function xmlTexts(content) {
  const texts = [];
  for (const match of content.matchAll(/>([^<]+)</g)) if (match[1].trim()) texts.push(unescapeXml(match[1]));
  for (const match of content.matchAll(CONTENT_ATTRIBUTE)) if (match[1].trim()) texts.push(unescapeXml(match[1]));
  return texts;
}

// Where in the workbook a leftover sits, in words a user can act on.
export function describeXlsxPart(name) {
  if (/^xl\/worksheets\//i.test(name)) return "工作表单元格或公式";
  if (/^xl\/sharedStrings\.xml$/i.test(name)) return "单元格文字";
  if (/comments|threadedComments|vmlDrawing/i.test(name)) return "批注";
  if (/^xl\/(?:charts|drawings)\//i.test(name)) return "图表或图形里的文字";
  if (/^xl\/pivot/i.test(name)) return "数据透视表";
  if (/^xl\/tables\//i.test(name)) return "表格（超级表）的列名";
  if (/^xl\/workbook\.xml$/i.test(name)) return "工作表名称或定义的名称";
  if (/^docProps\//i.test(name)) return "文件属性（标题、作者等）";
  return "文件的其他部分";
}

export async function assertNoSensitiveValuesInXlsxPackage(input, mapping) {
  const zip = await JSZip.loadAsync(input);
  const values = [...new Set(Object.values(mapping).map(mappingText).filter(Boolean))];
  const residual = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(?:xml|rels|vml)$/i.test(entry.name) || STRUCTURE_PART.test(entry.name)) continue;
    const texts = xmlTexts(readableXml(entry.name, await entry.async("string")));
    for (const value of values) {
      if (texts.some(text => residualMatches(text, value))) residual.push(`${describeXlsxPart(entry.name)}：${value}`);
      if (residual.length >= 50) break;
    }
    if (residual.length >= 50) break;
  }
  if (residual.length) throw packageError("SENSITIVE_RESIDUALS", "脱敏后的 XLSX 仍在未处理区域包含所选真实值。", [...new Set(residual)]);
}
