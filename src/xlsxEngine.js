import {
  addTaskMarker,
  analyzeWorkbook,
  inspectWorkbookAlteredTokens,
  inspectWorkbookTokens,
  removeTaskMarker,
  restoreWorkbookValues,
  tokenizeWorkbook,
} from "./xlsxCore.js";
import { deleteVault, listVaultSummaries, loadVault, saveVault } from "./vaultStore.js";
import { assertNoSensitiveValuesInXlsxPackage, preflightXlsxPackage } from "./xlsxPackageCore.js";
import { highRiskTextFindings, occurrenceBaseline, occurrenceComparison, protectedOutputName } from "./fileSafety.js";

export class SafeFileError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "SafeFileError";
    this.code = code;
    this.details = details;
  }
}

export async function discardLocalTask(taskId) {
  if (taskId) await deleteVault(taskId);
}

export async function getLocalTaskStatus() {
  const tasks = await listVaultSummaries();
  return {
    count: tasks.length,
    mappingCount: tasks.reduce((sum, task) => sum + (Number(task.uniqueValues) || 0), 0),
    latest: tasks[0] ?? null,
    tasks,
  };
}

async function excelLibrary() {
  const module = await import("exceljs");
  return module.default ?? module;
}

async function loadWorkbook(file) {
  const ExcelJS = await excelLibrary();
  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = await file.arrayBuffer();
    await preflightXlsxPackage(buffer);
    await workbook.xlsx.load(buffer);
  } catch (error) {
    if (error?.code) throw new SafeFileError(error.code, error.message, error.details || []);
    throw new SafeFileError("INVALID_XLSX", "无法读取这个 XLSX。它可能已损坏、加密或不是标准 XLSX 文件。", [String(error.message || error)]);
  }
  return workbook;
}

function scrubWorkbookMetadata(workbook) {
  workbook.creator = "文件脱敏助手";
  workbook.lastModifiedBy = "文件脱敏助手";
  workbook.company = "";
  workbook.subject = "";
  workbook.description = "";
  workbook.keywords = "";
  workbook.category = "";
  workbook.title = "";
  workbook.manager = "";
  workbook.language = "";
  workbook.revision = "";
  workbook.contentStatus = "";
  workbook.identifier = "";
  workbook.version = "";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.lastPrinted = undefined;
}

function taskId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function baseName(filename) {
  return filename.replace(/\.xlsx$/i, "");
}

export async function inspectProtectionFile(file) {
  const workbook = await loadWorkbook(file);
  const analysis = analyzeWorkbook(workbook);
  if (!analysis.columns.length) {
    throw new SafeFileError("NO_TABLE", "没有识别到可处理的表头，请确认文件中包含普通表格。");
  }
  const text = [];
  workbook.eachSheet((worksheet) => worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (typeof cell.text === "string") text.push(cell.text);
  })));
  return { ...analysis, riskFindings: highRiskTextFindings(text.join("\n")) };
}

export async function createSafeWorkbook(file, selectedColumns) {
  if (!selectedColumns.length) throw new SafeFileError("NO_COLUMNS", "请至少选择一列需要替换的内容。");
  const workbook = await loadWorkbook(file);
  const id = taskId();
  const createdAt = new Date().toISOString();
  const taskName = baseName(file.name);
  const result = tokenizeWorkbook(workbook, selectedColumns, id);
  if (!result.replacedCells) {
    throw new SafeFileError("NO_VALUES", "所选列中没有找到可替换值，或文中替换列没有出现已确认实体。", result.warnings);
  }
  if (result.warnings.length) {
    throw new SafeFileError(
      "UNSUPPORTED_CELLS",
      "所选列中存在无法安全替换的单元格，已停止生成。",
      result.warnings.map((warning) => `${warning.location}：${warning.reason}`),
    );
  }

  addTaskMarker(workbook, { taskId: id, taskName, createdAt });
  scrubWorkbookMetadata(workbook);
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  const buffer = await workbook.xlsx.writeBuffer();
  await assertNoSensitiveValuesInXlsxPackage(buffer, result.mapping);
  const vault = {
    version: 2,
    taskId: id,
    taskName,
    createdAt,
    sourceFormat: "xlsx",
    occurrenceBaseline: occurrenceBaseline(inspectWorkbookTokens(workbook).occurrences),
    mapping: result.mapping,
  };
  await saveVault(vault);

  return {
    buffer,
    outputName: protectedOutputName("xlsx", id),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    format: "xlsx",
    taskId: id,
    taskName,
    replacedCells: result.replacedCells,
    uniqueValues: result.uniqueValues,
    warnings: result.warnings,
    notices: result.notices,
  };
}

