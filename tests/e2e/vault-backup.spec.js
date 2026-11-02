import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

const source = "客户名称：虚构星河测试公司\n产品名称：DEMO-826\n销售人员：测试人员甲\n业务备注：测试人员甲向虚构星河测试公司介绍DEMO-826。\n";
const fileInput = page => page.locator('input[type="file"]:not([accept=".json"])');
const readDownload = async download => fs.readFile(await download.path());
const summaries = page => page.evaluate(async () => (await import("/src/vaultStore.js")).listVaultSummaries());
const drawerOf = page => page.getByRole("dialog", { name: "本机任务", exact: true });

async function maskFile(page, short) {
  await fileInput(page).setInputFiles({ name: short ? "简短样本.txt" : "标准样本.txt", mimeType: "text/plain", buffer: Buffer.from(source) });
  if (short) {
    await page.locator(".advanced-options > summary").click();
    await page.getByRole("radio", { name: "简短代号（试验）" }).check();
  }
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  let key = null;
  if (short) {
    const keyDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载还原钥匙文件" }).click();
    key = await readDownload(await keyDownload);
  }
  const safeDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const download = await safeDownload;
  return { name: download.suggestedFilename(), bytes: await readDownload(download), key };
}

async function exportBackup(page) {
  await page.getByRole("button", { name: /^本机任务/ }).click();
  const drawer = drawerOf(page);
  await drawer.getByRole("button", { name: "导出备份" }).click();
  const prompt = page.getByRole("alertdialog", { name: "导出备份？" });
  await expect(prompt).toContainText("备份文件包含全部真实信息");
  // Escape answers the dialog only; the drawer behind it stays open.
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "导出备份" }).click();
  const pending = page.waitForEvent("download");
  await prompt.getByRole("button", { name: "导出备份" }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readDownload(download) };
}

const importBackup = (page, name, buffer) => drawerOf(page).getByLabel("选择备份文件").setInputFiles({ name, mimeType: "application/json", buffer });

async function createTasks(page) {
  await page.goto("/");
  const standard = await maskFile(page, false);
  await page.getByRole("button", { name: "换一个文件" }).click();
  const short = await maskFile(page, true);
  return { standard, short };
}

test("备份导出后可在另一浏览器导入并还原，重复导入只跳过", async ({ page, browser }, testInfo) => {
  const { standard, short } = await createTasks(page);
  const backup = await exportBackup(page);
  expect(backup.name).toMatch(/^还原记录备份_含真实信息_\d{8}-\d{4}\.json$/);
  const content = JSON.parse(backup.bytes.toString("utf8"));
  expect(content.tasks).toHaveLength(2);
  expect(backup.bytes.toString("utf8")).toContain("虚构星河测试公司");

  const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL, acceptDownloads: true });
  const target = await other.newPage();
  await target.goto("/");
  await target.getByRole("button", { name: /^本机任务/ }).click();
  await importBackup(target, backup.name, backup.bytes);
  await expect(drawerOf(target).getByText("已导入 2 个任务。", { exact: true })).toBeVisible();
  expect(await summaries(target)).toHaveLength(2);
  await drawerOf(target).getByRole("button", { name: "关闭本机任务" }).click();

  await target.getByRole("button", { name: /^还原处理文件/ }).click();
  await fileInput(target).setInputFiles({ name: standard.name, mimeType: "text/plain", buffer: standard.bytes });
  await target.getByRole("button", { name: "生成还原文件" }).click();
  let restored = target.waitForEvent("download");
  await target.getByRole("link", { name: "下载还原文件" }).click();
  expect((await readDownload(await restored)).equals(Buffer.from(source))).toBe(true);

  await target.getByRole("button", { name: "再还原一个文件" }).click();
  await fileInput(target).setInputFiles({ name: short.name, mimeType: "text/plain", buffer: short.bytes });
  await expect(target.getByText("待导入还原钥匙文件", { exact: true })).toBeVisible();
  await target.getByLabel("选择还原钥匙文件", { exact: true }).setInputFiles({ name: "还原钥匙.json", mimeType: "application/json", buffer: short.key });
  await target.getByRole("checkbox", { name: "我确认此文件与以上任务配套" }).check();
  await target.getByRole("button", { name: "生成还原文件" }).click();
  restored = target.waitForEvent("download");
  await target.getByRole("link", { name: "下载还原文件" }).click();
  expect((await readDownload(await restored)).equals(Buffer.from(source))).toBe(true);

  await target.getByRole("button", { name: /^本机任务/ }).click();
  const before = await summaries(target);
  await importBackup(target, backup.name, backup.bytes);
  await expect(drawerOf(target).getByText("已导入 0 个任务，跳过 2 个（本机已有）。", { exact: true })).toBeVisible();
  expect(await summaries(target)).toEqual(before);
  await other.close();
});

