import {
  createSafeWorkbook,
  inspectProtectionFile as inspectXlsxProtectionFile,
  inspectRestoreFile as inspectXlsxRestoreFile,
  restoreSafeWorkbook,
} from "./xlsxEngine.js";
import { createSafeCsv, inspectCsvProtectionFile, inspectCsvRestoreFile, restoreSafeCsv } from "./csvEngine.js";
import { inspectOfficeRestoreFile, restoreOfficeSafeFile } from "./officeOpenXmlEngine.js";
import { inspectHtmlRestoreFile, restoreHtmlSafeFile } from "./htmlEngine.js";

export const SUPPORTED_PROTECT_FORMATS = ["xlsx", "csv"];
export const SUPPORTED_RESTORE_FORMATS = ["xlsx", "csv", "docx", "pptx", "html"];

export const FORMAT_CAPABILITIES = {
  xlsx: { protect: true, restore: true },
  csv: { protect: true, restore: true },
  docx: { protect: false, restore: true },
  pptx: { protect: false, restore: true },
  html: { protect: false, restore: true },
};

export const FILE_FORMAT_META = {
  xlsx: { label: "Excel", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  csv: { label: "CSV", mimeType: "text/csv;charset=utf-8" },
  docx: { label: "Word", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pptx: { label: "PowerPoint", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  html: { label: "HTML", mimeType: "text/html;charset=utf-8" },
};

export function fileFormatFromName(filename) {
  return String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export async function inspectProtectionFile(file) {
  const format = fileFormatFromName(file.name);
  if (format === "csv") return inspectCsvProtectionFile(file);
  const analysis = await inspectXlsxProtectionFile(file);
  return { ...analysis, format: "xlsx", formatLabel: FILE_FORMAT_META.xlsx.label };
}

export async function createSafeFile(file, selectedColumns) {
  return fileFormatFromName(file.name) === "csv"
    ? createSafeCsv(file, selectedColumns)
    : createSafeWorkbook(file, selectedColumns);
}

export async function inspectRestoreFile(file) {
  const format = fileFormatFromName(file.name);
  if (format === "html") return inspectHtmlRestoreFile(file);
  if (format === "csv") {
    const inspection = await inspectCsvRestoreFile(file);
    return {
      ...inspection,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      usedMappings: inspection.uniqueTokens,
      checkedAreas: ["全部 CSV 文本字段"],
      uncheckedAreas: ["图片、格式、公式和嵌入对象（CSV 本身不包含）"],
      warnings: ["输出统一为 UTF-8 BOM；未出现的映射不代表异常。"],
    };
  }
  if (format === "xlsx") {
    const inspection = await inspectXlsxRestoreFile(file);
    return {
      ...inspection,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      usedMappings: inspection.uniqueTokens,
      checkedAreas: ["工作表普通单元格和富文本"],
      uncheckedAreas: ["图片、图表和嵌入对象"],
      warnings: ["图片未扫描，未出现的映射不代表异常。"],
    };
  }
  return inspectOfficeRestoreFile(file);
}

export async function restoreSafeFile(file, expectedTaskId) {
  const format = fileFormatFromName(file.name);
  if (format === "html") return restoreHtmlSafeFile(file, expectedTaskId);
  if (format === "csv") {
    const result = await restoreSafeCsv(file, expectedTaskId);
    return {
      ...result,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      mimeType: FILE_FORMAT_META[format].mimeType,
      checkedAreas: ["全部 CSV 文本字段"],
      uncheckedAreas: ["图片、格式、公式和嵌入对象（CSV 本身不包含）"],
      warnings: ["输出统一为 UTF-8 BOM；未出现的映射不代表异常。"],
    };
  }
  if (format === "xlsx") {
    const result = await restoreSafeWorkbook(file, expectedTaskId);
    return {
      ...result,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      mimeType: FILE_FORMAT_META[format].mimeType,
      usedMappings: result.usedMappings ?? result.restoredOccurrences,
      checkedAreas: ["工作表普通单元格和富文本"],
      uncheckedAreas: ["图片、图表和嵌入对象"],
      warnings: ["图片未扫描，未出现的映射不代表异常。"],
    };
  }
  return restoreOfficeSafeFile(file, expectedTaskId);
}
