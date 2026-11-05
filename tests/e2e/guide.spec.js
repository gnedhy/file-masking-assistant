import { test, expect } from "@playwright/test";
import { CHANGELOG } from "../../src/changelog.js";

const current = CHANGELOG[0].version;

// 使用指南 sits next to the route in the top bar: usage steps, feedback steps and the change log.
test("使用指南：三个页签、截图能加载，新版本蓝点看过更新日志后消失", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("file-mask-guide-seen-version"));
  await page.reload();
  const trigger = page.getByRole("button", { name: /^使用指南/ });
  await expect(trigger).toHaveAccessibleName("使用指南，有新版本更新");
  await expect(trigger.locator(".guide-trigger__dot")).toBeVisible();

  // With an unseen update the guide opens on the change log, which clears the dot.
  await trigger.click();
  const guide = page.getByRole("dialog", { name: "使用指南" });
  await expect(guide.getByRole("tab", { name: "更新日志" })).toHaveAttribute("aria-selected", "true");
  await expect(guide.locator(".guide-version")).toContainText(`v${current}`);
  await expect(guide.locator(".guide-changes > li").first()).toContainText(`v${current}当前版本`);
  // Each release lists each kind of change once, with its items underneath.
  await expect(guide.locator(".guide-changes > li").first().locator(".guide-change-type")).toHaveText(["新增", "改进", "修复"]);
  await expect(trigger.locator(".guide-trigger__dot")).toHaveCount(0);

  // Arrow keys move between tabs; every screenshot loads.
  await guide.getByRole("tab", { name: "更新日志" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(guide.getByRole("tab", { name: "使用指引" })).toHaveAttribute("aria-selected", "true");
  // Three steps, matching the route in the top bar.
  await expect(guide.locator(".guide-steps h3")).toHaveText(["1选择文件，生成脱敏文件", "2下载脱敏文件，交给 AI 处理", "3导入 AI 结果，下载还原文件"]);
  const loaded = async () => guide.locator("img").evaluateAll(images => Promise.all(images.map(img => { img.loading = "eager"; return img.decode().then(() => img.naturalWidth > 0, () => false); })));
  expect(await loaded()).toEqual([true, true, true, true, true]);
  await guide.getByRole("tab", { name: "反馈指引" }).click();
  await expect(guide.locator(".guide-steps h3")).toHaveText(["结果不对：点「不满意」", "报错、卡住或有建议：点「反馈」", "查看管理员的回复"]);
  expect(await loaded()).toEqual([true, true, true, true]);

  // Escape closes it and focus goes back to the button; the dot stays gone after a reload.
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(page.getByRole("button", { name: "使用指南", exact: true })).toBeVisible();
  await expect(page.locator(".guide-trigger__dot")).toHaveCount(0);
  await page.getByRole("button", { name: "使用指南", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "使用指南" }).getByRole("tab", { name: "使用指引" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