test("任务编号被其他任务占用时不导入该任务", async ({ page, browser }, testInfo) => {
  await createTasks(page);
  const backup = await exportBackup(page);
  const marker = JSON.parse(backup.bytes.toString("utf8")).tasks.find(task => task.tokenFormat === "short").marker;
  const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const target = await other.newPage();
  await target.goto("/");
  await target.evaluate(async marker => (await import("/src/vaultStore.js")).reserveTaskMarker(marker, crypto.randomUUID()), marker);
  await target.getByRole("button", { name: /^本机任务/ }).click();
  await importBackup(target, backup.name, backup.bytes);
  await expect(drawerOf(target).getByRole("alert")).toHaveText("已导入 1 个任务，1 个任务编号与本机其他任务冲突，未导入。");
  const tasks = await summaries(target);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].tokenFormat).not.toBe("short");
  await other.close();
});

test("无效备份整体拒绝，本机任务不变", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^本机任务/ }).click();
  const alert = drawerOf(page).getByRole("alert");
  await importBackup(page, "随便.json", Buffer.from("不是 JSON"));
  await expect(alert).toHaveText("无法读取这个文件，请选择本工具导出的备份文件。");
  await importBackup(page, "其他.json", Buffer.from("{}"));
  await expect(alert).toHaveText("这不是本工具导出的备份文件。");
  await importBackup(page, "新版.json", Buffer.from(JSON.stringify({ format: "file-masking-assistant-backup", version: 2, tasks: [] })));
  await expect(alert).toHaveText("备份文件的版本不受支持。");
  const broken = { format: "file-masking-assistant-backup", version: 1, tasks: [
    { taskId: "AAAA1111", taskName: "完整任务", createdAt: new Date().toISOString(), mapping: {} },
    { taskId: "不合法", taskName: "坏任务", createdAt: new Date().toISOString(), mapping: {} },
  ] };
  await importBackup(page, "损坏.json", Buffer.from(JSON.stringify(broken)));
  await expect(alert).toHaveText("备份文件中有无法识别的任务，没有导入任何内容。");
  expect(await summaries(page)).toHaveLength(0);
  const oversize = await page.evaluate(async () => {
    try { await (await import("/src/vaultBackup.js")).readVaultBackup({ size: 51 * 1024 * 1024 }); return ""; }
    catch (error) { return error.code; }
  });
  expect(oversize).toBe("INVALID_BACKUP");
});

test("个别任务无法解密时仍导出其余任务并提示", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { saveVault } = await import("/src/vaultStore.js");
    for (const taskId of ["AAAA1111", "BBBB2222"]) await saveVault({ taskId, taskName: `任务 ${taskId}`, createdAt: new Date().toISOString(), mapping: { [`[[P001@${taskId}]]`]: { value: "虚构值" } } });
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("file-masking-assistant-v2-vault");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const store = open.result.transaction("vaults", "readwrite").objectStore("vaults");
        const read = store.get("BBBB2222");
        read.onsuccess = () => {
          store.put({ ...read.result, ciphertext: new Uint8Array(32).buffer }).onsuccess = () => { open.result.close(); resolve(); };
        };
      };
    });
  });
  const backup = await exportBackup(page);
  expect(JSON.parse(backup.bytes.toString("utf8")).tasks.map(task => task.taskId)).toEqual(["AAAA1111"]);
  await expect(drawerOf(page).getByRole("alert")).toContainText("1 个任务无法读取");
});
