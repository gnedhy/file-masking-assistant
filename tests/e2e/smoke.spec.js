import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

test("核心工作台、主题和说明抽屉可用", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page).toHaveTitle(/文件脱敏助手/);
  await expect(page.getByRole("heading", { name: "让文件安全进入 AI 工作流" })).toBeVisible();

  const themeSelect = page.getByRole("combobox", { name: "界面颜色模式" });
  const setTheme = async (value, buttonName) => {
    if (await themeSelect.isVisible()) await themeSelect.selectOption(value);
    else await page.getByRole("button", { name: buttonName }).click();
  };

  await setTheme("dark", "深色模式");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkContrast = await page.evaluate(() => {
    const parse = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (rgb) => rgb.map((channel) => { const value = channel / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.cssText = "color:var(--ink);background:var(--surface)";
    const styles = getComputedStyle(probe);
    const foreground = luminance(parse(styles.color));
    const background = luminance(parse(styles.backgroundColor));
    probe.remove();
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(darkContrast).toBeGreaterThanOrEqual(4.5);
  await setTheme("light", "浅色模式");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightContrast = await page.evaluate(() => {
    const parse = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (rgb) => rgb.map((channel) => { const value = channel / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.cssText = "color:var(--ink);background:var(--surface)";
    const styles = getComputedStyle(probe);
    const foreground = luminance(parse(styles.color));
    const background = luminance(parse(styles.backgroundColor));
    probe.remove();
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(lightContrast).toBeGreaterThanOrEqual(4.5);
  await setTheme("system", "系统模式");
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");

  await page.getByRole("button", { name: "原理说明" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭原理说明" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "还原处理文件" }).click();
  await expect(page.getByRole("heading", { name: "把处理结果恢复为实名文件" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  expect(errors).toEqual([]);
});

test("390px 原理说明可访问且两种模式保持一致布局", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const themeControl = page.getByRole("combobox", { name: "界面颜色模式" });
  const principleButton = page.getByRole("button", { name: "原理说明" });
  const brandBox = await page.locator(".brand").boundingBox();
  const themeBox = await themeControl.boundingBox();
  expect(Math.abs((brandBox.y + brandBox.height / 2) - (themeBox.y + themeBox.height / 2))).toBeLessThanOrEqual(1);
  expect((await page.locator(".workspace-intro h1").boundingBox()).height).toBeLessThanOrEqual(32);
  expect((await page.locator(".workspace-intro span").boundingBox()).height).toBeLessThanOrEqual(20);
  await expect(page.getByText("真实内容留在本机", { exact: true })).toBeVisible();
  for (const control of [themeControl, principleButton]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await principleButton.click();
  const principleDialog = page.getByRole("dialog", { name: "它和一般脱敏工具有什么不同？" });
  await expect(principleDialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.getByRole("button", { name: "关闭原理说明" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "关闭原理说明" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(principleDialog).toBeHidden();

  const taskPanel = page.locator(".local-task-panel");
  const workbench = page.locator(".workbench");
  await expect(taskPanel).toBeHidden();
  await expect(page.getByText("选择待脱敏文件", { exact: true })).toBeVisible();
  const chooseFileBox = await page.getByRole("button", { name: "选择文件" }).boundingBox();
  expect(chooseFileBox.y + chooseFileBox.height).toBeLessThanOrEqual(844);

  await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    await store.saveVault({
      version: 1,
      taskId: "MOBILE01",
      taskName: "移动端续接任务",
      createdAt: new Date().toISOString(),
      mapping: { "[[C001@MOBILE01]]": { value: { type: "string", value: "测试客户" } } },
    });
  });
  await page.reload();
  await expect(taskPanel).toBeVisible();
  let taskBox = await taskPanel.boundingBox();
  let workbenchBox = await workbench.boundingBox();
  expect(taskBox.y).toBeLessThan(workbenchBox.y);
  expect(taskBox.height).toBeLessThan(170);

  await page.getByRole("button", { name: "还原处理文件" }).click();
  await expect(taskPanel).toBeVisible();
  taskBox = await taskPanel.evaluate((element) => element.getBoundingClientRect().toJSON());
  workbenchBox = await workbench.evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(taskBox.y).toBeLessThan(workbenchBox.y);
  const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHorizontalOverflow).toBe(true);

  await page.setViewportSize({ width: 844, height: 390 });
  const taskChoices = page.locator(".task-choice");
  const firstChoice = await taskChoices.nth(0).boundingBox();
  const secondChoice = await taskChoices.nth(1).boundingBox();
  expect(firstChoice.y).toBe(secondChoice.y);
  expect(firstChoice.height).toBeLessThanOrEqual(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("两个浏览器标签页首次并发创建任务不会覆盖加密密钥", async ({ browser }) => {
  const context = await browser.newContext();
  const [pageA, pageB] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([pageA.goto("/"), pageB.goto("/")]);
  const save = (page, taskId) => page.evaluate(async (id) => {
    const store = await import("/src/vaultStore.js");
    await store.saveVault({ version: 2, taskId: id, taskName: id, createdAt: new Date().toISOString(), sourceFormat: "txt", mapping: { [`[[C001@${id}]]`]: id } });
  }, taskId);
  await Promise.all([save(pageA, "AAAA0001"), save(pageB, "BBBB0002")]);
  const loaded = await pageA.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    return Promise.all([store.loadVault("AAAA0001"), store.loadVault("BBBB0002")]);
  });
  expect(loaded.map((item) => item.taskId)).toEqual(["AAAA0001", "BBBB0002"]);
  await context.close();
});

test("CSV 文件选择、任务抽屉和失败关闭可用", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');

  await input.setInputFiles(path.resolve("tests/fixtures/01_标准销售数据_UTF8.csv"));
  await expect(page.getByText("确认需要替换的列")).toBeVisible();
  await page.getByRole("button", { name: /生成脱敏文件/ }).click();
  await expect(page.getByRole("heading", { name: "脱敏文件可以下载" })).toBeVisible();

  await page.getByRole("button", { name: "查看全部任务" }).click();
  const taskDialog = page.getByRole("dialog", { name: "本机任务" });
  await expect(taskDialog).toBeVisible();
  await taskDialog.getByRole("button", { name: "关闭本机任务" }).click();

  await page.getByRole("button", { name: "换一个文件" }).click();
  await expect(page.getByRole("heading", { name: "让文件安全进入 AI 工作流" })).toBeVisible();
  await expect(page.locator(".empty-state__title")).toContainText("待脱敏");
  await input.setInputFiles(path.resolve("tests/fixtures/05_异常_未闭合引号.csv"));
  await expect(page.getByRole("heading", { name: "无法安全读取这个 CSV" })).toBeVisible();
  await page.getByRole("button", { name: "查看技术详情" }).click();
  await expect(page.getByRole("dialog", { name: "技术详情" })).toBeVisible();
});

test("并发任务共用同一密钥，密钥丢失后失败关闭", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    const vault = (taskId) => ({
      version: 1,
      taskId,
      taskName: `任务 ${taskId}`,
      createdAt: new Date().toISOString(),
      mapping: { [`[[C001@${taskId}]]`]: { value: { type: "string", value: taskId } } },
    });
    await Promise.all([store.saveVault(vault("AAAA0001")), store.saveVault(vault("BBBB0002"))]);
    const loaded = await Promise.all([store.loadVault("AAAA0001"), store.loadVault("BBBB0002")]);
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("file-masking-assistant-v2-vault", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("settings", "readwrite");
      transaction.objectStore("settings").delete("device-aes-key");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    let missingKeyCode;
    try { await store.loadVault("AAAA0001"); } catch (error) { missingKeyCode = error.code; }
    return { loaded: loaded.map((item) => item.taskId), missingKeyCode };
  });

  expect(result.loaded).toEqual(["AAAA0001", "BBBB0002"]);
  expect(result.missingKeyCode).toBe("VAULT_KEY_MISSING");
});

test("损坏密文不会生成错误映射", async ({ page }) => {
  await page.goto("/");
  const code = await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    await store.saveVault({
      version: 1,
      taskId: "BROKEN01",
      taskName: "损坏测试",
      createdAt: new Date().toISOString(),
      mapping: { "[[C001@BROKEN01]]": { value: { type: "string", value: "真实名称" } } },
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("file-masking-assistant-v2-vault", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise((resolve, reject) => {
      const transaction = database.transaction("vaults", "readonly");
      const request = transaction.objectStore("vaults").get("BROKEN01");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    record.ciphertext = new Uint8Array([1, 2, 3]);
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("vaults", "readwrite");
      transaction.objectStore("vaults").put(record);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    try { await store.loadVault("BROKEN01"); } catch (error) { return error.code; }
    return null;
  });

  expect(code).toBe("VAULT_DECRYPT_FAILED");
});

test("本机存储不可用时不生成脱敏文件", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: { open() { throw new DOMException("blocked", "InvalidStateError"); } },
    });
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path.resolve("tests/fixtures/01_标准销售数据_UTF8.csv"));
  await expect(page.getByText("确认需要替换的列")).toBeVisible();
  await page.getByRole("button", { name: /生成脱敏文件/ }).click();
  await expect(page.getByRole("heading", { name: "当前浏览器无法使用本机映射存储" })).toBeVisible();
  await expect(page.getByText("没有生成输出文件")).toBeVisible();
});

test("部分还原使用警示语义且允许继续下载", async ({ page }) => {
  const assets = path.resolve("tests/output/validation-assets");
  const vault = JSON.parse(await fs.readFile(path.join(assets, "00_测试说明", "本机映射_仅测试_A14F2026.json"), "utf8"));
  await page.goto("/");
  await page.evaluate(async (entry) => {
    const store = await import("/src/vaultStore.js");
    await store.saveVault({ version: 1, createdAt: new Date().toISOString(), ...entry });
  }, vault);

  await page.getByRole("button", { name: "还原处理文件" }).click();
  await page.locator('input[type="file"]').setInputFiles(path.join(assets, "05_HTML样本", "异常_残缺代号_A14F2026.html"));
  const check = page.locator(".compatibility-check");
  await expect(check).toHaveAttribute("data-partial", "true");
  await expect(check.getByText("可以继续部分还原")).toBeVisible();

  await page.getByRole("button", { name: /生成还原文件/ }).click();
  const result = page.locator(".success-state");
  await expect(result).toHaveAttribute("data-partial", "true");
  await expect(page.getByRole("heading", { name: "部分还原文件可以下载" })).toBeVisible();
  await expect(page.getByText(/处被改写的代号未还原并原样保留/)).toBeVisible();
});

test("Markdown 可确认候选、手动补充并完成脱敏还原", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve("tests/fixtures/06_Markdown敏感内容.md"));
  await expect(page.getByText(/已选择 \d+ 项敏感内容/)).toBeVisible();
  await page.getByRole("button", { name: "查看并调整" }).click();
  const drawer = page.getByRole("dialog", { name: "安全详情" });
  await expect(drawer.getByRole("heading", { name: "需要替换的敏感内容" })).toBeVisible();
  await drawer.getByPlaceholder("粘贴文件中需要替换的完整文字").fill("Atlas-9");
  await drawer.getByRole("button", { name: "添加", exact: true }).click();
  await expect(drawer.getByText("Atlas-9", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭详情" }).click();

  await page.getByRole("button", { name: /生成脱敏文件/ }).click();
  const safeDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const safeDownload = await safeDownloadPromise;
  const safeBytes = await fs.readFile(await safeDownload.path());
  expect(safeBytes.toString("utf8")).toContain("[[");

  await page.getByRole("button", { name: "导入 AI 处理后的文件" }).click();
  await input.setInputFiles({ name: safeDownload.suggestedFilename(), mimeType: "text/markdown", buffer: safeBytes });
  await expect(page.getByText(/已识别 Markdown/)).toBeVisible();
  await page.getByRole("button", { name: /生成还原文件/ }).click();
  const restoredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载还原文件" }).click();
  const restoredDownload = await restoredDownloadPromise;
  const restoredText = (await fs.readFile(await restoredDownload.path())).toString("utf8");
  expect(restoredText).toContain("浙江ABC染整有限公司");
  expect(restoredText).toContain("Atlas-9");
  expect(restoredText).not.toContain("[[C001@");
});

test("DOCX 可确认候选并完成原格式脱敏还原", async ({ page }) => {
  const source = path.resolve("tests/output/validation-assets/04_DOCX样本/销售经营分析_原始版.docx");
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(source);
  await expect(page.getByText(/已选择 \d+ 项敏感内容/)).toBeVisible();
  await page.getByRole("button", { name: "查看并调整" }).click();
  const drawer = page.getByRole("dialog", { name: "安全详情" });
  await expect(drawer.getByText(/Word 首版处理正文/)).toBeVisible();
  await drawer.getByPlaceholder("粘贴文件中需要替换的完整文字").fill("ECO/Soft-X2.0");
  await drawer.getByRole("button", { name: "添加", exact: true }).click();
  await drawer.getByRole("button", { name: "关闭详情" }).click();

  await page.getByRole("button", { name: /生成脱敏文件/ }).click();
  const safeDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const safeDownload = await safeDownloadPromise;
  const safeBytes = await fs.readFile(await safeDownload.path());

  await page.getByRole("button", { name: "导入 AI 处理后的文件" }).click();
  await input.setInputFiles({ name: safeDownload.suggestedFilename(), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: safeBytes });
  await expect(page.getByText(/已识别 Word/)).toBeVisible();
  await page.getByRole("button", { name: /生成还原文件/ }).click();
  const restoredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载还原文件" }).click();
  const restoredDownload = await restoredDownloadPromise;
  const restoredZip = await JSZip.loadAsync(await fs.readFile(await restoredDownload.path()));
  const xml = await restoredZip.file("word/document.xml").async("string");
  expect(xml).toContain("浙江ABC染整有限公司");
  expect(xml).toContain("ECO/Soft-X2.0");
  expect(xml).not.toContain("[[");
});

test("真实值本身是 C001 时仍可完整还原", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve("tests/fixtures/07_真实短编码.csv"));
  await page.getByRole("button", { name: "查看并调整" }).click();
  const drawer = page.getByRole("dialog", { name: "安全详情" });
  await drawer.getByLabel(/B 列 · 备注/).check();
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("button", { name: /生成脱敏文件/ }).click();
  const safeDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const safeDownload = await safeDownloadPromise;
  const safeBytes = await fs.readFile(await safeDownload.path());

  await page.getByRole("button", { name: "导入 AI 处理后的文件" }).click();
  await input.setInputFiles({ name: safeDownload.suggestedFilename(), mimeType: "text/csv", buffer: safeBytes });
  await page.getByRole("button", { name: /生成还原文件/ }).click();
  await expect(page.getByRole("heading", { name: "还原文件可以下载" })).toBeVisible();
  const restoredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载还原文件" }).click();
  const restored = (await fs.readFile(await (await restoredDownloadPromise).path())).toString("utf8");
  expect(restored).toContain("C001");
  expect(restored).not.toContain("[[C001@");
});
