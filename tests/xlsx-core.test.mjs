import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  addTaskMarker,
  analyzeWorkbook,
  classifyHeader,
  inspectWorkbookAlteredTokens,
  inspectWorkbookTokens,
  recommendedProcessingMode,
  removeTaskMarker,
  restoreWorkbookValues,
  tokenizeWorkbook,
} from "../src/xlsxCore.js";

function sampleWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("销售明细");
  sheet.addRow(["客户名称", "产品内部编码", "销售人员", "销售金额", "内部订单号"]);
  sheet.addRow(["浙江ABC染整", "HT-825GK", "张三", 128000, "SO-001"]);
  sheet.addRow(["浙江ABC染整", "HT-992", "李四", 86000, "SO-002"]);
  sheet.addRow(["合计", null, null, { formula: "SUM(D2:D3)", result: 214000 }, null]);
  sheet.getCell("A2").font = { bold: true, color: { argb: "FF123456" } };
  sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2FF" } };
  sheet.getColumn(1).width = 22;
  return workbook;
}

test("识别建议字段，并允许普通列作为自定义字段", () => {
  const analysis = analyzeWorkbook(sampleWorkbook());
  assert.deepEqual(
    analysis.columns.filter((column) => column.suggested).map((column) => column.header),
    ["客户名称", "产品内部编码", "销售人员"],
  );
  assert.equal(analysis.columns.find((column) => column.header === "内部订单号").suggested, false);
});

test("自动建议只覆盖明确实体字段，叙述字段默认使用文中替换", () => {
  assert.equal(classifyHeader("客户名称").category, "customer");
  assert.equal(classifyHeader("业务员").category, "sales");
  assert.equal(classifyHeader("客户等级").category, "custom");
  assert.equal(classifyHeader("客户类型").category, "custom");
  assert.equal(classifyHeader("业务员反馈").category, "custom");
  assert.equal(classifyHeader("业务员要求完成日期").category, "custom");
  assert.equal(classifyHeader("客户测试通过情况").category, "custom");
  assert.equal(recommendedProcessingMode("业务员反馈"), "inline");
  assert.equal(recommendedProcessingMode("业务员要求完成日期（研发提供数据）"), "whole");
  assert.equal(recommendedProcessingMode("反馈时间"), "whole");
  assert.equal(recommendedProcessingMode("客户名称"), "whole");
});

test("XLSX 富文本可整格脱敏并按原结构还原", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("来样明细");
  sheet.addRow(["客户名称"]);
  sheet.getCell("A2").value = {
    richText: [
      { font: { bold: true }, text: "浙江 ABC" },
      { font: { italic: true }, text: "染整\n（重点）" },
    ],
  };
  const analysis = analyzeWorkbook(workbook);
  assert.equal(analysis.columns[0].valueCount, 1);
  assert.equal(analysis.columns[0].complexCount, 0);

  const result = tokenizeWorkbook(workbook, [{ ...analysis.columns[0], processingMode: "whole" }], "A1B2C3D4");
  assert.equal(result.warnings.length, 0);
  assert.equal(sheet.getCell("A2").value, "[[客户名称:C001@A1B2C3D4]]");
  restoreWorkbookValues(workbook, result.mapping);
  assert.deepEqual(sheet.getCell("A2").value, {
    richText: [
      { font: { bold: true }, text: "浙江 ABC" },
      { font: { italic: true }, text: "染整\n（重点）" },
    ],
  });
});

test("XLSX 叙述字段只替换已确认实体并保留上下文", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("销售跟进");
  sheet.addRow(["业务员", "客户名称", "产品内部编码", "业务员反馈"]);
  sheet.addRow(["张三", "浙江ABC染整", "HT-825GK", "张三反馈：浙江ABC染整的 HT-825GK 已完成第二轮测试。"]);
  const analysis = analyzeWorkbook(workbook);
  const selected = analysis.columns.map((column) => ({
    ...column,
    processingMode: column.header === "业务员反馈" ? "inline" : "whole",
  }));
  const result = tokenizeWorkbook(workbook, selected, "7F2A9C4D");

  assert.equal(result.warnings.length, 0);
  assert.equal(result.uniqueValues, 3);
  assert.equal(result.replacedCells, 6);
  assert.equal(
    sheet.getCell("D2").value,
    "[[业务员:S001@7F2A9C4D]]反馈：[[客户名称:C001@7F2A9C4D]]的 [[产品内部编码:P001@7F2A9C4D]] 已完成第二轮测试。",
  );
  restoreWorkbookValues(workbook, result.mapping);
  assert.equal(sheet.getCell("D2").value, "张三反馈：浙江ABC染整的 HT-825GK 已完成第二轮测试。");
});

