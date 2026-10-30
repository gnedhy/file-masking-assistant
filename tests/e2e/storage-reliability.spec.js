import { test, expect } from "@playwright/test";
import path from "node:path";

test("持久保存申请被拒绝或批准时准确显示，不承诺备份", async ({ page }) => {
  await page.addInitScript(() => {
    let persisted = false;
    let calls = 0;
    Object.defineProperty(navigator, "storage", { configurable: true, value: {
      persisted: async () => persisted,
      estimate: async () => ({ usage: 95, quota: 100 }),
      persist: async () => { persisted = ++calls > 1; return persisted; },
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "查看存储状态" }).click();
  await expect(page.getByText("尚未获准持久保存", { exact: true })).toBeVisible();
  await expect(page.getByText(/本站存储接近配额/)).toBeVisible();
  await page.getByRole("button", { name: "申请持久保存" }).click();
  await expect(page.getByText(/浏览器暂未批准/)).toBeVisible();
  await page.getByRole("button", { name: "申请持久保存" }).click();
  await expect(page.getByText("已获准持久保存", { exact: true })).toBeVisible();
  await page.getByText("保存方式与限制", { exact: true }).click();
  await expect(page.getByText(/持久保存可降低自动清理风险，但不是备份/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("不支持存储状态接口时仍能使用任务抽屉", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "storage", { configurable: true, value: undefined }));
  await page.goto("/");
  await page.getByRole("button", { name: "查看存储状态" }).click();
  await expect(page.getByText("浏览器未提供持久保存状态")).toBeVisible();
  await expect(page.getByRole("button", { name: "申请持久保存" })).toHaveCount(0);
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
