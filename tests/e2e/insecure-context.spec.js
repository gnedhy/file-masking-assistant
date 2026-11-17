import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

// The intranet deployment is plain HTTP, where browsers hide crypto.randomUUID and the Clipboard API.
// Choosing a file used to throw before anything happened; the whole flow must work without them.
test("HTTP 内网环境（无 randomUUID、无剪贴板接口）可以脱敏、复制说明并还原", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true });
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined, configurable: true });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");

  await page.locator('input[type="file"]').setInputFiles({ name: "内网测试.txt", mimeType: "text/plain", buffer: Buffer.from("客户名称：虚构内网测试公司\n产品名称：虚构产品乙") });
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const masked = await fs.readFile(await (await download).path(), "utf8");
  expect(masked).not.toContain("虚构内网测试公司");

  await page.getByRole("button", { name: "复制 AI 处理说明" }).click();
  await expect(page.getByRole("button", { name: "处理说明已复制" })).toBeVisible();

  await page.getByRole("button", { name: /^还原处理文件/ }).click();
  await page.getByRole("alertdialog", { name: "切换任务？" }).getByRole("button", { name: "切换并清空" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "AI返回.txt", mimeType: "text/plain", buffer: Buffer.from(masked) });
  await page.getByRole("button", { name: "生成还原文件" }).click();
  const restored = page.waitForEvent("download");
  await page.getByRole("link", { name: /下载/ }).first().click();
  expect(await fs.readFile(await (await restored).path(), "utf8")).toContain("虚构内网测试公司");
  expect(errors).toEqual([]);
});
