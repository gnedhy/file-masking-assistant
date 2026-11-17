import {
  analyzeCsv,
  findCsvSensitiveResiduals,
  findCsvFormulaCells,
  inspectCsvAlteredTokens,
  inspectCsvTokens,
  parseCsvText,
  restoreCsvValues,
  stringifyCsv,
  tokenizeCsv,
} from "./csvCore.js";
import { highRiskTextFindings, occurrenceBaseline, occurrenceComparison, protectedOutputName, restoredOutputName, suspiciousTextFindings } from "./fileSafety.js";
import { SafeFileError } from "./xlsxEngine.js";
import { FILE_SIZE_LIMITS } from "./filePreflight.js";
import { createProtectionIdentity, protectionTokenIdentity, protectionResult, resolveRestoreVault, taskEvidence } from "./taskIdentity.js";
import { listVaultSummaries, loadVault, saveVault } from "./vaultStore.js";

const MAX_CSV_BYTES = FILE_SIZE_LIMITS.csv;

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
    throw new SafeFileError("CSV_TOO_LARGE", "CSV 文件超过 10 MB，已停止处理。", [`文件大小 ${(file.size / 1024 / 1024).toFixed(1)} MB`]);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) throw new SafeFileError("INVALID_CSV", "文件中包含二进制内容，无法作为 CSV 安全处理。");
  const decoded = decodeCsv(bytes);
  const suspicious = suspiciousTextFindings(decoded.text.replace(/^\uFEFF/, ""));
  if (suspicious.length) throw new SafeFileError("SUSPICIOUS_TEXT", "CSV 包含不可见控制字符，已停止处理。", suspicious);
  let document;
  try {
    document = parseCsvText(decoded.text);
  } catch (error) {
    if (error.code === "CSV_LIMIT_EXCEEDED") throw new SafeFileError(error.code, error.message, error.details);
    throw new SafeFileError("INVALID_CSV", "无法读取这个 CSV。请检查引号、分隔符和换行是否完整。", [String(error.message || error)]);
  }
  if (!document.rows.some((row) => row.some((value) => String(value).trim()))) {
    throw new SafeFileError("EMPTY_CSV", "CSV 中没有可处理的表格内容。");
  }
  assertCsvFormulaSafety(document);
  return { ...document, sourceEncoding: decoded.encoding };
}

function assertCsvFormulaSafety(document) {
  const formulas = findCsvFormulaCells(document);
  if (formulas.length) throw new SafeFileError("CSV_FORMULA_INJECTION", "CSV 中包含可能被表格软件执行的公式型字段，已停止处理。", formulas.map(item => ({ ...item, reason: `开头的“${item.value[0]}”可能让表格软件把它当作公式` })));
}

function encodeCsv(document) {
  assertCsvFormulaSafety(document);
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
  return { ...analysis, sourceEncoding: document.sourceEncoding, riskFindings: highRiskTextFindings(stringifyCsv(document)) };
}

export async function createSafeCsv(file, selectedColumns, options) {
  if (!selectedColumns.length) throw new SafeFileError("NO_COLUMNS", "请至少选择一列需要替换的内容。");
  const document = await loadCsv(file);
  const identity = await createProtectionIdentity(options, stringifyCsv(document));
  const id = identity.taskId;
  const createdAt = new Date().toISOString();
  const taskName = baseName(file.name);
  const result = tokenizeCsv(document, selectedColumns, protectionTokenIdentity(identity), options?.candidates ?? []);
  if (!result.replacedCells) throw new SafeFileError("NO_VALUES", "所选列中没有找到可替换值，或文中替换列没有出现已确认实体。", result.warnings);
  if (result.warnings.length) {
    throw new SafeFileError(
      "UNSUPPORTED_CSV_VALUES",
      "所选列中存在无法安全替换的内容，已停止生成。",
      result.warnings.map((warning) => `${warning.location}：${warning.reason}`),
    );
  }
  const residuals = findCsvSensitiveResiduals(document, result.mapping);
  if (residuals.length) {
    throw new SafeFileError("SENSITIVE_RESIDUALS", "脱敏后仍发现已选真实值，已停止生成。", residuals);
  }

  const buffer = encodeCsv(document);
  await saveVault({ version: 2, ...identity, taskName, createdAt, sourceFormat: "csv", occurrenceBaseline: occurrenceBaseline(inspectCsvTokens(document).occurrences), mapping: result.mapping });
  return {
    buffer,
    ...protectionResult(identity, result.mapping),
    outputName: protectedOutputName("csv", identity.marker || id),
    mimeType: "text/csv;charset=utf-8",
    format: "csv",
    taskId: id,
    taskName,
    replacedCells: result.replacedCells,
    uniqueValues: result.uniqueValues,
    elsewhere: result.elsewhere,
    warnings: [],
    notices: [{ location: "输出文件", reason: `已从 ${document.sourceEncoding} 统一输出为 UTF-8 BOM，便于 Excel 正确识别中文` }],
  };
}

export async function inspectCsvRestoreFile(file, context) {
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
    throw new SafeFileError("MIXED_TASKS", "CSV 中混入了多个脱敏任务的代号，已停止还原。", inspection.taskIds.map((id) => `任务编号 ${id}`));
  }
  const vault = await resolveRestoreVault(inspection, context);
  const id = vault.taskId;
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${id} 的还原记录，已停止还原。`, [`任务编号 ${id}`]);
  const unresolved = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
  const altered = inspectCsvAlteredTokens(document, vault.mapping);
  if (unresolved.length || altered.length) {
    throw new SafeFileError("UNRESOLVED_TOKENS", "CSV 中存在无法安全还原的代号，已停止输出。", [
      ...unresolved.map((token) => `${token}：本机没有还原记录`),
      ...altered.map((item) => `${item.location}：代号已改写为 ${item.value}`),
    ]);
  }
  restoreCsvValues(document, vault.mapping);
  assertCsvFormulaSafety(document);
  return { ...taskEvidence(vault), taskId: id, taskName: vault.taskName, occurrences: inspection.occurrences.length, uniqueTokens: inspection.uniqueTokens.length, occurrenceComparison: occurrenceComparison(vault, inspection.occurrences, "csv") };
}

export async function restoreSafeCsv(file, expectedTaskId, context) {
  const document = await loadCsv(file);
  const inspection = inspectCsvTokens(document);
  const vault = await resolveRestoreVault(inspection, context, expectedTaskId);
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机还原记录已不存在，无法还原。");
  const comparison = occurrenceComparison(vault, inspection.occurrences, "csv");
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
    outputName: restoredOutputName(file.name, "csv", vault),
    mimeType: "text/csv;charset=utf-8",
    format: "csv",
    taskId: expectedTaskId,
    taskName: vault.taskName,
    restoredOccurrences: result.restoredOccurrences,
    usedMappings: result.inspection.uniqueTokens.length,
    occurrenceComparison: comparison,
  };
}
