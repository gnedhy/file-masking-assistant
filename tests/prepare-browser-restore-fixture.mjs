import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { inspectWorkbookTokens } from "../src/xlsxCore.js";

const here = dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2];
const outputPath = resolve(here, "fixtures", "AI分析结果_功能测试.xlsx");
if (!inputPath) throw new Error("请传入脱敏文件路径");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(inputPath);
const inspection = inspectWorkbookTokens(workbook);
assert.equal(inspection.taskIds.length, 1, "脱敏文件必须只包含一个任务指纹");
assert.ok(inspection.occurrences.length > 0, "脱敏文件必须包含本工具代号");

const source = workbook.getWorksheet("销售明细");
assert.equal(source.getCell("D5").value.formula, "SUM(D2:D4)");
assert.equal(source.getCell("A2").font.bold, true);
assert.notEqual(source.getCell("A2").value, "浙江ABC染整");

const aiSheet = workbook.addWorksheet("AI分析");
aiSheet.getCell("A1").value = "AI 经营洞察";
aiSheet.getCell("A2").value = `客户 ${source.getCell("A2").value} 的销售贡献最高`;
aiSheet.getCell("A3").value = `建议由 ${source.getCell("C2").value} 持续跟进`;
aiSheet.getColumn(1).width = 48;

await mkdir(dirname(outputPath), { recursive: true });
await workbook.xlsx.writeFile(outputPath);
console.log(JSON.stringify({ outputPath, taskId: inspection.taskIds[0], tokenOccurrences: inspection.occurrences.length }));
