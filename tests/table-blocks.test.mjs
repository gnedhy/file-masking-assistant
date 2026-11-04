import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { analyzeWorkbook, detectTableBlocks, tokenizeWorkbook, restoreWorkbookValues } from "../src/xlsxCore.js";
import { customerProfileWorkbook } from "./fixtures/customer-profile-workbook.mjs";

const sheetOf = (rows, name = "表") => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name);
  rows.forEach((row, index) => { if (row) sheet.getRow(index + 1).values = row; });
  return { workbook, sheet };
};
const shape = blocks => blocks.map(({ headerRow, startColumn, endColumn, endRow }) => [headerRow, startColumn, endColumn, endRow]);

test("正常的单表：表头在第一行，数据到最后一行，结果和以前一致", () => {
  const { sheet } = sheetOf([["客户名称", "业务员", "数量"], ["甲公司", "张三", 1], ["乙公司", "李四", 2], ["丙公司", "王五", 3]]);
  assert.deepEqual(shape(detectTableBlocks(sheet)), [[1, 1, 3, 4]]);
});

test("上面是表单、下面是表格：只有下面的表格算表格，表单留给关键词", () => {
  const { sheet } = sheetOf([
    ["企业名称", "虚构星河化工有限公司", null, "法人", "张良源"],
    ["成立时间", "2008年", null, "地址", "虚构市虚构路 1 号"],
    null, null,
    ["序号", "客户名称", "业务员", "金额"],
    [1, "甲公司", "张三", 100],
    [2, "乙公司", "李四", 200],
  ]);
  assert.deepEqual(shape(detectTableBlocks(sheet)), [[5, 1, 4, 7]]);
});

test("上下两个表格，中间有标题行：各算一个，上面的表格在下一个表头前结束", () => {
  const { sheet } = sheetOf([
    ["客户名称", "业务员", "金额"], ["甲公司", "张三", 1], ["乙公司", "李四", 2],
    null, ["品种分析表"],
    ["产品名称", "数量", "单价"], ["防水剂", 10, 3], ["固色剂", 20, 4],
  ]);
  assert.deepEqual(shape(detectTableBlocks(sheet)), [[1, 1, 3, 3], [6, 1, 3, 8]]);
});

test("左右并排的三个小表格：每个表头各算一个表格，高度各自计算", () => {
  const { sheet } = sheetOf([
    ["配方一", "用量", "占比", null, "配方二", "用量", "占比", null, "配方三", "用量", "占比"],
    ["染料甲", 1, "10%", null, "染料丙", 3, "30%", null, "染料戊", 5, "50%"],
    ["染料乙", 2, "20%", null, "染料丁", 4, "40%", null, "染料己", 6, "60%"],
    [null, null, null, null, null, null, null, null, "染料庚", 7, "70%"],
  ]);
  assert.deepEqual(shape(detectTableBlocks(sheet)), [[1, 1, 3, 3], [1, 5, 7, 3], [1, 9, 11, 4]]);
});

test("只有一两行的小表格、和只有标签没有表头的表单，不会被当成表格", () => {
  const { sheet } = sheetOf([["姓名", "马立群"], ["联系人", "张振扬"], ["成立时间", "2008年", "法人", "张良源", "年产量", "63990万米"], null, null, null, null, ["股东人数", "2人", "占比", "张总"]]);
  assert.deepEqual(detectTableBlocks(sheet), []);
});

test("analyzeWorkbook：每个表格的列带着自己的起止行，其他区域不产生列", () => {
  const { workbook } = sheetOf([
    ["企业名称", "虚构星河化工有限公司"], null,
    ["序号", "客户名称", "业务员"], [1, "甲公司", "张三"], [2, "乙公司", "李四"],
  ]);
  const { columns } = analyzeWorkbook(workbook);
  assert.deepEqual(columns.map(column => [column.header, column.headerRow, column.endRow]), [["序号", 3, 5], ["客户名称", 3, 5], ["业务员", 3, 5]]);
});

test("只在表格范围内按列取值，表格以外按关键词沿用同一个代号；还原后与原文件逐格一致", async () => {
  const { workbook } = sheetOf([
    ["备注", "这里写着甲公司，不是表格内容"], null, null,
    ["序号", "客户名称", "业务员"], [1, "甲公司", "张三"], [2, "乙公司", "李四"],
  ]);
  const cellsOf = book => { const out = []; book.getWorksheet("表").eachRow(row => row.eachCell(cell => out.push(`${cell.address}=${cell.value}`))); return out; };
  const before = cellsOf(workbook);
  const { columns } = analyzeWorkbook(workbook);
  const selected = columns.filter(column => ["客户名称", "业务员"].includes(column.header)).map(column => ({ ...column, processingMode: "whole" }));
  const result = tokenizeWorkbook(workbook, selected, "A1B2C3D4");
  const sheet = workbook.getWorksheet("表");
  assert.notEqual(sheet.getCell("B5").value, "甲公司");
  // 表单区域不按列处理，但已确认的名称在整个文件里用同一个代号。
  assert.ok(!String(sheet.getCell("B1").value).includes("甲公司"));
  assert.equal(sheet.getCell("A4").value, "序号");
  restoreWorkbookValues(workbook, result.mapping);
  assert.deepEqual(cellsOf(workbook), before);
});

test("仿真的重点客户资料工作簿：表单工作表不再被当成一整张表，销售明细仍是表格", () => {
  const workbook = customerProfileWorkbook();
  const sheets = Object.fromEntries(workbook.worksheets.map(sheet => [sheet.name, shape(detectTableBlocks(sheet))]));
  assert.deepEqual(sheets["销售明细表"], [[1, 1, 6, 3]]);
  assert.deepEqual(sheets["重点客户资料表"], []);
});
