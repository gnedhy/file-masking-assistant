import { test, expect } from "@playwright/test";

const source = "客户名称：虚构星河测试公司\n产品名称：DEMO-826\n销售人员：测试人员甲";
const input = page => page.locator('input[type="file"]:not([accept=".json"])');
const upload = page => input(page).setInputFiles({ name: "虚构测试.txt", mimeType: "text/plain", buffer: Buffer.from(source) });
const summaries = page => page.evaluate(async () => (await import("/src/vaultStore.js")).listVaultSummaries());
const switchToRestore = page => page.getByRole("button", { name: /^还原处理文件/ }).click();
const confirmSwitch = page => page.getByRole("alertdialog", { name: "切换任务？" }).getByRole("button", { name: "切换并清空" }).click();

test("当前模式不重置，切换取消保留选择并返回实际焦点", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await upload(page);
  await page.getByRole("radio", { name: "简短代号（试验）" }).check();
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
  await expect(page.getByRole("radio", { name: "简短代号（试验）" })).toBeChecked();
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
  await expect(page.getByLabel("选择凭据文件")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("未交付任务清理，下载过凭据的任务切换后保留", async ({ page }) => {
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
  await page.getByRole("radio", { name: "简短代号（试验）" }).check();
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  const receipt = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载还原凭据" }).click();
  await receipt;
  const original = await summaries(page);
  expect(original).toHaveLength(1);
  const credentialRecord = await page.evaluate(async () => (await (await import("/src/operationLog.js")).listOperations()).find(r => r.action === "download_credential"));
  expect(credentialRecord.marker).toBe(original[0].marker);
  await switchToRestore(page);
  await confirmSwitch(page);
  await expect(page.getByRole("heading", { name: "把处理结果恢复为实名文件" })).toBeVisible();
  expect(await summaries(page)).toEqual(original);
});

test("同编号并发只能新增一次，重复保存不改变密钥和旧密文", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  const save = (tab, value) => tab.evaluate(async value => {
    const store = await import("/src/vaultStore.js");
    try { await store.saveVault({ taskId: "ABCDEF12", taskName: value, createdAt: "2026-01-01", mapping: { "[[P001@ABCDEF12]]": value } }); return "saved"; }
    catch (error) { return error.code; }
  }, value);
  expect((await Promise.all([save(page, "虚构甲"), save(other, "虚构乙")])).sort()).toEqual(["VAULT_TASK_EXISTS", "saved"]);
  const result = await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    const snapshot = async () => {
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open("file-masking-assistant-v2-vault"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const record = await new Promise((resolve, reject) => { const req = db.transaction("vaults").objectStore("vaults").get("ABCDEF12"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      db.close();
      return [...new Uint8Array(record.ciphertext)];
    };
    const before = await snapshot();
    const loaded = await store.loadVault("ABCDEF12");
    let code;
    try { await store.saveVault({ ...loaded, mapping: { "[[P001@ABCDEF12]]": "不得覆盖" } }); } catch (error) { code = error.code; }
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = () => { throw new Error("摘要不能批量读取全部密文"); };
    let rows;
    try { rows = await store.listVaultSummaries(); } finally { IDBObjectStore.prototype.getAll = getAll; }
    return { code, ciphertextSame: JSON.stringify(before) === JSON.stringify(await snapshot()), valueSame: JSON.stringify(loaded) === JSON.stringify(await store.loadVault("ABCDEF12")), rows };
  });
  expect(result).toMatchObject({ code: "VAULT_TASK_EXISTS", ciphertextSame: true, valueSame: true });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).not.toHaveProperty("ciphertext");
});

test("生成撞号时无下载且旧任务可还原，调整后可重新生成", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    await store.saveVault({ taskId: "00000000", taskName: "保留旧任务", createdAt: "2026-01-01", mapping: { "[[P001@00000000]]": { value: { type: "string", value: "虚构旧产品" } } } });
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = bytes => bytes.length === 4 ? bytes.fill(0) : random(bytes);
  });
  await upload(page);
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("heading", { name: "任务编号已存在" })).toBeVisible();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toHaveCount(0);
  expect(await summaries(page)).toHaveLength(1);
  const restored = await page.evaluate(async () => {
    const api = await import("/src/fileEngine.js");
    return new TextDecoder().decode((await api.restoreSafeFile(new File(["[[P001@00000000]]"], "旧.txt"), "00000000")).buffer);
  });
  expect(restored).toBe("虚构旧产品");
  await page.getByRole("button", { name: "调整选择字段" }).click();
  await page.getByRole("dialog", { name: "替换内容" }).getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("radio", { name: "简短代号（试验）" }).check();
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible();
  expect(await summaries(page)).toHaveLength(2);
});

test("跨标签页通知只含变更标记，任务摘要自动更新", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "查看存储状态" })).toBeVisible();
  await page.evaluate(() => {
    window.testMessages = [];
    window.testChannel = new BroadcastChannel("file-masking-assistant-v2-vault");
    window.testChannel.onmessage = event => window.testMessages.push(event.data);
  });
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(async () => (await import("/src/vaultStore.js")).saveVault({ taskId: "BBBB2222", taskName: "另页虚构任务", createdAt: new Date().toISOString(), mapping: { a: "不应广播的真实值" } }));
  await expect(page.locator(".local-task-panel")).toContainText("另页虚构任务");
  await page.getByRole("button", { name: "查看全部任务" }).click();
  const drawer = page.getByRole("dialog", { name: "本机任务", exact: true });
  await expect(drawer.getByText("映射已保存", { exact: true })).toBeVisible();
  await other.evaluate(async () => (await import("/src/vaultStore.js")).deleteVault("BBBB2222"));
  await expect(drawer.getByText("0 个还原任务 · 0 条映射")).toBeVisible();
  expect(await page.evaluate(() => window.testMessages)).toEqual(["changed", "changed"]);
});

