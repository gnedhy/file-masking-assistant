import {
  analyzeCsv,
  inspectCsvAlteredTokens,
  inspectCsvTokens,
  parseCsvText,
  restoreCsvValues,
  stringifyCsv,
  tokenizeCsv,
} from "./csvCore.js";
import { SafeFileError } from "./xlsxEngine.js";
import { listVaultSummaries, loadVault, saveVault } from "./vaultStore.js";

const MAX_CSV_BYTES = 50 * 1024 * 1024;
const MAX_CSV_ROWS = 200_000;
const MAX_CSV_COLUMNS = 500;
const MAX_CSV_CELLS = 5_000_000;

function taskId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function baseName(filename) {
  return filename.replace(/\.csv$/i, "");
}

function decodeCsv(bytes) {
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: hasBom ? "UTF-8 BOM" : "UTF-8" };
  } catch {
    try {
      return { text: new TextDecoder("gb18030", { fatal: true }).decode(bytes), encoding: "GB18030" };
    } catch {
      throw new SafeFileError("INVALID_CSV_ENCODING", "无法识别这个 CSV 的文字编码。请将文件另存为 UTF-8 CSV 后重试。");
    }
  }
}

async function loadCsv(file) {
  if (file.size > MAX_CSV_BYTES) {
    throw new SafeFileError("CSV_TOO_LARGE", "CSV 文件超过 50 MB，已停止处理。", [`文件大小 ${(file.size / 1024 / 1024).toFixed(1)} MB`]);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) throw new SafeFileError("INVALID_CSV", "文件中包含二进制内容，无法作为 CSV 安全处理。");
  const decoded = decodeCsv(bytes);
  let document;
  try {
    document = parseCsvText(decoded.text);
  } catch (error) {
    throw new SafeFileError("INVALID_CSV", "无法读取这个 CSV。请检查引号、分隔符和换行是否完整。", [String(error.message || error)]);
  }
  const maximumColumns = document.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const cells = document.rows.reduce((total, row) => total + row.length, 0);
  if (document.rows.length > MAX_CSV_ROWS || maximumColumns > MAX_CSV_COLUMNS || cells > MAX_CSV_CELLS) {
    throw new SafeFileError("CSV_LIMIT_EXCEEDED", "CSV 超出当前安全处理范围，已停止处理。", [
      `${document.rows.length} 行`,
      `${maximumColumns} 列`,
      `${cells} 个字段`,
    ]);
  }
  if (!document.rows.some((row) => row.some((value) => String(value).trim()))) {
    throw new SafeFileError("EMPTY_CSV", "CSV 中没有可处理的表格内容。");
  }
  return { ...document, sourceEncoding: decoded.encoding };
}

function encodeCsv(document) {
  return new TextEncoder().encode(`\uFEFF${stringifyCsv(document)}`);
}

async function combinedLocalMapping() {
  const summaries = await listVaultSummaries();
  const vaults = await Promise.all(summaries.map((summary) => loadVault(summary.taskId)));
  return Object.assign({}, ...vaults.filter(Boolean).map((vault) => vault.mapping));
}

export async function inspectCsvProtectionFile(file) {
  const document = await loadCsv(file);
  const analysis = analyzeCsv(document);
  if (!analysis.columns.length) throw new SafeFileError("NO_TABLE", "没有识别到可处理的 CSV 表头。");
  return { ...analysis, sourceEncoding: document.sourceEncoding };
}

export async function createSafeCsv(file, selectedColumns) {
  if (!selectedColumns.length) throw new SafeFileError("NO_COLUMNS", "请至少选择一列需要替换的内容。");
  const document = await loadCsv(file);
  const id = taskId();
  const createdAt = new Date().toISOString();
  const taskName = baseName(file.name);
  const result = tokenizeCsv(document, selectedColumns, id);
  if (!result.replacedCells) throw new SafeFileError("NO_VALUES", "所选列中没有找到可替换值，或文中替换列没有出现已确认实体。", result.warnings);
  if (result.warnings.length) {
    throw new SafeFileError(
      "UNSUPPORTED_CSV_VALUES",
      "所选列中存在无法安全替换的内容，已停止生成。",
      result.warnings.map((warning) => `${warning.location}：${warning.reason}`),
    );
  }

  await saveVault({ version: 1, taskId: id, taskName, createdAt, sourceFileName: file.name, mapping: result.mapping });
  return {
    buffer: encodeCsv(document),
    outputName: `${taskName}_脱敏版_${id}.csv`,
    mimeType: "text/csv;charset=utf-8",
    format: "csv",
    taskId: id,
    taskName,
    replacedCells: result.replacedCells,
    uniqueValues: result.uniqueValues,
    warnings: [],
    notices: [{ location: "输出文件", reason: `已从 ${document.sourceEncoding} 统一输出为 UTF-8 BOM，便于 Excel 正确识别中文` }],
  };
}

