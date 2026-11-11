import {
  addTaskMarker,
  analyzeWorkbook,
  coveredValues,
  flattenExternalReferences,
  flattenHyperlinks,
  hiddenContent,
  inspectWorkbookAlteredTokens,
  inspectWorkbookTokens,
  removeTaskMarker,
  restoreWorkbookValues,
  findWorkbookResiduals,
  tokenizeWorkbook,
} from "./xlsxCore.js";
import { deleteVault, listVaultSummaries, loadVault, saveVault } from "./vaultStore.js";
import { createProtectionIdentity, protectionTokenIdentity, protectionResult, resolveRestoreVault, taskEvidence } from "./taskIdentity.js";
import { assertNoAttachmentsInXlsxPackage, assertNoSensitiveValuesInXlsxPackage, mappingText, preflightXlsxPackage } from "./xlsxPackageCore.js";
import { findWorkbookCandidates } from "./workbookCandidates.js";
import { shortNameCandidates } from "./companyAbbreviations.js";
import { highRiskTextFindings, occurrenceBaseline, occurrenceComparison, protectedOutputName, restoredOutputName } from "./fileSafety.js";

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
    const preflight = await preflightXlsxPackage(buffer);
    await workbook.xlsx.load(buffer);
    workbook.fileMedia = preflight.media;
    workbook.externalFormulas = flattenExternalReferences(workbook);
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

function baseName(filename) {
  return filename.replace(/\.xlsx$/i, "");
}

export async function inspectProtectionFile(file) {
  const workbook = await loadWorkbook(file);
  flattenHyperlinks(workbook);
  const analysis = analyzeWorkbook(workbook);
  // Names already covered by the suggested columns are not listed again.
  const covered = coveredValues(workbook, analysis.columns.filter((item) => analysis.suggestedColumnIds.includes(item.id)));
  // Header rows of tables with a suggested column are read as column names; form rows are still read as labels.
  const headerRows = new Map();
  for (const column of analysis.columns.filter((item) => analysis.suggestedColumnIds.includes(item.id))) {
    if (!headerRows.has(column.sheetName)) headerRows.set(column.sheetName, new Set());
    headerRows.get(column.sheetName).add(`${column.headerRow}:${column.columnNumber}`);
  }
  const chosen = analysis.columns.filter((item) => analysis.suggestedColumnIds.includes(item.id));
  const inChosenColumn = (cell) => chosen.some((column) => column.sheetName === cell.sheet && column.columnNumber === cell.column && cell.row > column.headerRow && cell.row <= (column.endRow ?? Infinity));
  const named = findWorkbookCandidates(workbook, covered, headerRows, inChosenColumn);
  // Short forms of the company names (宏图化工 for 广州宏图化工有限公司) that are written somewhere on their own.
  const companies = [...covered, ...named.candidates.filter((item) => item.category === "customer").map((item) => item.value)];
  const shortNames = shortNameCandidates(companies, named.cells.filter((cell) => cell.note || !inChosenColumn(cell)), new Set([...covered, ...named.candidates.map((item) => item.value)]));
  named.candidates.push(...shortNames);
  named.suggestedCandidateIds.push(...shortNames.map((item) => item.id));
  if (!analysis.columns.length && !named.candidates.length) {
    throw new SafeFileError("NO_TABLE", "没有识别到表格或需要保护的名称。");
  }
  const text = [];
  workbook.eachSheet((worksheet) => worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (typeof cell.text === "string") text.push(cell.text);
  })));
  return { ...analysis, ...named, media: workbook.fileMedia, hidden: hiddenContent(workbook), riskFindings: highRiskTextFindings(text.join("\n")) };
}

