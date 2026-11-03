import { SafeFileError } from "./xlsxEngine.js";
import { listVaultSummaries, loadVault, saveVault } from "./vaultStore.js";
import { createProtectionIdentity, protectionTokenIdentity, protectionResult, resolveRestoreVault, taskEvidence } from "./taskIdentity.js";
import { OFFICE_FORMATS, analyzeDocxProtectionPackage, assertNoSensitiveValuesInOfficePackage, findAlteredTokens, inspectOfficePackage, loadOfficePackage, restoreOfficePackage, tokenizeDocxPackage } from "./officeOpenXmlCore.js";
import { scrubOfficeMetadata, allXmlText } from "./officeOpenXmlCore.js";
import { highRiskTextFindings, occurrenceBaseline, occurrenceComparison, protectedOutputName, restoredOutputName } from "./fileSafety.js";

function extensionOf(filename) {
  return filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function cleanBaseName(filename) {
  return filename.replace(/\.(docx|pptx)$/i, "").replace(/_(?:脱敏版|安全副本|还原版)(?:_[A-F0-9]{8})?$/i, "");
}

function asSafeFileError(error) {
  if (error instanceof SafeFileError) return error;
  return new SafeFileError(error.code || "INVALID_OFFICE_PACKAGE", error.message || "Office 文件处理失败。", error.details || []);
}

function validateInspection(inspection) {
  if (!inspection.occurrences.length && !inspection.unsupportedOccurrences.length) {
    throw new SafeFileError("NO_TOKENS", "文件中没有找到本应用生成的完整代号。");
  }
  if (inspection.taskIds.length !== 1) {
    throw new SafeFileError("MIXED_TASKS", "文件中混入了多个脱敏任务的代号，已停止还原。", inspection.taskIds.map((id) => `任务 ${id}`));
  }
  if (inspection.unsupportedOccurrences.length) {
    throw new SafeFileError(
      "UNSUPPORTED_CONTENT",
      "代号出现在暂不处理的 Office 区域，已停止输出。",
      inspection.unsupportedOccurrences.map((item) => `${item.location}：${item.token}`),
    );
  }
}

async function allLocalMappings() {
  const summaries = await listVaultSummaries();
  const vaults = await Promise.all(summaries.map((summary) => loadVault(summary.taskId)));
  return Object.assign({}, ...vaults.filter(Boolean).map((vault) => vault.mapping));
}

async function detectAlteredWithoutFormalToken(zip, format) {
  const mapping = await allLocalMappings();
  if (!Object.keys(mapping).length) return [];
  const findings = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith(".xml")) continue;
    const xml = await entry.async("string");
    findings.push(...findAlteredTokens(xml, format, mapping).map((value) => `${entry.name}：${value}`));
  }
  return findings;
}

async function checkedPackage(file) {
  return loadOfficePackage(await file.arrayBuffer(), extensionOf(file.name));
}

export async function inspectDocxProtectionFile(file) {
  try {
    const { zip, format } = await checkedPackage(file);
    if (format !== "docx") throw new SafeFileError("FORMAT_MISMATCH", "DOCX 脱敏入口只处理标准 Word 文件。");
    const analysis = await analyzeDocxProtectionPackage(zip);
    return { ...analysis, riskFindings: highRiskTextFindings(analysis.sourceText) };
  } catch (error) {
    throw asSafeFileError(error);
  }
}

