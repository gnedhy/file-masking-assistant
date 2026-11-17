import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import { openMoreColumns } from "./drawer-helper.js";

const ASSETS = "tests/output/validation-assets";
// Restored files must contain neither the new short tokens nor the older bracket tokens.
const TOKEN = /\[\[[^\]]*@[A-F0-9]{8}\]\]|(客户|产品|人员|信息)-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-\d{2,}/;
const FULL_WORKBOOK = "tests/fixtures/00_完整销售数据.xlsx";
const PHONE_CSV = "tests/fixtures/02_中英文混合与特殊符号.csv";

const CASES = [
  { format: "xlsx", file: FULL_WORKBOOK },
  { format: "xlsx", file: "tests/fixtures/销售明细_功能测试.xlsx" },
  { format: "csv", file: "tests/fixtures/01_标准销售数据_UTF8.csv" },
  { format: "csv", file: PHONE_CSV, without: (text) => text.replace(/,\+86-/g, ",86-") },
  { format: "csv", file: "tests/fixtures/03_分号分隔与前置说明.csv" },
  { format: "txt", file: "tests/fixtures/08_简短替身虚构样本.txt" },
  { format: "txt", file: `${ASSETS}/08_文本样本/业务跟进_原始版.txt` },
  { format: "md", file: "tests/fixtures/06_Markdown敏感内容.md" },
  { format: "md", file: `${ASSETS}/08_文本样本/客户分析_原始版.md` },
  { format: "docx", file: `${ASSETS}/04_DOCX样本/销售经营分析_原始版.docx` },
];

const fileInput = (page) => page.locator('input[type="file"]:not([accept=".json"])');
const withoutBom = (bytes) => (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);

function csvRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === ";") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value.richText) return value.richText.map((part) => part.text).join("");
  if (value.formula || value.sharedFormula) return `=${value.formula ?? value.sharedFormula}`;
  if (value.text) return String(value.text);
  return JSON.stringify(value);
}

async function workbookCells(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const cells = {};
  workbook.eachSheet((sheet) => {
    if (sheet.name === "__AI安全任务") return;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      cells[`${sheet.name}!${rowNumber}:${columnNumber}`] = cellText(cell.value);
    }));
  });
  return cells;
}

async function docxParagraphs(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = {};
  for (const name of Object.keys(zip.files).filter((entry) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(entry)).sort()) {
    const xml = await zip.file(name).async("string");
    parts[name] = xml.split("</w:p>").map((paragraph) => [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(""));
  }
  return parts;
}

async function comparable(format, bytes) {
  if (format === "xlsx") return workbookCells(bytes);
  if (format === "docx") return docxParagraphs(bytes);
  const text = withoutBom(bytes).toString("utf8");
  return format === "csv" ? csvRows(text) : text;
}

async function visibleText(format, bytes) {
  if (format === "xlsx") return Object.values(await workbookCells(bytes)).join("\n");
  if (format === "docx") return Object.values(await docxParagraphs(bytes)).flat().join("\n");
  return withoutBom(bytes).toString("utf8");
}

async function download(page, name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name, exact: true }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), buffer: await fs.readFile(await file.path()) };
}

for (const { format, file, without } of CASES) {
  {
    test(`${format.toUpperCase()} 往返：${path.basename(file)}`, async ({ page, browserName }, testInfo) => {
      test.skip(testInfo.project.name === "mobile-chromium", "格式往返不依赖视口");
      test.skip(browserName !== "chromium" && file !== CASES.find((item) => item.format === format).file, "其他浏览器每种格式只跑一个样本");
      test.setTimeout(120000);

      const source = await fs.readFile(file);
      const original = without ? Buffer.from(without(source.toString("utf8"))) : source;
      await page.goto("/");
      await fileInput(page).setInputFiles({ name: path.basename(file), mimeType: "application/octet-stream", buffer: original });
      const generate = page.getByRole("button", { name: "生成脱敏文件" });
      await expect(generate).toBeVisible({ timeout: 20000 });
      await generate.click();
      await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible({ timeout: 30000 });

      const masked = await download(page, "下载脱敏文件");
      const values = await page.evaluate(async () => {
        const store = await import("/src/vaultStore.js");
        const [summary] = await store.listVaultSummaries();
        return Object.values((await store.loadVault(summary.taskId)).mapping).map((entry) => String(entry.value?.value ?? entry.value ?? ""));
      });
      const maskedText = await visibleText(format, masked.buffer);
      expect(values.filter((value) => value.length >= 2 && maskedText.includes(value))).toEqual([]);

      await page.getByRole("button", { name: /导入 AI 处理后的文件/ }).click();
      await expect(page.getByRole("heading", { name: "把处理结果恢复为实名文件" })).toBeVisible();
      await fileInput(page).setInputFiles({ name: masked.name, mimeType: "application/octet-stream", buffer: masked.buffer });
      await expect(page.locator(".restore-task-match")).toBeVisible();
      await page.getByRole("button", { name: "生成还原文件" }).click();
      await expect(page.getByRole("link", { name: "下载还原文件" })).toBeVisible({ timeout: 30000 });
      const restored = await download(page, "下载还原文件");

      expect(await comparable(format, restored.buffer)).toEqual(await comparable(format, original));
      expect(await visibleText(format, restored.buffer)).not.toMatch(TOKEN);
    });
  }
}

