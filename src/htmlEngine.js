import { SafeFileError } from "./xlsxEngine.js";
import { listVaultSummaries, loadVault } from "./vaultStore.js";
import { decodeHtmlFileBytes, inspectHtmlText, restoreHtmlText } from "./htmlCore.js";
import { occurrenceComparison, restoredOutputName } from "./fileSafety.js";
import { resolveRestoreVault, taskEvidence } from "./taskIdentity.js";

function asSafeFileError(error) {
  if (error instanceof SafeFileError) return error;
  return new SafeFileError(error.code || "INVALID_HTML", error.message || "HTML 文件处理失败。", error.details || []);
}

async function readHtml(file) {
  return decodeHtmlFileBytes(await file.arrayBuffer());
}

async function allLocalMappings() {
  const summaries = await listVaultSummaries();
  const vaults = await Promise.all(summaries.map((summary) => loadVault(summary.taskId)));
  return Object.assign({}, ...vaults.filter(Boolean).map((vault) => vault.mapping));
}

function checkedAreas(keptScripts) {
  return ["可见文字", "标题、图片说明和无障碍标签", ...(keptScripts ? ["图表脚本中的文字"] : [])];
}

function scriptWarning(keptScripts) {
  return `还原版保留了 ${keptScripts} 段图表脚本，在隔离框架中运行，不能联网、弹窗或跳转；其他脚本、表单和远程资源已移除。`;
}

function validateInspection(inspection) {
  if (!inspection.occurrences.length && !inspection.unsupportedOccurrences.length) {
    throw new SafeFileError("NO_TOKENS", "HTML 中没有找到本应用生成的完整代号。");
  }
  if (inspection.taskIds.length !== 1) {
    throw new SafeFileError("MIXED_TASKS", "HTML 中混入了多个脱敏任务的代号，已停止还原。", inspection.taskIds);
  }
  if (inspection.unsupportedOccurrences.length) {
    throw new SafeFileError("UNSUPPORTED_CONTENT", "代号出现在脚本、样式、链接或其他不安全位置，已停止输出。", inspection.unsupportedOccurrences.map((item) => `${item.location}：${item.token}`));
  }
}

export async function inspectHtmlRestoreFile(file, context) {
  try {
    const html = await readHtml(file);
    const initial = inspectHtmlText(html, window);
    if (!initial.occurrences.length && !initial.unsupportedOccurrences.length) {
      const altered = inspectHtmlText(html, window, await allLocalMappings()).altered;
      if (altered.length) throw new SafeFileError("ALTERED_TOKENS", "HTML 中只剩下残缺或被改写的已知代号。", altered.map((item) => `${item.location}：${item.value}`));
    }
    validateInspection(initial);
    const vault = await resolveRestoreVault(initial, context);
    const taskId = vault.taskId;
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${taskId} 的还原记录。`, [`任务 ${taskId}`]);
    const inspection = inspectHtmlText(html, window, vault.mapping);
    const unknown = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
    if (unknown.length) throw new SafeFileError("UNRESOLVED_TOKENS", "HTML 中存在本机无法确认的代号。", unknown);
    if (inspection.altered.length) throw new SafeFileError("ALTERED_TOKENS", "HTML 中存在残缺或被改写的已知代号，已停止输出。", inspection.altered.map((item) => `${item.location}：${item.value}`));
    return {
      ...taskEvidence(vault), format: "html", formatLabel: "HTML", taskId, taskName: vault.taskName,
      occurrenceComparison: occurrenceComparison(vault, inspection.occurrences, "html"),
      occurrences: inspection.occurrences.length, uniqueTokens: inspection.uniqueTokens.length,
      usedMappings: inspection.uniqueTokens.length,
      partialRestore: false,
      unresolvedOccurrences: [],
      checkedAreas: checkedAreas(inspection.keptScripts),
      uncheckedAreas: ["图片中的文字"],
      warnings: inspection.keptScripts ? [scriptWarning(inspection.keptScripts)] : [
        "脚本、表单、嵌入页面、远程资源和事件处理器会从还原版中移除。",
        "还原版使用严格内容安全策略，原页面动画和联网能力不会保留。",
      ],
      removedContent: inspection.removed,
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}

export async function restoreHtmlSafeFile(file, expectedTaskId, context) {
  try {
    const html = await readHtml(file);
    const initial = inspectHtmlText(html, window);
    validateInspection(initial);
    const vault = await resolveRestoreVault(initial, context, expectedTaskId);
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机还原记录已不存在，无法还原。");
    const comparison = occurrenceComparison(vault, initial.occurrences, "html");
    const restored = restoreHtmlText(html, window, vault.mapping);
    const buffer = new TextEncoder().encode(restored.html).buffer;
    return {
      buffer, outputName: restoredOutputName(file.name, "html", vault), mimeType: "text/html;charset=utf-8",
      format: "html", formatLabel: "HTML", taskId: expectedTaskId, taskName: vault.taskName,
      restoredOccurrences: restored.restoredOccurrences, usedMappings: restored.usedMappings,
      occurrenceComparison: comparison,
      partialRestore: restored.partialRestore,
      unresolvedOccurrences: restored.unresolved,
      checkedAreas: checkedAreas(restored.keptScripts),
      uncheckedAreas: ["图片中的文字"],
      warnings: [
        restored.keptScripts ? scriptWarning(restored.keptScripts) : "已移除脚本、表单、嵌入页面、远程资源和事件处理器。",
        "请在下载后复核排版和交互退化。",
      ],
      removedContent: restored.removed,
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}
