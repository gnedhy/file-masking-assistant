import { addManualCandidate, analyzeText, inspectAlteredTextTokens, inspectTextTokens, restoreText, tokenizeText } from "./textCore.js";
import { SafeFileError } from "./xlsxEngine.js";
import { FILE_SIZE_LIMITS } from "./filePreflight.js";
import { createProtectionIdentity, protectionTokenIdentity, protectionResult, resolveRestoreVault, taskEvidence } from "./taskIdentity.js";
import { listVaultSummaries, loadVault, saveVault } from "./vaultStore.js";
import { highRiskTextFindings, occurrenceBaseline, occurrenceComparison, protectedOutputName, restoredOutputName, suspiciousTextFindings } from "./fileSafety.js";

const MAX_TEXT_BYTES = FILE_SIZE_LIMITS.txt;

function baseName(filename) {
  return filename.replace(/\.(?:txt|md)$/i, "");
}

async function loadText(file) {
  if (file.size > MAX_TEXT_BYTES) throw new SafeFileError("TEXT_TOO_LARGE", "纯文本文件不能超过 10 MB。", [`文件大小 ${(file.size / 1024 / 1024).toFixed(1)} MB`]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) throw new SafeFileError("INVALID_TEXT", "文件包含二进制空字符，不能作为纯文本安全处理。");
  const hadBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new SafeFileError("INVALID_TEXT_ENCODING", "TXT/MD 仅支持标准 UTF-8 或 UTF-8 BOM 编码。");
  }
  const suspicious = suspiciousTextFindings(text);
  if (suspicious.length) throw new SafeFileError("SUSPICIOUS_TEXT", "文件包含不可见控制字符，已停止处理。", suspicious);
  if (!text.trim()) throw new SafeFileError("EMPTY_TEXT", "文件中没有可处理的文字内容。");
  return { text, hadBom, newline: text.includes("\r\n") ? "CRLF" : "LF" };
}

function encodeText(text, hadBom) {
  return new TextEncoder().encode(`${hadBom ? "\uFEFF" : ""}${text}`);
}

async function combinedLocalMapping() {
  const summaries = await listVaultSummaries();
  const vaults = await Promise.all(summaries.map((summary) => loadVault(summary.taskId)));
  return Object.assign({}, ...vaults.filter(Boolean).map((vault) => vault.mapping));
}

export async function inspectTextProtectionFile(file, format) {
  const document = await loadText(file);
  return { ...analyzeText(document.text, format), format, formatLabel: format === "md" ? "Markdown" : "TXT", encoding: document.hadBom ? "UTF-8 BOM" : "UTF-8", newline: document.newline, riskFindings: highRiskTextFindings(document.text) };
}

export function addManualTextCandidate(analysis, value) {
  return addManualCandidate(analysis, value);
}

export async function createSafeText(file, selectedCandidates, format, options) {
  if (!selectedCandidates.length) throw new SafeFileError("NO_TEXT_CANDIDATES", "请至少选择一项需要替换的敏感内容。");
  const document = await loadText(file);
  const identity = await createProtectionIdentity(options, document.text);
  const { taskId } = identity;
  const taskName = baseName(file.name);
  const result = tokenizeText(document.text, selectedCandidates, protectionTokenIdentity(identity));
  if (!result.replacedOccurrences) throw new SafeFileError("NO_VALUES", "没有找到可替换的完整文字。");
  await saveVault({ version: 2, ...identity, taskName, createdAt: new Date().toISOString(), sourceFormat: format, occurrenceBaseline: occurrenceBaseline(inspectTextTokens(result.text).occurrences), mapping: result.mapping });
  return {
    ...protectionResult(identity, result.mapping),
    buffer: encodeText(result.text, document.hadBom), outputName: protectedOutputName(format, identity.marker || taskId),
    mimeType: "text/plain;charset=utf-8", format, taskId, taskName,
    replacedCells: result.replacedOccurrences, uniqueValues: result.uniqueValues,
    warnings: [], notices: [`保留 ${document.hadBom ? "UTF-8 BOM" : "UTF-8"} 与 ${document.newline} 换行`],
  };
}

