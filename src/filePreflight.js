const FORMAT_MIME_TYPES = {
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  csv: ["text/csv", "application/vnd.ms-excel"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  html: ["text/html"],
};

const ZIP_FORMATS = new Set(["xlsx", "docx", "pptx"]);
const TEXT_FORMATS = new Set(["csv", "txt", "md", "html"]);

function preflightError(code, message, details = []) {
  return Object.assign(new Error(message), { code, details });
}

function extensionOf(filename) {
  return String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function hasZipSignature(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

export async function preflightFile(file, allowedFormats) {
  const format = extensionOf(file?.name);
  if (!allowedFormats.includes(format)) {
    throw preflightError("UNSUPPORTED_FILE", `当前入口不支持 .${format || "未知"} 文件。`, [`支持格式：${allowedFormats.join("、").toUpperCase()}`]);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ZIP_FORMATS.has(format) && !hasZipSignature(bytes)) {
    throw preflightError("FORMAT_MISMATCH", `文件扩展名是 ${format.toUpperCase()}，但内容不是标准 Office 压缩包。`);
  }
  if (TEXT_FORMATS.has(format) && bytes.includes(0)) {
    const code = format === "csv" ? "INVALID_CSV" : format === "html" ? "INVALID_HTML" : "INVALID_TEXT";
    throw preflightError(code, "文件包含二进制空字符，不能作为文本文件安全处理。");
  }

  const mimeType = String(file.type || "").toLowerCase();
  const expectedMimeTypes = FORMAT_MIME_TYPES[format] ?? [];
  const warnings = mimeType && !expectedMimeTypes.includes(mimeType)
    ? [`浏览器报告的 MIME 类型为 ${mimeType}，已继续按扩展名和文件内容核对。`]
    : [];
  return {
    format,
    declaredExtension: format,
    reportedMimeType: mimeType || "未提供",
    signature: ZIP_FORMATS.has(format) ? "ZIP/Office Open XML" : "文本内容",
    preflightWarnings: warnings,
  };
}
