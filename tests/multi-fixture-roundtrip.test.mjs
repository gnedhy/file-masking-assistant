import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import {
  addTaskMarker,
  analyzeWorkbook,
  inspectWorkbookTokens,
  removeTaskMarker,
  restoreWorkbookValues,
  tokenizeWorkbook,
} from "../src/xlsxCore.js";
import {
  analyzeCsv,
  inspectCsvTokens,
  parseCsvText,
  restoreCsvValues,
  stringifyCsv,
  tokenizeCsv,
} from "../src/csvCore.js";

const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function visibleCellValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return { date: value.toISOString() };
  if (value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }
  if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
    return { formula: value.formula ?? value.sharedFormula };
  }
  if (value && typeof value === "object" && "text" in value) return String(value.text ?? "");
  return value;
}

function workbookVisibleSnapshot(workbook) {
  const snapshot = {};
  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    const cells = {};
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells[cell.address] = visibleCellValue(cell.value);
      });
    });
    snapshot[worksheet.name] = cells;
  });
  return snapshot;
}

test("完整 XLSX 样本可完成脱敏、序列化和实名还原", async () => {
  const source = new ExcelJS.Workbook();
  await source.xlsx.readFile(path.join(fixtureDirectory, "00_完整销售数据.xlsx"));
  const baseline = workbookVisibleSnapshot(source);
  const analysis = analyzeWorkbook(source);
  const selectedHeaders = new Set([
    "业务员",
    "所属部门",
    "客户K码",
    "客户名称",
    "竞品厂家",
    "推荐产品\n对外名称",
    "推荐产品内编",
    "实验员",
    "业务员反馈\n（完成后未寄样原因）",
    "备注",
    "联系邮箱",
    "联系电话",
    "项目内部代号",
  ]);
  const selected = analysis.columns
    .filter((column) => column.sheetName === "销售测试数据" && selectedHeaders.has(column.header))
    .map((column) => ({ ...column, processingMode: column.recommendedMode }));

  assert.equal(selected.length, 13);
  const protectedResult = tokenizeWorkbook(source, selected, "7F2A9C4D");
  assert.equal(protectedResult.warnings.length, 0);
  // 163 in the selected columns plus 9 example values on the 测试说明 sheet, replaced workbook-wide.
  assert.equal(protectedResult.replacedCells, 172);
  assert.deepEqual(protectedResult.elsewhere.sheets, [{ sheet: "测试说明", cells: 9 }]);
  assert.equal(protectedResult.uniqueValues, 99);
  addTaskMarker(source, { taskId: "7F2A9C4D", taskName: "完整销售数据", createdAt: "2026-08-14T00:00:00.000Z" });

  const protectedWorkbook = new ExcelJS.Workbook();
  await protectedWorkbook.xlsx.load(await source.xlsx.writeBuffer());
  const inspection = inspectWorkbookTokens(protectedWorkbook);
  assert.deepEqual(inspection.taskIds, ["7F2A9C4D"]);
  // Two of those cells hold two names each, so 174 aliases in all.
  assert.equal(inspection.occurrences.length, 174);

  const restored = restoreWorkbookValues(protectedWorkbook, protectedResult.mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.equal(restored.restoredOccurrences, 174);
  removeTaskMarker(protectedWorkbook);

  const restoredWorkbook = new ExcelJS.Workbook();
  await restoredWorkbook.xlsx.load(await protectedWorkbook.xlsx.writeBuffer());
  assert.deepEqual(workbookVisibleSnapshot(restoredWorkbook), baseline);
  assert.equal(inspectWorkbookTokens(restoredWorkbook).occurrences.length, 0);
});

for (const fixtureName of [
  "01_标准销售数据_UTF8.csv",
  "02_中英文混合与特殊符号.csv",
  "03_分号分隔与前置说明.csv",
  "04_短编码与边界.csv",
]) {
  test(`${fixtureName} 可完成脱敏与还原`, async () => {
    const text = await fs.readFile(path.join(fixtureDirectory, fixtureName), "utf8");
    const document = parseCsvText(text);
    const baseline = structuredClone(document.rows);
    const analysis = analyzeCsv(document);
    const selected = analysis.columns.map((column) => ({ ...column, processingMode: column.recommendedMode }));
    assert.ok(selected.some((column) => column.processingMode === "whole"));

    const protectedResult = tokenizeCsv(document, selected, "7F2A9C4D");
    assert.equal(protectedResult.warnings.length, 0);
    assert.ok(protectedResult.replacedCells > 0);
    assert.ok(protectedResult.uniqueValues > 0);
    if (fixtureName === "04_短编码与边界.csv") assert.equal(protectedResult.replacedCells, 18);

    const protectedDocument = parseCsvText(stringifyCsv(document));
    const inspection = inspectCsvTokens(protectedDocument);
    assert.deepEqual(inspection.taskIds, ["7F2A9C4D"]);
    assert.ok(inspection.occurrences.length > 0);

    const restored = restoreCsvValues(protectedDocument, protectedResult.mapping);
    assert.equal(restored.unresolved.length, 0);
    assert.equal(restored.restoredOccurrences, inspection.occurrences.length);
    assert.deepEqual(protectedDocument.rows, baseline);
    assert.equal(inspectCsvTokens(protectedDocument).occurrences.length, 0);
  });
}

test("损坏 CSV 样本会停止处理", async () => {
  const text = await fs.readFile(path.join(fixtureDirectory, "05_异常_未闭合引号.csv"), "utf8");
  assert.throws(() => parseCsvText(text), /未闭合/);
});