export async function inspectRestoreFile(file) {
  const workbook = await loadWorkbook(file);
  const inspection = inspectWorkbookTokens(workbook);
  if (!inspection.occurrences.length) {
    const summaries = await listVaultSummaries();
    const vaults = await Promise.all(summaries.map((summary) => loadVault(summary.taskId)));
    const combinedMapping = Object.assign({}, ...vaults.filter(Boolean).map((vault) => vault.mapping));
    const altered = inspectWorkbookAlteredTokens(workbook, combinedMapping);
    if (altered.length) {
      throw new SafeFileError("ALTERED_TOKENS", "文件中只剩下残缺或被改写的已知代号，已停止输出。", altered.map((item) => `${item.sheetName}!${item.address}：${item.value}`));
    }
    throw new SafeFileError("NO_TOKENS", "文件中没有找到本应用生成的代号。");
  }
  if (inspection.taskIds.length !== 1) {
    throw new SafeFileError(
      "MIXED_TASKS",
      "文件中混入了多个脱敏任务的代号，已停止还原。",
      inspection.taskIds.map((id) => `任务指纹 ${id}`),
    );
  }

  const id = inspection.taskIds[0];
  const vault = await loadVault(id);
  if (!vault) {
    throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${id} 的映射，已停止还原。`, [`任务指纹 ${id}`]);
  }
  const unresolved = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
  const unsupported = inspection.occurrences.filter((item) => item.kind === "formula");
  const altered = inspectWorkbookAlteredTokens(workbook, vault.mapping);
  if (unresolved.length || unsupported.length || altered.length) {
    const details = [
      ...unresolved.map((token) => `${token}：本机没有映射`),
      ...unsupported.map((item) => `${item.sheetName}!${item.address}：公式中的代号不自动改写`),
      ...altered.map((item) => `${item.sheetName}!${item.address}：代号已改写为 ${item.value}`),
    ];
    throw new SafeFileError("UNRESOLVED_TOKENS", "存在无法安全还原的代号，已停止导出。", details);
  }

  return {
    taskId: id,
    taskName: vault.taskName,
    occurrences: inspection.occurrences.length,
    uniqueTokens: inspection.uniqueTokens.length,
    occurrenceComparison: occurrenceComparison(vault.occurrenceBaseline, inspection.occurrences),
  };
}

export async function restoreSafeWorkbook(file, expectedTaskId) {
  const workbook = await loadWorkbook(file);
  const inspection = inspectWorkbookTokens(workbook);
  if (inspection.taskIds.length !== 1 || inspection.taskIds[0] !== expectedTaskId) {
    throw new SafeFileError("TASK_CHANGED", "文件与刚才检查通过的任务不一致，已停止还原。", inspection.taskIds);
  }
  const vault = await loadVault(expectedTaskId);
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机映射已不存在，无法还原。");
  const altered = inspectWorkbookAlteredTokens(workbook, vault.mapping);
  if (altered.length) {
    throw new SafeFileError("ALTERED_TOKENS", "文件中存在残缺或被改写的已知代号，已停止输出。", altered.map((item) => `${item.sheetName}!${item.address}：${item.value}`));
  }
  const result = restoreWorkbookValues(workbook, vault.mapping);
  if (result.unresolved.length) {
    throw new SafeFileError(
      "UNRESOLVED_TOKENS",
      "存在无法安全还原的代号，已停止导出。",
      result.unresolved.map((item) => `${item.sheetName}!${item.address}：${item.reason}`),
    );
  }
  const postCheck = inspectWorkbookTokens(workbook);
  if (postCheck.occurrences.length) {
    throw new SafeFileError(
      "RESIDUAL_TOKENS",
      "还原后仍检测到代号，已停止导出。",
      postCheck.occurrences.map((item) => `${item.sheetName}!${item.address}`),
    );
  }
  removeTaskMarker(workbook);
  scrubWorkbookMetadata(workbook);
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    outputName: `${baseName(file.name).replace(/_(?:脱敏版|安全副本)(?:_[A-F0-9]{8})?$/i, "")}_还原版_${expectedTaskId}.xlsx`,
    taskId: expectedTaskId,
    taskName: vault.taskName,
    restoredOccurrences: result.restoredOccurrences,
    usedMappings: result.inspection.uniqueTokens.length,
  };
}
