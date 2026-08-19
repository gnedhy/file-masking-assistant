import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { inspectWorkbookTokens } from "../src/xlsxCore.js";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("请传入还原文件路径");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(outputPath);
const source = workbook.getWorksheet("销售明细");
const analysis = workbook.getWorksheet("AI分析");

assert.equal(source.getCell("A2").value, "浙江ABC染整");
assert.equal(source.getCell("B2").value, "HT-825GK");
assert.equal(source.getCell("C2").value, "张三");
assert.equal(source.getCell("E2").value, "SO-001");
assert.equal(source.getCell("D5").value.formula, "SUM(D2:D4)");
assert.equal(source.getCell("A2").font.bold, true);
assert.equal(analysis.getCell("A2").value, "客户 浙江ABC染整 的销售贡献最高");
assert.equal(analysis.getCell("A3").value, "建议由 张三 持续跟进");
assert.equal(workbook.getWorksheet("__AI安全任务"), undefined);
assert.equal(inspectWorkbookTokens(workbook).occurrences.length, 0);

console.log(JSON.stringify({ verified: true, outputPath, sheets: workbook.worksheets.map((sheet) => sheet.name) }));