test("XLSX 脱敏与还原保留公式和样式", async () => {
  const taskId = "7F2A9C4D";
  const workbook = sampleWorkbook();
  const analysis = analyzeWorkbook(workbook);
  const selected = analysis.columns.filter((column) => column.suggested || column.header === "内部订单号");
  const protectedResult = tokenizeWorkbook(workbook, selected, taskId);
  addTaskMarker(workbook, { taskId, taskName: "7月销售明细", createdAt: "2026-08-12T00:00:00.000Z" });

  assert.equal(protectedResult.replacedCells, 9);
  assert.equal(workbook.getWorksheet("销售明细").getCell("A2").value, "[[客户名称:C001@7F2A9C4D]]");
  assert.equal(workbook.getWorksheet("销售明细").getCell("A3").value, "[[客户名称:C001@7F2A9C4D]]");
  assert.equal(workbook.getWorksheet("销售明细").getCell("D4").value.formula, "SUM(D2:D3)");

  const roundTripped = new ExcelJS.Workbook();
  await roundTripped.xlsx.load(await workbook.xlsx.writeBuffer());
  const inspection = inspectWorkbookTokens(roundTripped);
  assert.deepEqual(inspection.taskIds, [taskId]);
  assert.equal(roundTripped.getWorksheet("__AI安全任务").state, "veryHidden");
  assert.equal(roundTripped.getWorksheet("__AI安全任务").getColumn(1).values.includes("任务名称"), false);
  assert.equal(JSON.stringify(roundTripped.getWorksheet("__AI安全任务").getSheetValues()).includes("7月销售明细"), false);

  const restored = restoreWorkbookValues(roundTripped, protectedResult.mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.equal(restored.restoredOccurrences, 9);
  removeTaskMarker(roundTripped);

  const output = new ExcelJS.Workbook();
  await output.xlsx.load(await roundTripped.xlsx.writeBuffer());
  const sheet = output.getWorksheet("销售明细");
  assert.equal(sheet.getCell("A2").value, "浙江ABC染整");
  assert.equal(sheet.getCell("B2").value, "HT-825GK");
  assert.equal(sheet.getCell("C2").value, "张三");
  assert.equal(sheet.getCell("E2").value, "SO-001");
  assert.equal(sheet.getCell("D4").value.formula, "SUM(D2:D3)");
  assert.equal(sheet.getCell("A2").font.bold, true);
  assert.equal(sheet.getCell("A2").font.color.argb, "FF123456");
  assert.equal(sheet.getCell("A2").fill.fgColor.argb, "FFEAF2FF");
  assert.equal(sheet.getColumn(1).width, 22);
  assert.equal(inspectWorkbookTokens(output).occurrences.length, 0);
});

test("选择金额列时清除公式缓存而不是拦截处理", async () => {
  const taskId = "A1B2C3D4";
  const workbook = sampleWorkbook();
  const analysis = analyzeWorkbook(workbook);
  const selected = analysis.columns.filter((column) => column.header === "销售金额");
  const protectedResult = tokenizeWorkbook(workbook, selected, taskId);

  assert.equal(protectedResult.replacedCells, 2);
  assert.equal(protectedResult.warnings.length, 0);
  assert.equal(protectedResult.notices.length, 1);
  assert.match(workbook.getWorksheet("销售明细").getCell("D2").value, /^\[\[销售金额:X001@A1B2C3D4\]\]$/);
  assert.equal(workbook.getWorksheet("销售明细").getCell("D4").value.formula, "SUM(D2:D3)");
  assert.equal(workbook.getWorksheet("销售明细").getCell("D4").value.result, undefined);

  const restored = restoreWorkbookValues(workbook, protectedResult.mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.equal(workbook.getWorksheet("销售明细").getCell("D2").value, 128000);
  assert.equal(workbook.getWorksheet("销售明细").getCell("D4").value.formula, "SUM(D2:D3)");
});

test("未知 Token 与公式中的 Token 均失败关闭", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("AI结果");
  sheet.getCell("A1").value = "[[C999@7F2A9C4D]]";
  sheet.getCell("B1").value = { formula: 'IF(A1="[[C001@7F2A9C4D]]",1,0)', result: 0 };
  const result = restoreWorkbookValues(workbook, {
    "[[C001@7F2A9C4D]]": { value: { type: "string", value: "浙江ABC染整" }, category: "customer" },
  });
  assert.equal(result.restoredOccurrences, 0);
  assert.equal(result.unresolved.length, 2);
  assert.match(result.unresolved[0].reason, /没有对应映射/);
  assert.match(result.unresolved[1].reason, /公式/);
});

test("混合任务指纹可以被识别", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("AI结果");
  sheet.addRow(["[[C001@7F2A9C4D]]", "[[P001@11223344]]"]);
  const inspection = inspectWorkbookTokens(workbook);
  assert.deepEqual(inspection.taskIds.sort(), ["11223344", "7F2A9C4D"]);
});

