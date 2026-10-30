import {
  createSafeWorkbook,
  inspectProtectionFile as inspectXlsxProtectionFile,
  inspectRestoreFile as inspectXlsxRestoreFile,
  restoreSafeWorkbook,
} from "./xlsxEngine.js";
import { createSafeCsv, inspectCsvProtectionFile, inspectCsvRestoreFile, restoreSafeCsv } from "./csvEngine.js";
import { FILE_SIZE_LIMITS, prepareFile } from "./filePreflight.js";

export { FILE_SIZE_LIMITS };

export const SUPPORTED_PROTECT_FORMATS = ["xlsx", "csv", "txt", "md", "docx"];
export const SUPPORTED_RESTORE_FORMATS = ["xlsx", "csv", "txt", "md", "docx", "pptx", "html"];

export const FORMAT_CAPABILITIES = {
  xlsx: { protect: true, restore: true },
  csv: { protect: true, restore: true },
  txt: { protect: true, restore: true },
  md: { protect: true, restore: true },
  docx: { protect: true, restore: true },
  pptx: { protect: false, restore: true },
  html: { protect: false, restore: true },
};

export const FILE_FORMAT_META = {
  xlsx: { label: "Excel", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  csv: { label: "CSV", mimeType: "text/csv;charset=utf-8" },
  txt: { label: "TXT", mimeType: "text/plain;charset=utf-8" },
  md: { label: "Markdown", mimeType: "text/plain;charset=utf-8" },
  docx: { label: "Word", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pptx: { label: "PowerPoint", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  html: { label: "HTML", mimeType: "text/html;charset=utf-8" },
};

export function fileFormatFromName(filename) {
  return String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export async function inspectProtectionFile(file) {
  const prepared = await prepareFile(file, SUPPORTED_PROTECT_FORMATS);
  file = prepared.file;
  const { evidence } = prepared;
  const format = evidence.format;
  if (format === "docx") {
    const { inspectDocxProtectionFile } = await import("./officeOpenXmlEngine.js");
    return { ...await inspectDocxProtectionFile(file), ...evidence };
  }
  if (format === "txt" || format === "md") {
    const { inspectTextProtectionFile } = await import("./textEngine.js");
    return { ...await inspectTextProtectionFile(file, format), ...evidence };
  }
  if (format === "csv") {
    const analysis = await inspectCsvProtectionFile(file);
    return { ...analysis, ...evidence, formatLabel: FILE_FORMAT_META.csv.label };
  }
  const analysis = await inspectXlsxProtectionFile(file);
  return { ...analysis, ...evidence, formatLabel: FILE_FORMAT_META.xlsx.label };
}

export async function createSafeFile(file, selection, options) {
  const prepared = await prepareFile(file, SUPPORTED_PROTECT_FORMATS);
  file = prepared.file;
  const { format } = prepared.evidence;
  if (format === "docx") {
    const { createSafeDocx } = await import("./officeOpenXmlEngine.js");
    return createSafeDocx(file, selection, options);
  }
  if (format === "txt" || format === "md") {
    const { createSafeText } = await import("./textEngine.js");
    return createSafeText(file, selection, format, options);
  }
  return format === "csv"
    ? createSafeCsv(file, selection, options)
    : createSafeWorkbook(file, selection, options);
}

export async function inspectRestoreFile(file, context) {
  const prepared = await prepareFile(file, SUPPORTED_RESTORE_FORMATS);
  file = prepared.file;
  const { evidence } = prepared;
  const format = evidence.format;
  if (format === "txt" || format === "md") {
    const { inspectTextRestoreFile } = await import("./textEngine.js");
    return { ...await inspectTextRestoreFile(file, format, context), ...evidence };
  }
  if (format === "html") {
    const { inspectHtmlRestoreFile } = await import("./htmlEngine.js");
    return { ...await inspectHtmlRestoreFile(file, context), ...evidence };
  }
  if (format === "csv") {
    const inspection = await inspectCsvRestoreFile(file, context);
    return {
      ...inspection,
      ...evidence,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      usedMappings: inspection.uniqueTokens,
      checkedAreas: ["全部 CSV 文本字段"],
      uncheckedAreas: ["图片、样式和嵌入对象（CSV 本身不包含）；不计算公式"],
      warnings: ["输出统一为 UTF-8 BOM；部分代号未出现不代表异常。"],
    };
  }
  if (format === "xlsx") {
    const inspection = await inspectXlsxRestoreFile(file, context);
    return {
      ...inspection,
      ...evidence,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      usedMappings: inspection.uniqueTokens,
      checkedAreas: ["工作表普通单元格和富文本"],
      uncheckedAreas: ["图片、图表和嵌入对象"],
      warnings: ["图片未扫描，部分代号未出现不代表异常。"],
    };
  }
  const { inspectOfficeRestoreFile } = await import("./officeOpenXmlEngine.js");
  return { ...await inspectOfficeRestoreFile(file, context), ...evidence };
}

export async function restoreSafeFile(file, expectedTaskId, context) {
  const prepared = await prepareFile(file, SUPPORTED_RESTORE_FORMATS);
  file = prepared.file;
  const { format } = prepared.evidence;
  if (format === "txt" || format === "md") {
    const { restoreSafeText } = await import("./textEngine.js");
    return restoreSafeText(file, expectedTaskId, format, context);
  }
  if (format === "html") {
    const { restoreHtmlSafeFile } = await import("./htmlEngine.js");
    return restoreHtmlSafeFile(file, expectedTaskId, context);
  }
  if (format === "csv") {
    const result = await restoreSafeCsv(file, expectedTaskId, context);
    return {
      ...result,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      mimeType: FILE_FORMAT_META[format].mimeType,
      checkedAreas: ["全部 CSV 文本字段"],
      uncheckedAreas: ["图片、样式和嵌入对象（CSV 本身不包含）；不计算公式"],
      warnings: ["输出统一为 UTF-8 BOM；部分代号未出现不代表异常。"],
    };
  }
  if (format === "xlsx") {
    const result = await restoreSafeWorkbook(file, expectedTaskId, context);
    return {
      ...result,
      format,
      formatLabel: FILE_FORMAT_META[format].label,
      mimeType: FILE_FORMAT_META[format].mimeType,
      usedMappings: result.usedMappings ?? result.restoredOccurrences,
      checkedAreas: ["工作表普通单元格和富文本"],
      uncheckedAreas: ["图片、图表和嵌入对象"],
      warnings: ["图片未扫描，部分代号未出现不代表异常。"],
    };
  }
  const { restoreOfficeSafeFile } = await import("./officeOpenXmlEngine.js");
  return restoreOfficeSafeFile(file, expectedTaskId, context);
}
