import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chooseTheme } from "./theme-helper.js";

// Records live on the server; read every page the way the drawer does.
const serverRecords = page => page.evaluate(async () => {
  const records = [];
  for (let page = 1; page < 50; page++) {
    const list = await (await fetch(`/api/v1/operation-events?page=${page}`)).json();
    records.push(...list.records);
    if (records.length >= list.total) break;
  }
  return records;
});

test("操作记录覆盖往返、下载、删除和失败，不留敏感内容", async ({ page }, testInfo) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "保密文件名.txt", mimeType: "text/plain", buffer: Buffer.from("客户名称：虚构保密客户") });
  await page.getByRole("button", { name: "生成脱敏文件", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件", exact: true }).click();
  const download = await downloadPromise;
  const buffer = await fs.readFile(await download.path());
  await page.getByRole("button", { name: /^还原处理文件/ }).click();
  await page.getByRole("alertdialog", { name: "切换任务？" }).getByRole("button", { name: "切换并清空" }).click();
  await input.setInputFiles({ name: "AI结果.txt", mimeType: "text/plain", buffer });
  await page.getByRole("button", { name: "生成还原文件" }).click();
  await page.getByRole("link", { name: "下载还原文件", exact: true }).click();
  await expect.poll(async () => (await serverRecords(page)).some(r => r.action === "download_restore")).toBe(true);
  const taskId = (await serverRecords(page)).find(r => r.action === "protect").taskId;
  await page.evaluate(async taskId => (await import("/src/vaultStore.js")).deleteVault(taskId), taskId);
  await expect.poll(async () => (await serverRecords(page)).some(r => r.action === "delete_mapping")).toBe(true);
  const records = await serverRecords(page);
  for (const action of ["inspect_protect", "save_mapping", "protect", "download_protect", "inspect_restore", "restore", "download_restore", "delete_mapping"]) expect(records.some(r => r.action === action), action).toBe(true);
  expect(records.find(r => r.action === "protect").inputName).toBe("保密文件名.txt");
  expect(records.find(r => r.action === "restore").inputName).toBe("AI结果.txt");
  expect(JSON.stringify(records)).not.toContain("虚构保密客户");
  for (const record of records) for (const key of ["mapping", "buffer", "credential", "taskName", "message"]) expect(record).not.toHaveProperty(key);
  await page.reload();
  await input.setInputFiles({ name: "不支持.pdf", mimeType: "application/pdf", buffer: Buffer.from("fake") });
  await expect.poll(async () => (await serverRecords(page)).some(r => r.inputName === "不支持.pdf" && r.result === "failed")).toBe(true);
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "操作记录", exact: true });
  await expect(drawer.locator(".operation-tasks > li").first()).toBeVisible();
  // Newest first: the rejected PDF import is on the first page (records in the same second may share the top spot).
  await expect(drawer.locator(".operation-tasks")).toContainText("不支持.pdf", { timeout: 15000 });
  await drawer.evaluate(async el => Promise.all(el.getAnimations().map(a => a.finished)));
  await page.screenshot({ path: path.join(os.tmpdir(), `masking-audit-records-${testInfo.project.name}.png`) });
});

test("记录只保留白名单字段，服务器暂时不可用时不影响还原记录", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { recordOperation } = await import("/src/operationLog.js");
    await recordOperation("protect", "success", { taskId: "ABCDEF12", format: "txt", taskName: "秘密文件名", mapping: { x: "秘密内容" }, credential: "秘密凭据", message: "秘密错误" });
  });
  await expect.poll(async () => (await serverRecords(page)).length).toBe(1);
  const [row] = await serverRecords(page);
  expect(JSON.stringify(row)).not.toContain("秘密");
  expect(row).toMatchObject({ action: "protect", result: "success", taskId: "ABCDEF12", format: "txt" });
  await page.route("**/api/v1/operation-events/batch", route => route.abort());
  const loaded = await page.evaluate(async () => {
    const vault = await import("/src/vaultStore.js");
    await vault.saveVault({ version: 2, taskId: "ABCDEF34", taskName: "测试", sourceFormat: "txt", mapping: { "[[C001@ABCDEF34]]": "秘密值" }, createdAt: new Date().toISOString() });
    return (await vault.loadVault("ABCDEF34")).mapping["[[C001@ABCDEF34]]"];
  });
  expect(loaded).toBe("秘密值");
  await page.unroute("**/api/v1/operation-events/batch");
  await page.evaluate(async () => (await import("/src/operationSync.js")).retryOperationSync());
  await expect.poll(async () => (await serverRecords(page)).some(r => r.action === "save_mapping" && r.taskId === "ABCDEF34")).toBe(true);
});

test("审计抽屉与三个主题图标适配浅深色和移动端", async ({ page }, testInfo) => {
  await page.goto("/");
  for (const theme of ["light", "dark", "system"]) {
    await chooseTheme(page, theme);
    await expect(page.getByRole("menu", { name: "界面颜色模式" })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(os.tmpdir(), `masking-header-${testInfo.project.name}-${theme}.png`) });
    await page.getByRole("button", { name: "操作记录", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "操作记录", exact: true });
    await expect(drawer.getByText("当前筛选范围暂无记录。可调整日期或等待记录同步。")).toBeVisible();
    await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
    await drawer.evaluate(async el => Promise.all(el.getAnimations().map(a => a.finished)));
    await page.screenshot({ path: path.join(os.tmpdir(), `masking-audit-${testInfo.project.name}-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("button", { name: "操作记录", exact: true })).toBeFocused();
  }
});