test("无广播时打开抽屉与恢复焦点均刷新，不把密钥丢失称为映射可用", async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "查看存储状态" })).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(async () => {
    await (await import("/src/vaultStore.js")).saveVault({ taskId: "BBBB2222", taskName: "摘要仍在", createdAt: new Date().toISOString(), mapping: { "[[P001@BBBB2222]]": { value: { type: "string", value: "虚构产品" } } } });
    const req = indexedDB.open("file-masking-assistant-v2-vault");
    const db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    await new Promise((resolve, reject) => { const tx = db.transaction("settings", "readwrite"); tx.objectStore("settings").delete("device-aes-key"); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.getByRole("button", { name: "查看存储状态" }).click();
  const drawer = page.getByRole("dialog", { name: "本机任务", exact: true });
  await expect(drawer.getByText("摘要仍在", { exact: true })).toBeVisible();
  await expect(drawer.getByText("映射已保存", { exact: true })).toBeVisible();
  await expect(drawer.getByText("映射可用", { exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "关闭本机任务" }).click();
  await other.evaluate(async () => (await import("/src/vaultStore.js")).deleteVault("BBBB2222"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".local-task-panel")).toContainText("还没有可继续的任务");
});

test("凭据错误可原地恢复，完整编号可复制，实名结果有回传警告", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => localStorage.setItem("testCopiedId", text) } }));
  await page.goto("/");
  const fixture = await page.evaluate(async () => {
    const api = await import("/src/fileEngine.js");
    const file = new File(["产品名称：虚构型号"], "原.txt");
    const analysis = await api.inspectProtectionFile(file);
    const result = await api.createSafeFile(file, analysis.candidates, { tokenFormat: "short" });
    return { text: new TextDecoder().decode(result.buffer), receipt: new TextDecoder().decode(result.credential.buffer), taskId: result.taskId, marker: result.marker };
  });
  await switchToRestore(page);
  await input(page).setInputFiles({ name: "AI返回.txt", mimeType: "text/plain", buffer: Buffer.from(fixture.text) });
  await expect(page.getByText("待导入凭据", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择凭据文件", exact: true })).toBeVisible();
  const credentialInput = page.getByLabel("选择凭据文件", { exact: true });
  await credentialInput.setInputFiles({ name: "损坏.json", mimeType: "application/json", buffer: Buffer.from("bad") });
  await expect(page.getByRole("alert")).toContainText("无法读取还原凭据");
  await expect(page.getByText("AI返回.txt", { exact: true })).toBeVisible();
  await credentialInput.setInputFiles({ name: "正确.json", mimeType: "application/json", buffer: Buffer.from(fixture.receipt) });
  await expect(page.getByRole("button", { name: "生成还原文件" })).toBeDisabled();
  await expect(page.getByText(/Markdown/)).toHaveCount(0);
  await page.getByRole("button", { name: "还原处理文件", exact: false }).first().click();
  await expect(page.getByRole("checkbox", { name: "我确认此文件与以上任务配套" })).toBeVisible();
  await page.getByRole("checkbox", { name: "我确认此文件与以上任务配套" }).check();
  await page.getByRole("button", { name: "生成还原文件" }).click();
  await expect(page.getByText("包含真实信息，请勿再次交给外部 AI。", { exact: true })).toBeVisible();
  await expect(page.locator(".output-file")).toContainText(`任务 ${fixture.marker}`);
  await expect(page.getByText("当前支持范围内的检查通过", { exact: true })).toBeVisible();
  await expect(page.getByText(/外部请求/)).toHaveCount(0);
  await page.getByRole("button", { name: "查看全部任务" }).click();
  const drawer = page.getByRole("dialog", { name: "本机任务", exact: true });
  await expect(drawer.getByText(fixture.marker, { exact: true })).toBeVisible();
  await drawer.getByText("完整任务编号", { exact: true }).click();
  await drawer.getByRole("button", { name: "复制任务编号" }).click();
  await expect(drawer.getByText("任务编号已复制", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("testCopiedId"))).toBe(fixture.taskId);
  for (const [value, label] of [["dark", "深色模式"], ["light", "浅色模式"], ["system", "系统模式"]]) {
    await drawer.getByRole("button", { name: "关闭本机任务" }).click();
    const select = page.getByRole("combobox", { name: "界面颜色模式" });
    if (await select.isVisible()) await select.selectOption(value); else await page.getByRole("button", { name: label }).click();
    await page.getByRole("button", { name: "查看全部任务" }).click();
    await expect(drawer).toBeVisible();
    const persistenceButton = drawer.locator(".storage-status .secondary-button");
    if (await persistenceButton.isVisible() && !testInfo.project.name.startsWith("mobile")) await persistenceButton.hover();
    if (await persistenceButton.isVisible()) await expect.poll(() => persistenceButton.evaluate(element => {
      const styles = getComputedStyle(element);
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => { const v = channel / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i], 0);
      const foreground = luminance(styles.color), background = luminance(styles.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    })).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`本机任务-${value}.png`), fullPage: true });
  }
});
