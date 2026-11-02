import { test, expect } from "@playwright/test";
import { chooseTheme } from "./theme-helper.js";

const source = "客户名称：虚构星河测试公司\n产品名称：DEMO-826\n销售人员：测试人员甲";
const input = page => page.locator('input[type="file"]');
const upload = page => input(page).setInputFiles({ name: "虚构测试.txt", mimeType: "text/plain", buffer: Buffer.from(source) });
const summaries = page => page.evaluate(async () => (await import("/src/vaultStore.js")).listVaultSummaries());
const switchToRestore = page => page.getByRole("button", { name: /^还原处理文件/ }).click();
const confirmSwitch = page => page.getByRole("alertdialog", { name: "切换任务？" }).getByRole("button", { name: "切换并清空" }).click();
const legacyTask = (taskId, taskName, value = "虚构产品") => ({ version: 2, taskId, taskName, sourceFormat: "txt", createdAt: new Date().toISOString(), mapping: { [`[[P001@${taskId}]]`]: { value: { type: "string", value } } } });

test("当前模式不重置，切换取消保留选择并返回实际焦点", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await upload(page);
  const trigger = page.getByRole("button", { name: "确认替换内容 查看并调整", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "替换内容", exact: true });
  await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
  await expect(drawer.getByText(/TXT 按纯文本处理/)).toBeVisible();
  await expect(drawer.getByText(/Markdown 按纯文本处理/)).toHaveCount(0);
  await drawer.getByRole("checkbox").first().uncheck();
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
  await page.getByRole("button", { name: /^制作脱敏文件/ }).click();
  await expect(page.getByText(/已选择 2 项敏感内容/)).toBeVisible();
  await switchToRestore(page);
  const prompt = page.getByRole("alertdialog", { name: "切换任务？" });
  await expect(prompt).toContainText("切换后将清空当前页面选择，原文件不变");
  await expect(prompt.getByRole("button", { name: "取消" })).toBeFocused();
  await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(page.getByText(/已选择 2 项敏感内容/)).toBeVisible();
  await switchToRestore(page);
  await prompt.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText(/已选择 2 项敏感内容/)).toBeVisible();
  await switchToRestore(page);
  await confirmSwitch(page);
  await expect(page.getByRole("heading", { name: "把处理结果恢复为实名文件" })).toBeVisible();
  await expect(input(page)).toHaveAttribute("accept", ".xlsx,.csv,.txt,.md,.docx,.pptx,.html");
  expect(errors).toEqual([]);
});

test("未下载的任务切换时清理，已下载的任务保留", async ({ page }) => {
  await page.goto("/");
  await upload(page);
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible();
  expect(await summaries(page)).toHaveLength(1);
  await switchToRestore(page);
  await confirmSwitch(page);
  await expect.poll(() => summaries(page)).toHaveLength(0);
  await page.getByRole("button", { name: "制作脱敏文件" }).click();
  await upload(page);
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  await download;
  const original = await summaries(page);
  expect(original).toHaveLength(1);
  await switchToRestore(page);
  await confirmSwitch(page);
  await expect(page.getByRole("heading", { name: "把处理结果恢复为实名文件" })).toBeVisible();
  expect(await summaries(page)).toEqual(original);
});

test("同编号并发只能新增一次，重复保存不覆盖原记录", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  const save = (tab, task) => tab.evaluate(async task => {
    try { await (await import("/src/vaultStore.js")).saveVault(task); return "saved"; }
    catch (error) { return error.code; }
  }, task);
  expect((await Promise.all([save(page, legacyTask("ABCDEF12", "虚构甲", "甲")), save(other, legacyTask("ABCDEF12", "虚构乙", "乙"))])).sort()).toEqual(["VAULT_TASK_EXISTS", "saved"]);
  const before = await page.evaluate(async () => (await import("/src/vaultStore.js")).loadVault("ABCDEF12"));
  expect(await save(page, legacyTask("ABCDEF12", "不得覆盖", "不得覆盖"))).toBe("VAULT_TASK_EXISTS");
  expect(await page.evaluate(async () => (await import("/src/vaultStore.js")).loadVault("ABCDEF12"))).toEqual(before);
  const rows = await summaries(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty("mapping");
});

test("其他标签页的变化在回到页面和打开抽屉时刷新", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^我的任务/ })).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(async task => (await import("/src/vaultStore.js")).saveVault(task), legacyTask("BBBB2222", "另页虚构任务"));
  await page.getByRole("button", { name: /^我的任务/ }).click();
  const drawer = page.getByRole("dialog", { name: "我的任务", exact: true });
  await expect(drawer.getByText("另页虚构任务", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭我的任务" }).click();
  await other.evaluate(async () => (await import("/src/vaultStore.js")).deleteVault("BBBB2222"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".local-task-trigger b")).toHaveCount(0);
});

test("还原页显示匹配任务，完整编号可复制，实名结果有回传警告", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => localStorage.setItem("testCopiedId", text) } }));
  await page.goto("/");
  const fixture = await page.evaluate(async () => {
    const api = await import("/src/fileEngine.js");
    const file = new File(["产品名称：虚构型号"], "原.txt");
    const analysis = await api.inspectProtectionFile(file);
    const result = await api.createSafeFile(file, analysis.candidates);
    return { text: new TextDecoder().decode(result.buffer), taskId: result.taskId, marker: result.marker };
  });
  await switchToRestore(page);
  await input(page).setInputFiles({ name: "AI返回.txt", mimeType: "text/plain", buffer: Buffer.from(fixture.text) });
  await expect(page.locator(".restore-task-match")).toContainText("原");
  await page.getByRole("button", { name: "生成还原文件" }).click();
  await expect(page.getByText("包含真实信息，请勿再次交给外部 AI。", { exact: true })).toBeVisible();
  await expect(page.locator(".output-file")).toContainText(fixture.marker);
  await expect(page.getByText("检查通过", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^我的任务/ }).click();
  const drawer = page.getByRole("dialog", { name: "我的任务", exact: true });
  await expect(drawer.getByText(fixture.marker)).toBeVisible();
  await drawer.getByText("完整任务编号", { exact: true }).click();
  await drawer.getByRole("button", { name: "复制任务编号" }).click();
  await expect(drawer.getByText("任务编号已复制", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("testCopiedId"))).toBe(fixture.taskId);
  for (const value of ["dark", "light", "system"]) {
    await drawer.getByRole("button", { name: "关闭我的任务" }).click();
    await chooseTheme(page, value);
    await page.getByRole("button", { name: /^我的任务/ }).click();
    await expect(drawer).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`我的任务-${value}.png`), fullPage: true });
  }
});

test("从抽屉最近任务直接选择待还原文件", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async task => (await import("/src/vaultStore.js")).saveVault(task), legacyTask("AAAA1111", "虚构最近任务"));
  await page.getByRole("button", { name: /^我的任务/ }).click();
  const drawer = page.getByRole("dialog", { name: "我的任务", exact: true });
  await expect(drawer.getByText("虚构最近任务", { exact: true })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await drawer.getByRole("button", { name: "选择待还原文件" }).click();
  await chooser;
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "还原处理文件" })).toHaveAttribute("aria-pressed", "true");
});