export async function createSafeWorkbook(file, selectedColumns, options) {
  if (!selectedColumns.length && !options?.candidates?.length) throw new SafeFileError("NO_COLUMNS", "请至少选择一列或一个名称。");
  const workbook = await loadWorkbook(file);
  const removedLinks = flattenHyperlinks(workbook);
  const identity = await createProtectionIdentity(options, JSON.stringify(workbook.model));
  const id = identity.taskId;
  const createdAt = new Date().toISOString();
  const taskName = baseName(file.name);
  const result = tokenizeWorkbook(workbook, selectedColumns, protectionTokenIdentity(identity), options?.candidates ?? []);
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

  // Pictures stay where they are and are not read; attached files (embedded PDF, Word …) are never written back
  // by the workbook library, so they are left out of the protected copy.
  addTaskMarker(workbook, { taskId: id, taskName, createdAt });
  scrubWorkbookMetadata(workbook);
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  const buffer = await workbook.xlsx.writeBuffer();
  await assertNoAttachmentsInXlsxPackage(buffer);
  try {
    await assertNoSensitiveValuesInXlsxPackage(buffer, result.mapping);
  } catch (error) {
    if (error.code !== "SENSITIVE_RESIDUALS") throw error;
    const cells = findWorkbookResiduals(workbook, Object.values(result.mapping).map(mappingText));
    throw new SafeFileError(error.code, error.message, cells.length ? cells : error.details);
  }
  const vault = {
    version: 2,
    ...identity,
    taskName,
    createdAt,
    sourceFormat: "xlsx",
    occurrenceBaseline: occurrenceBaseline(inspectWorkbookTokens(workbook).occurrences),
    mapping: result.mapping,
  };
  await saveVault(vault);

  return {
    buffer,
    ...protectionResult(identity, result.mapping),
    outputName: protectedOutputName("xlsx", identity.marker || id),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    format: "xlsx",
    taskId: id,
    taskName,
    replacedCells: result.replacedCells,
    uniqueValues: result.uniqueValues,
    elsewhere: result.elsewhere,
    removedMedia: workbook.fileMedia,
    warnings: result.warnings,
    notices: [
      ...result.notices,
      ...(removedLinks ? [{ location: "整个文件", reason: `${removedLinks} 个单元格的超链接已去掉，文字保留` }] : []),
      ...(workbook.externalFormulas ? [{ location: "整个文件", reason: `${workbook.externalFormulas} 个引用其他工作簿的公式已换成当前显示的值` }] : []),
    ],
  };
}

export async function inspectRestoreFile(file, context) {
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
      inspection.taskIds.map((id) => `任务编号 ${id}`),
    );
  }

  const vault = await resolveRestoreVault(inspection, context);
  const id = vault.taskId;
  if (!vault) {
    throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${id} 的还原记录，已停止还原。`, [`任务编号 ${id}`]);
  }
  const unresolved = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
  const unsupported = inspection.occurrences.filter((item) => item.kind === "formula");
  const altered = inspectWorkbookAlteredTokens(workbook, vault.mapping);
  if (unresolved.length || unsupported.length || altered.length) {
    const details = [
      ...unresolved.map((token) => `${token}：本机没有还原记录`),
      ...unsupported.map((item) => `${item.sheetName}!${item.address}：公式中的代号不自动改写`),
      ...altered.map((item) => `${item.sheetName}!${item.address}：代号已改写为 ${item.value}`),
    ];
    throw new SafeFileError("UNRESOLVED_TOKENS", "存在无法安全还原的代号，已停止导出。", details);
  }

  return {
    ...taskEvidence(vault), taskId: id,
    taskName: vault.taskName,
    occurrences: inspection.occurrences.length,
    uniqueTokens: inspection.uniqueTokens.length,
    occurrenceComparison: occurrenceComparison(vault, inspection.occurrences, "xlsx"),
  };
}

export async function restoreSafeWorkbook(file, expectedTaskId, context) {
  const workbook = await loadWorkbook(file);
  const inspection = inspectWorkbookTokens(workbook);
  const vault = await resolveRestoreVault(inspection, context, expectedTaskId);
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机还原记录已不存在，无法还原。");
  const comparison = occurrenceComparison(vault, inspection.occurrences, "xlsx");
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
    outputName: restoredOutputName(file.name, "xlsx", vault),
    taskId: expectedTaskId,
    taskName: vault.taskName,
    restoredOccurrences: result.restoredOccurrences,
    usedMappings: result.inspection.uniqueTokens.length,
    occurrenceComparison: comparison,
  };
}
