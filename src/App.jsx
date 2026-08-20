import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CaretRight,
  Check,
  CheckCircle,
  Database,
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
  Monitor,
  MagnifyingGlass,
  Moon,
  Question,
  ShieldCheck,
  Sun,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
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
  SUPPORTED_PROTECT_FORMATS,
  SUPPORTED_RESTORE_FORMATS,
  fileFormatFromName,
  inspectProtectionFile,
  inspectRestoreFile,
  restoreSafeFile,
} from "./fileEngine.js";

const THEME_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "系统", icon: Monitor },
];

const WORKSPACE_COPY = {
  protect: {
    eyebrow: "当前任务 · 本机脱敏",
    title: "让文件安全进入 AI 工作流",
    description: "真实值留在本机，AI 只接触可分析、可还原的任务代号。",
  },
  restore: {
    eyebrow: "当前任务 · 本机还原",
    title: "把处理结果恢复为实名文件",
    description: "核对任务标记与本机映射，匹配通过后才生成还原文件。",
  },
};

function ThemeSwitcher({ value, onChange }) {
  return (
    <div className="theme-switcher" role="group" aria-label="界面颜色模式">
      {THEME_OPTIONS.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          className="theme-switcher__option"
          data-active={value === option}
          type="button"
          title={`${label}模式`}
          aria-label={`${label}模式`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          <Icon weight={value === option ? "fill" : "regular"} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

const MODE_COPY = {
  protect: {
    title: "制作脱敏文件",
    subtitle: "把敏感信息替换成代号后再交给 AI",
    emptyTitle: "拖入待脱敏的表格或文本文件",
    emptyNote: "文件仅在当前浏览器中读取和处理",
    primary: "生成脱敏文件",
  },
  restore: {
    title: "还原处理文件",
    subtitle: "导入 AI 处理后的 Excel、CSV、Word 或 PPT，恢复真实内容",
    emptyTitle: "拖入 AI 处理后的文件",
    emptyNote: "还原前会核对文件与本机记录",
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
      <Icon weight="duotone" />
    </span>
  );
}

function TaskChoice({ active, icon: Icon, title, subtitle, disabled, onClick }) {
  return (
    <button className="task-choice" data-active={active} type="button" disabled={disabled} onClick={onClick} aria-pressed={active}>
      <span className="task-choice__icon" aria-hidden="true"><Icon weight="duotone" /></span>
      <span className="task-choice__copy"><strong>{title}</strong><span>{subtitle}</span></span>
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
    <section className="local-task-panel" aria-labelledby="local-task-title" aria-live="polite">
      <div className="local-task-panel__head">
        <span className="local-task-panel__mark" aria-hidden="true"><LockKey weight="duotone" /></span>
        <div>
          <h2 id="local-task-title">本机任务</h2>
          <p>{localTasks.status === "loading"
            ? "正在读取本机记录"
            : localTasks.status === "error"
              ? "暂时无法读取记录"
              : hasTasks
                ? `${localTasks.count} 个任务 · ${localTasks.mappingCount} 条映射`
                : "还没有可继续的任务"}</p>
        </div>
      </div>

      {hasTasks ? (
        <>
          <div className="local-task-panel__latest">
            <span>最近任务</span>
            <strong title={localTasks.latest.taskName}>{localTasks.latest.taskName}</strong>
            <small>{formatTaskTime(localTasks.latest.createdAt)} · {localTasks.latest.uniqueValues} 条映射 · 任务 {localTasks.latest.taskId}</small>
            <em><CheckCircle weight="fill" />映射保存在当前浏览器</em>
          </div>
          <button className="local-task-panel__action" type="button" disabled={disabled} onClick={onContinue}>
            导入处理后的文件<ArrowRight weight="bold" />
          </button>
          <button ref={viewAllButtonRef} className="local-task-panel__view" type="button" onClick={onViewAll}>
            查看全部任务
          </button>
        </>
      ) : (
        <p className="local-task-panel__empty">
          {localTasks.status === "error"
            ? "你仍可以选择文件；还原前系统会再次核对本机映射。"
            : "制作并下载脱敏文件后，对应的还原任务会显示在这里。"}
        </p>
      )}
    </section>
  );
}

function LocalTasksDrawer({ localTasks, currentTaskId, pendingDeleteId, deletingTaskId, error, modal, drawerRef, closeButtonRef, onClose, onRequestDelete, onCancelDelete, onConfirmDelete }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleTasks = normalizedQuery
    ? localTasks.tasks.filter((task) => `${task.taskName} ${task.taskId}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    : localTasks.tasks;

  return (
    <aside className="local-tasks-drawer" id="local-tasks-drawer" ref={drawerRef} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-labelledby="local-tasks-drawer-title">
      <div className="drawer-head">
        <div>
          <h2 id="local-tasks-drawer-title">本机任务</h2>
          <p>{localTasks.count} 个还原任务 · {localTasks.mappingCount} 条映射</p>
        </div>
        <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭本机任务"><X /></button>
      </div>

      <p className="local-tasks-drawer__lead"><Database weight="duotone" />这些任务和映射只保存在当前浏览器，用于核对并还原对应的脱敏文件。</p>
      {error && <p className="local-tasks-drawer__error" role="alert"><WarningCircle weight="fill" />{error}</p>}

      {localTasks.tasks.length > 0 && (
        <div className="local-task-search">
          <label htmlFor="local-task-search-input">查找任务</label>
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
          <small>{normalizedQuery ? `找到 ${visibleTasks.length} 个任务` : `共 ${localTasks.tasks.length} 个任务`}</small>
        </div>
      )}

      {visibleTasks.length ? <div className="local-task-list" aria-label="本机还原任务列表">
        {visibleTasks.map((task) => {
          const isCurrent = task.taskId === currentTaskId;
          const confirming = pendingDeleteId === task.taskId;
          const deleting = deletingTaskId === task.taskId;
          return (
            <article className="local-task-row" key={task.taskId}>
              <div className="local-task-row__main">
                <div className="local-task-row__title">
                  <strong title={task.taskName}>{task.taskName}</strong>
                  <span><CheckCircle weight="fill" />映射可用</span>
                </div>
                <dl>
                  <div><dt>任务编号</dt><dd>{task.taskId}</dd></div>
                  <div><dt>生成时间</dt><dd>{formatTaskTime(task.createdAt)}</dd></div>
                  <div><dt>映射数量</dt><dd>{task.uniqueValues} 条</dd></div>
                </dl>
              </div>
              {confirming ? (
                <div className="local-task-row__confirm" role="alert">
                  <strong>确定删除这项本机映射？</strong>
                  <p>删除后，对应脱敏文件将无法在此浏览器实名还原。</p>
                  <div>
                    <button type="button" disabled={deleting} onClick={() => onConfirmDelete(task.taskId)}>{deleting ? "正在删除" : "确认删除"}</button>
                    <button type="button" disabled={deleting} onClick={onCancelDelete}>取消</button>
                  </div>
                </div>
              ) : (
                <button className="local-task-row__delete" type="button" disabled={isCurrent || Boolean(deletingTaskId)} title={isCurrent ? "当前任务结束后才能删除" : "删除本机映射"} onClick={() => onRequestDelete(task.taskId)}>
                  <Trash weight="regular" />{isCurrent ? "当前任务" : "删除"}
                </button>
              )}
            </article>
          );
        })}
      </div> : <p className="local-tasks-drawer__empty">{localTasks.tasks.length ? "没有找到匹配的任务，请换一个文件名或任务编号。" : "当前浏览器已没有可还原的本机任务。"}</p>}
      <p className="local-tasks-drawer__boundary"><Info weight="duotone" />V1 仅支持手动清理；映射保留期限将在企业策略和到期提醒机制明确后再加入。</p>
    </aside>
  );
}

function BoundaryRoute() {
  return (
    <div className="boundary-route" aria-label="文件脱敏与还原路径">
      <span><LockKey weight="duotone" />本机脱敏</span>
      <ArrowRight weight="bold" aria-hidden="true" />
      <span data-stage="ai"><FileXls weight="duotone" />脱敏文件给 AI</span>
      <ArrowRight weight="bold" aria-hidden="true" />
      <span><ShieldCheck weight="duotone" />本机还原</span>
    </div>
  );
}

function EmptyState({ mode, inputRef, localTasks, isDraggingFile }) {
  const copy = MODE_COPY[mode];
  const restoreReady = mode === "restore" && localTasks.status === "ready" && localTasks.count > 0;
  const restoreStatusTitle = localTasks.status === "loading"
    ? "正在读取本机还原任务"
    : localTasks.status === "error"
      ? "暂时无法读取本机还原任务"
      : restoreReady
        ? `本机有 ${localTasks.count} 个可还原任务`
        : "本机暂时没有可还原任务";
  const restoreStatusDetail = localTasks.status === "loading"
    ? "请稍候"
    : localTasks.status === "error"
      ? "仍可选择文件，系统会在还原前再次核对"
      : restoreReady
        ? `最近任务：${localTasks.latest.taskName} · ${localTasks.latest.taskId}`
        : "请先在本机制作并下载脱敏文件";
  const supportedCopy = mode === "protect" ? " XLSX、CSV、TXT、MD 或 DOCX 文件" : " XLSX、CSV、TXT、MD、DOCX、PPTX 或 HTML 文件";

  return (
    <div className="empty-state" data-dragging={isDraggingFile}>
      {mode === "restore" && (
        <span className="restore-readiness" data-state={localTasks.status === "loading" ? "loading" : restoreReady ? "ready" : "warning"}>
          {restoreReady ? <CheckCircle weight="fill" /> : <Info weight="fill" />}
          <span><strong>{restoreStatusTitle}</strong><small>{restoreStatusDetail}</small></span>
        </span>
      )}
      <span className="empty-state__icon" aria-hidden="true"><UploadSimple weight="regular" /></span>
      <strong className="empty-state__title" aria-live="polite">{isDraggingFile ? "松开鼠标，开始读取文件" : copy.emptyTitle}</strong>
      <span className="empty-state__note">{isDraggingFile
        ? <>文件只在当前浏览器中处理，不会自动上传到网络</>
        : <>{copy.emptyNote}<br />也可以点击按钮选择{supportedCopy}</>}</span>
      {!isDraggingFile && <button className="small-button" type="button" onClick={() => inputRef.current?.click()}>选择文件</button>}
      {mode === "restore" && <span className="same-device-note"><DesktopTower weight="duotone" />请在生成脱敏文件时使用的同一设备和浏览器中还原</span>}
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
  const selectedCandidates = analysis?.kind === "text" ? analysis.candidates.filter((candidate) => selectedIds.includes(candidate.id)) : [];
  const selectedColumns = (analysis?.columns ?? [])
    .filter((column) => selectedIds.includes(column.id))
    .map((column) => ({ ...column, processingMode: fieldModes[column.id] ?? column.recommendedMode ?? "whole" }));
  const wholeColumnCount = selectedColumns.filter((column) => column.processingMode === "whole").length;
  const hasOnlyInlineFields = mode === "protect" && analysis?.kind !== "text" && selectedColumns.length > 0 && wholeColumnCount === 0;
  const valueCount = selectedColumns.reduce((sum, column) => sum + column.valueCount, 0);
  const valueUnit = fileFormatFromName(file.name) === "csv" ? "个字段值" : "个单元格";
  const summary = mode === "protect"
    ? analysis?.kind === "text"
      ? `已选择 ${selectedCandidates.length} 项敏感内容，共出现 ${selectedCandidates.reduce((sum, item) => sum + item.count, 0)} 处`
      : `已选择 ${selectedColumns.length} 列，将检查 ${valueCount} ${valueUnit}`
    : `已识别 ${restoreInspection.formatLabel} · 发现 ${restoreInspection.occurrences} 处代号 · 使用 ${restoreInspection.usedMappings} 条本机映射`;

  return (
    <div className="ready-state">
      <SelectedFile file={file} onRemove={onRemove} />
      {regenerationNotice && (
        <div className="task-change-banner" role="status">
          <WarningCircle weight="duotone" aria-hidden="true" />
          <span>
            <strong>你正在创建一个新的脱敏文件</strong>
            <small>已下载的旧文件仍对应任务 {regenerationNotice.taskId}。重新生成后会创建新任务，请不要混用两个文件。</small>
          </span>
        </div>
      )}
      <p className="recognition-line"><CheckCircle weight="duotone" /><span>{summary}</span></p>
      {mode === "restore" && (
        <section className="compatibility-check" data-partial={restoreInspection.partialRestore} aria-labelledby="compatibility-check-title">
          <div className="compatibility-check__head">
            {restoreInspection.partialRestore ? <WarningCircle weight="fill" aria-hidden="true" /> : <CheckCircle weight="fill" aria-hidden="true" />}
            <span><strong id="compatibility-check-title">{restoreInspection.partialRestore ? "可以继续部分还原" : "兼容性预检已通过"}</strong><small>{restoreInspection.partialRestore
              ? `可确认的代号会正常还原；${restoreInspection.unresolvedOccurrences.length} 处被改写的代号将原样保留。`
              : `${restoreInspection.formatLabel} 文件与本机任务已匹配，可以安全进入还原。`}</small></span>
          </div>
          <dl>
            <div><dt>会检查并还原</dt><dd>{restoreInspection.checkedAreas.join("、") || "文件文字区域"}</dd></div>
            <div><dt>首版暂不检查</dt><dd>{restoreInspection.uncheckedAreas.join("、") || "无"}</dd></div>
          </dl>
          {restoreInspection.warnings?.length > 0 && <p><Info weight="duotone" />{restoreInspection.warnings[0]}</p>}
        </section>
      )}
      {hasOnlyInlineFields && (
        <div className="task-change-banner" role="alert">
          <WarningCircle weight="duotone" aria-hidden="true" />
          <span>
            <strong>请先保留至少一列“整格替换”</strong>
            <small>“仅替换文中实体”需要用客户、产品或人员等整格字段作为准确依据；否则系统无法判断备注里哪些文字代表真实实体。</small>
          </span>
        </div>
      )}
      <div className="rule" />
      <button className="evidence-trigger" type="button" onClick={onDetails} aria-expanded={detailsOpen} aria-controls="security-details">
        <span><ShieldCheck weight="duotone" /><strong>{mode === "protect" ? "确认需要替换的列" : `任务指纹 ${restoreInspection.taskId}`}</strong></span>
        <span className="evidence-trigger__action">{mode === "protect" ? "查看并调整" : "查看匹配证据"}<CaretRight weight="bold" /></span>
      </button>
      <button className="primary-button" type="button" onClick={onPrimary} disabled={mode === "protect" && (!(analysis?.kind === "text" ? selectedCandidates.length : selectedColumns.length) || hasOnlyInlineFields)}>
        {MODE_COPY[mode].primary}<ArrowRight weight="bold" />
      </button>
      <div className="trust-line" aria-label="处理边界">
        <span>外部请求 0 次</span><i aria-hidden="true" /><span>原文件不修改</span><i aria-hidden="true" /><span>映射加密保存在本机</span>
      </div>
    </div>
  );
}

function ProcessingState({ mode, file }) {
  const format = fileFormatFromName(file.name) || "xlsx";
  const steps = mode === "protect"
    ? [format === "csv" ? "读取 CSV 表格结构" : ["txt", "md"].includes(format) ? "读取纯文本内容" : format === "docx" ? "复制 Word 文档结构" : "复制工作簿结构", ["txt", "md", "docx"].includes(format) ? "替换已确认内容" : "替换已确认列", "加密保存映射并检查残留"]
    : ["读取本机加密映射", "恢复匹配的真实值", "检查残留代号并准备导出"];
  return (
    <div className="processing-state" aria-live="polite">
      <FileMark size="medium" format={format} />
      <p className="state-kicker">本机处理中</p>
      <h2>{mode === "protect" ? "正在生成脱敏文件" : "正在生成还原文件"}</h2>
      <p className="state-description">正在处理 {file.name}。文件内容不会发送到网络。</p>
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
      }}
    >
      <DownloadSimple weight="duotone" />
      {label}
    </a>
  );
}

function AiHandoff() {
  return (
    <div className="ai-handoff" aria-label="脱敏文件交给 AI 后的操作步骤">
      <div className="ai-handoff__head"><strong>接下来，用任意 AI 处理脱敏文件</strong><span>不要改写 [[C001@任务号]] 这类代号</span></div>
      <ol>
        <li data-state="done"><b><Check weight="bold" /></b><span><strong>确认下载</strong><small>在浏览器下载列表中确认文件</small></span></li>
        <li data-state="active"><b>2</b><span><strong>交给 AI 处理</strong><small>可生成 Excel、CSV、Word 或 PPT，保留代号原样</small></span></li>
        <li><b>3</b><span><strong>带回本机还原</strong><small>完成后导入 AI 处理后的文件</small></span></li>
      </ol>
      <p><DesktopTower weight="duotone" />可以稍后回来，但请使用当前设备和浏览器。</p>
    </div>
  );
}

function SuccessState({ mode, result, downloadRequested, detailsOpen, onDetails, onDownloadRequested, onAdjust, onNext, onReset }) {
  const protect = mode === "protect";
  const count = protect ? result.replacedCells : result.restoredOccurrences;
  const outputFileName = splitFileName(result.outputName);
  const handoff = protect && downloadRequested;
  const valueUnit = result.format === "csv" ? "个字段值" : ["txt", "md", "docx"].includes(result.format) ? "处文字" : "个单元格";
  const restoreBoundary = ["csv", "txt", "md"].includes(result.format)
    ? "全部文本内容已检查；未出现的映射不代表异常。"
    : "图片未扫描，未出现的映射不代表异常。";
  return (
    <div className="success-state" data-handoff={handoff} data-partial={Boolean(result.partialRestore)} role="status" aria-live="polite">
      <span className="success-state__seal" aria-hidden="true">{result.partialRestore ? <WarningCircle weight="fill" /> : <Check weight="bold" />}</span>
      <p className="state-kicker">{handoff ? "脱敏文件已准备好" : "文件已生成"}</p>
      <h2>{protect ? handoff ? "现在可以交给 AI 处理" : "脱敏文件可以下载" : result.partialRestore ? "部分还原文件可以下载" : "还原文件可以下载"}</h2>
      <p className="state-description">{protect
        ? handoff
          ? "已发起下载。请先确认文件已保存，再交给任意 AI 处理；完成后回到这里导入处理后的文件。"
          : `已替换 ${count} ${valueUnit}，${result.uniqueValues} 个唯一真实值仅保存在本机。请点击下方按钮保存文件。`
        : result.partialRestore
          ? `已还原 ${count} 处代号，另有 ${result.unresolvedOccurrences.length} 处被改写的代号未还原并原样保留。此文件已含真实信息，请勿再次交给外部 AI。`
          : `发现并还原 ${count} 处代号，使用 ${result.usedMappings} 条本机映射。${restoreBoundary}`}</p>
      <div className="output-file">
        <FileMark size="medium" format={result.format ?? "xlsx"} />
        <span>
          <strong className="output-file__name" title={result.outputName}><span>{outputFileName.base}</span><b>{outputFileName.extension}</b></strong>
          <small>{downloadRequested ? "已发起下载 · 请在浏览器下载列表确认" : `已生成 · 等待下载 · 任务 ${result.taskId}`}</small>
        </span>
        {result.partialRestore ? <WarningCircle weight="fill" aria-label="部分还原" /> : <CheckCircle weight="fill" aria-label="已通过检查" />}
      </div>
      <button className="evidence-trigger evidence-trigger--success" type="button" onClick={onDetails} aria-expanded={detailsOpen}>
        <span><ShieldCheck weight="duotone" /><span className="evidence-trigger__summary"><strong>{result.partialRestore ? "部分还原已完成" : "安全检查已通过"}</strong><small>{protect
          ? `本机完成 · 已替换 ${count} ${valueUnit} · ${result.uniqueValues} 条映射已保存`
          : result.partialRestore
            ? `本机完成 · 已还原 ${count} 处 · ${result.unresolvedOccurrences.length} 处未还原并已标记`
            : `本机完成 · 已还原 ${count} 处 · 使用 ${result.usedMappings} 条本机映射 · 未发现未还原代号`}</small></span></span>
        <span className="evidence-trigger__action">查看验证证据<CaretRight weight="bold" /></span>
      </button>
      {handoff && <AiHandoff />}
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
            <button className="text-button" type="button" onClick={onAdjust}>{downloadRequested ? "调整字段并生成新文件" : "修改脱敏字段"}</button>
            <i aria-hidden="true" />
            <button className="text-button" type="button" onClick={onReset}>{downloadRequested ? "处理另一个文件" : "换一个文件"}</button>
          </div>
          {!downloadRequested && <p className="next-step-hint">下载后，请先交给任意 AI 处理，再回来还原</p>}
        </>
      ) : (
        <div className="action-row">
          <WorkbookDownloadLink mode={mode} result={result} requested={downloadRequested} onRequested={onDownloadRequested} />
          <button className="secondary-button" type="button" onClick={onReset}>再还原一个文件</button>
        </div>
      )}
    </div>
  );
}

const ERROR_PRESENTATION = {
  NO_COLUMNS: {
    title: "还没有选择脱敏字段",
    description: "当前没有可用于生成脱敏文件的已选字段。",
    guidance: "可以直接返回字段选择，勾选至少一个需要替换的字段。",
  },
  NO_VALUES: {
    title: "所选字段没有可替换内容",
    description: "整格字段中没有可替换值，或文中替换字段里没有出现已经确认的实体。",
    guidance: "请至少选择一个客户、产品或人员字段使用整格替换，再按需加入反馈、备注等文中替换字段。",
  },
  UNSUPPORTED_CELLS: {
    title: "所选字段包含暂不支持的单元格",
    description: "所选范围中包含公式、富文本、链接或其他结构化单元格，为避免破坏文件结构，系统已停止生成。",
    guidance: "可以直接调整选择字段；如果这些字段必须脱敏，请先在文件副本中把目标单元格转换为普通值或纯文本。",
  },
  NO_TOKENS: {
    title: "这个文件无法自动还原",
    description: "没有识别到本工具生成的代号。它可能不是脱敏文件，或者 AI 改变了代号格式。",
    guidance: "请选择 AI 处理后的脱敏文件；如果代号已被改写，请重新制作脱敏文件后再处理。",
  },
  VAULT_NOT_FOUND: {
    title: "本机缺少这个文件的还原映射",
    description: "文件中的任务代号存在，但当前设备或浏览器没有对应的真实映射。",
    guidance: "请回到生成脱敏文件时使用的同一设备和浏览器，或重新制作脱敏文件。",
  },
  NO_TEXT_CANDIDATES: {
    title: "还没有选择敏感内容",
    description: "当前没有可用于生成脱敏文件的已选文字。",
    guidance: "返回候选列表，勾选自动识别的内容，或手动添加文件中的完整文字。",
  },
  VAULT_KEY_MISSING: {
    title: "本机映射密钥已经丢失",
    description: "任务记录仍在，但当前浏览器已没有解密它所需的本机密钥，因此无法恢复真实内容。",
    guidance: "该映射无法找回。请使用原始文件重新制作脱敏任务，并避免清理当前浏览器的网站数据。",
  },
  VAULT_DECRYPT_FAILED: {
    title: "本机映射已经损坏",
    description: "当前浏览器无法解密这条映射记录，系统已停止还原，避免生成错误实名文件。",
    guidance: "请使用原始文件重新制作脱敏任务；损坏的映射不能安全继续使用。",
  },
  VAULT_SAVE_FAILED: {
    title: "无法保存本机还原映射",
    description: "浏览器存储不可用或空间不足，因此系统没有生成无法还原的脱敏文件。",
    guidance: "请释放浏览器存储空间或允许当前站点使用本机存储后重试。",
  },
  VAULT_STORAGE_FAILED: {
    title: "当前浏览器无法使用本机映射存储",
    description: "系统无法打开保存还原任务所需的本机存储。",
    guidance: "请检查隐私模式、浏览器存储权限或可用空间后重试。",
  },
  MIXED_TASKS: {
    title: "文件中混入了不同任务的代号",
    description: "系统无法确认每个代号应该使用哪一份本机映射，因此已停止还原。",
    guidance: "请使用同一次任务生成的处理文件，不要合并来自不同脱敏文件的内容。",
  },
  UNRESOLVED_TOKENS: {
    title: "有些代号无法安全还原",
    description: "系统发现未知代号，或代号出现在暂不支持自动改写的位置。",
    guidance: "可以查看技术详情定位问题；修正文件后重新选择，系统会再次完整检查。",
  },
  UNSUPPORTED_FILE: {
    title: "当前还不能处理这种文件",
    description: "制作脱敏文件支持 XLSX、CSV、TXT、MD、DOCX；还原支持标准 XLSX、CSV、TXT、MD、DOCX、PPTX 和安全静态 HTML。",
    guidance: "请选择支持的标准文件。宏、加密文件和复杂嵌入对象暂不处理。",
  },
  INVALID_CSV: { title: "无法安全读取这个 CSV", description: "文件可能包含二进制内容、损坏的引号或异常分隔结构。", guidance: "请从 Excel 重新另存为 UTF-8 CSV 后再试。" },
  INVALID_CSV_ENCODING: { title: "无法识别 CSV 文字编码", description: "当前文件不是可识别的 UTF-8 或 GB18030 编码。", guidance: "请将文件另存为 UTF-8 CSV 后再试。" },
  INVALID_TEXT: { title: "无法安全读取这个文本文件", description: "文件包含二进制内容或空字符，不是标准纯文本。", guidance: "请另存为 UTF-8 的 TXT 或 MD 文件后再试。" },
  INVALID_TEXT_ENCODING: { title: "无法识别文本编码", description: "TXT/MD 仅支持标准 UTF-8 或 UTF-8 BOM。", guidance: "请用文本编辑器另存为 UTF-8 后再试。" },
  TEXT_TOO_LARGE: { title: "文本文件超过首版安全限制", description: "TXT/MD 文件不能超过 10 MB。", guidance: "请拆分文件后重试。" },
  CSV_TOO_LARGE: { title: "CSV 超过首版安全限制", description: "CSV 文件不能超过 50 MB。", guidance: "请拆分文件后重试。" },
  CSV_LIMIT_EXCEEDED: { title: "CSV 表格规模超过安全限制", description: "文件的行数、列数或字段总量过大，系统已停止处理。", guidance: "请按月份、业务单元或工作表拆分后重试。" },
  INVALID_OFFICE_PACKAGE: { title: "无法安全读取这个 Office 文件", description: "文件可能已损坏、加密，或不是标准 DOCX/PPTX。", guidance: "请从 Word 或 PowerPoint 重新另存为标准文件后再试。" },
  UNSUPPORTED_DOCX_STRUCTURE: { title: "这个 Word 文件包含首版无法完整脱敏的结构", description: "检测到脚注、尾注、修订、内容控件、域或批注。为避免静默遗漏，系统已停止生成。", guidance: "请接受或拒绝修订，并移除批注、域、脚注/尾注或内容控件后，另存为标准 DOCX 再试。" },
  INVALID_HTML: { title: "无法安全读取这个 HTML 文件", description: "文件不是有效的 UTF-8 静态 HTML，或包含无法识别的二进制内容。", guidance: "请让 AI 导出为 UTF-8 的单文件 HTML 后再试。" },
  FORMAT_MISMATCH: { title: "文件扩展名与内部格式不一致", description: "为避免把伪装文件当作 Office 文件处理，系统已停止输出。", guidance: "请用原应用重新另存文件，不要只修改扩展名。" },
  EMBEDDED_OBJECTS: { title: "文件包含首版不处理的嵌入内容", description: "检测到宏、OLE、ActiveX 或嵌入包，系统已停止输出。", guidance: "请移除嵌入对象并另存为标准 DOCX/PPTX 后再试。" },
  FILE_TOO_LARGE: { title: "文件超过首版安全限制", description: "压缩文件不能超过 50 MB。", guidance: "请拆分文件或压缩图片后重试。" },
  PACKAGE_TOO_LARGE: { title: "文件内部结构超过安全限制", description: "解包总量或内部文件项过多，系统已停止处理。", guidance: "请精简文件后重试。" },
  ALTERED_TOKENS: { title: "有些代号已被改写或截断", description: "系统只还原完整且能由本机映射确认的正式代号。", guidance: "请让 AI 保留完整代号，或重新生成处理文件。" },
  UNSUPPORTED_CONTENT: { title: "代号出现在不安全或暂不处理的位置", description: "Office 的图表、SmartArt、批注、嵌入内容，或 HTML 的脚本、样式、链接、事件属性中发现正式代号，因此已停止输出。", guidance: "请把代号放回普通可见文字、表格或允许的说明属性后再试。" },
};

function ErrorState({ mode, error, canAdjustFields, onAdjustFields, onReset, onDetails, onBackToProtect }) {
  const copy = ERROR_PRESENTATION[error?.code] ?? {
    title: error?.message || "文件暂时无法处理",
    description: "安全检查没有通过，因此系统没有继续生成输出文件。",
    guidance: "请重新选择文件；如需定位原因，可以查看技术详情。",
  };
  return (
    <div className="error-state" role="alert">
      <span className="error-state__seal" aria-hidden="true"><WarningCircle weight="duotone" /></span>
      <p className="state-kicker">已安全停止</p>
      <h2>{copy.title}</h2>
      <p className="state-description">{copy.description}</p>
      <div className="blocked-export"><LockKey weight="duotone" /><span><strong>没有生成输出文件</strong><small>原文件保持不变</small></span></div>
      <p className="error-guidance">{copy.guidance}</p>
      <div className="action-row error-actions">
        {canAdjustFields && <button className="primary-button primary-button--compact" type="button" onClick={onAdjustFields}>调整选择字段</button>}
        <button className={canAdjustFields ? "secondary-button" : "primary-button primary-button--compact"} type="button" onClick={onReset}>重新选择文件</button>
        {mode === "restore" && <button className="secondary-button" type="button" onClick={onBackToProtect}>返回制作脱敏文件</button>}
        <button className="text-button error-details-button" type="button" onClick={onDetails}>查看技术详情</button>
      </div>
    </div>
  );
}

function formatIssueDetail(detail) {
  if (typeof detail === "string") return detail;
  return `${detail?.location || "未知位置"}：${detail?.reason || "未处理"}`;
}

function summarizeIssueLocations(details) {
  const locations = new Map();
  details.forEach((detail) => {
    const match = detail.match(/^([^!：]+)!([A-Z]+)\d+/i);
    if (!match) return;
    const [, sheet, column] = match;
    if (!locations.has(sheet)) locations.set(sheet, new Set());
    locations.get(sheet).add(column.toUpperCase());
  });
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
      "修正后重新导入文件；不要绕过安全拦截。",
    ],
    summary: details.length
      ? `共发现 ${details.length} 项问题，主要位于 ${summarizeIssueLocations(details)}。`
      : "安全检查未通过，但没有可定位到具体位置的明细。",
  };
}

function TextCandidateSelection({ analysis, selectedIds, onToggle, onAdd, onRemove, onSetSelection }) {
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [manualError, setManualError] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visible = normalizedQuery
    ? analysis.candidates.filter((item) => `${item.value} ${item.label} ${item.contexts.join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    : analysis.candidates;

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
    <section className="text-candidates" aria-labelledby="text-candidates-title">
      <div className="protection-section__head"><div><h3 id="text-candidates-title">需要替换的敏感内容</h3><p>系统只提出候选，最终由你确认；替换时会匹配文件中的完整文字</p></div></div>
      <div className="text-candidates__tools">
        <label><span>搜索候选</span><input type="search" value={query} placeholder="名称、编码或上下文" onChange={(event) => setQuery(event.target.value)} /></label>
        <div><button type="button" onClick={() => onSetSelection([...new Set([...selectedIds, ...visible.map((item) => item.id)])])}>选择当前结果</button><button type="button" onClick={() => onSetSelection(selectedIds.filter((id) => !visible.some((item) => item.id === id)))}>取消当前结果</button></div>
      </div>
      <div className="text-candidate-list">
        {visible.map((item) => {
          const inputId = `candidate-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          return (
            <article className="text-candidate" key={item.id}>
              <input id={inputId} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggle(item.id)} />
              <label htmlFor={inputId}><strong>{item.value}</strong><small>{item.label} · 出现 {item.count} 次</small><span>{item.contexts[0]}</span></label>
              {item.manual && <button type="button" aria-label={`移除 ${item.value}`} onClick={() => onRemove(item.id)}><Trash /></button>}
            </article>
          );
        })}
        {!visible.length && <p className="text-candidates__empty">没有匹配的候选；可以清除搜索或手动添加文件中的完整文字。</p>}
      </div>
      <div className="text-candidates__manual">
        <label htmlFor="manual-sensitive-value">手动添加</label>
        <div><input id="manual-sensitive-value" value={manualValue} placeholder="粘贴文件中需要替换的完整文字" onChange={(event) => setManualValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitManual(); } }} /><button type="button" onClick={submitManual}>添加</button></div>
        {manualError && <small role="alert">{manualError}</small>}
      </div>
      <p className="drawer-note"><Info weight="duotone" />{analysis.format === "docx"
        ? "Word 首版处理正文、普通表格、页眉页脚和文本框；图片文字不扫描，复杂结构会停止生成。"
        : "Markdown 按纯文本处理，不渲染或执行 HTML、脚本；代码块、链接和 Front Matter 中的已选完整文字也会替换。"}</p>
    </section>
  );
}

function SecurityDrawer({ mode, status, analysis, selectedIds, fieldModes = {}, restoreInspection, result, error, modal, drawerRef, closeButtonRef, onClose, onToggleColumn, onModeChange, onAddCandidate, onRemoveCandidate, onSetSelection }) {
  const [issuesExpanded, setIssuesExpanded] = useState(false);
  const selectedColumns = (analysis?.columns ?? [])
    .filter((column) => selectedIds.includes(column.id))
    .map((column) => ({ ...column, processingMode: fieldModes[column.id] ?? column.recommendedMode ?? "whole" }));
  const selectedMetricColumns = selectedColumns.filter((column) => column.processingMode === "whole" && METRIC_HEADER_PATTERN.test(column.header));
  const wholeColumnCount = selectedColumns.filter((column) => column.processingMode === "whole").length;
  const inlineColumnCount = selectedColumns.length - wholeColumnCount;
  const errorDiagnosis = error ? buildErrorDiagnosis(error) : null;
  const textCandidates = analysis?.kind === "text" ? analysis.candidates.filter((item) => selectedIds.includes(item.id)) : [];
  const detailRows = mode === "restore" && restoreInspection
      ? [["文件格式", restoreInspection.formatLabel], ["匹配任务", restoreInspection.taskName], ["任务指纹", restoreInspection.taskId], ["发现代号", `${restoreInspection.occurrences} 处`], ["使用映射", `${restoreInspection.usedMappings} 条`]]
      : result
        ? [["任务指纹", result.taskId], [mode === "protect" ? "已替换" : "已还原", `${mode === "protect" ? result.replacedCells : result.restoredOccurrences} 处`], ...(mode === "restore" ? [["使用映射", `${result.usedMappings} 条`], ...(result.partialRestore ? [["未还原", `${result.unresolvedOccurrences.length} 处（已原样保留）`]] : [])] : []), ["外部请求", "0 次"], ["输出状态", result.partialRestore ? "部分还原" : "已通过"]]
        : analysis?.kind === "text"
          ? [["已选内容", `${textCandidates.length} 项`], ["预计替换", `${textCandidates.reduce((sum, item) => sum + item.count, 0)} 处`], ["映射位置", "本机加密存储"], ["外部请求", "0 次"]]
          : [["已选择列", `${selectedColumns.length} 列`], ["处理方式", `${wholeColumnCount} 列整格 · ${inlineColumnCount} 列文中`], ["映射位置", "本机加密存储"], ["外部请求", "0 次"]];

  return (
    <aside className="security-drawer" id="security-details" ref={drawerRef} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-labelledby="security-details-title">
      <div className="drawer-head"><h2 id="security-details-title">{error ? "技术详情" : "安全详情"}</h2><button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭详情"><X /></button></div>
      <div className={`drawer-summary ${error ? "drawer-summary--warning" : status === "success" ? "" : "drawer-summary--pending"}`}>
        {error ? <WarningCircle weight="fill" /> : status === "success" ? <CheckCircle weight="fill" /> : <Info weight="fill" />}
        <span><strong>{error ? "安全检查未通过" : status === "success" ? "本机处理已完成" : mode === "protect" ? "请确认替换范围" : "本机任务已匹配"}</strong><small>{error ? "没有生成输出文件" : "真实值不会出现在外部请求中"}</small></span>
      </div>
      {error ? (
        <div className="error-diagnosis">
          <section className="diagnosis-card diagnosis-card--analysis" aria-labelledby="diagnosis-analysis-title">
            <div className="diagnosis-card__title"><Info weight="duotone" /><h3 id="diagnosis-analysis-title">现状分析</h3></div>
            <p>{errorDiagnosis.analysis}</p>
          </section>
          <section className="diagnosis-card" aria-labelledby="diagnosis-guidance-title">
            <div className="diagnosis-card__title"><ShieldCheck weight="duotone" /><h3 id="diagnosis-guidance-title">调整建议</h3></div>
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
        <dl className="evidence-list" data-complete={status === "success"}>
          {detailRows.map(([label, value]) => <div key={`${label}-${value}`}><CheckCircle weight="fill" /><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {mode === "restore" && !error && (result || restoreInspection) && (
        <section className="restore-scope" aria-label="还原检查范围">
          <div className="restore-scope__item">
            <h3>已检查区域</h3>
            <p>{(result?.checkedAreas ?? restoreInspection.checkedAreas).join("、") || "文件文字区域"}</p>
          </div>
          <div className="restore-scope__item">
            <h3>不在首版承诺范围</h3>
            <p>{(result?.uncheckedAreas ?? restoreInspection.uncheckedAreas).join("、")}</p>
          </div>
          {(result?.removedContent ?? restoreInspection.removedContent) && (
            <div className="restore-scope__item">
              <h3>已移除的动态内容</h3>
              <p>{`${(result?.removedContent ?? restoreInspection.removedContent).elements} 个不安全元素、${(result?.removedContent ?? restoreInspection.removedContent).attributes} 个危险属性、${(result?.removedContent ?? restoreInspection.removedContent).remoteResources} 个远程资源引用`}</p>
            </div>
          )}
          <p className="drawer-note restore-scope__note"><Info weight="duotone" />{["csv", "txt", "md"].includes(result?.format ?? restoreInspection.format)
            ? "纯文本不包含图片、样式和嵌入对象；未出现的映射不代表异常。"
            : "图片未扫描；未出现的映射不代表异常。真实内容变长后，请在 Office 中复核换行和溢出。"}</p>
        </section>
      )}

      {mode === "protect" && analysis?.kind === "text" && status === "ready" && (
        <TextCandidateSelection analysis={analysis} selectedIds={selectedIds} onToggle={onToggleColumn} onAdd={onAddCandidate} onRemove={onRemoveCandidate} onSetSelection={onSetSelection} />
      )}

      {mode === "protect" && analysis && analysis.kind !== "text" && status === "ready" && (
        <section className="protection-section" aria-labelledby="protection-title">
          <div className="protection-section__head"><div><h3 id="protection-title">需要替换的列</h3><p>勾选字段；叙述类字段可以只替换其中已知的客户、产品或人员</p></div></div>
          <div className="column-selection-list">
            {analysis.columns.map((column) => {
              const checked = selectedIds.includes(column.id);
              const inputId = `column-${column.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              return (
                <div className="column-selection" key={column.id}>
                  <input id={inputId} type="checkbox" checked={checked} onChange={() => onToggleColumn(column.id)} />
                  <label className="column-selection__copy" htmlFor={inputId}><strong>{spreadsheetColumnLabel(column.columnNumber)} 列 · {column.header}</strong><small>{column.sheetName} · {column.valueCount} 个值{column.samples[0] ? ` · 示例 ${column.samples[0]}` : ""}</small></label>
                  <select className="column-selection__mode" aria-label={`${column.header}的替换方式`} value={fieldModes[column.id] ?? column.recommendedMode ?? "whole"} disabled={!checked} onChange={(event) => onModeChange(column.id, event.target.value)}>
                    <option value="whole">整格替换</option>
                    <option value="inline">仅替换文中实体</option>
                  </select>
                  <em>{column.suggested ? "自动建议" : "可自定义"}</em>
                </div>
              );
            })}
          </div>
          <p className="drawer-note drawer-note--method"><Info weight="duotone" /><span><strong>整格替换</strong>会隐藏整个单元格；<strong>仅替换文中实体</strong>只替换已在整格字段中确认过的真实值，保留反馈、备注等上下文，不会模糊猜测陌生名称。</span></p>
          {selectedColumns.length > 0 && wholeColumnCount === 0 && (
            <p className="drawer-note drawer-note--warning"><WarningCircle weight="duotone" /><span>当前全部选为“仅替换文中实体”。请至少把一列客户、产品、人员或自定义实体设为“整格替换”，作为文中识别依据。</span></p>
          )}
          {selectedMetricColumns.length > 0 ? (
            <p className="drawer-note drawer-note--warning">
              <WarningCircle weight="duotone" />
              {analysis.format === "csv"
                ? <>选择后，“{selectedMetricColumns.map((column) => column.header).join("、")}”会变成代号。AI 看不到真实数值，也无法计算总额、排名和图表；还原后会恢复原始字段文字。CSV 本身不保存 Excel 公式和样式。</>
                : <>选择后，“{selectedMetricColumns.map((column) => column.header).join("、")}”会变成代号。AI 看不到真实数值，也无法计算总额、排名和图表；还原后，原始数值会按原值恢复，文件中现有的公式会保留，并在使用 Excel 打开时重新计算。</>}
            </p>
          ) : (
            <p className="drawer-note"><Info weight="duotone" />金额、日期等分析指标不会自动勾选；如确有需要，可由你手动加入。</p>
          )}
        </section>
      )}

      <div className="task-token-note"><ShieldCheck weight="duotone" /><p><strong>简单理解</strong>真实值只在本机变成带任务标记的代号；AI 可以处理这些代号，但无法从中得知真实身份。</p></div>
      <p className="drawer-note"><Info weight="duotone" />当前功能验证版使用浏览器本机加密存储，不等同于正式企业密钥库。请先使用文件副本测试。</p>
    </aside>
  );
}

function PrinciplePopover({ onClose, triggerRef }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    window.requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    const handlePointerDown = (event) => {
      if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
      triggerRef.current?.focus();
    };
  }, []);

  return (
    <section className="principle-popover" ref={panelRef} role="dialog" aria-modal="false" aria-labelledby="principle-title">
      <div className="principle-popover__head">
        <div>
          <span className="principle-popover__icon" aria-hidden="true"><Question weight="bold" /></span>
          <div><p>工作原理</p><h2 id="principle-title">它和一般脱敏工具有什么不同？</h2></div>
        </div>
        <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭原理说明"><X /></button>
      </div>

      <p className="principle-lead"><strong>常见脱敏主要隐藏真实值；文件脱敏助手还会保留本机映射，让处理后的文件可以核对并还原。</strong></p>

      <div className="principle-compare" role="table" aria-label="与一般脱敏工具的差异">
        <div className="principle-compare__head" role="row">
          <span role="columnheader">常见字段脱敏</span><span role="columnheader">文件脱敏助手</span>
        </div>
        <div role="row"><span role="cell">把真实值替换成通用代号</span><span role="cell"><strong>每个代号绑定一次具体任务</strong><small>例如 [[C001@7F2A9C4D]]，避免跨文件混用</small></span></div>
        <div role="row"><span role="cell">保存一份字段映射用于查找替换</span><span role="cell"><strong>真实映射加密留在本机</strong><small>外部 AI 只接触代号，不获得真实身份</small></span></div>
        <div role="row"><span role="cell">找到代号就替换，重点是隐藏原文</span><span role="cell"><strong>还原前先核对任务和完整性</strong><small>任务不匹配或存在未知代号，就停止导出</small></span></div>
      </div>

      <div className="principle-path" aria-label="数据处理边界">
        <span><b>1</b>本机识别并替换</span><i aria-hidden="true" /><span><b>2</b>AI 只处理代号</span><i aria-hidden="true" /><span><b>3</b>本机核对并还原</span>
      </div>

      <p className="principle-boundary"><Info weight="duotone" />当前使用浏览器本机加密存储，尚不等同于正式企业密钥库；脱敏制作支持 XLSX、CSV、TXT、MD、DOCX，还原支持 XLSX、CSV、TXT、MD、DOCX、PPTX 和安全静态 HTML 的已声明文字区域。</p>
    </section>
  );
}

export function App() {
  const inputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const localTasksDrawerRef = useRef(null);
  const localTasksCloseButtonRef = useRef(null);
  const localTasksViewButtonRef = useRef(null);
  const principleButtonRef = useRef(null);
  const [mode, setMode] = useState("protect");
  const [status, setStatus] = useState("empty");
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [fieldModes, setFieldModes] = useState({});
  const [restoreInspection, setRestoreInspection] = useState(null);
  const [result, setResult] = useState(null);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const [regenerationNotice, setRegenerationNotice] = useState(null);
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [localTasksOpen, setLocalTasksOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [taskManagerError, setTaskManagerError] = useState("");
  const [principleOpen, setPrincipleOpen] = useState(false);
  const [localTasks, setLocalTasks] = useState({ status: "loading", count: 0, mappingCount: 0, latest: null, tasks: [] });
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
    let active = true;
    setLocalTasks((current) => ({ ...current, status: "loading" }));
    getLocalTaskStatus()
      .then((summary) => { if (active) setLocalTasks({ status: "ready", ...summary }); })
      .catch(() => { if (active) setLocalTasks({ status: "error", count: 0, mappingCount: 0, latest: null, tasks: [] }); });
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    const overlayOpen = localTasksOpen || detailsOpen;
    if (!overlayOpen) return undefined;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => (localTasksOpen ? localTasksCloseButtonRef : closeButtonRef).current?.focus());
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (localTasksOpen) closeLocalTasks();
        else setDetailsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const activeDrawer = localTasksOpen ? localTasksDrawerRef.current : drawerRef.current;
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
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", onKey); };
  }, [detailsOpen, localTasksOpen]);

  const openLocalTasks = () => {
    setDetailsOpen(false);
    setPendingDeleteId(null);
    setTaskManagerError("");
    setLocalTasksOpen(true);
  };

  const closeLocalTasks = () => {
    setLocalTasksOpen(false);
    setPendingDeleteId(null);
    setTaskManagerError("");
    window.requestAnimationFrame(() => localTasksViewButtonRef.current?.focus());
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
      setTaskManagerError("无法删除这项本机映射，请稍后重试。原映射仍然保留。");
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
        showError(new SafeFileError("VAULT_DELETE_FAILED", "无法清理尚未下载的本机任务，请重试后再切换。"));
        return false;
      }
    }
    dragDepthRef.current = 0; setIsDraggingFile(false);
    setMode(nextMode); setStatus("empty"); setFile(null); setAnalysis(null); setSelectedIds([]); setFieldModes({});
    setRestoreInspection(null); setResult(null); setDownloadRequested(false); setRegenerationNotice(null); setError(null); setDetailsOpen(false); setLocalTasksOpen(false);
    return true;
  };

  const continueLatestTask = async () => {
    const switched = await reset("restore");
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

  const inspectFile = async (selected) => {
    dragDepthRef.current = 0; setIsDraggingFile(false);
    const format = fileFormatFromName(selected.name);
    const supportedFormats = mode === "protect" ? SUPPORTED_PROTECT_FORMATS : SUPPORTED_RESTORE_FORMATS;
    if (!supportedFormats.includes(format)) {
      showError(new SafeFileError("UNSUPPORTED_FILE", mode === "protect"
        ? "制作脱敏文件支持标准 .xlsx、.csv、.txt、.md 和 .docx 文件。"
        : "还原处理支持标准 .xlsx、.csv、.txt、.md、.docx、.pptx 和 .html 文件。"));
      return;
    }
    setFile(selected); setStatus("inspecting"); setError(null); setDetailsOpen(false); setResult(null); setDownloadRequested(false); setRegenerationNotice(null);
    try {
      if (mode === "protect") {
        const nextAnalysis = await inspectProtectionFile(selected);
        setAnalysis(nextAnalysis);
        setSelectedIds(nextAnalysis.kind === "text" ? nextAnalysis.suggestedCandidateIds : nextAnalysis.suggestedColumnIds);
        setFieldModes(nextAnalysis.kind === "text" ? {} : Object.fromEntries(nextAnalysis.columns.map((column) => [column.id, column.recommendedMode ?? "whole"])));
      } else {
        setRestoreInspection(await inspectRestoreFile(selected));
      }
      setStatus("ready");
    } catch (caught) { showError(caught); }
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

  const processFile = async () => {
    setStatus("processing"); setError(null); setDetailsOpen(false); setDownloadRequested(false); setRegenerationNotice(null);
    try {
      let output;
      if (mode === "protect") {
        const selection = analysis.kind === "text"
          ? analysis.candidates.filter((candidate) => selectedIds.includes(candidate.id))
          : analysis.columns
            .filter((column) => selectedIds.includes(column.id))
            .map((column) => ({ ...column, processingMode: fieldModes[column.id] ?? column.recommendedMode ?? "whole" }));
        output = await createSafeFile(file, selection);
      } else {
        output = await restoreSafeFile(file, restoreInspection.taskId);
      }
      setResult(output); setStatus("success");
      if (mode === "protect") {
        getLocalTaskStatus()
          .then((summary) => setLocalTasks({ status: "ready", ...summary }))
          .catch(() => setLocalTasks({ status: "error", count: 0, mappingCount: 0, latest: null, tasks: [] }));
      }
    } catch (caught) { showError(caught); }
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
        showError(new SafeFileError("VAULT_DELETE_FAILED", "无法清理尚未下载的本机任务，请重试后再调整字段。"));
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
    && ["NO_COLUMNS", "NO_TEXT_CANDIDATES", "NO_VALUES", "UNSUPPORTED_CELLS"].includes(error?.code);

  const toggleProtectionColumn = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const changeProtectionMode = (id, processingMode) => {
    setFieldModes((current) => ({ ...current, [id]: processingMode }));
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
  if (status === "empty") mainState = <EmptyState mode={mode} inputRef={inputRef} localTasks={localTasks} isDraggingFile={isDraggingFile} />;
  else if (status === "inspecting") mainState = <ProcessingState mode={mode} file={file} />;
  else if (status === "ready") mainState = <ReadyState mode={mode} file={file} analysis={analysis} selectedIds={selectedIds} fieldModes={fieldModes} restoreInspection={restoreInspection} regenerationNotice={regenerationNotice} detailsOpen={detailsOpen} onRemove={() => reset(mode)} onPrimary={processFile} onDetails={() => setDetailsOpen(true)} />;
  else if (status === "processing") mainState = <ProcessingState mode={mode} file={file} />;
  else if (status === "success") mainState = <SuccessState mode={mode} result={result} downloadRequested={downloadRequested} detailsOpen={detailsOpen} onDetails={() => setDetailsOpen(true)} onDownloadRequested={() => setDownloadRequested(true)} onAdjust={adjustProtection} onNext={() => reset("restore")} onReset={() => reset(mode)} />;
  else mainState = <ErrorState mode={mode} error={error} canAdjustFields={canAdjustFailedProtectionSelection} onAdjustFields={adjustFailedProtectionSelection} onReset={() => reset(mode)} onDetails={() => setDetailsOpen(true)} onBackToProtect={() => reset("protect")} />;

  return (
    <div className="app" data-mode={mode}>
      <header className="app-header">
        <div className="brand"><span className="brand__mark" aria-hidden="true"><ShieldCheck weight="duotone" /></span><div><strong>文件脱敏助手</strong><span>本机脱敏后交给 AI，处理完成再还原。</span></div></div>
        <BoundaryRoute />
        <div className="local-status">
          <span className="prototype-chip prototype-chip--quiet">验证版</span><span><DesktopTower weight="duotone" />本机模式</span><i aria-hidden="true" />
          <ThemeSwitcher value={themePreference} onChange={setThemePreference} />
          <i aria-hidden="true" />
          <button ref={principleButtonRef} className="principle-trigger" type="button" aria-label="原理说明" aria-haspopup="dialog" aria-expanded={principleOpen} onClick={() => setPrincipleOpen((open) => !open)}><Question weight="bold" /><span>原理说明</span></button>
        </div>
      </header>
      <main className="app-main">
        <section className="workspace" aria-label="文件处理工作区">
          <header className="workspace-intro">
            <p>{WORKSPACE_COPY[mode].eyebrow}</p>
            <h1>{WORKSPACE_COPY[mode].title}</h1>
            <span>{WORKSPACE_COPY[mode].description}</span>
          </header>
          <aside className="task-rail" aria-label="任务与本机记录">
            <div className="task-switcher" aria-label="选择任务">
              <TaskChoice active={mode === "protect"} icon={FilePlus} title="制作脱敏文件" subtitle="识别并替换敏感信息" disabled={status === "processing" || status === "inspecting"} onClick={() => reset("protect")} />
              <TaskChoice active={mode === "restore"} icon={FileArrowDown} title="还原处理文件" subtitle="核对文件并恢复真实内容" disabled={status === "processing" || status === "inspecting"} onClick={() => reset("restore")} />
            </div>
            <LocalTaskPanel localTasks={localTasks} disabled={status === "processing" || status === "inspecting"} onContinue={continueLatestTask} onViewAll={openLocalTasks} viewAllButtonRef={localTasksViewButtonRef} />
          </aside>
          <section className="workbench" data-dragging={isDraggingFile} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} aria-label={MODE_COPY[mode].title}>
            {mainState}
            <p className="demo-caption"><Info weight="duotone" />{mode === "protect" ? "脱敏制作支持标准 XLSX、CSV、TXT、MD、DOCX。" : "还原支持 XLSX、CSV、TXT、MD、DOCX、PPTX、安全静态 HTML；不扫描图片，危险位置中的代号会拦截输出。"}</p>
          </section>
          <input ref={inputRef} className="visually-hidden" type="file" accept={mode === "protect" ? ".xlsx,.csv,.txt,.md,.docx" : ".xlsx,.csv,.txt,.md,.docx,.pptx,.html"} tabIndex={-1} aria-label={mode === "protect" ? "选择待脱敏的 XLSX、CSV、TXT、MD 或 DOCX 文件" : "选择待还原的 XLSX、CSV、TXT、MD、DOCX、PPTX 或 HTML 文件"} onChange={handleFileInput} />
        </section>
        {detailsOpen && <><button className="drawer-scrim" type="button" tabIndex={-1} onClick={() => setDetailsOpen(false)} aria-label="关闭详情" /><SecurityDrawer mode={mode} status={status} analysis={analysis} selectedIds={selectedIds} fieldModes={fieldModes} restoreInspection={restoreInspection} result={result} error={error} modal drawerRef={drawerRef} closeButtonRef={closeButtonRef} onClose={() => setDetailsOpen(false)} onToggleColumn={toggleProtectionColumn} onModeChange={changeProtectionMode} onAddCandidate={addTextCandidate} onRemoveCandidate={removeTextCandidate} onSetSelection={setSelectedIds} /></>}
        {localTasksOpen && <><button className="drawer-scrim drawer-scrim--local" type="button" tabIndex={-1} onClick={closeLocalTasks} aria-label="关闭本机任务" /><LocalTasksDrawer localTasks={localTasks} currentTaskId={result?.taskId ?? restoreInspection?.taskId ?? null} pendingDeleteId={pendingDeleteId} deletingTaskId={deletingTaskId} error={taskManagerError} modal drawerRef={localTasksDrawerRef} closeButtonRef={localTasksCloseButtonRef} onClose={closeLocalTasks} onRequestDelete={setPendingDeleteId} onCancelDelete={() => setPendingDeleteId(null)} onConfirmDelete={deleteLocalTask} /></>}
      </main>
      {principleOpen && <PrinciplePopover triggerRef={principleButtonRef} onClose={() => setPrincipleOpen(false)} />}
    </div>
  );
}
