import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { addManualCandidate } from "../src/textCore.js";
import { analyzeWorkbook, restoreWorkbookValues, tokenizeWorkbook } from "../src/xlsxCore.js";
import { findWorkbookCandidates } from "../src/workbookCandidates.js";
import { assertNoAttachmentsInXlsxPackage, assertNoSensitiveValuesInXlsxPackage, preflightXlsxPackage } from "../src/xlsxPackageCore.js";
import { customerProfileBytes, PROFILE_NAMES as N } from "./fixtures/customer-profile-workbook.mjs";

// Form-style workbooks (a 重点客户资料表 with label/value rows, an org chart, a quote) keep their names outside
// table columns. The tool lists them for confirmation and replaces them across the whole file.
async function load() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await customerProfileBytes());
  return workbook;
}

const cellTexts = workbook => {
  const cells = {};
  workbook.eachSheet(sheet => { if (sheet.name === "__AI安全任务") return; sheet.eachRow(row => row.eachCell(cell => { if (!(cell.isMerged && cell.master !== cell)) cells[`${sheet.name}!${cell.address}`] = JSON.stringify(cell.value); })); });
  return cells;
};

test("表单式工作簿：从标签、“标签：值”和公司名里找出候选名称，不收表头词和产品类别", async () => {
  const { candidates } = findWorkbookCandidates(await load());
  const values = candidates.map(item => item.value);
  for (const name of [N.customer, N.partner, N.trader, N.supplier, N.legal, N.boss, N.manager, N.sales, "马总"]) assert.ok(values.includes(name), name);
  for (const noise of ["职位", "部门", "数量", "防水剂", "业务员", "姓名"]) assert.ok(!values.includes(noise), noise);
  assert.ok(!values.some(value => /^以|（|-中间商/.test(value)), values.join("、"));
  assert.equal(candidates.find(item => item.value === N.legal).category, "sales");
  assert.equal(candidates.find(item => item.value === N.partner).category, "customer");
});

test("表单页里装着标签词的“列”不会被默认勾选", async () => {
  const analysis = analyzeWorkbook(await load());
  const suggested = analysis.columns.filter(column => analysis.suggestedColumnIds.includes(column.id)).map(column => `${column.sheetName}/${column.header}`);
  assert.ok(!suggested.includes("决策链分析/客户名称"));
  assert.ok(suggested.includes("销售明细表/客户中文名称"));
});

test("确认的名称（含手动添加的简称）在整个文件里替换，还原后与原文件一致", async () => {
  const original = await load();
  const workbook = await load();
  const analysis = analyzeWorkbook(workbook);
  const found = findWorkbookCandidates(workbook);
  const manual = ["张总", "陈总", "东骏", "骏邦", N.buyer].map(value => addManualCandidate({ ...found, candidates: found.candidates }, value));
  const columns = analysis.columns.filter(column => analysis.suggestedColumnIds.includes(column.id)).map(column => ({ ...column, processingMode: column.recommendedMode ?? "whole" }));
  const result = tokenizeWorkbook(workbook, columns, "AB12CD34", [...found.candidates, ...manual]);
  assert.deepEqual(result.warnings, []);
  const buffer = await workbook.xlsx.writeBuffer();
  await assertNoSensitiveValuesInXlsxPackage(buffer, result.mapping);
  await assertNoAttachmentsInXlsxPackage(buffer);
  const masked = new ExcelJS.Workbook(); await masked.xlsx.load(buffer);
  const aiSees = Object.values(cellTexts(masked)).join("\n");
  for (const name of [...Object.values(N), "马总", "张总", "陈总", "骏邦"]) assert.ok(!aiSees.includes(name), `${name} 仍在脱敏文件里`);
  const restored = new ExcelJS.Workbook(); await restored.xlsx.load(buffer);
  restoreWorkbookValues(restored, result.mapping);
  assert.deepEqual(cellTexts(restored), cellTexts(original));
});

test("图片原样保留，嵌入附件不进入脱敏文件，并都告诉用户", async () => {
  const bytes = await customerProfileBytes();
  assert.deepEqual((await preflightXlsxPackage(bytes)).media, { images: 1, attachments: 1 });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const files = Object.keys((await JSZip.loadAsync(await workbook.xlsx.writeBuffer())).files);
  assert.ok(files.some(name => /^xl\/media\//.test(name)), "图片应保留");
  assert.ok(!files.some(name => /^xl\/embeddings\//.test(name)), "附件不应写回");
});

test("宏和 ActiveX 仍然停止处理", async () => {
  const zip = await JSZip.loadAsync(await customerProfileBytes());
  zip.file("xl/vbaProject.bin", "macro");
  await assert.rejects(async () => preflightXlsxPackage(await zip.generateAsync({ type: "nodebuffer" })), { code: "EMBEDDED_OBJECTS" });
});

test("标准表格：表头行不当成名称；公司名取完整后缀，中间带括号的保留，末尾括号备注去掉", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("大客户名单");
  sheet.addRow(["序号", "部门", "业务员", "客户省份", "客户全称", "2024年销售"]);
  sheet.addRow([1, "销售二部", "虚构麦一", "广东", "虚构顺德金纺集团有限公司", 100]);
  sheet.addRow([2, "销售三部", "虚构何二", "广东", "虚构互太（番禺）纺织印染有限公司", 200]);
  const notes = workbook.addWorksheet("备注");
  notes.addRow(["企业名称", "虚构东骏纺织有限公司（以虚构盛意公司合作）"]);
  notes.addRow(["说明", "有限公司"]);
  const values = findWorkbookCandidates(workbook, new Set(), new Map([["大客户名单", new Set([1])]])).candidates.map(item => item.value);
  for (const header of ["客户省份", "2024年销售"]) assert.ok(!values.includes(header), header);
  assert.ok(values.includes("虚构顺德金纺集团有限公司") && !values.includes("虚构顺德金纺集团"));
  assert.ok(values.includes("虚构互太（番禺）纺织印染有限公司"));
  assert.ok(values.includes("虚构东骏纺织有限公司") && values.includes("虚构盛意公司"));
  assert.ok(!values.includes("有限公司"));
});
