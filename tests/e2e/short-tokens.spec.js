import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import ExcelJS from "exceljs";

const source = "客户名称：虚构测试客户\n产品名称：TEST-826\n销售人员：测试人员";
async function office(format, text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types><Override ContentType="application/vnd.openxmlformats-officedocument.${format === "docx" ? "wordprocessingml.document" : "presentationml.presentation"}.main+xml"/></Types>`);
  const parts = text.split("\n").map(value => format === "docx" ? `<w:p><w:r><w:t>${value.slice(0, 5)}</w:t></w:r><w:r><w:t>${value.slice(5)}</w:t></w:r></w:p>` : `<a:p><a:r><a:t>${value.slice(0, 5)}</a:t></a:r><a:r><a:t>${value.slice(5)}</a:t></a:r></a:p>`).join("");
  zip.file(format === "docx" ? "word/document.xml" : "ppt/slides/slide1.xml", format === "docx" ? `<w:document><w:body>${parts}</w:body></w:document>` : `<p:sld>${parts}</p:sld>`);
  return [...await zip.generateAsync({ type: "uint8array" })];
}

test("五种输入完整往返及 PPTX/HTML 跨格式凭据还原", async ({ page }) => {
  await page.goto("/");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("样本").addRows([["客户名称", "产品名称", "销售人员"], ["虚构测试客户", "TEST-826", "测试人员"]]);
  const files = [
    { format: "csv", bytes: [...Buffer.from("客户名称,产品名称,销售人员\n虚构测试客户,TEST-826,测试人员")] },
    ...["txt", "md"].map(format => ({ format, bytes: [...Buffer.from(source)] })),
    { format: "docx", bytes: await office("docx", source) },
    { format: "xlsx", bytes: [...new Uint8Array(await workbook.xlsx.writeBuffer())] },
  ];
  const results = await page.evaluate(async files => {
    const api = await import("/src/fileEngine.js");
    const store = await import("/src/vaultStore.js");
    const results = [];
    for (const { format, bytes } of files) {
      const file = new File([new Uint8Array(bytes)], `原始.${format}`);
      const analysis = await api.inspectProtectionFile(file);
      const selection = analysis.kind === "text" ? analysis.candidates : analysis.columns.filter(column => analysis.suggestedColumnIds.includes(column.id));
      const safe = await api.createSafeFile(file, selection, { tokenFormat: "short" });
      const credential = JSON.parse(new TextDecoder().decode(safe.credential.buffer));
      const context = { credential, pairingConfirmed: true };
      const safeFile = new File([safe.buffer], safe.outputName);
      const inspection = await api.inspectRestoreFile(safeFile, context);
      const restored = await api.restoreSafeFile(safeFile, inspection.taskId, context);
      const vault = await store.loadVault(safe.taskId);
      results.push({ format, count: restored.restoredOccurrences, aliases: Object.keys(vault.mapping), marker: safe.marker, credential, restoredSize: restored.buffer.byteLength });
    }
    return results;
  }, files);
  expect(results.map(item => item.count)).toEqual([3, 3, 3, 3, 3]);
  for (const item of results) {
    expect(item.aliases).toHaveLength(3);
    expect(item.aliases.every(alias => /^(客户|产品|人员)-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-01$/.test(alias))).toBe(true);
    expect(Object.keys(item.credential).sort()).toEqual(["marker", "taskId", "verification", "version"]);
  }
  const item = results[0];
  for (const format of ["pptx", "html"]) {
    const bytes = format === "pptx" ? await office("pptx", item.aliases.join("\n")) : [...Buffer.from(`<html><body>${item.aliases.map(alias => `<p>${alias}</p>`).join("")}</body></html>`)];
    const count = await page.evaluate(async ({ format, bytes, credential }) => {
      const api = await import("/src/fileEngine.js");
      const file = new File([new Uint8Array(bytes)], `AI.${format}`);
      const context = { credential, pairingConfirmed: true };
      const inspection = await api.inspectRestoreFile(file, context);
      return (await api.restoreSafeFile(file, inspection.taskId, context)).restoredOccurrences;
    }, { format, bytes, credential: item.credential });
    expect(count).toBe(3);
  }
});

test("凭据和错误代号失败关闭，缺失和新增计数准确", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const api = await import("/src/fileEngine.js");
    const identity = await import("/src/taskIdentity.js");
    const store = await import("/src/vaultStore.js");
    const file = new File(["产品名称：虚构型号\n客户名称：虚构客户"], "样本.txt");
    const analysis = await api.inspectProtectionFile(file);
    const safe = await api.createSafeFile(file, analysis.candidates, { tokenFormat: "short" });
    const credential = JSON.parse(new TextDecoder().decode(safe.credential.buffer));
    const aliases = safe.aliases;
    const context = { credential, pairingConfirmed: true };
    const inspect = (text, ctx = context) => api.inspectRestoreFile(new File([text], "结果.txt"), ctx);
    const code = async callback => { try { await callback(); return "passed"; } catch (error) { return error.code; } };
    const codes = [];
    codes.push(await code(() => inspect(aliases.join("\n"), undefined)));
    codes.push(await code(() => api.inspectRestoreFile(new File([aliases[0]], "结果.txt"))));
    codes.push(await code(() => inspect(aliases[0], { credential: { ...credential, verification: "0".repeat(32) } })));
    codes.push(await code(() => inspect(aliases[0].replace(/-01$/, "-99"))));
    codes.push(await code(() => inspect(`${aliases[0]}\n[[C001@12345678]]`)));
    codes.push(await code(() => inspect(`${aliases[0]}\n${aliases[1].toLowerCase()}`)));
    codes.push(await code(() => api.restoreSafeFile(new File([aliases[0]], "结果.txt"), safe.taskId, { credential })));
    codes.push(await code(() => identity.readTaskCredential({ size: 16385, arrayBuffer() { throw new Error("must not read"); } })));
    codes.push(await code(() => identity.validateCredential({ ...credential, version: 0 })));
    codes.push(await code(() => inspect("没有任何代号")));
    const counts = (await inspect(`${aliases[0]}\n${aliases[0]}`)).occurrenceComparison;
    // A matching valid alias from another database is indistinguishable: document this boundary, not source authentication.
    const foreignSameAlias = await api.restoreSafeFile(new File([aliases[0]], "另一浏览器同名替身.txt"), safe.taskId, context);
    await store.deleteVault(safe.taskId);
    codes.push(await code(() => inspect(aliases[0])));
    return { codes, counts, riskRestored: foreignSameAlias.restoredOccurrences };
  });
  expect(result.codes).toEqual(["passed", "CREDENTIAL_REQUIRED", "CREDENTIAL_MISMATCH", "UNRESOLVED_TOKENS", "MIXED_TASKS", "UNRESOLVED_TOKENS", "PAIRING_REQUIRED", "INVALID_CREDENTIAL", "INVALID_CREDENTIAL", "NO_TOKENS", "VAULT_NOT_FOUND"]);
  expect(result.counts).toMatchObject({ original: 2, returned: 2, missing: 1, added: 1 });
  expect(result.riskRestored).toBe(1);
});

test("原子占用、删除不回收、随机碰撞上限与原文冲突", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  const concurrent = await Promise.all([page, other].map(tab => tab.evaluate(async () => (await import("/src/vaultStore.js")).reserveTaskMarker("K7M4", crypto.randomUUID()))));
  expect(concurrent.sort()).toEqual([false, true]);
  const result = await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    const { createProtectionIdentity } = await import("/src/taskIdentity.js");
    await store.reserveTaskMarker("2222", "failed-task");
    await store.deleteVault("failed-task");
    const reuse = await store.reserveTaskMarker("2222", "another-task");
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = bytes => bytes.fill(0);
    let failure;
    try { await createProtectionIdentity({ tokenFormat: "short" }); } catch (error) { failure = error.code; }
    let calls = 0;
    crypto.getRandomValues = bytes => bytes.length === 1 ? bytes.fill(calls++ < 4 ? 1 : 2) : original(bytes);
    let allocated;
    try { allocated = await createProtectionIdentity({ tokenFormat: "short" }, "产品-3333-01"); } finally { crypto.getRandomValues = original; }
    const sourceReserved = !await store.reserveTaskMarker("3333", "later");
    return { reuse, failure, marker: allocated.marker, sourceReserved };
  });
  expect(result).toEqual({ reuse: false, failure: "MARKER_ALLOCATION_FAILED", marker: "4444", sourceReserved: true });
});

test("简短模式界面下载、重新打开、导入凭据和确认还原", async ({ page, context }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.locator('input[type="file"]:not([accept=".json"])').setInputFiles({ name: "试验.txt", mimeType: "text/plain", buffer: Buffer.from(source) });
  await expect(page.getByRole("radio", { name: "标准代号（默认）", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "简短代号（试验）" }).check();
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  const receiptPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载还原钥匙文件" }).click();
  const receipt = await receiptPromise;
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible();
  const safePromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const safe = await safePromise;
  await expect(page.locator(".ai-handoff li").first()).not.toHaveAttribute("data-state", "done");
  await page.getByRole("button", { name: "复制 AI 处理说明" }).click();
  await expect(page.locator("textarea[readonly]")).toHaveValue(/产品-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-01/);
  const receiptPath = testInfo.outputPath("凭据.json"), safePath = testInfo.outputPath("脱敏.txt");
  await receipt.saveAs(receiptPath); await safe.saveAs(safePath);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened.getByRole("button", { name: "还原处理文件" }).click();
  await reopened.locator('input[type="file"]:not([accept=".json"])').setInputFiles(safePath);
  await expect(reopened.getByText("待导入还原钥匙文件", { exact: true })).toBeVisible();
  await reopened.getByLabel("选择还原钥匙文件", { exact: true }).setInputFiles(receiptPath);
  await expect(reopened.getByRole("button", { name: "生成还原文件" })).toBeDisabled();
  await reopened.getByRole("checkbox", { name: "我确认此文件与以上任务配套" }).check();
  for (const [value, name] of [["dark", "深色模式"], ["light", "浅色模式"]]) {
    const theme = reopened.getByRole("combobox", { name: "界面颜色模式" });
    if (await theme.isVisible()) await theme.selectOption(value);
    else await reopened.getByRole("button", { name }).click();
    await expect(reopened.locator("html")).toHaveAttribute("data-theme", value);
    await expect(reopened.getByRole("checkbox", { name: "我确认此文件与以上任务配套" })).toBeVisible();
    await reopened.screenshot({ path: testInfo.outputPath(`配对-${value}.png`), fullPage: true });
  }
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reopened.screenshot({ path: testInfo.outputPath("配对确认.png"), fullPage: true });
  await reopened.getByRole("button", { name: "生成还原文件" }).click();
  await expect(reopened.getByRole("link", { name: "下载还原文件" })).toBeVisible();
  await reopened.getByRole("button", { name: "查看全部任务" }).click();
  const redownload = reopened.waitForEvent("download");
  await reopened.getByRole("button", { name: "下载还原钥匙文件" }).click();
  expect((await redownload).suggestedFilename()).toMatch(/^还原钥匙_/);
  expect(errors).toEqual([]);
});

test("数据库增量升级保留旧密钥、密文和旧任务还原", async ({ page }) => {
  await page.goto("/favicon.svg");
  const result = await page.evaluate(async () => {
    const task = { taskId: "AABB2233", taskName: "升级前任务", createdAt: "2026-01-01T00:00:00Z", mapping: { "[[P001@AABB2233]]": { value: { type: "string", value: "原型号" } } } };
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(task)));
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("file-masking-assistant-v2-vault", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("settings"); request.result.createObjectStore("vaults", { keyPath: "taskId" }); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction(["settings", "vaults"], "readwrite");
      tx.objectStore("settings").put(key, "device-aes-key");
      tx.objectStore("vaults").put({ taskId: task.taskId, taskName: task.taskName, createdAt: task.createdAt, uniqueValues: 1, iv, ciphertext });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    database.close();
    const store = await import("/src/vaultStore.js");
    const api = await import("/src/fileEngine.js");
    const old = await store.loadVault(task.taskId);
    const file = new File(["[[P001@AABB2233]]"], "old.txt");
    const restored = await api.restoreSafeFile(file, task.taskId);
    const upgraded = await new Promise(resolve => { const request = indexedDB.open("file-masking-assistant-v2-vault"); request.onsuccess = () => resolve(request.result); });
    const record = await new Promise(resolve => { const request = upgraded.transaction("vaults").objectStore("vaults").get(task.taskId); request.onsuccess = () => resolve(request.result); });
    const version = upgraded.version; upgraded.close();
    await store.deleteVault(task.taskId);
    return { version, same: [...new Uint8Array(ciphertext)].join() === [...new Uint8Array(record.ciphertext)].join(), old, text: new TextDecoder().decode(restored.buffer), deleted: await store.loadVault(task.taskId) };
  });
  expect(result).toMatchObject({ version: 2, same: true, text: "原型号", deleted: null, old: { taskId: "AABB2233" } });
});

test("标记占用配额失败和生成失败不会保存无效映射", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    const identity = await import("/src/taskIdentity.js");
    const api = await import("/src/fileEngine.js");
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) { if (this.name === "markers") throw new DOMException("full", "QuotaExceededError"); return original.apply(this, args); };
    let quotaCode;
    try { await identity.createProtectionIdentity({ tokenFormat: "short" }); } catch (error) { quotaCode = error.code; }
    finally { IDBObjectStore.prototype.add = original; }
    const file = new File(["客户名称,备注\n测试客户,测试客户"], "残留.csv");
    const analysis = await api.inspectProtectionFile(file);
    let residualCode;
    try { await api.createSafeFile(file, [analysis.columns[0]], { tokenFormat: "short" }); } catch (error) { residualCode = error.code; }
    const db = await new Promise(resolve => { const request = indexedDB.open("file-masking-assistant-v2-vault"); request.onsuccess = () => resolve(request.result); });
    const markers = await new Promise(resolve => { const request = db.transaction("markers").objectStore("markers").count(); request.onsuccess = () => resolve(request.result); });
    db.close();
    return { quotaCode, residualCode, markers, tasks: (await store.listVaultSummaries()).length };
  });
  expect(result).toEqual({ quotaCode: "VAULT_QUOTA_EXCEEDED", residualCode: "SENSITIVE_RESIDUALS", markers: 1, tasks: 0 });
});

test("七种还原格式对未知混合改写保持一致阻断，缺失和新增允许", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  const seed = await page.evaluate(async () => {
    const api = await import("/src/fileEngine.js");
    const file = new File(["产品名称：试验型号\n客户名称：试验客户"], "seed.txt");
    const analysis = await api.inspectProtectionFile(file);
    const safe = await api.createSafeFile(file, analysis.candidates, { tokenFormat: "short" });
    return { aliases: safe.aliases, credential: JSON.parse(new TextDecoder().decode(safe.credential.buffer)), taskId: safe.taskId };
  });
  const [first, second] = seed.aliases;
  const foreignMarker = seed.credential.marker === "2222" ? "3333" : "2222";
  const variants = {
    unknown: [first, second.replace(/-01$/, "-99")],
    mixed: [first, second.replace(seed.credential.marker, foreignMarker)],
    legacy: [first, "[[C001@11223344]]"],
    altered: [first, second.replaceAll("-", "－")],
    missing: [first], added: [first, first, second], empty: ["普通文字"],
  };
  const cases = [];
  for (const format of ["xlsx", "csv", "txt", "md", "docx", "pptx", "html"]) {
    for (const [variant, lines] of Object.entries(variants)) {
      let bytes;
      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("结果").addRows(lines.map(value => [value]));
        bytes = [...new Uint8Array(await workbook.xlsx.writeBuffer())];
      } else if (format === "docx" || format === "pptx") bytes = await office(format, lines.join("\n"));
      else bytes = [...Buffer.from(format === "html" ? `<html><body>${lines.map(value => `<p>${value}</p>`).join("")}</body></html>` : lines.join("\n"))];
      cases.push({ format, variant, bytes });
    }
  }
  const results = await page.evaluate(async ({ cases, seed }) => {
    const api = await import("/src/fileEngine.js");
    const context = { credential: seed.credential, pairingConfirmed: true };
    const results = [];
    for (const item of cases) {
      const file = new File([new Uint8Array(item.bytes)], `AI.${item.format}`);
      try {
        const inspection = await api.inspectRestoreFile(file, context);
        const restored = await api.restoreSafeFile(file, inspection.taskId, context);
        results.push({ format: item.format, variant: item.variant, count: restored.restoredOccurrences, comparison: inspection.occurrenceComparison });
      } catch (error) { results.push({ format: item.format, variant: item.variant, error: error.code }); }
    }
    return results;
  }, { cases, seed });
  for (const result of results) {
    if (result.variant === "missing") expect(result).toMatchObject({ count: 1, comparison: { missing: 1, added: 0 } });
    else if (result.variant === "added") expect(result).toMatchObject({ count: 3, comparison: { missing: 0, added: 1 } });
    else expect(result.error, `${result.format}/${result.variant}`).toBeTruthy();
  }
});

test("两个独立浏览器库同名替身不能被凭据当成来源认证", async ({ page, browser }) => {
  await page.goto("/");
  const isolated = await browser.newContext();
  try {
    const foreign = await isolated.newPage();
    await foreign.goto("http://127.0.0.1:4174/");
    const generate = async (tab, value) => tab.evaluate(async value => {
      const api = await import("/src/fileEngine.js");
      const original = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = bytes => bytes.length === 1 ? bytes.fill(0) : original(bytes);
      try {
        const file = new File([`产品名称：${value}`], "源文件.txt");
        const analysis = await api.inspectProtectionFile(file);
        const safe = await api.createSafeFile(file, analysis.candidates, { tokenFormat: "short" });
        return { text: new TextDecoder().decode(safe.buffer), credential: JSON.parse(new TextDecoder().decode(safe.credential.buffer)), taskId: safe.taskId };
      } finally { crypto.getRandomValues = original; }
    }, value);
    const local = await generate(page, "本机试验型号甲");
    const other = await generate(foreign, "另一浏览器型号乙");
    expect(local.text).toBe(other.text);
    expect(local.taskId).not.toBe(other.taskId);
    const restored = await page.evaluate(async ({ local, other }) => {
      const api = await import("/src/fileEngine.js");
      const result = await api.restoreSafeFile(new File([other.text], "外来返回文件.txt"), local.taskId, { credential: local.credential, pairingConfirmed: true });
      return new TextDecoder().decode(result.buffer);
    }, { local, other });
    expect(restored).toContain("本机试验型号甲");
    expect(restored).not.toContain("另一浏览器型号乙");
  } finally { await isolated.close(); }
});