for (const { format, file } of [
  { format: "pptx", file: `${ASSETS}/03_PPTX样本/销售经营分析_代号版_A14F2026.pptx` },
  { format: "html", file: `${ASSETS}/05_HTML样本/销售经营分析_Swiss代号版_A14F2026.html` },
]) {
  test(`${format.toUpperCase()} 仅还原：恢复全部真实值`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "格式往返不依赖视口");
    const vault = JSON.parse(await fs.readFile(`${ASSETS}/00_测试说明/本机映射_仅测试_A14F2026.json`, "utf8"));
    await page.goto("/");
    await page.evaluate(async (entry) => (await import("/src/vaultStore.js")).saveVault({ version: 2, sourceFormat: "html", createdAt: new Date().toISOString(), ...entry }), vault);
    await page.getByRole("button", { name: /^还原处理文件/ }).click();
    await fileInput(page).setInputFiles(file);
    await page.getByRole("button", { name: "生成还原文件" }).click();
    await expect(page.getByRole("link", { name: "下载还原文件" })).toBeVisible({ timeout: 30000 });
    const restored = await download(page, "下载还原文件");
    let text = restored.buffer.toString("utf8");
    // The Swiss page keeps its inline script, so the restored page sits in a sandboxed frame's srcdoc.
    const srcdoc = text.match(/<iframe sandbox="allow-scripts"[^>]*srcdoc="([^"]*)"/)?.[1];
    if (srcdoc) text = srcdoc.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    if (format === "pptx") {
      const zip = await JSZip.loadAsync(restored.buffer);
      const slides = Object.keys(zip.files).filter((name) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(name));
      text = (await Promise.all(slides.map((name) => zip.file(name).async("string")))).join("\n");
    }
    const expected = Object.values(vault.mapping).map((entry) => String(entry.value?.value ?? "")).filter(Boolean);
    expect(expected.filter((value) => !text.includes(value) && !text.includes(value.replace(/&/g, "&amp;")))).toEqual([]);
    expect(text).not.toMatch(TOKEN);
  });
}

// The selected columns define the names; the same names on other sheets and in narrative columns are replaced
// too, so the default selection goes straight through and the result says where else names were replaced.
test("XLSX 默认勾选即可完成，所选列以外相同的名称也一并替换并说明位置", async ({ page }) => {
  await page.goto("/");
  await fileInput(page).setInputFiles(FULL_WORKBOOK);
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible({ timeout: 30000 });
  // The example sheet and the unselected narrative columns (备注, 业务员反馈) on the data sheet.
  await expect(page.locator(".state-description")).toContainText(/除了所选的列，还在「测试说明」「销售测试数据」 2 个工作表里替换了 \d+ 处相同的名称/);
  await page.getByRole("button", { name: "查看检查详情" }).click();
  await expect(page.getByRole("dialog", { name: "检查详情" })).toContainText(/所选列以外\s*测试说明 \d+ 处、销售测试数据 \d+ 处/);
});

test("CSV 没勾选的列里的名称自动替换；短值不自动替换，停下并指明位置", async ({ page }) => {
  await page.goto("/");
  await fileInput(page).setInputFiles({ name: "残留.csv", mimeType: "text/csv", buffer: Buffer.from("客户名称,跟进记录\n星河科技,已联系星河科技\n") });
  await page.getByRole("button", { name: "生成脱敏文件" }).waitFor();
  await page.getByRole("button", { name: /确认替换内容/ }).click();
  const drawer = page.getByRole("dialog");
  await openMoreColumns(drawer);
  const notes = drawer.getByRole("checkbox", { name: /跟进记录/ });
  if (await notes.isChecked()) await notes.uncheck();
  await drawer.getByLabel("关闭详情").click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible();
  await expect(page.locator(".state-description")).toContainText("除了所选的列，还在「跟进记录」列里替换了 1 处相同的名称");

  await page.goto("/");
  await fileInput(page).setInputFiles({ name: "短值.csv", mimeType: "text/csv", buffer: Buffer.from("客户名称,跟进记录\n李,联系了李\n") });
  await page.getByRole("button", { name: "生成脱敏文件" }).waitFor();
  await page.getByRole("button", { name: /确认替换内容/ }).click();
  await openMoreColumns(drawer);
  const shortNotes = drawer.getByRole("checkbox", { name: /跟进记录/ });
  if (await shortNotes.isChecked()) await shortNotes.uncheck();
  await drawer.getByLabel("关闭详情").click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("heading", { name: "还有真实名称没有替换掉" })).toBeVisible();
  await expect(page.locator(".error-issues li")).toHaveText(["第 2 行第 2 列"]);
  await expect(page.getByRole("button", { name: /并重新生成$/ })).toHaveCount(0);
});

test("CSV 公式型字段指明行列和内容，且不生成输出", async ({ page }) => {
  await page.goto("/");
  await fileInput(page).setInputFiles(PHONE_CSV);
  await expect(page.getByRole("heading", { name: "有些格子会被 Excel 当成公式" })).toBeVisible();
  await expect(page.locator(".error-issues li").first()).toContainText(/第 \d+ 行 · .+：\+86-/);
  await expect(page.getByRole("button", { name: "生成脱敏文件" })).toHaveCount(0);
});

for (const [label, name, buffer] of [
  ["PDF", "资料.pdf", "%PDF-1.4"],
  ["XLS 旧格式", "旧表格.xls", "fake"],
  ["DOC 旧格式", "旧文档.doc", "fake"],
  ["PPTX 作脱敏输入", "演示.pptx", "fake"],
  ["损坏的 XLSX", "损坏.xlsx", "not a zip"],
]) {
  test(`拦截 ${label}`, async ({ page }) => {
    await page.goto("/");
    await fileInput(page).setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(buffer) });
    await expect(page.locator(".error-state")).toBeVisible();
    await expect(page.getByRole("link", { name: /^下载(脱敏|还原)文件$/ })).toHaveCount(0);
  });
}
