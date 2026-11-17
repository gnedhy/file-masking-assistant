import { test, expect } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { chooseTheme } from "./theme-helper.js";

test("完成页文件卡、下载提醒和检查抽屉在各主题保持布局", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const input = page.locator('input[type="file"]:not([accept=".json"])');
  await input.setInputFiles({ name: "虚构布局验证.txt", mimeType: "text/plain", buffer: Buffer.from("客户名称：虚构测试公司\n产品名称：DEMO-01") });
  await page.getByRole("button", { name: "生成脱敏文件", exact: true }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件", exact: true })).toBeVisible();
  const checkCard = async () => {
    const icon = await page.locator(".output-file > .file-mark").boundingBox();
    const copy = await page.locator(".output-file__copy").boundingBox();
    expect(icon.width).toBeLessThanOrEqual(58);
    expect(copy.width).toBeGreaterThan(icon.width * 2);
    expect(copy.x).toBeGreaterThanOrEqual(icon.x + icon.width);
    await expect(page.locator(".success-state > .state-kicker")).toHaveCount(0);
    await expect(page.locator(".output-file > svg")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  await checkCard();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件", exact: true }).click();
  const safePath = await (await download).path();
  await expect(page.getByRole("button", { name: "复制 AI 处理说明" })).toBeVisible();
  await page.getByRole("button", { name: "导入 AI 处理后的文件", exact: true }).click();
  await input.setInputFiles({ name: "这是一份用于核对长文件名换行及文件后缀显示的虚构返回文件_业务汇总_请复核.txt", mimeType: "text/plain", buffer: await (await import("node:fs/promises")).readFile(safePath) });
  await page.getByRole("button", { name: "生成还原文件", exact: true }).click();
  await expect(page.getByRole("link", { name: "下载还原文件", exact: true })).toBeVisible();
  for (const theme of ["light", "dark", "system"]) {
    await chooseTheme(page, theme);
    await checkCard();
    const note = page.locator(".restored-sensitive-note");
    await expect(note).toHaveText("包含真实信息，请勿再次交给外部 AI。");
    const noteBox = await note.boundingBox();
    const actions = await page.locator(".success-state .action-row").boundingBox();
    expect(actions.y - (noteBox.y + noteBox.height)).toBeLessThanOrEqual(16);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(os.tmpdir(), `masking-result-${testInfo.project.name}-${theme}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: /^检查通过/ }).click();
  await expect(page.getByRole("dialog", { name: "检查详情", exact: true }).getByRole("region", { name: "还原检查范围" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^检查通过/ })).toBeFocused();
  expect(errors).toEqual([]);
});
