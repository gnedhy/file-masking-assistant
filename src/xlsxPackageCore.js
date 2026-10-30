import JSZip from "jszip";
import { FILE_SIZE_LIMITS } from "./filePreflight.js";
import { tokenPattern } from "./tokenFormat.js";
import { findKnownShortTokens } from "./xlsxCore.js";

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
  const unsafeEntry = entries.find((entry) => /(^|\/)(embeddings|activeX)\//i.test(entry.name) || /vbaProject\.bin$/i.test(entry.name));
  if (unsafeEntry) throw packageError("EMBEDDED_OBJECTS", "XLSX 包含宏、ActiveX、OLE 或嵌入包，暂不处理。", [unsafeEntry.name]);
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) throw packageError("INVALID_XLSX", "XLSX 缺少内容类型声明。");
  const contentTypes = await contentTypesFile.async("string");
  if (/macroEnabled|vnd\.ms-office\.vbaProject/i.test(contentTypes)) throw packageError("EMBEDDED_OBJECTS", "宏格式 XLSX 暂不支持。");
  if (!/spreadsheetml\.sheet\.main\+xml/i.test(contentTypes)) throw packageError("FORMAT_MISMATCH", "文件扩展名是 XLSX，但内部内容不是标准工作簿。");
  for (const entry of entries.filter((item) => /\.rels$/i.test(item.name))) {
    const relationships = await entry.async("string");
    if (/TargetMode=["']External["']/i.test(relationships)) {
      throw packageError("EXTERNAL_RELATIONSHIPS", "XLSX 包含外部链接或远程连接，已停止处理。", [entry.name]);
    }
  }
  for (const entry of entries.filter(item => /\.(xml|rels)$/i.test(item.name))) {
    let xml = await entry.async("string");
    // Only ordinary cell text is restored; aliases elsewhere must not disappear during ExcelJS serialization.
    if (/^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(entry.name)) xml = xml.replace(/(<t\b[^>]*>)[\s\S]*?(<\/t>)/g, "$1$2");
    const decoded = xml.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
    const text = `${decoded}\n${decoded.replace(/<[^>]*>/g, "")}`;
    const shortTokens = [...text.matchAll(tokenPattern())].map(match => match[0]).filter(token => !token.startsWith("[["));
    const altered = findKnownShortTokens(text.replace(tokenPattern(), " "), new Set());
    if (shortTokens.length || altered.length) throw packageError("UNSUPPORTED_CONTENT", "简短代号出现在不支持还原的 XLSX 区域，已停止处理。", [entry.name]);
  }
  return { zip, entries: entries.length, totalSize, worksheetCount };
}

function mappingText(entry) {
  const value = entry?.value;
  if (!value) return "";
  if (value.type === "richText") return String(value.text ?? "");
  return String(value.value ?? "");
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function assertNoSensitiveValuesInXlsxPackage(input, mapping) {
  const zip = await JSZip.loadAsync(input);
  const values = [...new Set(Object.values(mapping).map(mappingText).filter(Boolean))];
  const residual = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(?:xml|rels)$/i.test(entry.name)) continue;
    const content = await entry.async("string");
    for (const value of values) {
      if (content.includes(value) || content.includes(escapeXml(value))) residual.push(`${entry.name}：${value}`);
      if (residual.length >= 50) break;
    }
    if (residual.length >= 50) break;
  }
  if (residual.length) throw packageError("SENSITIVE_RESIDUALS", "脱敏后的 XLSX 仍在未处理区域包含所选真实值。", residual);
}
