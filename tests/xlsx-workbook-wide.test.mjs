import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { assertNoSensitiveValuesInXlsxPackage } from "../src/xlsxPackageCore.js";
import { analyzeWorkbook, restoreWorkbookValues, spreadsAcrossWorkbook, tokenizeWorkbook } from "../src/xlsxCore.js";

// People choose the columns that hold names; those names must then be gone from every sheet, and come back
// exactly on restore. Each case is a common real-world layout built from made-up data.
const A = "虚构星河化工有限公司", B = "虚构东骏纺织有限公司", P = "张晓明", Q = "李思远";
const CASES = {
  "明细+汇总页公式引用": wb => {
    const d = wb.addWorksheet("明细"); d.addRow(["客户名称", "业务员", "金额"]); d.addRow([A, P, 100]); d.addRow([B, Q, 200]);
    const s = wb.addWorksheet("汇总"); s.addRow(["序号", "合计"]); s.addRow([1, { formula: "明细!C2", result: 100 }]); s.addRow([{ formula: "明细!A3", result: B }, 200]);
  },
  "交叉表：客户在表头": wb => {
    const d = wb.addWorksheet("客户"); d.addRow(["客户名称", "区域"]); d.addRow([A, "华南"]); d.addRow([B, "华东"]);
    const x = wb.addWorksheet("月度"); x.addRow(["月份", A, B]); x.addRow(["1月", 10, 20]);
  },
  "其他表用了认不出的表头": wb => {
    const d = wb.addWorksheet("客户"); d.addRow(["客户全称", "等级"]); d.addRow([A, "A"]); d.addRow([B, "B"]);
    const o = wb.addWorksheet("回款"); o.addRow(["对方户名", "到账金额"]); o.addRow([A, 5000]); o.addRow([B, 8000]);
  },
  "跟进记录长文字+隐藏表": wb => {
    const d = wb.addWorksheet("客户"); d.addRow(["客户名称", "负责人"]); d.addRow([A, P]); d.addRow([B, Q]);
    const f = wb.addWorksheet("跟进"); f.addRow(["日期", "内容"]); f.addRow(["11-01", `${P} 拜访 ${A}，确认二季度订单`]);
    const h = wb.addWorksheet("底稿", { state: "hidden" }); h.addRow(["备份"]); h.addRow([A]);
  },
  "标题行+分类汇总+合并+占位符": wb => {
    const s = wb.addWorksheet("大客户"); s.mergeCells("A1:D1"); s.getCell("A1").value = "2026年大客户名单";
    s.addRow(["业务员", "客户简称", "客户全称", "2025年销售"]); s.addRow([P, "K5204", A, 100]); s.addRow([null, "/", B, 200]); s.mergeCells("A3:A4");
    s.addRow(["开发型 汇总", { formula: "SUBTOTAL(3,B3:B4)&\"个\"", result: "2个" }, null, { formula: "SUBTOTAL(9,D3:D4)", result: 300 }]);
  },
};

const cellsOf = wb => {
  const cells = {};
  wb.eachSheet(ws => { if (ws.name === "__AI安全任务") return; ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
    if (cell.isMerged && cell.master !== cell) return;
    const v = cell.value;
    cells[`${ws.name}!${cell.address}`] = v && typeof v === "object" && "formula" in v ? `=${v.formula}` : String(v?.richText ? v.richText.map(r => r.text).join("") : v);
  })); });
  return cells;
};

for (const [label, build] of Object.entries(CASES)) {
  test(`全文件替换：${label}`, async () => {
    const original = new ExcelJS.Workbook(); build(original);
    const workbook = new ExcelJS.Workbook(); build(workbook);
    const analysis = analyzeWorkbook(workbook);
    const selected = analysis.columns.filter(c => analysis.suggestedColumnIds.includes(c.id)).map(c => ({ ...c, processingMode: c.recommendedMode ?? "whole" }));
    const result = tokenizeWorkbook(workbook, selected, "AB12CD34");
    assert.deepEqual(result.warnings, []);
    const buffer = await workbook.xlsx.writeBuffer();
    await assertNoSensitiveValuesInXlsxPackage(buffer, result.mapping);
    const masked = new ExcelJS.Workbook(); await masked.xlsx.load(buffer);
    const aiSees = JSON.stringify(cellsOf(masked));
    for (const name of [A, B, P, Q]) assert.ok(!aiSees.includes(name), `${name} 不应出现在脱敏文件里`);
    const restored = new ExcelJS.Workbook(); await restored.xlsx.load(buffer);
    restoreWorkbookValues(restored, result.mapping);
    assert.deepEqual(cellsOf(restored), cellsOf(original));
  });
}

test("全文件替换不碰数字：数量恰好等于客户编号时保持原样", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("客户");
  sheet.addRow(["客户编号", "客户名称", "数量"]); sheet.addRow(["1200", A, 1200]); sheet.addRow(["K5204", B, 5204]);
  const analysis = analyzeWorkbook(workbook);
  const selected = analysis.columns.filter(c => analysis.suggestedColumnIds.includes(c.id)).map(c => ({ ...c, processingMode: "whole" }));
  const result = tokenizeWorkbook(workbook, selected, "AB12CD34");
  assert.equal(sheet.getCell("C2").value, 1200);
  assert.equal(sheet.getCell("C3").value, 5204);
  assert.equal(result.elsewhere.cells, 0);
});

test("只有名称和带字母的长编号会在其他列里查找", () => {
  for (const value of [A, P, "K5204", "HT-825GK"]) assert.equal(spreadsAcrossWorkbook(value), true, value);
  for (const value of ["1200", "2026", "K52", "A", "100.5"]) assert.equal(spreadsAcrossWorkbook(value), false, value);
});

test("其他位置替换了多少处会告诉用户", () => {
  const workbook = new ExcelJS.Workbook();
  CASES["交叉表：客户在表头"](workbook);
  const analysis = analyzeWorkbook(workbook);
  const selected = analysis.columns.filter(c => analysis.suggestedColumnIds.includes(c.id)).map(c => ({ ...c, processingMode: "whole" }));
  const result = tokenizeWorkbook(workbook, selected, "AB12CD34");
  assert.deepEqual(result.elsewhere, { cells: 2, sheets: [{ sheet: "月度", cells: 2 }] });
});
