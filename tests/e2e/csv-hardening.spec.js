import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

test("CSV 特殊字符的名称自动替换，短值残留不保存任务，调整后可往返且每操作仅读取一次", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const engine = await import("/src/fileEngine.js");
    const store = await import("/src/vaultStore.js");
    const core = await import("/src/csvCore.js");
    const results = [];
    for (const value of ["𠮷田产品", "产品🔒A", "李", "825"]) {
      const original = `产品名称,备注\n${value},采购${value}。`;
      const bytes = new TextEncoder().encode(original);
      let reads = 0;
      const file = { name: "合成数据.csv", size: bytes.length, type: "text/csv", arrayBuffer: async () => { reads++; return bytes.buffer; } };
      const before = (await store.listVaultSummaries()).length;
      const analysis = await engine.inspectProtectionFile(file);
      const inspectReads = reads;
      let code;
      try { await engine.createSafeFile(file, analysis.columns.slice(0, 1)); } catch (error) { code = error.code; }
      const afterFailure = (await store.listVaultSummaries()).length;
      reads = 0;
      const safe = await engine.createSafeFile(file, analysis.columns.map(column => ({ ...column, processingMode: "whole" })));
      const createReads = reads;
      const returned = new File([safe.buffer], "返回.csv", { type: "text/csv" });
      const inspection = await engine.inspectRestoreFile(returned);
      const restored = await engine.restoreSafeFile(returned, inspection.taskId);
      results.push({ value, code, noInvalidTask: before === afterFailure, inspectReads, createReads,
        correct: JSON.stringify(core.parseCsvText(new TextDecoder().decode(restored.buffer)).rows) === JSON.stringify(core.parseCsvText(original).rows) });
    }
    return results;
  });
  for (const row of result) {
    // A name written out in full is replaced in the note automatically; one character or three digits are not
    // (they could be anything), so the file stops there and no task is saved.
    const short = ["李", "825"].includes(row.value);
    expect(row.code, row.value).toBe(short ? "SENSITIVE_RESIDUALS" : undefined);
    if (short) expect(row.noInvalidTask, row.value).toBe(true);
    expect(row, row.value).toMatchObject({ inspectReads: 1, createReads: 1, correct: true });
  }
});

test("CSV 公式检查覆盖原输入与跨格式映射还原，失败不输出或新建任务", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const engine = await import("/src/fileEngine.js");
    const store = await import("/src/vaultStore.js");
    const file = text => new File([text], "公式.csv", { type: "text/csv" });
    const code = async action => { try { await action(); return "OUTPUT_CREATED"; } catch (error) { return error.code; } };
    const before = (await store.listVaultSummaries()).length;
    const raw = file("产品名称,备注\n产品甲,=1+1");
    const inspect = await code(() => engine.inspectProtectionFile(raw));
    const create = await code(() => engine.createSafeFile(raw, [{ header: "产品名称", headerRow: 1, columnNumber: 1, prefix: "P" }]));
    const noTask = before === (await store.listVaultSummaries()).length;
    const id = "ABCDEF12";
    const tokens = ["[[P001@ABCDEF12]]", "[[产品名称:P002@ABCDEF12]]"];
    await store.saveVault({ version: 2, taskId: id, taskName: "合成跨格式映射", createdAt: new Date().toISOString(), sourceFormat: "txt",
      mapping: Object.fromEntries(tokens.map(token => [token, { value: { type: "string", value: "=1+1" } }])) });
    const restored = [];
    for (const token of tokens) {
      const safe = file(`产品名称\n${token}`);
      restored.push(await code(() => engine.inspectRestoreFile(safe)), await code(() => engine.restoreSafeFile(safe, id)));
    }
    return { inspect, create, noTask, restored };
  });
  expect(result).toEqual({ inspect: "CSV_FORMULA_INJECTION", create: "CSV_FORMULA_INJECTION", noTask: true,
    restored: Array(4).fill("CSV_FORMULA_INJECTION") });
});

test("短名称残留时停止并指明位置，手动添加该名称后可下载并还原", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const input = page.locator('input[type="file"]:not([accept=".json"])');
  await input.setInputFiles({ name: "短名称.csv", mimeType: "text/csv", buffer: Buffer.from("销售人员,备注\n李,负责人：李") });
  await page.getByRole("button", { name: /生成脱敏文件/ }).click();
  await expect(page.getByRole("heading", { name: "还有真实名称没有替换掉" })).toBeVisible();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toHaveCount(0);
  await expect(page.locator(".error-issues li")).toHaveText(["第 2 行第 2 列"]);
  await page.getByRole("button", { name: "查看详细信息" }).click();
  const diagnosis = page.getByRole("dialog", { name: "详细信息" });
  await expect(diagnosis.getByText(/主要位于 第 2 行，第 2 列/)).toBeVisible();
  await expect(diagnosis.getByText(/名称太短时（例如只有 1 个字）/)).toBeVisible();
  await diagnosis.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("button", { name: "调整选择字段" }).click();
  const drawer = page.getByRole("dialog", { name: /替换列|替换内容|检查详情/ });
  // A name the tool will not guess in a sentence can be added by hand; it is then replaced everywhere.
  await drawer.getByPlaceholder("粘贴文件中需要替换的完整文字").fill("李");
  await drawer.getByPlaceholder("粘贴文件中需要替换的完整文字").press("Enter");
  await expect(drawer.getByRole("checkbox", { name: /^李/ })).toBeChecked();
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("button", { name: /生成脱敏文件/ }).click();
  const safeDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const safe = await fs.readFile(await (await safeDownload).path());
  expect(safe.toString("utf8")).not.toContain("李");
  await page.getByRole("button", { name: "导入 AI 处理后的文件" }).click();
  await input.setInputFiles({ name: "返回.csv", mimeType: "text/csv", buffer: safe });
  await page.getByRole("button", { name: /生成还原文件/ }).click();
  await expect(page.getByRole("heading", { name: "还原文件可以下载" })).toBeVisible();
  const restoredDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载还原文件" }).click();
  const restored = (await fs.readFile(await (await restoredDownload).path())).toString("utf8");
  expect(restored).toContain("李,负责人：李");
  expect(restored).not.toContain("[[");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("CSV 六千实体分析与往返性能样本", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const core = await import("/src/csvCore.js");
    const document = { delimiter: ",", newline: "\n", trailingNewline: false,
      rows: [["产品名称", "备注"], ...Array.from({ length: 6000 }, (_, i) => [`产品${String(i).padStart(6, "0")}型号`, "这是一段不引用已知产品的工作说明"])] };
    const start = performance.now();
    const analysis = core.analyzeCsv(document);
    const analysisMs = performance.now() - start;
    const original = core.stringifyCsv(document);
    const safe = core.tokenizeCsv(document, analysis.columns.map(c => ({ ...c, processingMode: c.recommendedMode })), "ABCDEF12");
    const residuals = core.findCsvSensitiveResiduals(document, safe.mapping);
    core.restoreCsvValues(document, safe.mapping);
    return { analysisMs, totalMs: performance.now() - start, residuals: residuals.length, equal: original === core.stringifyCsv(document) };
  });
  console.log("CSV 6000-row benchmark", JSON.stringify(result));
  expect(result).toMatchObject({ residuals: 0, equal: true });
  // Broad regression ceiling, not a mobile-device speed guarantee.
  expect(result.analysisMs).toBeLessThan(2000);
});