export async function inspectCsvRestoreFile(file) {
  const document = await loadCsv(file);
  const inspection = inspectCsvTokens(document);
  if (!inspection.occurrences.length) {
    const altered = inspectCsvAlteredTokens(document, await combinedLocalMapping());
    if (altered.length) {
      throw new SafeFileError("ALTERED_TOKENS", "CSV 中只剩下残缺或被改写的已知代号，已停止输出。", altered.map((item) => `${item.location}：${item.value}`));
    }
    throw new SafeFileError("NO_TOKENS", "CSV 中没有找到本应用生成的代号。");
  }
  if (inspection.taskIds.length !== 1) {
    throw new SafeFileError("MIXED_TASKS", "CSV 中混入了多个脱敏任务的代号，已停止还原。", inspection.taskIds.map((id) => `任务指纹 ${id}`));
  }
  const id = inspection.taskIds[0];
  const vault = await loadVault(id);
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${id} 的映射，已停止还原。`, [`任务指纹 ${id}`]);
  const unresolved = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
  const altered = inspectCsvAlteredTokens(document, vault.mapping);
  if (unresolved.length || altered.length) {
    throw new SafeFileError("UNRESOLVED_TOKENS", "CSV 中存在无法安全还原的代号，已停止输出。", [
      ...unresolved.map((token) => `${token}：本机没有映射`),
      ...altered.map((item) => `${item.location}：代号已改写为 ${item.value}`),
    ]);
  }
  return { taskId: id, taskName: vault.taskName, occurrences: inspection.occurrences.length, uniqueTokens: inspection.uniqueTokens.length };
}

export async function restoreSafeCsv(file, expectedTaskId) {
  const document = await loadCsv(file);
  const inspection = inspectCsvTokens(document);
  if (inspection.taskIds.length !== 1 || inspection.taskIds[0] !== expectedTaskId) {
    throw new SafeFileError("TASK_CHANGED", "CSV 与刚才检查通过的任务不一致，已停止还原。", inspection.taskIds);
  }
  const vault = await loadVault(expectedTaskId);
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机映射已不存在，无法还原。");
  const altered = inspectCsvAlteredTokens(document, vault.mapping);
  if (altered.length) {
    throw new SafeFileError("ALTERED_TOKENS", "CSV 中存在残缺或被改写的已知代号，已停止输出。", altered.map((item) => `${item.location}：${item.value}`));
  }
  const result = restoreCsvValues(document, vault.mapping);
  if (result.unresolved.length) {
    throw new SafeFileError("UNRESOLVED_TOKENS", "CSV 中存在无法安全还原的代号，已停止输出。", result.unresolved.map((item) => `${item.location}：${item.reason}`));
  }
  const postCheck = inspectCsvTokens(document);
  if (postCheck.occurrences.length) {
    throw new SafeFileError("RESIDUAL_TOKENS", "还原后仍检测到代号，已停止导出。", postCheck.occurrences.map((item) => item.location));
  }
  return {
    buffer: encodeCsv(document),
    outputName: `${baseName(file.name).replace(/_(?:脱敏版|安全副本|还原版)(?:_[A-F0-9]{8})?$/i, "")}_还原版_${expectedTaskId}.csv`,
    mimeType: "text/csv;charset=utf-8",
    format: "csv",
    taskId: expectedTaskId,
    taskName: vault.taskName,
    restoredOccurrences: result.restoredOccurrences,
    usedMappings: result.inspection.uniqueTokens.length,
  };
}
