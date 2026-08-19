import JSZip from "jszip";

export const XLSX_LIMITS = {
  compressedBytes: 50 * 1024 * 1024,
  uncompressedBytes: 250 * 1024 * 1024,
  entries: 5000,
  worksheets: 200,
};

function packageError(code, message, details = []) {
  return Object.assign(new Error(message), { code, details });
}

export async function preflightXlsxPackage(input, limits = XLSX_LIMITS) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > limits.compressedBytes) throw packageError("FILE_TOO_LARGE", "XLSX 文件超过 50 MB，已停止处理。");
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
  if (unsafeEntry) throw packageError("EMBEDDED_OBJECTS", "XLSX 包含宏、ActiveX、OLE 或嵌入包，首版不处理。", [unsafeEntry.name]);
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) throw packageError("INVALID_XLSX", "XLSX 缺少内容类型声明。");
  const contentTypes = await contentTypesFile.async("string");
  if (/macroEnabled|vnd\.ms-office\.vbaProject/i.test(contentTypes)) throw packageError("EMBEDDED_OBJECTS", "宏格式 XLSX 不在首版支持范围内。");
  if (!/spreadsheetml\.sheet\.main\+xml/i.test(contentTypes)) throw packageError("FORMAT_MISMATCH", "文件扩展名是 XLSX，但内部内容不是标准工作簿。");
  return { zip, entries: entries.length, totalSize, worksheetCount };
}
