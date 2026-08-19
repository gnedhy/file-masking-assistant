import { SafeFileError } from "./xlsxEngine.js";
import { listVaultSummaries, loadVault } from "./vaultStore.js";
import { OFFICE_FORMATS, findAlteredTokens, inspectOfficePackage, loadOfficePackage, restoreOfficePackage } from "./officeOpenXmlCore.js";

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
      "代号出现在首版不主动修改的 Office 区域，已停止输出。",
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

export async function inspectOfficeRestoreFile(file) {
  try {
    const { zip, format } = await checkedPackage(file);
    const initial = await inspectOfficePackage(zip, format);
    if (!initial.occurrences.length && !initial.unsupportedOccurrences.length) {
      const altered = await detectAlteredWithoutFormalToken(zip, format);
      if (altered.length) throw new SafeFileError("ALTERED_TOKENS", "文件中只剩下残缺或被改写的已知代号，已停止输出。", altered);
    }
    validateInspection(initial);
    const taskId = initial.taskIds[0];
    const vault = await loadVault(taskId);
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${taskId} 的映射，已停止还原。`, [`任务 ${taskId}`]);
    const inspection = await inspectOfficePackage(zip, format, vault.mapping);
    const unknown = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
    if (unknown.length) throw new SafeFileError("UNRESOLVED_TOKENS", "文件中存在本机无法确认的正式代号，已停止输出。", unknown);
    if (inspection.altered.length) {
      throw new SafeFileError("ALTERED_TOKENS", "文件中存在残缺或被改写的已知代号，已停止输出。", inspection.altered.map((item) => `${item.location}：${item.value}`));
    }
    return {
      format,
      formatLabel: OFFICE_FORMATS[format].label,
      taskId,
      taskName: vault.taskName,
      occurrences: inspection.occurrences.length,
      uniqueTokens: inspection.uniqueTokens.length,
      usedMappings: inspection.uniqueTokens.length,
      checkedAreas: inspection.checkedAreas,
      uncheckedAreas: inspection.uncheckedAreas,
      warnings: ["图片未扫描，未出现的映射不代表异常。", "真实内容变长后可能产生换行或溢出，请在 Office 中复核版式。"],
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}

export async function restoreOfficeSafeFile(file, expectedTaskId) {
  try {
    const { zip, format } = await checkedPackage(file);
    const initial = await inspectOfficePackage(zip, format);
    validateInspection(initial);
    if (initial.taskIds[0] !== expectedTaskId) {
      throw new SafeFileError("TASK_CHANGED", "文件与刚才检查通过的任务不一致，已停止还原。", initial.taskIds);
    }
    const vault = await loadVault(expectedTaskId);
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机映射已不存在，无法还原。");
    const before = await inspectOfficePackage(zip, format, vault.mapping);
    const unknown = before.uniqueTokens.filter((token) => !vault.mapping[token]);
    if (unknown.length || before.altered.length || before.unsupportedOccurrences.length) {
      throw new SafeFileError("UNRESOLVED_TOKENS", "文件未通过还原前的完整代号检查，已停止输出。", [
        ...unknown,
        ...before.altered.map((item) => `${item.location}：${item.value}`),
        ...before.unsupportedOccurrences.map((item) => `${item.location}：${item.token}`),
      ]);
    }
    const restored = await restoreOfficePackage(zip, format, vault.mapping);
    const postCheck = await inspectOfficePackage(zip, format, vault.mapping);
    const residualAltered = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !entry.name.toLowerCase().endsWith(".xml")) continue;
      const xml = await entry.async("string");
      residualAltered.push(...findAlteredTokens(xml, format, vault.mapping).map((value) => `${entry.name}：${value}`));
    }
    if (postCheck.occurrences.length || postCheck.unsupportedOccurrences.length || residualAltered.length) {
      throw new SafeFileError("RESIDUAL_TOKENS", "还原后仍检测到正式代号或残缺代号，已停止输出。", [
        ...postCheck.occurrences.map((item) => `${item.location}：${item.token}`),
        ...postCheck.unsupportedOccurrences.map((item) => `${item.location}：${item.token}`),
        ...residualAltered,
      ]);
    }
    const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return {
      buffer,
      outputName: `${cleanBaseName(file.name)}_还原版_${expectedTaskId}.${format}`,
      mimeType: OFFICE_FORMATS[format].mimeType,
      format,
      formatLabel: OFFICE_FORMATS[format].label,
      taskId: expectedTaskId,
      taskName: vault.taskName,
      restoredOccurrences: restored.restoredOccurrences,
      usedMappings: before.uniqueTokens.length,
      checkedAreas: restored.checkedAreas,
      uncheckedAreas: OFFICE_FORMATS[format].unchecked,
      warnings: ["图片未扫描，未出现的映射不代表异常。", "真实内容变长后可能产生换行或溢出，请在 Office 中复核版式。"],
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}
