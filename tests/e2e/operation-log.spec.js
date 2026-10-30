import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chooseTheme } from "./theme-helper.js";

test("操作记录覆盖往返、下载、删除和失败，不留敏感内容", async ({ page }, testInfo) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]:not([accept=".json"])');
  await input.setInputFiles({ name: "保密文件名.txt", mimeType: "text/plain", buffer: Buffer.from("客户名称：虚构保密客户") });
  await page.getByRole("button", { name: "生成脱敏文件", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件", exact: true }).click();
  const download = await downloadPromise;
  const buffer = await fs.readFile(await download.path());
  await page.getByRole("button", { name: /^还原处理文件/ }).click();
  await page.getByRole("alertdialog", { name: "切换任务？" }).getByRole("button", { name: "切换并清空" }).click();
  await input.setInputFiles({ name: "AI结果.txt", mimeType: "text/plain", buffer });
  await page.getByRole("button", { name: /生成还原文件|开始还原|核对并还原/ }).click();
  await page.getByRole("link", { name: "下载还原文件", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await (await import("/src/operationLog.js")).listOperations()).some(r => r.action === "download_restore"))).toBe(true);
  const records = await page.evaluate(async () => {
    const log = await import("/src/operationLog.js");
    const records = await log.listOperations();
    const taskId = records.find(r => r.action === "protect").taskId;
    await (await import("/src/vaultStore.js")).deleteVault(taskId);
    return log.listOperations();
  });
  for (const action of ["inspect_protect", "save_mapping", "protect", "download_protect", "inspect_restore", "restore", "download_restore", "delete_mapping"]) expect(records.some(r => r.action === action)).toBe(true);
  expect(records.find(r => r.action === "protect").inputName).toBe("保密文件名.txt");
  expect(records.find(r => r.action === "restore").inputName).toBe("AI结果.txt");
  expect(JSON.stringify(records)).not.toContain("虚构保密客户");
  for (const record of records) for (const key of ["mapping", "buffer", "credential", "taskName", "message"]) expect(record).not.toHaveProperty(key);
  await page.reload();
  await input.setInputFiles({ name: "不支持.pdf", mimeType: "application/pdf", buffer: Buffer.from("fake") });
  await expect.poll(() => page.evaluate(async () => (await (await import("/src/operationLog.js")).listOperations())[0]?.result)).toBe("failed");
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "操作记录", exact: true });
  const cards = drawer.locator(".operation-cards > li");
  await expect(drawer.getByRole("heading", { name: "今天", exact: true })).toBeVisible();
  await expect(cards).toHaveCount(3);
  await expect(cards.first().locator(".operation-list__head").first()).toContainText("失败");
  const restoreCard = cards.filter({ hasText: "还原处理文件" });
  await expect(restoreCard).toContainText("AI结果.txt");
  await expect(restoreCard.locator(".operation-list__head").first()).toContainText("完成");
  await restoreCard.locator(".operation-steps > summary").click();
  await expect(restoreCard.getByText("生成还原文件", { exact: true })).toBeVisible();
  await drawer.evaluate(async el => Promise.all(el.getAnimations().map(a => a.finished)));
  await page.screenshot({ path: path.join(os.tmpdir(), `masking-audit-records-${testInfo.project.name}.png`) });
});

test("记录并发写入、容量上限及写入失败不影响映射", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  const add = p => p.evaluate(async () => {
    const { recordOperation } = await import("/src/operationLog.js");
    for (let i = 0; i < 260; i++) await recordOperation("protect", "success", { taskId: "ABCDEF12", format: "txt", taskName: "秘密文件名", mapping: { x: "秘密内容" }, credential: "秘密凭据", message: "秘密错误" });
  });
  await Promise.all([add(page), add(other)]);
  const rows = await page.evaluate(async () => (await import("/src/operationLog.js")).listOperations());
  expect(rows).toHaveLength(500);
  expect(new Set(rows.map(r => r.id)).size).toBe(500);
  expect(JSON.stringify(rows)).not.toContain("秘密");
  expect(Object.keys(rows[0]).sort()).toEqual(["action", "format", "id", "result", "taskId", "time"]);
  await page.evaluate(async () => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, ...args) => { if (name.endsWith("-operations")) throw new DOMException("full", "QuotaExceededError"); return open(name, ...args); };
    const vault = await import("/src/vaultStore.js");
    await vault.saveVault({ taskId: "ABCDEF34", taskName: "测试", mapping: { x: "秘密值" }, createdAt: new Date().toISOString() });
    const loaded = await vault.loadVault("ABCDEF34");
    if (loaded.mapping.x !== "秘密值") throw new Error("映射被影响");
    indexedDB.open = open;
  });
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("有操作记录未能保存");
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
    await expect(drawer.getByText("暂无操作记录", { exact: true })).toBeVisible();
    await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
    await drawer.evaluate(async el => Promise.all(el.getAnimations().map(a => a.finished)));
    await page.screenshot({ path: path.join(os.tmpdir(), `masking-audit-${testInfo.project.name}-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("button", { name: "操作记录", exact: true })).toBeFocused();
  }
});