test("XLSX 能识别已知短代号和残缺语法", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("AI结果");
  sheet.addRow(["客户", "产品"]);
  sheet.addRow(["客户 C001", "[[P001@7F2A"]);
  const mapping = {
    "[[C001@7F2A9C4D]]": { value: { type: "string", value: "浙江ABC染整" } },
    "[[P001@7F2A9C4D]]": { value: { type: "string", value: "HT-825GK" } },
  };
  const findings = inspectWorkbookAlteredTokens(workbook, mapping);
  assert.deepEqual(new Set(findings.map((item) => item.address)), new Set(["A2", "B2"]));
  assert.ok(findings.some((item) => item.value === "P001"));
  assert.ok(findings.some((item) => item.value.startsWith("[[P001")));
});

test("公式中的普通单元格引用不会被误判为短代号", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("AI结果");
  sheet.getCell("A1").value = { formula: "IF(C376=X132,1,0)", result: 0 };
  const findings = inspectWorkbookAlteredTokens(workbook, {
    "[[C376@7F2A9C4D]]": { value: { type: "string", value: "研发部" } },
    "[[X132@7F2A9C4D]]": { value: { type: "string", value: "来样名称" } },
  });
  assert.deepEqual(findings, []);
});

test("中英文及带说明的常见表头可以自动识别", () => {
  assert.equal(classifyHeader("客户K码").category, "customer");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("混合表头");
  sheet.addRow(["客户名称（Customer Name）", "Product Code", "销售负责人 / Sales Rep", "Follow-up Notes"]);
  sheet.addRow(["华东客户-A&B（一期）", "HT-825/GK V2.1", "Amy 张", "Amy 张反馈：HT-825/GK V2.1 已交付华东客户-A&B（一期）"]);

  const analysis = analyzeWorkbook(workbook);
  assert.deepEqual(
    analysis.columns.slice(0, 3).map((column) => column.category),
    ["customer", "product", "sales"],
  );
  assert.equal(analysis.columns[3].recommendedMode, "inline");
});

test("短英文数字编码仅在独立出现时进行文中替换", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("短编码");
  sheet.addRow(["产品编码", "备注"]);
  sheet.addRow(["A1", "A1 已通过，XA12 不应被部分替换"]);

  const analysis = analyzeWorkbook(workbook);
  const selected = analysis.columns.map((column) => ({
    ...column,
    processingMode: column.header === "备注" ? "inline" : "whole",
  }));
  const result = tokenizeWorkbook(workbook, selected, "7F2A9C4D");

  assert.equal(result.replacedCells, 2);
  assert.equal(sheet.getCell("B2").value, "[[产品编码:P001@7F2A9C4D]] 已通过，XA12 不应被部分替换");
  restoreWorkbookValues(workbook, result.mapping);
  assert.equal(sheet.getCell("B2").value, "A1 已通过，XA12 不应被部分替换");
});