export async function inspectTextRestoreFile(file, format, context) {
  const document = await loadText(file);
  const inspection = inspectTextTokens(document.text);
  if (!inspection.occurrences.length) {
    const altered = inspectAlteredTextTokens(document.text, await combinedLocalMapping());
    if (altered.length) throw new SafeFileError("ALTERED_TOKENS", "文件中只剩残缺或被改写的已知代号。", altered.map((item) => item.value));
    throw new SafeFileError("NO_TOKENS", "文件中没有找到本应用生成的代号。");
  }
  if (inspection.taskIds.length !== 1) throw new SafeFileError("MIXED_TASKS", "文件中混入了多个脱敏任务的代号。", inspection.taskIds);
  const vault = await resolveRestoreVault(inspection, context);
  const taskId = vault.taskId;
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", `本机找不到任务 ${taskId} 的映射。`);
  const unknown = inspection.uniqueTokens.filter((token) => !vault.mapping[token]);
  const altered = inspectAlteredTextTokens(document.text, vault.mapping);
  if (unknown.length || altered.length) throw new SafeFileError("UNRESOLVED_TOKENS", "文件中存在无法安全还原的代号。", [...unknown, ...altered.map((item) => item.value)]);
  return {
    ...taskEvidence(vault), format, formatLabel: format === "md" ? "Markdown" : "TXT", taskId, taskName: vault.taskName,
    occurrences: inspection.occurrences.length, usedMappings: inspection.uniqueTokens.length,
    occurrenceComparison: occurrenceComparison(vault.occurrenceBaseline, inspection.occurrences),
    checkedAreas: ["全部纯文本内容"], uncheckedAreas: ["图片、脚本和嵌入对象（纯文本本身不包含）"],
    warnings: [format === "md" ? "未出现的映射不代表异常；Markdown 不会被渲染或执行。" : "未出现的映射不代表异常；TXT 按纯文本处理。"],
  };
}

export async function restoreSafeText(file, expectedTaskId, format, context) {
  const document = await loadText(file);
  const inspection = inspectTextTokens(document.text);
  const vault = await resolveRestoreVault(inspection, context, expectedTaskId);
  if (!vault) throw new SafeFileError("VAULT_NOT_FOUND", "本机映射已不存在，无法还原。");
  const comparison = occurrenceComparison(vault.occurrenceBaseline, inspection.occurrences);
  const altered = inspectAlteredTextTokens(document.text, vault.mapping);
  if (altered.length) throw new SafeFileError("ALTERED_TOKENS", "文件中存在残缺或被改写的已知代号。", altered.map((item) => item.value));
  const result = restoreText(document.text, vault.mapping);
  if (result.unresolved.length) throw new SafeFileError("UNRESOLVED_TOKENS", "文件中存在未知代号。", result.unresolved.map((item) => item.token));
  if (inspectTextTokens(result.text).occurrences.length) throw new SafeFileError("RESIDUAL_TOKENS", "还原后仍检测到代号，已停止导出。");
  return {
    buffer: encodeText(result.text, document.hadBom),
    outputName: restoredOutputName(file.name, format, vault),
    mimeType: "text/plain;charset=utf-8", format, taskId: expectedTaskId, taskName: vault.taskName,
    restoredOccurrences: result.restoredOccurrences, usedMappings: result.inspection.uniqueTokens.length,
    occurrenceComparison: comparison,
    checkedAreas: ["全部纯文本内容"], uncheckedAreas: ["图片、脚本和嵌入对象（纯文本本身不包含）"],
    warnings: [format === "md" ? "保留原 UTF-8 BOM 与换行格式；Markdown 未渲染或执行。" : "保留原 UTF-8 BOM 与换行格式。"],
  };
}
