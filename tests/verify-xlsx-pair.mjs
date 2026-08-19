import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { inspectWorkbookTokens } from "../src/xlsxCore.js";

const [sourcePath, restoredPath] = process.argv.slice(2);
if (!sourcePath || !restoredPath) throw new Error("用法：node tests/verify-xlsx-pair.mjs <源文件> <还原文件>");

function visibleValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return { date: value.toISOString() };
  if (value && Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("");
  if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
    return { formula: value.formula ?? value.sharedFormula };
  }
  if (value && typeof value === "object" && "text" in value) return String(value.text ?? "");
  return value;
}

function snapshot(workbook) {
  const result = {};
  workbook.eachSheet((worksheet) => {
    if (worksheet.name === "__AI安全任务") return;
    const cells = {};
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells[cell.address] = visibleValue(cell.value);
      });
    });
    result[worksheet.name] = cells;
  });
  return result;
}

const source = new ExcelJS.Workbook();
const restored = new ExcelJS.Workbook();
await source.xlsx.readFile(sourcePath);
await restored.xlsx.readFile(restoredPath);

assert.deepEqual(snapshot(restored), snapshot(source));
assert.equal(inspectWorkbookTokens(restored).occurrences.length, 0);
assert.equal(restored.getWorksheet("销售测试数据").getCell("T4").value.formula, source.getWorksheet("销售测试数据").getCell("T4").value.formula);
assert.equal(restored.getWorksheet("销售测试数据").getColumn(6).width, source.getWorksheet("销售测试数据").getColumn(6).width);

console.log(JSON.stringify({
  sheets: restored.worksheets.map((sheet) => sheet.name),
  remainingTokens: 0,
  visibleContentMatches: true,
  formulasMatch: true,
  representativeColumnWidthMatches: true,
}));
