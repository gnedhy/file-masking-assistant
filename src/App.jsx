import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "./randomId.js";
import { isEmptyColumn } from "./xlsxCore.js";
import { ERROR_PRESENTATION, residualPlace } from "./errorPresentation.js";
import { TaskDetails } from "./TaskDetails.jsx";
import { THEME_OPTIONS, ThemeSwitcher } from "./ThemeSwitcher.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { OperationDrawer } from "./OperationDrawer.jsx";
import { GuideDrawer, hasUnseenUpdate } from "./GuideDrawer.jsx";
import { CURRENT_VERSION } from "./changelog.js";
const CHANGELOG_VERSION = CURRENT_VERSION.version;
import AccessSettings from "./AccessSettings.jsx";
import FeedbackCenter from "./FeedbackCenter.jsx";
import ResultFeedback from "./ResultFeedback.jsx";
import { useFeedbackSummary } from "./feedbackApi.js";
import { recordOperation, hasOperationWriteFailure } from "./operationLog.js";
import {
  ArrowRight,
  CaretRight,
  Check,
  CheckCircle,
  Copy,
  DesktopTower,
  DownloadSimple,
  FileArrowDown,
  FileCsv,
  FileDoc,
  FileHtml,
  FilePlus,
  FilePpt,
  FileText,
  FileXls,
  Info,
  LockKey,
  MagnifyingGlass,
  ClockCounterClockwise,
  ShieldCheck,
  Trash,
  UploadSimple,
  UserGear,
  ChatCircleDots,
  WarningCircle,
  X,
  BookOpenText,
} from "@phosphor-icons/react";
import { addManualCandidate } from "./textCore.js";
import {
  discardLocalTask,
  getLocalTaskStatus,
  SafeFileError,
} from "./xlsxEngine.js";
import {
  createSafeFile,
  FILE_FORMAT_META,
  FILE_SIZE_LIMITS,
  SUPPORTED_PROTECT_FORMATS,
  SUPPORTED_RESTORE_FORMATS,
  fileFormatFromName,
  inspectProtectionFile,
  inspectRestoreFile,
  restoreSafeFile,
} from "./fileEngine.js";
import { getSession, signIn } from "./session.js";

const UsageStats = lazy(() => import("./UsageStats.jsx"));

const WORKSPACE_COPY = {
  protect: {
    title: "让文件安全进入 AI 工作流",
    description: "选择文件并核对替换内容，生成可以交给 AI 的脱敏文件。",
  },
  restore: {
    title: "把处理结果恢复为实名文件",
    description: "导入 AI 处理后的文件，任务核对通过后生成实名文件。",
  },
};
const ROUTE_STEPS = [
  { id: "protect", label: "本机脱敏", icon: LockKey },
  { id: "ai", label: "交给 AI 处理", icon: FileXls },
  { id: "restore", label: "本机还原", icon: ShieldCheck },
];
const VAULT_LABEL = "还原记录";
const TEXT_SIZE_LIMIT_MB = FILE_SIZE_LIMITS.csv / 1024 / 1024;
const OFFICE_SIZE_LIMIT_MB = FILE_SIZE_LIMITS.xlsx / 1024 / 1024;
const LOCAL_PROCESSING_COPY = "文件在浏览器内处理，还原记录加密保存在公司服务器";
const formatList = (mode) => (mode === "protect" ? SUPPORTED_PROTECT_FORMATS : SUPPORTED_RESTORE_FORMATS).map(format => format.toUpperCase()).join("、");

const MODE_COPY = {
  protect: {
    title: "制作脱敏文件",
    subtitle: "把敏感信息替换成代号后再交给 AI",
    emptyTitle: "拖入待脱敏的表格或文本文件",
    primary: "生成脱敏文件",
  },
  restore: {
    title: "还原处理文件",
    subtitle: "导入 AI 处理后的 Excel、CSV、Word 或 PPT，恢复真实内容",
    emptyTitle: "拖入 AI 处理后的文件",
    primary: "生成还原文件",
  },
};

const METRIC_HEADER_PATTERN = /(金额|销售额|单价|数量|成本|利润|毛利|折扣)/;

function fileInfo(file) {
  const kind = fileFormatFromName(file.name) || "xlsx";
  return {
    name: file.name,
    size: `${Math.max(file.size / 1024 / 1024, 0.01).toFixed(2)} MB`,
    modified: new Date(file.lastModified || Date.now()).toLocaleString("zh-CN", { hour12: false }),
    kind,
  };
}

function splitFileName(name) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return { base: name, extension: "" };
  return { base: name.slice(0, dotIndex), extension: name.slice(dotIndex) };
}

function spreadsheetColumnLabel(columnNumber) {
  let number = Number(columnNumber);
  if (!Number.isInteger(number) || number < 1) return "";
  let label = "";
  while (number > 0) {
    number -= 1;
    label = String.fromCharCode(65 + (number % 26)) + label;
    number = Math.floor(number / 26);
  }
  return label;
}

const FILE_ICONS = { xlsx: FileXls, csv: FileCsv, txt: FileText, md: FileText, docx: FileDoc, pptx: FilePpt, html: FileHtml };
const FILE_CLASSES = { xlsx: "excel", csv: "csv", txt: "text", md: "text", docx: "word", pptx: "pptx", html: "html" };

function FileMark({ size = "large", format = "xlsx" }) {
  const Icon = FILE_ICONS[format] ?? FileXls;
  return (
    <span className={`file-mark file-mark--${FILE_CLASSES[format] ?? "excel"} file-mark--${size}`} aria-hidden="true">
      <Icon weight="bold" />
    </span>
  );
}

function TaskChoice({ active, icon: Icon, title, subtitle, disabled, onClick }) {
  return (
    <button className="task-choice" data-active={active} type="button" disabled={disabled} onClick={onClick} aria-pressed={active}>
      <span className="task-choice__icon" aria-hidden="true"><Icon weight="bold" /></span>
      <span className="task-choice__copy"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</span>
    </button>
  );
}

function formatTaskTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function LocalTaskPanel({ localTasks, disabled, onContinue, onViewAll, viewAllButtonRef }) {
  const ready = localTasks.status === "ready";
  const hasTasks = ready && localTasks.count > 0 && localTasks.latest;

  return (
    <section className="local-task-panel" data-has-tasks={Boolean(hasTasks)} aria-labelledby="local-task-title" aria-live="polite">
      <div className="local-task-panel__head">
        <span className="local-task-panel__mark" aria-hidden="true"><LockKey weight="bold" /></span>
        <div>
          <h2 id="local-task-title">我的任务</h2>
          <p>{localTasks.status === "loading"
            ? "正在读取任务"
            : localTasks.status === "error"
              ? "暂时无法读取任务"
              : hasTasks
                ? `${localTasks.count} 个任务 · 还原记录保存在公司服务器`
                : "还没有可继续的任务"}</p>
        </div>
      </div>

      {hasTasks ? (
        <>
          <div className="local-task-panel__latest">
            <span>最近任务</span>
            <strong title={localTasks.latest.taskName}>{localTasks.latest.taskName}</strong>
            <small>{formatTaskTime(localTasks.latest.createdAt)} · 任务 {localTasks.latest.marker || localTasks.latest.taskId}</small>
          </div>
          <button className="local-task-panel__action" type="button" disabled={disabled} onClick={onContinue}>
            选择待还原文件<ArrowRight weight="bold" />
          </button>
          <button ref={viewAllButtonRef} className="local-task-panel__view" type="button" onClick={onViewAll}>
            查看全部任务
          </button>
        </>
      ) : (
        <p className="local-task-panel__empty">
          {localTasks.status === "error"
            ? "你仍可以选择文件；还原前系统会再次核对还原记录。"
            : "制作并下载脱敏文件后，对应的还原任务会显示在这里。"}
        </p>
      )}
    </section>
  );
}

const TASK_SEARCH_MIN_COUNT = 5;