export async function createSafeDocx(file, selectedCandidates, options) {
  try {
    if (!selectedCandidates.length) throw new SafeFileError("NO_TEXT_CANDIDATES", "请至少选择一项需要替换的敏感内容。");
    const { zip, format } = await checkedPackage(file);
    if (format !== "docx") throw new SafeFileError("FORMAT_MISMATCH", "DOCX 脱敏入口只处理标准 Word 文件。");
    await analyzeDocxProtectionPackage(zip);
    const sourceParts = await Promise.all(Object.values(zip.files).filter(entry => !entry.dir && /\.xml$/i.test(entry.name)).map(entry => entry.async("string")));
    const identity = await createProtectionIdentity(options, sourceParts.map(allXmlText).join("\n"));
    const taskId = identity.taskId;
    const taskName = cleanBaseName(file.name);
    const result = await tokenizeDocxPackage(zip, selectedCandidates, protectionTokenIdentity(identity));
    if (!result.replacedOccurrences || !result.uniqueValues) throw new SafeFileError("NO_VALUES", "没有找到可替换的完整文字。");
    const postCheck = await inspectOfficePackage(zip, "docx");
    const unknown = postCheck.uniqueTokens.filter((token) => !result.mapping[token]);
    if (postCheck.unsupportedOccurrences.length || unknown.length) throw new SafeFileError("UNSUPPORTED_CONTENT", "代号出现在 DOCX 暂不处理的区域。", [...postCheck.unsupportedOccurrences.map((item) => `${item.location}：${item.token}`), ...unknown]);
    await assertNoSensitiveValuesInOfficePackage(zip, result.mapping);
    await scrubOfficeMetadata(zip);
    const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    await saveVault({ version: 2, ...identity, taskName, createdAt: new Date().toISOString(), sourceFormat: "docx", occurrenceBaseline: occurrenceBaseline(postCheck.occurrences), mapping: result.mapping });
    return {
      ...protectionResult(identity, result.mapping), buffer,
      outputName: protectedOutputName("docx", identity.marker || taskId), mimeType: OFFICE_FORMATS.docx.mimeType,
      format: "docx", formatLabel: "Word", taskId, taskName,
      replacedCells: result.replacedOccurrences, uniqueValues: result.uniqueValues,
      checkedAreas: result.checkedAreas, uncheckedAreas: OFFICE_FORMATS.docx.unchecked,
      warnings: ["图片未扫描；真实内容变长后可能换行或溢出，请在 Word 中复核。"], notices: [],
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}

export async function inspectOfficeRestoreFile(file, context) {
  try {
    const { zip, format } = await checkedPackage(file);
    const initial = await inspectOfficePackage(zip, format);
    if (!initial.occurrences.length && !initial.unsupportedOccurrences.length) {
      const altered = await detectAlteredWithoutFormalToken(zip, format);
      if (altered.length) throw new SafeFileError("ALTERED_TOKENS", "文件中只剩下残缺或被改写的已知代号，已停止输出。", altered);
    }
    validateInspection(initial);
    const vault = await resolveRestoreVault(initial, context);
    const taskId = vault.taskId;
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${taskId} 的还原记录，已停止还原。`, [`任务 ${taskId}`]);
    const inspection = await inspectOfficePackage(zip, format, vault.mapping);
    const unknown = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
    if (unknown.length) throw new SafeFileError("UNRESOLVED_TOKENS", "文件中存在本机无法确认的代号，已停止输出。", unknown);
    if (inspection.altered.length) {
      throw new SafeFileError("ALTERED_TOKENS", "文件中存在残缺或被改写的已知代号，已停止输出。", inspection.altered.map((item) => `${item.location}：${item.value}`));
    }
    return {
      format,
      formatLabel: OFFICE_FORMATS[format].label,
      taskId,
      ...taskEvidence(vault), taskName: vault.taskName,
      occurrences: inspection.occurrences.length,
      uniqueTokens: inspection.uniqueTokens.length,
      usedMappings: inspection.uniqueTokens.length,
      checkedAreas: inspection.checkedAreas,
      uncheckedAreas: inspection.uncheckedAreas,
      warnings: ["图片未扫描，部分代号未出现不代表异常。", "真实内容变长后可能产生换行或溢出，请在 Office 中复核版式。"],
      occurrenceComparison: occurrenceComparison(vault.occurrenceBaseline, inspection.occurrences),
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}

export async function restoreOfficeSafeFile(file, expectedTaskId, context) {
  try {
    const { zip, format } = await checkedPackage(file);
    const initial = await inspectOfficePackage(zip, format);
    validateInspection(initial);
    const vault = await resolveRestoreVault(initial, context, expectedTaskId);
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机还原记录已不存在，无法还原。");
    const before = await inspectOfficePackage(zip, format, vault.mapping);
    const comparison = occurrenceComparison(vault.occurrenceBaseline, before.occurrences);
    const unknown = before.uniqueTokens.filter((token) => !vault.mapping[token]);
    if (unknown.length || before.altered.length || before.unsupportedOccurrences.length) {
      throw new SafeFileError("UNRESOLVED_TOKENS", "文件未通过还原前的完整代号检查，已停止输出。", [
        ...unknown,
        ...before.altered.map((item) => `${item.location}：${item.value}`),
        ...before.unsupportedOccurrences.map((item) => `${item.location}：${item.token}`),
      ]);
    }
    const restored = await restoreOfficePackage(zip, format, vault.mapping);
    const postCheck = await inspectOfficePackage(zip, format);
    if (postCheck.occurrences.length || postCheck.unsupportedOccurrences.length || postCheck.chartDataOccurrences.length) {
      throw new SafeFileError("RESIDUAL_TOKENS", "还原后仍检测到代号，已停止输出。", [
        ...postCheck.occurrences.map((item) => `${item.location}：${item.token}`),
        ...postCheck.chartDataOccurrences.map((item) => `${item.location}：${item.token}`),
        ...postCheck.unsupportedOccurrences.map((item) => `${item.location}：${item.token}`),
      ]);
    }
    const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return {
      buffer,
      outputName: restoredOutputName(file.name, format, vault),
      mimeType: OFFICE_FORMATS[format].mimeType,
      format,
      formatLabel: OFFICE_FORMATS[format].label,
      taskId: expectedTaskId,
      taskName: vault.taskName,
      restoredOccurrences: restored.restoredOccurrences,
      usedMappings: before.uniqueTokens.length,
      occurrenceComparison: comparison,
      checkedAreas: restored.checkedAreas,
      uncheckedAreas: OFFICE_FORMATS[format].unchecked,
      warnings: ["图片未扫描，部分代号未出现不代表异常。", "真实内容变长后可能产生换行或溢出，请在 Office 中复核版式。"],
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}
