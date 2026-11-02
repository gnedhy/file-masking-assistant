import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadSimple, UploadSimple } from "@phosphor-icons/react";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { recordOperation } from "./operationLog.js";
import { exportVaultBackup, importVaultBackup, readVaultBackup } from "./vaultBackup.js";
import { version as appVersion } from "../package.json";

function importSummary({ imported, skipped, conflicts, failed }) {
  const parts = [`已导入 ${imported} 个任务`];
  if (skipped) parts.push(`跳过 ${skipped} 个（本机已有）`);
  if (conflicts) parts.push(`${conflicts} 个任务编号与本机其他任务冲突，未导入`);
  if (failed) parts.push(`${failed} 个保存失败`);
  return `${parts.join("，")}。`;
}

export function BackupControls({ taskCount, onImported }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ tone: "status", text: "" });
  const inputRef = useRef(null);
  const downloadUrl = useRef(null);
  useEffect(() => () => { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);

  const exportBackup = useCallback(async () => {
    setBusy(true);
    try {
      const backup = await exportVaultBackup(appVersion);
      if (!backup.exported) { recordOperation("backup_export", "failed"); setNotice({ tone: "alert", text: "没有可导出的任务：还原记录无法读取。" }); return; }
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = URL.createObjectURL(new Blob([backup.buffer], { type: backup.mimeType }));
      const link = document.createElement("a");
      link.href = downloadUrl.current;
      link.download = backup.outputName;
      document.body.append(link);
      link.click();
      link.remove();
      recordOperation("backup_export", backup.failed ? "partial" : "success", { outputName: backup.outputName });
      setNotice(backup.failed
        ? { tone: "alert", text: `已发起下载，含 ${backup.exported} 个任务；${backup.failed} 个任务无法读取，未包含在备份中。` }
        : { tone: "status", text: `已发起下载，含 ${backup.exported} 个任务。请在下载列表确认。` });
    } catch {
      recordOperation("backup_export", "failed");
      setNotice({ tone: "alert", text: "导出未完成，本机任务没有变化。" });
    } finally { setBusy(false); }
  }, []);

  const importBackup = async (file) => {
    setBusy(true);
    try {
      const result = await importVaultBackup(await readVaultBackup(file));
      recordOperation("backup_import", result.conflicts || result.failed ? "partial" : "success", { inputName: file.name });
      setNotice({ tone: result.conflicts || result.failed ? "alert" : "status", text: importSummary(result) });
      await onImported();
    } catch (error) {
      recordOperation("backup_import", "failed", { inputName: file.name });
      setNotice({ tone: "alert", text: error?.code === "INVALID_BACKUP" ? error.message : "导入未完成，本机任务没有变化。" });
    } finally { setBusy(false); }
  };

  const closeConfirm = useCallback((accepted) => {
    setConfirming(false);
    if (accepted) exportBackup();
  }, [exportBackup]);

  return (
    <section className="backup-controls" aria-label="备份与恢复">
      <p>记录只在当前浏览器，换设备或清除数据前请先导出备份。</p>
      <div className="backup-controls__actions">
        <button className="secondary-button" type="button" disabled={busy || !taskCount} onClick={() => setConfirming(true)}><DownloadSimple aria-hidden="true" />导出备份</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><UploadSimple aria-hidden="true" />导入备份</button>
        <input ref={inputRef} className="visually-hidden" tabIndex={-1} aria-label="选择备份文件" type="file" accept=".json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importBackup(file); event.target.value = ""; }} />
      </div>
      {notice.text && <p className="backup-controls__notice" role={notice.tone} data-tone={notice.tone}>{notice.text}</p>}
      {confirming && <ConfirmDialog title="导出备份？" message="备份文件包含全部真实信息，请像原文件一样保管，不要交给 AI。" confirmLabel="导出备份" onClose={closeConfirm} />}
    </section>
  );
}
