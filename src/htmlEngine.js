import { SafeFileError } from "./xlsxEngine.js";
import { listVaultSummaries, loadVault } from "./vaultStore.js";
import { decodeHtmlFileBytes, inspectHtmlText, restoreHtmlText } from "./htmlCore.js";

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

export async function inspectHtmlRestoreFile(file) {
  try {
    const html = await readHtml(file);
    const initial = inspectHtmlText(html, window);
    if (!initial.occurrences.length && !initial.unsupportedOccurrences.length) {
      const altered = inspectHtmlText(html, window, await allLocalMappings()).altered;
      if (altered.length) throw new SafeFileError("ALTERED_TOKENS", "HTML 中只剩下残缺或被改写的已知代号。", altered.map((item) => `${item.location}：${item.value}`));
    }
    validateInspection(initial);
    const taskId = initial.taskIds[0];
    const vault = await loadVault(taskId);
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${taskId} 的映射。`, [`任务 ${taskId}`]);
    const inspection = inspectHtmlText(html, window, vault.mapping);
    const unknown = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
    if (unknown.length) throw new SafeFileError("UNRESOLVED_TOKENS", "HTML 中存在本机无法确认的正式代号。", unknown);
    return {
      format: "html", formatLabel: "HTML", taskId, taskName: vault.taskName,
      occurrences: inspection.occurrences.length, uniqueTokens: inspection.uniqueTokens.length,
      usedMappings: inspection.uniqueTokens.length,
      partialRestore: inspection.altered.length > 0,
      unresolvedOccurrences: inspection.altered,
      checkedAreas: ["可见文字", "标题、图片说明和无障碍标签"],
      uncheckedAreas: ["图片中的文字"],
      warnings: [
        ...(inspection.altered.length ? [`发现 ${inspection.altered.length} 处被改写的代号；系统不会猜测，将原样保留并生成部分还原文件。`] : []),
        "脚本、表单、嵌入页面、远程资源和事件处理器会从还原版中移除。",
        "还原版使用严格内容安全策略，原页面动画和联网能力不会保留。",
      ],
      removedContent: inspection.removed,
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}

export async function restoreHtmlSafeFile(file, expectedTaskId) {
  try {
    const html = await readHtml(file);
    const initial = inspectHtmlText(html, window);
    validateInspection(initial);
    if (initial.taskIds[0] !== expectedTaskId) throw new SafeFileError("TASK_CHANGED", "HTML 与刚才检查通过的任务不一致。", initial.taskIds);
    const vault = await loadVault(expectedTaskId);
    if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机映射已不存在，无法还原。");
    const restored = restoreHtmlText(html, window, vault.mapping);
    const buffer = new TextEncoder().encode(restored.html).buffer;
    const baseName = file.name.replace(/\.html?$/i, "").replace(/_(?:脱敏版|安全副本|还原版)(?:_[A-F0-9]{8})?$/i, "");
    return {
      buffer, outputName: `${baseName}_${restored.partialRestore ? "部分还原" : "还原版"}_${expectedTaskId}.html`, mimeType: "text/html;charset=utf-8",
      format: "html", formatLabel: "HTML", taskId: expectedTaskId, taskName: vault.taskName,
      restoredOccurrences: restored.restoredOccurrences, usedMappings: restored.usedMappings,
      partialRestore: restored.partialRestore,
      unresolvedOccurrences: restored.unresolved,
      checkedAreas: ["可见文字", "标题、图片说明和无障碍标签"],
      uncheckedAreas: ["图片中的文字"],
      warnings: [
        ...(restored.partialRestore ? [`仍有 ${restored.unresolved.length} 处被改写的代号未还原，已原样保留。部分还原文件含有真实信息，请勿再次交给外部 AI。`] : []),
        "已移除脚本、表单、嵌入页面、远程资源和事件处理器。",
        "请在下载后复核排版和交互退化。",
      ],
      removedContent: restored.removed,
    };
  } catch (error) {
    throw asSafeFileError(error);
  }
}