function LocalTasksDrawer({ localTasks, currentTaskId, pendingDeleteId, deletingTaskId, error, modal, drawerRef, closeButtonRef, continueDisabled, onClose, onContinueLatest, onRequestDelete, onCancelDelete, onConfirmDelete }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleTasks = normalizedQuery
    ? localTasks.tasks.filter((task) => `${task.taskName} ${task.taskId} ${task.marker || ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    : localTasks.tasks;

  return (
    <aside className="local-tasks-drawer" id="local-tasks-drawer" ref={drawerRef} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-labelledby="local-tasks-drawer-title">
      <div className="drawer-head">
        <div>
          <h2 id="local-tasks-drawer-title">我的任务</h2>
          <p>{localTasks.count} 个还原任务 · {localTasks.mappingCount} 条还原记录</p>
        </div>
        <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭我的任务"><X /></button>
      </div>

      <div className="drawer-body">
      {error && <p className="local-tasks-drawer__error" role="alert"><WarningCircle weight="fill" />{error}</p>}
      {localTasks.latest && <button className="primary-button local-tasks-continue" type="button" disabled={continueDisabled} onClick={onContinueLatest}>选择待还原文件<ArrowRight weight="bold" aria-hidden="true" /></button>}

      {localTasks.tasks.length >= TASK_SEARCH_MIN_COUNT && (
        <div className="local-task-search">
          <label className="visually-hidden" htmlFor="local-task-search-input">查找任务</label>
          <div>
            <MagnifyingGlass weight="bold" aria-hidden="true" />
            <input
              id="local-task-search-input"
              type="search"
              value={query}
              placeholder="输入文件名或任务编号"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {normalizedQuery && <small>找到 {visibleTasks.length} 个任务</small>}
        </div>
      )}

      {visibleTasks.length ? <div className="local-task-list" aria-label="还原任务列表">
        {visibleTasks.map((task) => {
          const isCurrent = task.taskId === currentTaskId;
          const confirming = pendingDeleteId === task.taskId;
          const deleting = deletingTaskId === task.taskId;
          return (
            <article className="local-task-row" key={task.taskId}>
              <div className="local-task-row__main">
                <strong title={task.taskName}>{task.taskName}</strong>
                <p>{task.marker || task.taskId} · {formatTaskTime(task.createdAt)} · {task.uniqueValues} 条</p>
              </div>
              <TaskDetails task={task} />
              {confirming ? (
                <div className="local-task-row__confirm" role="alert">
                  <strong>确定删除这项还原记录？</strong>
                  <p>删除后无法恢复，对应的脱敏文件将不能再还原。</p>
                  <div>
                    <button type="button" disabled={deleting} onClick={() => onConfirmDelete(task.taskId)}>{deleting ? "正在删除" : "确认删除"}</button>
                    <button type="button" disabled={deleting} onClick={onCancelDelete}>取消</button>
                  </div>
                </div>
              ) : (
                <button className="local-task-row__delete" type="button" disabled={isCurrent || Boolean(deletingTaskId)} title={isCurrent ? "当前任务结束后才能删除" : "删除还原记录"} onClick={() => onRequestDelete(task.taskId)}>
                  <Trash weight="regular" />{isCurrent ? "当前任务" : "删除"}
                </button>
              )}
            </article>
          );
        })}
      </div> : <p className="local-tasks-drawer__empty">{localTasks.tasks.length ? "没有找到匹配的任务，请换一个文件名或任务编号。" : "还没有还原任务。"}</p>}
      </div>
    </aside>
  );
}

function BoundaryRoute({ stage }) {
  return (
    <div className="boundary-route" aria-label="文件脱敏与还原路径">
      {ROUTE_STEPS.map(({ id, label, icon: Icon }, index) => (
        <Fragment key={id}>
          {index > 0 && <ArrowRight weight="bold" aria-hidden="true" />}
          <span aria-current={id === stage ? "step" : undefined}><Icon weight="bold" />{label}</span>
        </Fragment>
      ))}
    </div>
  );
}

function MobileProgress({ stage }) {
  const index = ROUTE_STEPS.findIndex((step) => step.id === stage);
  return (
    <section className="mobile-boundary" aria-label="当前进度">
      <div><LockKey weight="bold" /><strong>第 {index + 1} 步 · {ROUTE_STEPS[index].label}</strong></div>
      <p>{ROUTE_STEPS.map(({ id, label }, stepIndex) => (
        <Fragment key={id}>
          {stepIndex > 0 && <ArrowRight aria-hidden="true" />}
          <span aria-current={id === stage ? "step" : undefined}>{label}</span>
        </Fragment>
      ))}</p>
    </section>
  );
}

function ReplacementPreview({ items }) {
  if (!items.length) return null;
  const shown = items.slice(0, 4);
  return (
    <ul className="replacement-preview" aria-label="将被替换的内容">
      {shown.map((item) => <li key={item.key}><strong>{item.title}</strong><small>{item.detail}</small></li>)}
      {items.length > shown.length && <li className="replacement-preview__more">还有 {items.length - shown.length} 项，可在“查看并调整”中查看</li>}
    </ul>
  );
}

function EmptyState({ mode, inputRef, isDraggingFile }) {
  const copy = MODE_COPY[mode];
  const supportedCopy = ` ${formatList(mode)} 文件`;

  return (
    <div className="empty-state" data-dragging={isDraggingFile}>
      <span className="empty-state__icon" aria-hidden="true"><UploadSimple weight="regular" /></span>
      <strong className="empty-state__title" aria-live="polite">{isDraggingFile
        ? "松开鼠标，开始读取文件"
        : <><span className="desktop-copy">{copy.emptyTitle}</span><span className="mobile-copy">{mode === "protect" ? "选择待脱敏文件" : "选择 AI 处理后的文件"}</span></>}</strong>
      <span className="empty-state__note">{isDraggingFile
        ? <>文件在浏览器内处理，不会上传</>
        : <><span>支持{supportedCopy}</span><small className="empty-state__limit">文本类上限 {TEXT_SIZE_LIMIT_MB} MB · Office 上限 {OFFICE_SIZE_LIMIT_MB} MB</small></>}</span>
      {!isDraggingFile && <button className="small-button" type="button" onClick={() => inputRef.current?.click()}>选择文件</button>}
      {mode === "restore" && <span className="same-device-note"><DesktopTower weight="bold" />登录同一企业微信账号即可还原，换电脑也可以</span>}
    </div>
  );
}

function SelectedFile({ file, onRemove }) {
  const shown = fileInfo(file);
  return (
    <div className="selected-file">
      <FileMark format={shown.kind} />
      <div className="selected-file__copy">
        <strong>{shown.name}</strong>
        <span>{shown.size}<i aria-hidden="true" />修改于 {shown.modified}</span>
      </div>
      <button className="icon-button" type="button" onClick={onRemove} aria-label="移除当前文件"><X /></button>
    </div>
  );
}

function ReadyState({ mode, file, analysis, selectedIds, fieldModes = {}, restoreInspection, regenerationNotice, detailsOpen, onRemove, onPrimary, onDetails }) {
  const selectedCandidates = (analysis?.candidates ?? []).filter((candidate) => selectedIds.includes(candidate.id));
  const selectedColumns = (analysis?.columns ?? [])
    .filter((column) => selectedIds.includes(column.id))
    .map((column) => ({ ...column, processingMode: fieldModes[column.id] ?? column.recommendedMode ?? "whole" }));
  const wholeColumnCount = selectedColumns.filter((column) => column.processingMode === "whole").length;
  const hasOnlyInlineFields = mode === "protect" && analysis?.kind !== "text" && selectedColumns.length > 0 && wholeColumnCount === 0 && selectedCandidates.length === 0;
  const valueCount = selectedColumns.reduce((sum, column) => sum + column.valueCount, 0);
  const valueUnit = fileFormatFromName(file.name) === "csv" ? "个字段值" : "个单元格";
  const comparison = restoreInspection?.occurrenceComparison;
  const hasContentLoss = Boolean(comparison?.missing) && !comparison.rewritten;
  const changedTokens = comparison?.rewritten ? [] : comparison?.byToken?.filter((item) => item.missing || item.added) ?? [];
  const usedTokens = comparison?.byToken?.filter((item) => item.returned).length ?? 0;
  const originalTokens = comparison?.byToken?.filter((item) => item.original).length ?? 0;
  const summary = mode === "protect"
    ? analysis?.kind === "text"
      ? `已选择 ${selectedCandidates.length} 项敏感内容，共出现 ${selectedCandidates.reduce((sum, item) => sum + item.count, 0)} 处`
      : `已选择 ${selectedColumns.length} 列，将检查 ${valueCount} ${valueUnit}${selectedCandidates.length ? `；另有 ${selectedCandidates.length} 个名称会在整个文件里替换` : ""}`
    : `已识别 ${restoreInspection.formatLabel} · 发现 ${restoreInspection.occurrences} 处代号 · 使用 ${restoreInspection.usedMappings} 条还原记录`;

  return (
    <div className="ready-state">
      <SelectedFile file={file} onRemove={onRemove} />
      {regenerationNotice && (
        <div className="task-change-banner" role="status">
          <WarningCircle weight="bold" aria-hidden="true" />
          <span>
            <strong>你正在创建一个新的脱敏文件</strong>
            <small>已下载的旧文件仍对应任务 {regenerationNotice.taskId}。重新生成后会创建新任务，请不要混用两个文件。</small>
          </span>
        </div>
      )}
      {mode === "protect" && <p className="recognition-line"><CheckCircle weight="bold" /><span>{summary}</span></p>}
      {mode === "restore" && (
        <section className="compatibility-check" data-partial={restoreInspection.partialRestore} data-content-loss={hasContentLoss} aria-labelledby="compatibility-check-title">
          <div className="compatibility-check__head">
            {restoreInspection.partialRestore || hasContentLoss ? <WarningCircle weight="fill" aria-hidden="true" /> : <CheckCircle weight="fill" aria-hidden="true" />}
            <span><strong id="compatibility-check-title">{restoreInspection.partialRestore ? "可以继续部分还原" : hasContentLoss ? "可以还原，但 AI 返回内容有缺失" : "文件检查已通过"}</strong><small>{restoreInspection.partialRestore
              ? `可确认的代号会正常还原；${restoreInspection.unresolvedOccurrences.length} 处被改写的代号将原样保留。`
              : hasContentLoss
                ? `AI 返回内容中有 ${comparison.missing} 处代号未出现；现有完整代号仍可正常还原。`
              : comparison?.rewritten && comparison.missing
                ? `任务已匹配。AI 生成的新文件用到了 ${originalTokens} 个代号中的 ${usedTokens} 个，没用到的属于正常改写。`
              : "任务已匹配，还原记录可读取。请核对后生成还原文件。"}</small></span>
            <button className="compatibility-check__details" type="button" onClick={onDetails} aria-expanded={detailsOpen} aria-controls="security-details">查看检查详情<CaretRight weight="bold" /></button>
          </div>
          <dl>
            {restoreInspection.taskName && <div><dt>匹配任务</dt><dd className="restore-task-match"><strong>{restoreInspection.taskName}</strong> · 编号 {restoreInspection.marker || restoreInspection.taskId} · {formatTaskTime(restoreInspection.createdAt)}</dd></div>}
            <div><dt>识别结果</dt><dd>{summary}</dd></div>
            <div><dt>会检查并还原</dt><dd data-area="checked">{restoreInspection.checkedAreas.join("、") || "文件文字区域"}</dd></div>
            <div><dt>暂不检查</dt><dd>{restoreInspection.uncheckedAreas.join("、") || "无"}</dd></div>
          </dl>
          {changedTokens.length > 0 && <div className="token-change-list" aria-label="代号出现次数变化">{changedTokens.map((item) => <div key={item.token}><strong>{item.token}</strong><span>原始 {item.original} · 返回 {item.returned}</span></div>)}</div>}
          {restoreInspection.warnings?.length > 0 && <p><Info weight="bold" />{restoreInspection.warnings[0]}</p>}
        </section>
      )}
      {hasOnlyInlineFields && (
        <div className="task-change-banner" role="alert">
          <WarningCircle weight="bold" aria-hidden="true" />
          <span>
            <strong>请再勾选一列公司名、人名或编号</strong>
            <small>现在勾选的都是备注这类长文字列。系统要先知道有哪些名称（例如客户名称、业务员列），才能把长文字里的这些名称换成代号。</small>
          </span>
        </div>
      )}
      {mode === "protect" && mediaPhrase(analysis?.media) && (
        <div className="task-change-banner" role="status">
          <WarningCircle weight="bold" aria-hidden="true" />
          <span>
            <strong>文件里有 {mediaPhrase(analysis.media)}，系统只处理表格文字</strong>
            <small>{[analysis.media.images ? "图片会原样保留，但图片里的公司名、人名不会被替换，会随文件交给 AI，必要时请先删除图片" : "", analysis.media.attachments ? "嵌入的附件（PDF、Word 等）不会放进脱敏文件" : ""].filter(Boolean).join("；")}。原文件不受影响。</small>
          </span>
        </div>
      )}
      {mode === "protect" ? (
        // The header and the preview share one card so the sizes read as one block.
        <div className="replacement-card">
          <button className="evidence-trigger" type="button" onClick={onDetails} aria-expanded={detailsOpen} aria-controls="security-details">
            <span><ShieldCheck weight="bold" /><strong>{analysis?.kind === "text" || selectedCandidates.length ? "确认替换内容" : "确认替换列"}</strong></span>
            <span className="evidence-trigger__action">查看并调整<CaretRight weight="bold" /></span>
          </button>
          <ReplacementPreview items={analysis?.kind === "text"
            ? selectedCandidates.map((item) => ({ key: item.id, title: item.value, detail: `${item.label} · ${item.count} 处` }))
            : [...selectedColumns.map((column) => ({ key: column.id, title: column.header, detail: `${column.processingMode === "whole" ? "" : "长文字 · "}${column.valueCount} 个值` })), ...selectedCandidates.map((item) => ({ key: item.id, title: item.value, detail: `${item.label} · ${item.count} 处` }))]} />
        </div>
      ) : null}
      <button className="primary-button" type="button" onClick={onPrimary} disabled={mode === "protect" ? (!(analysis?.kind === "text" ? selectedCandidates.length : selectedColumns.length + selectedCandidates.length) || hasOnlyInlineFields) : false}>
        {MODE_COPY[mode].primary}<ArrowRight weight="bold" />
      </button>
      <div className="trust-line" aria-label="处理边界">
        <span>{LOCAL_PROCESSING_COPY}</span><i aria-hidden="true" /><span>原文件不修改</span>
      </div>
    </div>
  );
}

function ProcessingState({ mode, file, phase = "generate" }) {
  const format = fileFormatFromName(file.name) || "xlsx";
  const inspecting = phase === "inspect";
  const steps = inspecting
    ? ["读取文件结构", mode === "protect" ? "识别敏感内容" : "识别文件中的代号", mode === "protect" ? "准备替换范围" : "核对任务"]
    : mode === "protect"
    ? [format === "csv" ? "读取 CSV 表格结构" : ["txt", "md"].includes(format) ? "读取纯文本内容" : format === "docx" ? "复制 Word 文档结构" : "复制工作簿结构", ["txt", "md", "docx"].includes(format) ? "替换已确认内容" : "替换已确认列", "加密保存还原记录并检查残留"]
    : ["读取加密还原记录", "恢复匹配的真实值", "检查残留代号并准备导出"];
  return (
    <div className="processing-state" aria-live="polite">
      <FileMark size="medium" format={format} />
      <p className="state-kicker">{inspecting ? "本机检查中" : "本机处理中"}</p>
      <h2>{inspecting ? "正在检查文件" : mode === "protect" ? "正在生成脱敏文件" : "正在生成还原文件"}</h2>
      <p className="state-description">正在处理 {file.name}。{mode === "protect" ? "文件不会上传，只有加密后的还原记录保存到公司服务器。" : "文件不会上传。"}</p>
      <div className="progress-track progress-track--indeterminate" aria-hidden="true"><span /></div>
      <ol className="process-steps">
        {steps.map((step, index) => <li key={step} data-state={index === 0 ? "active" : "waiting"}><span>{index + 1}</span>{step}</li>)}
      </ol>
    </div>
  );
}

function WorkbookDownloadLink({ mode, result, requested, secondary = false, onRequested }) {
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    const blob = new Blob([result.buffer], { type: result.mimeType ?? FILE_FORMAT_META.xlsx.mimeType });
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  const label = requested
    ? "再次下载"
    : mode === "protect"
      ? "下载脱敏文件"
      : "下载还原文件";

  return (
    <a
      className={`${secondary ? "secondary-button" : "primary-button primary-button--compact"} download-button`}
      href={downloadUrl || undefined}
      download={result.outputName}
      aria-disabled={!downloadUrl}
      onClick={(event) => {
        if (!downloadUrl) {
          event.preventDefault();
          return;
        }
        window.setTimeout(onRequested, 0);
        recordOperation(`download_${mode}`, "requested", result);
      }}
    >
      <DownloadSimple weight="bold" />
      {label}
    </a>
  );
}

// The Clipboard API is HTTPS-only; on the plain-HTTP intranet fall back to the legacy copy command.
async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const field = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("COPY_FAILED");
}

function AiHandoff({ taskId, marker }) {
  const [copyState, setCopyState] = useState("idle");
  const instruction = marker
    ? `文件中的 客户-${marker}-01、产品-${marker}-01 等是已脱敏的业务实体代号，请当作对应对象分析。引用时必须完整原样保留代号，不改大小写、连字符或序号，也不要猜测真实身份。`
    : `文件中的 [[字段名称:P001@${taskId}]] 等是已脱敏的业务实体代号，请当作对应对象分析。引用时必须完整原样保留代号，不要删除、缩写或改写，也不要猜测真实身份。`;
  const copyInstruction = async () => {
    try {
      await copyText(instruction);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  };
  return (
    <div className="ai-handoff" aria-label="脱敏文件交给 AI 后的操作步骤">
      <ol className="ai-handoff__steps">
        <li><b>1</b>确认已下载</li>
        <li data-state="active" aria-current="step"><b>2</b>交给任意 AI 处理</li>
        <li><b>3</b>带回本机还原</li>
      </ol>
      <div className="ai-handoff__instruction">
        <button type="button" onClick={copyInstruction}><Copy weight="bold" />{copyState === "copied" ? "处理说明已复制" : "复制 AI 处理说明"}</button>
        <span>粘贴给 AI，它会保留代号继续处理，可生成 Excel、CSV、Word 或 PPT。</span>
      </div>
      {copyState === "manual" && <label className="ai-handoff__manual"><span>自动复制失败，请手动复制：</span><textarea readOnly value={instruction} onFocus={(event) => event.currentTarget.select()} /></label>}
      <p><DesktopTower weight="bold" />可以稍后回来，换电脑也能还原。</p>
    </div>
  );
}

// "除了所选的列，还在「月度」「回款」2 个工作表里替换了 4 处相同的名称。"
// "3 张图片和 1 个附件"
function mediaPhrase(media) {
  const parts = [media?.images ? `${media.images} 张图片` : "", media?.attachments ? `${media.attachments} 个附件` : ""].filter(Boolean);
  return parts.join("和 ");
}

function elsewhereSentence(elsewhere) {
  if (!elsewhere?.cells) return "";
  const sheets = elsewhere.sheets.map(item => `「${item.sheet}」`);
  const unit = elsewhere.unit ?? "工作表";
  const where = sheets.length > 3 ? `${sheets.slice(0, 3).join("")}等 ${sheets.length} 个${unit}` : `${sheets.join("")}${sheets.length > 1 ? ` ${sheets.length} 个${unit}` : unit}`;
  return `除了所选的列，还在${where}里替换了 ${elsewhere.cells} 处相同的名称。`;
}

function SuccessState({ mode, result, sourceFile, downloadRequested, detailsOpen, onDetails, onDownloadRequested, onAdjust, onNext, onReset }) {
  const protect = mode === "protect";
  const count = protect ? result.replacedCells : result.restoredOccurrences;
  const outputFileName = splitFileName(result.outputName);
  const handoff = protect && downloadRequested;
  const hasContentLoss = !protect && Boolean(result.occurrenceComparison?.missing) && !result.occurrenceComparison.rewritten;
  const valueUnit = result.format === "csv" ? "个字段值" : ["txt", "md", "docx"].includes(result.format) ? "处文字" : "个单元格";
  const checkSummary = protect
    ? `本机完成 · 已替换 ${count} ${valueUnit} · ${result.uniqueValues} 条还原记录已保存`
    : result.partialRestore
      ? `本机完成 · 已还原 ${count} 处 · ${result.unresolvedOccurrences.length} 处未还原并已标记`
      : hasContentLoss
        ? `本机完成 · 已还原 ${count} 处 · ${result.occurrenceComparison.missing} 处代号未返回`
        : `本机完成 · 已还原 ${count} 处 · 使用 ${result.usedMappings} 条还原记录 · 未发现未还原代号`;
  return (
    <div className="success-state" data-handoff={handoff} data-partial={Boolean(result.partialRestore)} data-content-loss={hasContentLoss} role="status" aria-live="polite">
      <span className="success-state__seal" aria-hidden="true">{result.partialRestore || hasContentLoss ? <WarningCircle weight="fill" /> : <Check weight="bold" />}</span>
      <h2>{protect ? handoff ? "现在可以交给 AI 处理" : "脱敏文件可以下载" : result.partialRestore ? "部分还原文件可以下载" : hasContentLoss ? "还原完成，但 AI 返回内容有缺失" : "还原文件可以下载"}</h2>
      {((protect && !handoff) || result.partialRestore || hasContentLoss) && <p className="state-description">{protect
        ? handoff
          ? ""
          : `已选内容已替换为代号。${elsewhereSentence(result.elsewhere)}${result.removedMedia?.images ? `${result.removedMedia.images} 张图片原样保留，图片里的文字未替换。` : ""}${result.removedMedia?.attachments ? `${result.removedMedia.attachments} 个附件没有放进脱敏文件。` : ""}交给 AI 前请复核其余内容，并点击下方按钮下载。`
        : result.partialRestore
          ? `另有 ${result.unresolvedOccurrences.length} 处被改写的代号未还原并原样保留，请下载后复核。`
          : hasContentLoss
            ? `已还原 ${count} 处代号；AI 返回内容中有 ${result.occurrenceComparison.missing} 处代号未出现，已删除内容无法自动恢复。请下载后复核内容完整性。`
          : ""}</p>}
      <div className="output-file">
        <FileMark size="medium" format={result.format ?? "xlsx"} />
        <span className="output-file__copy">
          <strong className="output-file__name" title={result.outputName}><span>{outputFileName.base}</span><b>{outputFileName.extension}</b></strong>
          {!downloadRequested && <small>已生成 · 等待下载</small>}
        </span>
      </div>
      <button className="evidence-trigger evidence-trigger--success" type="button" onClick={onDetails} aria-expanded={detailsOpen}>
        <span><ShieldCheck weight="bold" /><span className="evidence-trigger__summary"><strong>{result.partialRestore ? "部分还原已完成" : hasContentLoss ? "还原完成，内容有缺失" : "检查通过"}</strong><small>{checkSummary}</small></span></span>
        <span className="evidence-trigger__action">查看检查详情<CaretRight weight="bold" /></span>
      </button>
      {handoff && <AiHandoff taskId={result.taskId} marker={result.marker} />}
      {protect ? (
        <>
          <div className="action-row">
            {downloadRequested ? (
              <>
                <button className="primary-button primary-button--compact" type="button" onClick={onNext}>导入 AI 处理后的文件<ArrowRight weight="bold" /></button>
                <WorkbookDownloadLink mode={mode} result={result} requested secondary onRequested={onDownloadRequested} />
              </>
            ) : (
              <WorkbookDownloadLink mode={mode} result={result} requested={false} onRequested={onDownloadRequested} />
            )}
          </div>
          <div className="post-generate-links">
            <button className="text-button" type="button" onClick={onAdjust}>调整替换内容</button>
            <i aria-hidden="true" />
            <button className="text-button" type="button" onClick={onReset}>换一个文件</button>
          </div>
          <ResultFeedback key={result.operationId} mode={mode} result={result} summary={checkSummary.replace("本机完成 · ", "")} />
        </>
      ) : (
        <>
        <p className="restored-sensitive-note"><WarningCircle aria-hidden="true" />包含真实信息，请勿再次交给外部 AI。</p>
        <div className="action-row">
          <WorkbookDownloadLink mode={mode} result={result} requested={downloadRequested} onRequested={onDownloadRequested} />
          <button className="secondary-button" type="button" onClick={onReset}>再还原一个文件</button>
        </div>
        <ResultFeedback key={result.operationId} mode={mode} result={result} sourceFile={sourceFile} summary={checkSummary.replace("本机完成 · ", "")} />
        </>
      )}
    </div>
  );
}


const ISSUE_PREVIEW_LIMIT = 5;

function formulaIssueLabel(issue) {
  return `${issue.header ? `第 ${issue.row} 行 · ${issue.header}` : issue.location}：${issue.value}`;
}

function ErrorState({ mode, error, canAdjustFields, residualColumns = [], onAddResidualColumns, onAdjustFields, onReset, onDetails, onBackToProtect }) {
  const copy = ERROR_PRESENTATION[error?.code] ?? {
    title: "这个文件暂时处理不了",
    description: "安全检查没有通过，所以系统没有生成文件，原文件没有受影响。",
    guidance: "可以点“查看详细信息”看看原因；需要帮助时，可以点右上角“反馈”把情况告诉管理员。",
  };
  const formulaIssues = error?.code === "CSV_FORMULA_INJECTION" ? (error.details ?? []).filter((detail) => detail?.value) : [];
  // Where the leftover names are, in words people can find in their file.
  const residualPlaces = error?.code === "SENSITIVE_RESIDUALS" && !residualColumns.length ? [...new Set((error.details ?? []).map(residualPlace))] : [];
  return (
    <div className="error-state" role="alert">
      <span className="error-state__seal" aria-hidden="true"><WarningCircle weight="duotone" /></span>
      <p className="state-kicker">已安全停止</p>
      <h2>{copy.title}</h2>
      <p className="state-description">{copy.description}</p>
      <div className="blocked-export"><LockKey weight="bold" /><span><strong>没有生成输出文件</strong><small>原文件保持不变</small></span></div>
      {residualColumns.length > 0 ? (
        <div className="error-issues">
          <p>这些没有选中的列里还有真实值：</p>
          <ul>{residualColumns.map((column) => <li key={column.id}>{column.sheetName === "CSV" ? "" : `${column.sheetName} · `}{spreadsheetColumnLabel(column.columnNumber)} 列 · {column.header}</li>)}</ul>
        </div>
      ) : <p className="error-guidance">{copy.guidance}</p>}
      {residualPlaces.length > 0 && (
        <div className="error-issues">
          <p>需要处理的位置：</p>
          <ul>{residualPlaces.slice(0, ISSUE_PREVIEW_LIMIT).map((place) => <li key={place}>{place}</li>)}</ul>
          {residualPlaces.length > ISSUE_PREVIEW_LIMIT && <small>还有 {residualPlaces.length - ISSUE_PREVIEW_LIMIT} 处，可在详细信息中查看</small>}
        </div>
      )}
      {formulaIssues.length > 0 && (
        <div className="error-issues">
          <p>需要修改的位置：</p>
          <ul>{formulaIssues.slice(0, ISSUE_PREVIEW_LIMIT).map((issue) => <li key={issue.location}>{formulaIssueLabel(issue)}</li>)}</ul>
          {formulaIssues.length > ISSUE_PREVIEW_LIMIT && <small>还有 {formulaIssues.length - ISSUE_PREVIEW_LIMIT} 处，可在详细信息中查看</small>}
        </div>
      )}
      <div className="action-row error-actions">
        {residualColumns.length > 0 && <button className="primary-button primary-button--compact" type="button" onClick={onAddResidualColumns}>加入这 {residualColumns.length} 列并重新生成</button>}
        {canAdjustFields && <button className={residualColumns.length > 0 ? "secondary-button" : "primary-button primary-button--compact"} type="button" onClick={onAdjustFields}>调整选择字段</button>}
        <button className={canAdjustFields ? "secondary-button" : "primary-button primary-button--compact"} type="button" onClick={onReset}>重新选择文件</button>
        {mode === "restore" && <button className="secondary-button" type="button" onClick={onBackToProtect}>返回制作脱敏文件</button>}
        <button className="text-button error-details-button" type="button" onClick={onDetails}>查看详细信息</button>
      </div>
    </div>
  );
}

function residualColumnsToAdd(error, analysis, selectedIds) {
  if (error?.code !== "SENSITIVE_RESIDUALS" || !analysis?.columns) return [];
  const cells = (error.details ?? []).filter((detail) => detail?.eligible);
  return analysis.columns.filter((column) => !selectedIds.includes(column.id)
    && cells.some((cell) => cell.sheetName === column.sheetName && cell.columnNumber === column.columnNumber && cell.row > column.headerRow));
}

function formatIssueDetail(detail) {
  if (typeof detail === "string") return detail;
  return `${detail?.location || "未知位置"}：${detail?.reason || "未处理"}`;
}

function summarizeIssueLocations(details) {
  const locations = new Map();
  const csvLocations = new Set();
  details.forEach((detail) => {
    const csvLocation = detail.match(/^第 \d+ 行，第 \d+ 列/);
    if (csvLocation) csvLocations.add(csvLocation[0]);
    const match = detail.match(/^([^!：]+)!([A-Z]+)\d+/i);
    if (!match) return;
    const [, sheet, column] = match;
    if (!locations.has(sheet)) locations.set(sheet, new Set());
    locations.get(sheet).add(column.toUpperCase());
  });
  if (csvLocations.size) return [...csvLocations].slice(0, 5).join("；") + (csvLocations.size > 5 ? "等位置" : "");
  if (!locations.size) return "文件结构或任务信息";
  return Array.from(locations, ([sheet, columns]) => `${sheet} 的 ${Array.from(columns).join("、")} 列`).join("；");
}

function buildErrorDiagnosis(error) {
  const code = error?.code || "PROCESSING_ERROR";
  const details = (error?.details ?? []).map(formatIssueDetail);
  const defaultCopy = ERROR_PRESENTATION[code];
  const presets = {
    UNSUPPORTED_CELLS: {
      analysis: "所选字段中包含链接、错误值或其他暂不支持的结构化单元格。普通文字、数字、日期、布尔值和 Excel 富文本均可处理；为避免破坏其余文件结构，系统已停止生成脱敏文件。",
      suggestions: [
        "返回字段选择，取消不必脱敏且包含复杂单元格的字段，再重新生成。",
        "如果这些字段必须脱敏，请先复制原文件，并在副本中把目标单元格转换为普通值。",
        "重新导入处理后的副本，确认识别结果不再提示复杂单元格。",
      ],
    },
  };
  const preset = presets[code];
  return {
    code,
    details,
    analysis: preset?.analysis || defaultCopy?.description || error?.message || "当前文件未通过安全检查，系统已停止输出。",
    suggestions: preset?.suggestions || [
      defaultCopy?.guidance || "根据问题概要检查文件内容或任务状态。",
      code === "SENSITIVE_RESIDUALS" ? "名称太短时（例如只有 1 个字），系统不会自动在句子里替换，以免误伤其他内容。关闭详情后点击“调整选择字段”，用“手动添加”把这个名称加进去再重新生成，不需要重新上传；也可以在原文件里把名称写完整后重新导入。" : "修正后重新导入文件；不要绕过安全拦截。",
    ],
    summary: details.length
      ? `共发现 ${details.length} 项问题，主要位于 ${summarizeIssueLocations(details)}。`
      : "安全检查未通过，但没有可定位到具体位置的明细。",
  };
}

function TextCandidateSelection({ analysis, selectedIds, onToggle, onAdd, onRemove, onSetSelection, title = "需要替换的敏感内容", hint = "系统只提出候选，最终由你确认；替换时会匹配文件中的完整文字", compact = false }) {
  const candidates = analysis.candidates ?? [];
  const showTools = !compact || candidates.length > 8;
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [manualError, setManualError] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visible = normalizedQuery
    ? candidates.filter((item) => `${item.value} ${item.label} ${item.contexts.join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    : candidates;

  const submitManual = () => {
    const value = manualValue.trim();
    if (!value) return;
    try {
      onAdd(value);
      setManualValue("");
      setManualError("");
    } catch (error) {
      setManualError(error.message);
    }
  };

  return (
    <section className={compact ? "text-candidates text-candidates--compact" : "text-candidates"} aria-labelledby="text-candidates-title">
      <div className="protection-section__head"><div><h3 id="text-candidates-title">{title}</h3><p>{hint}</p></div></div>
      {showTools && <div className="text-candidates__tools">
        <label><span>搜索候选</span><input type="search" value={query} placeholder="名称、编码或上下文" onChange={(event) => setQuery(event.target.value)} /></label>
        <div><button type="button" onClick={() => onSetSelection([...new Set([...selectedIds, ...visible.map((item) => item.id)])])}>选择当前结果</button><button type="button" onClick={() => onSetSelection(selectedIds.filter((id) => !visible.some((item) => item.id === id)))}>取消当前结果</button></div>
      </div>}
      <div className="text-candidate-list">
        {visible.map((item) => {
          const inputId = `candidate-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          return (
            <article className="text-candidate" key={item.id}>
              <input id={inputId} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggle(item.id)} />
              <label htmlFor={inputId} title={compact ? item.contexts[0] : undefined}><strong>{item.value}</strong><small>{item.label} · 出现 {item.count} 次</small>{!compact && <span>{item.contexts[0]}</span>}</label>
              {item.manual && <button type="button" aria-label={`移除 ${item.value}`} onClick={() => onRemove(item.id)}><Trash /></button>}
            </article>
          );
        })}
        {!visible.length && <p className="text-candidates__empty">{candidates.length ? "没有匹配的候选；可以清除搜索或手动添加文件中的完整文字。" : "没有在表单里找到其他名称；有需要可以在下面手动添加。"}</p>}
      </div>
      <div className="text-candidates__manual">
        <label htmlFor="manual-sensitive-value">手动添加</label>
        <div><input id="manual-sensitive-value" value={manualValue} placeholder="粘贴文件中需要替换的完整文字" onChange={(event) => setManualValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitManual(); } }} /><button type="button" onClick={submitManual}>添加</button></div>
        {manualError && <small role="alert">{manualError}</small>}
      </div>
      {analysis.kind === "text" && <p className="drawer-note"><Info weight="bold" />{analysis.format === "docx"
        ? "Word 处理正文、普通表格、页眉页脚和文本框；图片文字不扫描，复杂结构会停止生成。"
        : analysis.format === "md" ? "Markdown 按纯文本处理，不渲染或执行 HTML、脚本；代码块、链接和 Front Matter 中的已选完整文字也会替换。"
          : "TXT 按纯文本处理，匹配已选完整文字并保留原换行与 BOM。"}</p>}
    </section>
  );
}

function SecurityDrawer({ mode, status, analysis, selectedIds, fieldModes = {}, restoreInspection, result, error, modal, drawerRef, closeButtonRef, onClose, onToggleColumn, onAddCandidate, onRemoveCandidate, onSetSelection }) {
  const [issuesExpanded, setIssuesExpanded] = useState(false);
  const selectedColumns = (analysis?.columns ?? [])
    .filter((column) => selectedIds.includes(column.id))
    .map((column) => ({ ...column, processingMode: fieldModes[column.id] ?? column.recommendedMode ?? "whole" }));
  const selectedMetricColumns = selectedColumns.filter((column) => column.processingMode === "whole" && METRIC_HEADER_PATTERN.test(column.header));
  const wholeColumnCount = selectedColumns.filter((column) => column.processingMode === "whole").length;
  const selectedCandidateCount = (analysis?.candidates ?? []).filter((candidate) => selectedIds.includes(candidate.id)).length;
  const errorDiagnosis = error ? buildErrorDiagnosis(error) : null;
  const comparison = result?.occurrenceComparison ?? restoreInspection?.occurrenceComparison;
  const changedTokens = comparison?.byToken?.filter((item) => item.missing || item.added) ?? [];
  const detailRows = mode === "restore" && restoreInspection
      ? [["文件格式", restoreInspection.formatLabel], ["匹配任务", restoreInspection.taskName], ["任务编号", restoreInspection.taskId], ["发现代号", `${restoreInspection.occurrences} 处`], ["使用还原记录", `${restoreInspection.usedMappings} 条`], ...(restoreInspection.occurrenceComparison ? [["原始 / 返回", `${restoreInspection.occurrenceComparison.original} / ${restoreInspection.occurrenceComparison.returned} 处`], ["缺失 / 新增", `${restoreInspection.occurrenceComparison.missing} / ${restoreInspection.occurrenceComparison.added} 处`]] : [])]
      : result
        ? [["任务编号", result.taskId], [mode === "protect" ? "已替换" : "已还原", `${mode === "protect" ? result.replacedCells : result.restoredOccurrences} 处`], ...(mode === "protect" && result.elsewhere?.cells ? [["所选列以外", result.elsewhere.sheets.map(item => `${item.sheet} ${item.cells} 处`).join("、")]] : []), ...(mode === "restore" ? [["使用还原记录", `${result.usedMappings} 条`], ...(result.partialRestore ? [["未还原", `${result.unresolvedOccurrences.length} 处（已原样保留）`]] : [])] : []), ["输出状态", result.partialRestore ? "部分还原" : "已通过"]]
        : [];

  const renderColumns = (columns) => (
    <>
      {columns.map((column) => {
              const checked = selectedIds.includes(column.id);
              const empty = isEmptyColumn(column);
              const inputId = `column-${encodeURIComponent(column.id)}`;
              return (
                <div className={empty ? "column-selection column-selection--empty" : "column-selection"} key={column.id}>
                  <input id={inputId} type="checkbox" checked={checked} disabled={empty && !checked} onChange={() => onToggleColumn(column.id)} />
                  <label className="column-selection__copy" htmlFor={inputId}><strong>{spreadsheetColumnLabel(column.columnNumber)} 列 · {column.header}</strong><small>{column.sheetName} · {empty ? "这一列没有内容，无需替换" : <>{column.valueCount} 个值{column.samples[0] ? ` · 示例 ${column.samples[0]}` : ""}</>}</small></label>
                  {checked && (fieldModes[column.id] ?? column.recommendedMode ?? "whole") === "inline" && <p className="column-selection__method">长文字列：保留句子，只替换其中的名称</p>}
                  <em>{empty ? "无内容" : column.suggested ? "自动建议" : "可自定义"}</em>
                </div>
              );
            })}
    </>
  );

  return (
    <aside className="security-drawer" id="security-details" ref={drawerRef} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-labelledby="security-details-title">
      <div className="drawer-head"><h2 id="security-details-title">{error ? "详细信息" : mode === "protect" && status === "ready" ? analysis?.kind === "text" || analysis?.candidates?.length ? "替换内容" : "替换列" : "检查详情"}</h2><button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭详情"><X /></button></div>
      <div className="drawer-body">
      {!(mode === "protect" && status === "ready") && <div className={`drawer-summary ${error ? "drawer-summary--warning" : status === "success" ? "" : "drawer-summary--pending"}`}>
        {error ? <WarningCircle weight="fill" /> : status === "success" ? <CheckCircle weight="fill" /> : <Info weight="fill" />}
        <span><strong>{error ? "安全检查未通过" : status === "success" ? "处理已完成" : mode === "protect" ? "请确认替换范围" : "任务已匹配，还原记录可读取"}</strong><small>{error ? "没有生成输出文件" : LOCAL_PROCESSING_COPY}</small></span>
      </div>}
      {error ? (
        <div className="error-diagnosis">
          <section className="diagnosis-card diagnosis-card--analysis" aria-labelledby="diagnosis-analysis-title">
            <div className="diagnosis-card__title"><Info weight="bold" /><h3 id="diagnosis-analysis-title">现状分析</h3></div>
            <p>{errorDiagnosis.analysis}</p>
          </section>
          <section className="diagnosis-card" aria-labelledby="diagnosis-guidance-title">
            <div className="diagnosis-card__title"><ShieldCheck weight="bold" /><h3 id="diagnosis-guidance-title">调整建议</h3></div>
            <ol>{errorDiagnosis.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ol>
          </section>
          <section className="issue-overview" aria-labelledby="issue-overview-title">
            <div className="issue-overview__head">
              <div><h3 id="issue-overview-title">问题概要</h3><p>{errorDiagnosis.summary}</p></div>
              <span>{errorDiagnosis.details.length} 项</span>
            </div>
            <button className="issue-details-toggle" type="button" aria-expanded={issuesExpanded} aria-controls="issue-details-list" onClick={() => setIssuesExpanded((expanded) => !expanded)}>
              <span>{issuesExpanded ? "收起问题详情" : "查看问题详情"}</span>
              <CaretRight weight="bold" />
            </button>
            {issuesExpanded && (
              <div className="issue-details" id="issue-details-list">
                <dl className="evidence-list evidence-list--issues" data-complete="false">
                  <div><WarningCircle weight="fill" /><dt>错误代码</dt><dd>{errorDiagnosis.code}</dd></div>
                  {errorDiagnosis.details.map((detail, index) => <div key={`${index}-${detail}`}><WarningCircle weight="fill" /><dt>问题 {index + 1}</dt><dd>{detail}</dd></div>)}
                </dl>
              </div>
            )}
          </section>
        </div>
      ) : (
        detailRows.length > 0 && <dl className="evidence-list" data-complete={status === "success"}>
          {detailRows.map(([label, value]) => <div key={`${label}-${value}`}><CheckCircle weight="fill" /><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {mode === "protect" && analysis?.riskFindings?.length > 0 && status === "ready" && (
        <p className="drawer-note drawer-note--warning"><WarningCircle weight="bold" /><span><strong>还发现可能需要保护的信息：</strong>{analysis.riskFindings.map((item) => `${item.label} ${item.count} 处`).join("、")}。请确认对应字段或内容是否已经加入替换范围。</span></p>
      )}
      {mode === "restore" && !error && (result || restoreInspection) && (
        <section className="restore-scope" aria-label="还原检查范围">
          <div className="restore-scope__item">
            <h3>已检查区域</h3>
            <p>{(result?.checkedAreas ?? restoreInspection.checkedAreas).join("、") || "文件文字区域"}</p>
          </div>
          <div className="restore-scope__item">
            <h3>暂不处理的内容</h3>
            <p>{(result?.uncheckedAreas ?? restoreInspection.uncheckedAreas).join("、")}</p>
          </div>
          {(result?.removedContent ?? restoreInspection.removedContent) && (
            <div className="restore-scope__item">
              <h3>已移除的动态内容</h3>
              <p>{`${(result?.removedContent ?? restoreInspection.removedContent).elements} 个不安全元素、${(result?.removedContent ?? restoreInspection.removedContent).attributes} 个危险属性、${(result?.removedContent ?? restoreInspection.removedContent).remoteResources} 个远程资源引用`}</p>
            </div>
          )}
          {changedTokens.length > 0 && (
            <div className="restore-scope__item token-change-evidence">
              <h3>代号出现次数变化</h3>
              <div>{changedTokens.map((item) => <p key={item.token}><strong>{item.token}</strong><span>原始 {item.original} · 返回 {item.returned}{item.missing ? ` · 缺失 ${item.missing}` : ` · 新增 ${item.added}`}</span></p>)}</div>
            </div>
          )}
          <p className="drawer-note restore-scope__note"><Info weight="bold" />{["csv", "txt", "md"].includes(result?.format ?? restoreInspection.format)
            ? comparison?.missing
              ? "纯文本不包含图片、样式和嵌入对象；未返回的代号可能是 AI 汇总或删除造成，请复核内容完整性。"
              : "纯文本不包含图片、样式和嵌入对象；部分代号未出现不代表异常。"
            : comparison?.missing
              ? "图片未扫描；未返回的代号可能是 AI 汇总或删除造成。真实内容变长后，请在 Office 中复核内容和版式。"
              : "图片未扫描；部分代号未出现不代表异常。真实内容变长后，请在 Office 中复核换行和溢出。"}</p>
        </section>
      )}

      {mode === "protect" && analysis?.kind === "text" && status === "ready" && (
        <TextCandidateSelection analysis={analysis} selectedIds={selectedIds} onToggle={onToggleColumn} onAdd={onAddCandidate} onRemove={onRemoveCandidate} onSetSelection={onSetSelection} />
      )}

      {mode === "protect" && analysis && analysis.kind !== "text" && status === "ready" && (
        <section className="protection-section" aria-labelledby="protection-title">
          <div className="protection-section__head"><div><h3 id="protection-title">需要替换的列</h3><p>勾选里面是公司名、人名、编号的列，这些内容会换成代号；备注这类长文字列会自动只替换句子里的名称。</p></div></div>
          <div className="column-selection-list">
            {renderColumns(analysis.columns.filter((column) => selectedIds.includes(column.id) || column.suggested))}
          </div>
          {analysis.columns.some((column) => !selectedIds.includes(column.id) && !column.suggested) && (
            <details className="column-more">
              <summary>其他 {analysis.columns.filter((column) => !selectedIds.includes(column.id) && !column.suggested).length} 列<small>通常不需要替换，有需要时展开勾选</small></summary>
              <div className="column-selection-list">{renderColumns(analysis.columns.filter((column) => !selectedIds.includes(column.id) && !column.suggested))}</div>
            </details>
          )}
          {selectedColumns.length > 0 && wholeColumnCount === 0 && selectedCandidateCount === 0 && (
            <p className="drawer-note drawer-note--warning"><WarningCircle weight="bold" /><span>现在勾选的都是长文字列。请至少再勾选一列公司名、人名或编号（例如客户名称、业务员），系统才知道长文字里该换哪些词。</span></p>
          )}
          {selectedMetricColumns.length > 0 ? (
            <p className="drawer-note drawer-note--warning">
              <WarningCircle weight="bold" />
              {analysis.format === "csv"
                ? <>选择后，“{selectedMetricColumns.map((column) => column.header).join("、")}”会变成代号。AI 看不到真实数值，也无法计算总额、排名和图表；还原后会恢复原始字段文字。CSV 本身不保存 Excel 公式和样式。</>
                : <>选择后，“{selectedMetricColumns.map((column) => column.header).join("、")}”会变成代号。AI 看不到真实数值，也无法计算总额、排名和图表；还原后，原始数值会按原值恢复，文件中现有的公式会保留，并在使用 Excel 打开时重新计算。</>}
            </p>
          ) : (
            <p className="drawer-note"><Info weight="bold" />金额、日期等分析指标不会自动勾选；如确有需要，可由你手动加入。</p>
          )}
        </section>
      )}
      {mode === "protect" && analysis && analysis.kind !== "text" && status === "ready" && (
        <TextCandidateSelection compact analysis={analysis} selectedIds={selectedIds} onToggle={onToggleColumn} onAdd={onAddCandidate} onRemove={onRemoveCandidate} onSetSelection={onSetSelection}
          title={`其他名称${analysis.candidates?.length ? `（${analysis.candidates.length}）` : ""}`} hint="表单、说明文字里找到的公司名和人名，勾选的会在整个文件里替换。系统认不全简称和昵称（如“马总”），请手动添加。" />
      )}

      <div className="task-token-note"><ShieldCheck weight="bold" /><p><strong>处理边界</strong>未选内容、上下文和图片仍可能含敏感信息。</p></div>
      <p className="drawer-note"><Info weight="bold" />还原记录加密保存在公司服务器，可在“我的任务”中删除。</p>
      </div>
    </aside>
  );
}


async function animateDrawerExit(drawer) {
  if (!drawer || drawer.dataset.closing === "true") return false;
  drawer.dataset.closing = "true";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const direction = drawer.classList.contains("local-tasks-drawer") ? -22 : 22;
  const easing = getComputedStyle(drawer).getPropertyValue("--ease-drawer").trim();
  const animations = [drawer, drawer.previousElementSibling].filter(Boolean).map(element => {
    const style = getComputedStyle(element);
    const from = { opacity: style.opacity, transform: style.transform };
    // Continue from the visible position if close interrupts the entrance.
    element.getAnimations().forEach(animation => animation.cancel());
    return element.animate([from, {
      opacity: 0,
      transform: element === drawer && !reduceMotion ? `translateX(${direction}px)` : "none",
    }], { duration: 200, easing, fill: "forwards" });
  });
  await Promise.allSettled(animations.map(animation => animation.finished));
  return drawer.isConnected;
}

export function App() {
  const inputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const localTasksDrawerRef = useRef(null);
  const localTasksCloseButtonRef = useRef(null);
  const localTasksViewButtonRef = useRef(null);
  const drawerTriggerRef = useRef(null);
  const auditDrawerRef = useRef(null);
  const guideDrawerRef = useRef(null);
  const guideCloseButtonRef = useRef(null);
  const auditCloseButtonRef = useRef(null);
  const [mode, setMode] = useState("protect");
  const [status, setStatus] = useState("empty");
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [fieldModes, setFieldModes] = useState({});
  const [restoreInspection, setRestoreInspection] = useState(null);
  const [result, setResult] = useState(null);
  const operationIdRef = useRef(null);
  const recordFileOperation = (action, result, metadata = {}) => recordOperation(action, result, { ...metadata, operationId: operationIdRef.current });
  const [downloadRequested, setDownloadRequested] = useState(false);
  const [regenerationNotice, setRegenerationNotice] = useState(null);
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [localTasksOpen, setLocalTasksOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [taskManagerError, setTaskManagerError] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideUpdate, setGuideUpdate] = useState(hasUnseenUpdate);
  const guideSeen = useCallback(() => setGuideUpdate(false), []);
  const [switchPrompt, setSwitchPrompt] = useState(false);
  const switchResolveRef = useRef(null);
  const [usagePreview, setUsagePreview] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const feedbackSummary = useFeedbackSummary(signedIn);
  // Admins are told about open feedback; everyone is told about new replies to their own.
  const feedbackBadge = (isAdmin ? feedbackSummary.open : 0) + feedbackSummary.replies;
  const [auditIncomplete, setAuditIncomplete] = useState(hasOperationWriteFailure);
  useEffect(() => {
    const update = () => setAuditIncomplete(hasOperationWriteFailure());
    window.addEventListener("operation-log-changed", update);
    return () => window.removeEventListener("operation-log-changed", update);
  }, []);
  const [localTasks, setLocalTasks] = useState({ status: "loading", count: 0, mappingCount: 0, latest: null, tasks: [] });
  const taskRefreshSequence = useRef(0);
  const refreshLocalTasks = useCallback(async () => {
    const sequence = ++taskRefreshSequence.current;
    try {
      const summary = await getLocalTaskStatus();
      if (sequence === taskRefreshSequence.current) setLocalTasks({ status: "ready", ...summary });
    } catch {
      if (sequence === taskRefreshSequence.current) setLocalTasks({ status: "error", count: 0, mappingCount: 0, latest: null, tasks: [] });
    }
  }, []);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [themePreference, setThemePreference] = useState(() => {
    try {
      const stored = window.localStorage.getItem("file-mask-theme");
      return THEME_OPTIONS.some(({ value }) => value === stored) ? stored : "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = themePreference === "system" ? (media.matches ? "dark" : "light") : themePreference;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themePreference = themePreference;
      document.documentElement.style.colorScheme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#0d0f12" : "#f1efe9");
    };
    applyTheme();
    if (themePreference === "system") media.addEventListener("change", applyTheme);
    try { window.localStorage.setItem("file-mask-theme", themePreference); } catch { /* Preference storage is optional. */ }
    return () => media.removeEventListener("change", applyTheme);
  }, [themePreference]);

  useEffect(() => {
    getSession().then(session => { setIsAdmin(session.isAdmin); setSignedIn(true); }).catch(error => { if (error.code === "AUTH_REQUIRED") signIn(); });
  }, []);

  useEffect(() => {
    refreshLocalTasks();
    const visible = () => { if (document.visibilityState === "visible") refreshLocalTasks(); };
    window.addEventListener("focus", refreshLocalTasks);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("vault-changed", refreshLocalTasks);
    return () => {
      taskRefreshSequence.current += 1;
      window.removeEventListener("focus", refreshLocalTasks);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("vault-changed", refreshLocalTasks);
    };
  }, [refreshLocalTasks]);

  useEffect(() => {
    const overlayOpen = localTasksOpen || detailsOpen || auditOpen || guideOpen;
    if (!overlayOpen) return undefined;
    const oldOverflow = document.body.style.overflow;
    const trigger = drawerTriggerRef.current;
    document.body.style.overflow = "hidden";
    // Delayed under load: never pull focus away from a control the user already reached inside the drawer.
    window.requestAnimationFrame(() => {
      const drawer = (guideOpen ? guideDrawerRef : auditOpen ? auditDrawerRef : localTasksOpen ? localTasksDrawerRef : drawerRef).current;
      if (!drawer?.contains(document.activeElement)) (guideOpen ? guideCloseButtonRef : auditOpen ? auditCloseButtonRef : localTasksOpen ? localTasksCloseButtonRef : closeButtonRef).current?.focus();
    });
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (guideOpen) closeGuide();
        else if (auditOpen) closeAudit();
        else if (localTasksOpen) closeLocalTasks();
        else closeDetails();
        return;
      }
      if (event.key !== "Tab") return;
      const activeDrawer = guideOpen ? guideDrawerRef.current : auditOpen ? auditDrawerRef.current : localTasksOpen ? localTasksDrawerRef.current : drawerRef.current;
      const focusable = Array.from(activeDrawer?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])
        .filter((element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKey);
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
        else document.querySelector(".workbench .evidence-trigger")?.focus();
      });
    };
  }, [detailsOpen, localTasksOpen, auditOpen, guideOpen]);

  const closeGuide = async () => {
    if (await animateDrawerExit(guideDrawerRef.current)) setGuideOpen(false);
  };

  const closeAudit = async () => {
    if (await animateDrawerExit(auditDrawerRef.current)) setAuditOpen(false);
  };

  const openDetails = event => {
    drawerTriggerRef.current = event.currentTarget;
    setDetailsOpen(true);
  };

  const openLocalTasks = event => {
    drawerTriggerRef.current = event.currentTarget;
    setDetailsOpen(false);
    setPendingDeleteId(null);
    setTaskManagerError("");
    refreshLocalTasks();
    setLocalTasksOpen(true);
  };

  const closeDetails = async () => {
    if (await animateDrawerExit(drawerRef.current)) setDetailsOpen(false);
  };

  const closeLocalTasks = async () => {
    if (!await animateDrawerExit(localTasksDrawerRef.current)) return;
    setLocalTasksOpen(false);
    setPendingDeleteId(null);
    setTaskManagerError("");
  };

  const deleteLocalTask = async (taskId) => {
    setDeletingTaskId(taskId);
    setTaskManagerError("");
    try {
      await discardLocalTask(taskId);
      const summary = await getLocalTaskStatus();
      setLocalTasks({ status: "ready", ...summary });
      setPendingDeleteId(null);
    } catch {
      setTaskManagerError("无法删除这项还原记录，请稍后重试。原还原记录仍然保留。");
    } finally {
      setDeletingTaskId(null);
    }
  };

  const reset = async (nextMode = mode) => {
    if (mode === "protect" && status === "success" && result && !downloadRequested) {
      try {
        await discardLocalTask(result.taskId);
        const summary = await getLocalTaskStatus();
        setLocalTasks({ status: "ready", ...summary });
      } catch {
        showError(new SafeFileError("VAULT_DELETE_FAILED", "无法清理尚未下载的任务，请重试后再切换。"));
        return false;
      }
    }
    dragDepthRef.current = 0; setIsDraggingFile(false);
    setMode(nextMode); setStatus("empty"); setFile(null); setAnalysis(null); setSelectedIds([]); setFieldModes({});
    setRestoreInspection(null); setResult(null); setDownloadRequested(false); setRegenerationNotice(null); setError(null); setDetailsOpen(false); setLocalTasksOpen(false);
    return true;
  };

  // After download the task is kept, so switching needs no prompt; open the picker in the same step.
  const openRestorePicker = async () => {
    if (await reset("restore")) window.requestAnimationFrame(() => inputRef.current?.click());
  };

  const continueLatestTask = async () => {
    // The file picker opens right after this click, so skip the drawer's exit animation.
    setLocalTasksOpen(false);
    const switched = mode === "restore" && status === "empty" ? true : await changeMode("restore", true);
    if (switched) window.requestAnimationFrame(() => inputRef.current?.click());
  };

  const showError = (caught) => {
    const normalized = caught instanceof SafeFileError
      ? caught
      : caught?.code
        ? new SafeFileError(caught.code, caught.message, caught.details ?? [])
      : new SafeFileError("PROCESSING_ERROR", caught?.message || "文件处理失败，请使用副本重试。");
    setError(normalized); setStatus("error"); setDetailsOpen(false);
  };

  const askSwitch = () => new Promise((resolve) => { switchResolveRef.current = resolve; setSwitchPrompt(true); });
  const closeSwitchPrompt = useCallback((accepted) => {
    switchResolveRef.current?.(accepted);
    switchResolveRef.current = null;
    setSwitchPrompt(false);
  }, []);

  const changeMode = async (nextMode, chooseFile = false) => {
    if (nextMode === mode && !chooseFile) return false;
    if ((file || error || result) && !(await askSwitch())) return false;
    return reset(nextMode);
  };

  const inspectFile = async (selected) => {
    operationIdRef.current = randomId();
    dragDepthRef.current = 0; setIsDraggingFile(false);
    const format = fileFormatFromName(selected.name);
    recordFileOperation(`import_${mode}`, "requested", { inputName: selected.name, format });
    const supportedFormats = mode === "protect" ? SUPPORTED_PROTECT_FORMATS : SUPPORTED_RESTORE_FORMATS;
    if (!supportedFormats.includes(format)) {
      recordFileOperation(`inspect_${mode}`, "failed", { inputName: selected.name, errorCode: "UNSUPPORTED_FILE" });
      showError(new SafeFileError("UNSUPPORTED_FILE", `此入口支持标准 ${formatList(mode)} 文件。`));
      return;
    }
    setFile(selected); setStatus("inspecting"); setError(null); setDetailsOpen(false); setResult(null); setDownloadRequested(false); setRegenerationNotice(null);
    try {
      if (mode === "protect") {
        const nextAnalysis = await inspectProtectionFile(selected);
        setAnalysis(nextAnalysis);
        setSelectedIds(nextAnalysis.kind === "text" ? nextAnalysis.suggestedCandidateIds : [...nextAnalysis.suggestedColumnIds, ...(nextAnalysis.suggestedCandidateIds ?? [])]);
        setFieldModes(nextAnalysis.kind === "text" ? {} : Object.fromEntries(nextAnalysis.columns.map((column) => [column.id, column.recommendedMode ?? "whole"])));
      } else {
        const inspection = await inspectRestoreFile(selected);
        setRestoreInspection(inspection);
        recordFileOperation("inspect_restore", inspection.occurrenceComparison?.missing && !inspection.occurrenceComparison.rewritten ? "missing" : "success", { ...inspection, inputName: selected.name });
      }
      if (mode === "protect") recordFileOperation("inspect_protect", "success", { format, inputName: selected.name });
      setStatus("ready");
    } catch (caught) {
      recordFileOperation(`inspect_${mode}`, "failed", { format, inputName: selected.name, errorCode: caught?.code });
      showError(caught);
    }
  };

  const handleFileInput = (event) => {
    const selected = event.target.files?.[0];
    if (selected) inspectFile(selected);
    event.target.value = "";
  };


  const hasDraggedFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const handleDragEnter = (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (status !== "empty") return;
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };
  const handleDragOver = (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = status === "empty" ? "copy" : "none";
  };
  const handleDragLeave = (event) => {
    if (!isDraggingFile || status !== "empty") return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  };
  const handleDrop = (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    if (status !== "empty") return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) inspectFile(dropped);
  };

  const processFile = async ({ ids = selectedIds, modes = fieldModes } = {}) => {
    setStatus("processing"); setError(null); setDetailsOpen(false); setDownloadRequested(false); setRegenerationNotice(null);
    try {
      let output;
      if (mode === "protect") {
        const selection = analysis.kind === "text"
          ? analysis.candidates.filter((candidate) => ids.includes(candidate.id))
          : analysis.columns
            .filter((column) => ids.includes(column.id))
            .map((column) => ({ ...column, processingMode: modes[column.id] ?? column.recommendedMode ?? "whole" }));
        output = await createSafeFile(file, selection, analysis.kind === "text" ? undefined : { candidates: (analysis.candidates ?? []).filter((candidate) => ids.includes(candidate.id)) });
      } else {
        output = await restoreSafeFile(file, restoreInspection.taskId);
      }
      output = { ...output, inputName: file.name, operationId: operationIdRef.current, ...(mode === "restore" ? { marker: restoreInspection.marker } : {}) };
      setResult(output); setStatus("success");
      recordFileOperation(mode, output.partialRestore ? "partial" : output.occurrenceComparison?.missing && !output.occurrenceComparison.rewritten ? "missing" : "success", { ...output, format: fileFormatFromName(file.name) });
      if (mode === "protect") {
        getLocalTaskStatus()
          .then((summary) => setLocalTasks({ status: "ready", ...summary }))
          .catch(() => setLocalTasks({ status: "error", count: 0, mappingCount: 0, latest: null, tasks: [] }));
      }
    } catch (caught) { recordFileOperation(mode, "failed", { format: fileFormatFromName(file.name), inputName: file.name, errorCode: caught?.code }); showError(caught); }
  };

  const adjustProtection = async () => {
    const previousResult = result;
    const wasDownloaded = downloadRequested;
    if (!wasDownloaded) {
      try {
        await discardLocalTask(previousResult.taskId);
        const summary = await getLocalTaskStatus();
        setLocalTasks({ status: "ready", ...summary });
      } catch {
        showError(new SafeFileError("VAULT_DELETE_FAILED", "无法清理尚未下载的任务，请重试后再调整字段。"));
        return;
      }
    }
    setStatus("ready");
    setResult(null);
    setDownloadRequested(false);
    setRegenerationNotice(wasDownloaded ? { taskId: previousResult.taskId, outputName: previousResult.outputName } : null);
    setDetailsOpen(true);
  };

  const adjustFailedProtectionSelection = () => {
    setError(null);
    setResult(null);
    setStatus("ready");
    setDetailsOpen(true);
  };

  const canAdjustFailedProtectionSelection = mode === "protect"
    && Boolean(file && analysis)
    && ["NO_COLUMNS", "NO_TEXT_CANDIDATES", "NO_VALUES", "UNSUPPORTED_CELLS", "SENSITIVE_RESIDUALS", "VAULT_TASK_EXISTS"].includes(error?.code);

  const residualColumns = mode === "protect" ? residualColumnsToAdd(error, analysis, selectedIds) : [];

  const addResidualColumns = () => {
    const ids = [...selectedIds, ...residualColumns.map((column) => column.id)];
    const modes = { ...fieldModes, ...Object.fromEntries(residualColumns.map((column) => [column.id, "inline"])) };
    setSelectedIds(ids);
    setFieldModes(modes);
    processFile({ ids, modes });
  };

  const toggleProtectionColumn = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const addTextCandidate = (value) => {
    const item = addManualCandidate(analysis, value);
    setAnalysis((current) => ({ ...current, candidates: [...current.candidates, item] }));
    setSelectedIds((current) => [...current, item.id]);
  };

  const removeTextCandidate = (id) => {
    setAnalysis((current) => ({ ...current, candidates: current.candidates.filter((item) => item.id !== id) }));
    setSelectedIds((current) => current.filter((item) => item !== id));
  };

  let mainState;
  if (status === "empty") mainState = <EmptyState mode={mode} inputRef={inputRef} isDraggingFile={isDraggingFile} />;
  else if (status === "inspecting") mainState = <ProcessingState mode={mode} file={file} phase="inspect" />;
  else if (status === "ready") mainState = <ReadyState mode={mode} file={file} analysis={analysis} selectedIds={selectedIds} fieldModes={fieldModes} restoreInspection={restoreInspection} regenerationNotice={regenerationNotice} detailsOpen={detailsOpen} onRemove={() => reset(mode)} onPrimary={processFile} onDetails={openDetails} />;
  else if (status === "processing") mainState = <ProcessingState mode={mode} file={file} />;
  else if (status === "success") mainState = <SuccessState mode={mode} result={result} sourceFile={file} downloadRequested={downloadRequested} detailsOpen={detailsOpen} onDetails={openDetails} onDownloadRequested={() => setDownloadRequested(true)} onAdjust={adjustProtection} onNext={openRestorePicker} onReset={() => reset(mode)} />;
  else mainState = <ErrorState mode={mode} error={error} canAdjustFields={canAdjustFailedProtectionSelection} residualColumns={residualColumns} onAddResidualColumns={addResidualColumns} onAdjustFields={adjustFailedProtectionSelection} onReset={() => reset(mode)} onDetails={openDetails} onBackToProtect={() => reset("protect")} />;

  const routeStage = mode === "restore" ? "restore" : status === "success" && downloadRequested ? "ai" : "protect";

  return (
    <div className="app" data-mode={mode}>
      <header className="app-header" inert={detailsOpen || localTasksOpen || auditOpen || guideOpen || switchPrompt}>
        <div className="brand"><span className="brand__mark" aria-hidden="true"><ShieldCheck weight="bold" /></span><div><strong>文件脱敏助手</strong></div></div>
        <div className="header-center">
          <BoundaryRoute stage={routeStage} />
          <button className="audit-trigger guide-trigger" type="button" title={guideUpdate ? `使用指南：有新版本 v${CHANGELOG_VERSION}` : "使用指南"} aria-label={guideUpdate ? "使用指南，有新版本更新" : "使用指南"} aria-haspopup="dialog" aria-expanded={guideOpen} onClick={event => { drawerTriggerRef.current = event.currentTarget; setGuideOpen(true); }}><BookOpenText aria-hidden="true" weight="bold" /><span>使用指南</span>{guideUpdate && <i className="guide-trigger__dot" aria-hidden="true" />}</button>
        </div>
        <div className="local-status">
          <ThemeSwitcher value={themePreference} onChange={setThemePreference} />
          {signedIn && <button className="audit-trigger feedback-trigger" type="button" title={feedbackBadge ? `反馈：${isAdmin && feedbackSummary.open ? `${feedbackSummary.open} 条待处理` : ""}${isAdmin && feedbackSummary.open && feedbackSummary.replies ? "，" : ""}${feedbackSummary.replies ? `${feedbackSummary.replies} 条新回复` : ""}` : "反馈"} aria-label={feedbackBadge ? `反馈，${feedbackBadge} 条新提醒` : "反馈"} aria-pressed={usagePreview === "feedback"} onClick={() => setUsagePreview("feedback")}><ChatCircleDots aria-hidden="true" weight="bold" /><span>反馈</span>{feedbackBadge > 0 && <b aria-hidden="true">{feedbackBadge > 99 ? "99+" : feedbackBadge}</b>}</button>}
          {isAdmin && <button className="audit-trigger access-trigger" type="button" title="权限配置" aria-label="权限配置" aria-pressed={usagePreview === "access"} onClick={() => setUsagePreview("access")}><UserGear aria-hidden="true" weight="bold" /><span>权限配置</span></button>}
          <button className="audit-trigger" type="button" title={auditIncomplete ? "操作记录：有记录未能保存" : "操作记录"} aria-label="操作记录" aria-haspopup="dialog" aria-expanded={auditOpen} onClick={event => { drawerTriggerRef.current = event.currentTarget; setAuditOpen(true); }}><ClockCounterClockwise aria-hidden="true" weight="bold" /><span>操作记录</span>{auditIncomplete && <b aria-label="有操作记录未保存">!</b>}</button>
        </div>
      </header>
      {usagePreview && <div inert={auditOpen || guideOpen}>{usagePreview === "feedback" ? <FeedbackCenter admin={isAdmin} onBack={() => { setUsagePreview(false); requestAnimationFrame(() => document.querySelector(".feedback-trigger")?.focus()); }} /> : usagePreview === "access" ? <AccessSettings onBack={() => { setUsagePreview(false); requestAnimationFrame(() => document.querySelector(".access-trigger")?.focus()); }} /> : <Suspense fallback={<p role="status">正在打开使用统计…</p>}><UsageStats onBack={() => { setUsagePreview(false); requestAnimationFrame(() => document.querySelector(".audit-trigger[aria-label=\"操作记录\"]")?.focus()); }}/></Suspense>}</div>}
      <main className="app-main" hidden={usagePreview}>
        <section className="workspace" aria-label="文件处理工作区" inert={detailsOpen || localTasksOpen || auditOpen || guideOpen || switchPrompt}>
          <header className="workspace-intro">
            <h1>{WORKSPACE_COPY[mode].title}</h1>
            <span>{WORKSPACE_COPY[mode].description}</span>
          </header>
          <aside className="task-rail" aria-label="任务与还原记录">
            <div className="task-switcher" aria-label="选择任务">
              <TaskChoice active={mode === "protect"} icon={FilePlus} title="制作脱敏文件" disabled={status === "processing" || status === "inspecting"} onClick={() => changeMode("protect")} />
              <TaskChoice active={mode === "restore"} icon={FileArrowDown} title="还原处理文件" disabled={status === "processing" || status === "inspecting"} onClick={() => changeMode("restore")} />
            </div>
            <LocalTaskPanel localTasks={localTasks} disabled={status === "processing" || status === "inspecting"} onContinue={continueLatestTask} onViewAll={openLocalTasks} viewAllButtonRef={localTasksViewButtonRef} />
          </aside>
          <section className="workbench" data-status={status} data-dragging={isDraggingFile} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} aria-label={MODE_COPY[mode].title}>
            {mainState}
          </section>
          <MobileProgress stage={routeStage} />
          <input ref={inputRef} className="visually-hidden" type="file" accept={(mode === "protect" ? SUPPORTED_PROTECT_FORMATS : SUPPORTED_RESTORE_FORMATS).map(format => `.${format}`).join(",")} tabIndex={-1} aria-label={`选择待${mode === "protect" ? "脱敏" : "还原"}的 ${formatList(mode)} 文件`} onChange={handleFileInput} />
        </section>
        {detailsOpen && <><button className="drawer-scrim" type="button" tabIndex={-1} onClick={closeDetails} aria-label="关闭详情" /><SecurityDrawer mode={mode} status={status} analysis={analysis} selectedIds={selectedIds} fieldModes={fieldModes} restoreInspection={restoreInspection} result={result} error={error} modal drawerRef={drawerRef} closeButtonRef={closeButtonRef} onClose={closeDetails} onToggleColumn={toggleProtectionColumn} onAddCandidate={addTextCandidate} onRemoveCandidate={removeTextCandidate} onSetSelection={setSelectedIds} /></>}
        {localTasksOpen && <><button className="drawer-scrim drawer-scrim--local" type="button" tabIndex={-1} onClick={closeLocalTasks} aria-label="关闭我的任务" /><LocalTasksDrawer localTasks={localTasks} continueDisabled={status === "processing" || status === "inspecting"} onContinueLatest={continueLatestTask} currentTaskId={result?.taskId ?? restoreInspection?.taskId ?? null} pendingDeleteId={pendingDeleteId} deletingTaskId={deletingTaskId} error={taskManagerError} modal drawerRef={localTasksDrawerRef} closeButtonRef={localTasksCloseButtonRef} onClose={closeLocalTasks} onRequestDelete={setPendingDeleteId} onCancelDelete={() => setPendingDeleteId(null)} onConfirmDelete={deleteLocalTask} /></>}
      </main>
      {guideOpen && <><button className="drawer-scrim" type="button" tabIndex={-1} onClick={closeGuide} aria-label="关闭使用指南遮罩" /><GuideDrawer drawerRef={guideDrawerRef} closeButtonRef={guideCloseButtonRef} onClose={closeGuide} onSeen={guideSeen} initialTab={guideUpdate ? "changes" : "use"} /></>}
      {auditOpen && <><button className="drawer-scrim" type="button" tabIndex={-1} onClick={closeAudit} aria-label="关闭记录遮罩" /><OperationDrawer drawerRef={auditDrawerRef} closeButtonRef={auditCloseButtonRef} onClose={closeAudit} onPreview={async view => { await closeAudit(); setUsagePreview(view); }} /></>}
      {switchPrompt && <ConfirmDialog title="切换任务？" message="切换后将清空当前页面选择，原文件不变。" confirmLabel="切换并清空" onClose={closeSwitchPrompt} />}
    </div>
  );
}
