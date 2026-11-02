import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { chooseTheme } from "./theme-helper.js";

const source = "客户名称：虚构测试客户\n产品名称：TEST-826\n销售人员：测试人员";
const ALIAS = /^(客户|产品|人员)-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-01$/;
async function office(format, text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types><Override ContentType="application/vnd.openxmlformats-officedocument.${format === "docx" ? "wordprocessingml.document" : "presentationml.presentation"}.main+xml"/></Types>`);
  const parts = text.split("\n").map(value => format === "docx" ? `<w:p><w:r><w:t>${value.slice(0, 5)}</w:t></w:r><w:r><w:t>${value.slice(5)}</w:t></w:r></w:p>` : `<a:p><a:r><a:t>${value.slice(0, 5)}</a:t></a:r><a:r><a:t>${value.slice(5)}</a:t></a:r></a:p>`).join("");
  zip.file(format === "docx" ? "word/document.xml" : "ppt/slides/slide1.xml", format === "docx" ? `<w:document><w:body>${parts}</w:body></w:document>` : `<p:sld>${parts}</p:sld>`);
  return [...await zip.generateAsync({ type: "uint8array" })];
}

test("五种输入完整往返，PPTX/HTML 跨格式按编号自动还原", async ({ page }) => {
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
      const safe = await api.createSafeFile(file, selection);
      const safeFile = new File([safe.buffer], safe.outputName);
      const inspection = await api.inspectRestoreFile(safeFile);
      const restored = await api.restoreSafeFile(safeFile, inspection.taskId);
      const vault = await store.loadVault(safe.taskId);
      results.push({ format, count: restored.restoredOccurrences, aliases: Object.keys(vault.mapping), marker: safe.marker, keys: Object.keys(safe) });
    }
    return results;
  }, files);
  expect(results.map(item => item.count)).toEqual([3, 3, 3, 3, 3]);
  for (const item of results) {
    expect(item.aliases).toHaveLength(3);
    expect(item.aliases.every(alias => ALIAS.test(alias))).toBe(true);
    expect(item.keys).not.toContain("credential");
  }
  for (const format of ["pptx", "html"]) {
    const bytes = format === "pptx" ? await office("pptx", results[0].aliases.join("\n")) : [...Buffer.from(`<html><body>${results[0].aliases.map(alias => `<p>${alias}</p>`).join("")}</body></html>`)];
    const count = await page.evaluate(async ({ format, bytes }) => {
      const api = await import("/src/fileEngine.js");
      const file = new File([new Uint8Array(bytes)], `AI.${format}`);
      const inspection = await api.inspectRestoreFile(file);
      return (await api.restoreSafeFile(file, inspection.taskId)).restoredOccurrences;
    }, { format, bytes });
    expect(count).toBe(3);
  }
});

test("错误代号失败关闭，缺失和新增计数准确，删除后找不到记录", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const api = await import("/src/fileEngine.js");
    const store = await import("/src/vaultStore.js");
    const file = new File(["产品名称：虚构型号\n客户名称：虚构客户"], "样本.txt");
    const analysis = await api.inspectProtectionFile(file);
    const safe = await api.createSafeFile(file, analysis.candidates);
    const aliases = Object.keys((await store.loadVault(safe.taskId)).mapping);
    const inspect = text => api.inspectRestoreFile(new File([text], "结果.txt"));
    const code = async callback => { try { await callback(); return "passed"; } catch (error) { return error.code; } };
    const codes = [];
    codes.push(await code(() => inspect(aliases.join("\n"))));
    codes.push(await code(() => inspect(aliases[0].replace(/-01$/, "-99"))));
    codes.push(await code(() => inspect(`${aliases[0]}\n[[C001@12345678]]`)));
    codes.push(await code(() => inspect(`${aliases[0]}\n${aliases[1].toLowerCase()}`)));
    codes.push(await code(() => inspect("没有任何代号")));
    const counts = (await inspect(`${aliases[0]}\n${aliases[0]}`)).occurrenceComparison;
    await store.deleteVault(safe.taskId);
    codes.push(await code(() => inspect(aliases[0])));
    return { codes, counts };
  });
  expect(result.codes).toEqual(["passed", "UNRESOLVED_TOKENS", "MIXED_TASKS", "UNRESOLVED_TOKENS", "NO_TOKENS", "VAULT_NOT_FOUND"]);
  expect(result.counts).toMatchObject({ original: 2, returned: 2, missing: 1, added: 1 });
});

test("编号原子占用、删除不回收、随机碰撞上限与原文冲突", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  const concurrent = await Promise.all([page, other].map(tab => tab.evaluate(async () => (await import("/src/vaultStore.js")).reserveTaskMarker("K7M4", crypto.randomUUID()))));
  expect(concurrent.sort()).toEqual([false, true]);
  const result = await page.evaluate(async () => {
    const store = await import("/src/vaultStore.js");
    const { createProtectionIdentity } = await import("/src/taskIdentity.js");
    const abandoned = crypto.randomUUID();
    await store.reserveTaskMarker("2222", abandoned);
    const reuse = await store.reserveTaskMarker("2222", crypto.randomUUID());
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = bytes => bytes.fill(0);
    let failure;
    try { await createProtectionIdentity(); } catch (error) { failure = error.code; }
    let calls = 0;
    crypto.getRandomValues = bytes => bytes.length === 1 ? bytes.fill(calls++ < 4 ? 1 : 2) : original(bytes);
    let allocated;
    try { allocated = await createProtectionIdentity({}, "产品-3333-01"); } finally { crypto.getRandomValues = original; }
    const sourceReserved = !await store.reserveTaskMarker("3333", crypto.randomUUID());
    return { reuse, failure, marker: allocated.marker, sourceReserved };
  });
  expect(result).toEqual({ reuse: false, failure: "MARKER_ALLOCATION_FAILED", marker: "4444", sourceReserved: true });
});

test("界面生成后不需要钥匙文件，重新打开页面直接还原", async ({ page, context }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "试验.txt", mimeType: "text/plain", buffer: Buffer.from(source) });
  await expect(page.getByText("代号格式")).toHaveCount(0);
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible();
  await expect(page.getByText(/还原钥匙/)).toHaveCount(0);
  const safePromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件" }).click();
  const safe = await safePromise;
  await page.getByRole("button", { name: "复制 AI 处理说明" }).click();
  await expect(page.locator("textarea[readonly]")).toHaveValue(/产品-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-01/);
  const safePath = testInfo.outputPath("脱敏.txt");
  await safe.saveAs(safePath);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened.getByRole("button", { name: "还原处理文件" }).click();
  await reopened.locator('input[type="file"]').setInputFiles(safePath);
  await expect(reopened.locator(".restore-task-match")).toContainText("试验");
  await expect(reopened.getByRole("checkbox")).toHaveCount(0);
  for (const value of ["dark", "light"]) {
    await chooseTheme(reopened, value);
    await expect(reopened.locator("html")).toHaveAttribute("data-theme", value);
    await reopened.screenshot({ path: testInfo.outputPath(`还原确认-${value}.png`), fullPage: true });
  }
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reopened.getByRole("button", { name: "生成还原文件" }).click();
  await expect(reopened.getByRole("link", { name: "下载还原文件" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("七种还原格式对未知混合改写保持一致阻断，缺失和新增允许", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  const seed = await page.evaluate(async () => {
    const api = await import("/src/fileEngine.js");
    const store = await import("/src/vaultStore.js");
    const file = new File(["产品名称：试验型号\n客户名称：试验客户"], "seed.txt");
    const analysis = await api.inspectProtectionFile(file);
    const safe = await api.createSafeFile(file, analysis.candidates);
    return { aliases: Object.keys((await store.loadVault(safe.taskId)).mapping), marker: safe.marker };
  });
  const [first, second] = seed.aliases;
  const foreignMarker = seed.marker === "2222" ? "3333" : "2222";
  const variants = {
    unknown: [first, second.replace(/-01$/, "-99")],
    mixed: [first, second.replace(seed.marker, foreignMarker)],
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
  const results = await page.evaluate(async cases => {
    const api = await import("/src/fileEngine.js");
    const results = [];
    for (const item of cases) {
      const file = new File([new Uint8Array(item.bytes)], `AI.${item.format}`);
      try {
        const inspection = await api.inspectRestoreFile(file);
        const restored = await api.restoreSafeFile(file, inspection.taskId);
        results.push({ format: item.format, variant: item.variant, count: restored.restoredOccurrences, comparison: inspection.occurrenceComparison });
      } catch (error) { results.push({ format: item.format, variant: item.variant, error: error.code }); }
    }
    return results;
  }, cases);
  for (const result of results) {
    if (result.variant === "missing") expect(result).toMatchObject({ count: 1, comparison: { missing: 1, added: 0 } });
    else if (result.variant === "added") expect(result).toMatchObject({ count: 3, comparison: { missing: 0, added: 1 } });
    else expect(result.error, `${result.format}/${result.variant}`).toBeTruthy();
  }
});

test("其他同事的文件查不到记录；编号恰好相同时只会用本人记录还原", async ({ page, browser }) => {
  await page.goto("/");
  const isolated = await browser.newContext();
  try {
    const foreign = await isolated.newPage();
    await foreign.goto("/");
    const generate = async (tab, value, forceMarker) => tab.evaluate(async ({ value, forceMarker }) => {
      const api = await import("/src/fileEngine.js");
      const original = crypto.getRandomValues.bind(crypto);
      if (forceMarker) crypto.getRandomValues = bytes => bytes.length === 1 ? bytes.fill(0) : original(bytes);
      try {
        const file = new File([`产品名称：${value}`], "源文件.txt");
        const analysis = await api.inspectProtectionFile(file);
        const safe = await api.createSafeFile(file, analysis.candidates);
        return { text: new TextDecoder().decode(safe.buffer), taskId: safe.taskId };
      } finally { crypto.getRandomValues = original; }
    }, { value, forceMarker });
    const restore = text => page.evaluate(async text => {
      const api = await import("/src/fileEngine.js");
      try {
        const file = new File([text], "外来返回文件.txt");
        const inspection = await api.inspectRestoreFile(file);
        return new TextDecoder().decode((await api.restoreSafeFile(file, inspection.taskId)).buffer);
      } catch (error) { return error.code; }
    }, text);
    const stranger = await generate(foreign, "同事型号丙", false);
    expect(await restore(stranger.text)).toBe("VAULT_NOT_FOUND");
    const local = await generate(page, "本人型号甲", true);
    const other = await generate(foreign, "同事型号乙", true);
    expect(local.text).toBe(other.text);
    const restored = await restore(other.text);
    expect(restored).toContain("本人型号甲");
    expect(restored).not.toContain("同事型号乙");
  } finally { await isolated.close(); }
});
