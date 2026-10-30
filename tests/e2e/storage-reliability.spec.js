import { test, expect } from "@playwright/test";
import path from "node:path";

test("保存任务时自动申请一次持久保存，界面只保留配额提醒", async ({ page }) => {
  await page.addInitScript(() => {
    window.persistCalls = 0;
    Object.defineProperty(navigator, "storage", { configurable: true, value: {
      persisted: async () => false,
      estimate: async () => ({ usage: 95, quota: 100 }),
      persist: async () => { window.persistCalls += 1; return false; },
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "导入备份" }).click();
  await expect(page.getByText(/本站存储接近配额/)).toBeVisible();
  await expect(page.getByRole("button", { name: "申请持久保存" })).toHaveCount(0);
  await page.evaluate(async () => {
    const { saveVault } = await import("/src/vaultStore.js");
    for (const taskId of ["AAAA1111", "BBBB2222"]) await saveVault({ taskId, taskName: taskId, createdAt: new Date().toISOString(), mapping: {} });
  });
  await expect.poll(() => page.evaluate(() => window.persistCalls)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("不支持存储状态接口时仍能使用任务抽屉", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "storage", { configurable: true, value: undefined }));
  await page.goto("/");
  await page.getByRole("button", { name: "导入备份" }).click();
  const drawer = page.getByRole("dialog", { name: "本机任务", exact: true });
  await expect(drawer.getByRole("region", { name: "备份与恢复" })).toBeVisible();
  await expect(page.getByText(/本站存储接近配额/)).toHaveCount(0);
  await page.evaluate(async () => (await import("/src/vaultStore.js")).saveVault({ taskId: "AAAA1111", taskName: "任务", createdAt: new Date().toISOString(), mapping: {} }));
  await expect.poll(() => page.evaluate(async () => (await (await import("/src/vaultStore.js")).listVaultSummaries()).length)).toBe(1);
});

test("浏览器配额异常明确拦截输出且不保存任务", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "vaults") throw new DOMException("full", "QuotaExceededError");
      return originalAdd.apply(this, args);
    };
  });
  await page.locator('input[type="file"]:not([accept=".json"])').setInputFiles(path.resolve("tests/fixtures/01_标准销售数据_UTF8.csv"));
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("heading", { name: "本机存储空间不足" })).toBeVisible();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toHaveCount(0);
  expect(await page.evaluate(async () => (await (await import("/src/vaultStore.js")).listVaultSummaries()).length)).toBe(0);
});

test("关闭页面后同一浏览器仍可读取原加密映射", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    await store.saveVault({ taskId: "ACDC1234", taskName: "重启样本", createdAt: new Date().toISOString(), mapping: { "[[客户:C001@ACDC1234]]": "虚构客户" } });
  });
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  expect(await reopened.evaluate(async () => (await (await import("/src/vaultStore.js")).loadVault("ACDC1234")).mapping)).toEqual({ "[[客户:C001@ACDC1234]]": "虚构客户" });
});
