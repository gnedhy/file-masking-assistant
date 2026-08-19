import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCsv,
  inspectCsvAlteredTokens,
  inspectCsvTokens,
  parseCsvText,
  restoreCsvValues,
  stringifyCsv,
  tokenizeCsv,
} from "../src/csvCore.js";

function sampleCsv() {
  return parseCsvText('\uFEFF客户名称,产品内部编码,销售人员,销售金额,备注\r\n浙江ABC染整,HT-825GK,张三,128000,"重点,客户"\r\n浙江ABC染整,HT-992,李四,86000,"跨行\n备注"\r\n');
}

test("CSV 识别表头、建议字段和带引号内容", () => {
  const document = sampleCsv();
  const analysis = analyzeCsv(document);
  assert.equal(document.delimiter, ",");
  assert.equal(document.newline, "\r\n");
  assert.equal(document.rows[1][4], "重点,客户");
  assert.equal(document.rows[2][4], "跨行\n备注");
  assert.deepEqual(
    analysis.columns.filter((column) => column.suggested).map((column) => column.header),
    ["客户名称", "产品内部编码", "销售人员"],
  );
});

test("CSV 脱敏与还原保持分隔符、换行和字段内容", () => {
  const taskId = "7F2A9C4D";
  const document = sampleCsv();
  const analysis = analyzeCsv(document);
  const selected = analysis.columns.filter((column) => column.suggested || column.header === "备注");
  const protectedResult = tokenizeCsv(document, selected, taskId);

  assert.equal(protectedResult.replacedCells, 8);
  assert.equal(protectedResult.uniqueValues, 7);
  assert.equal(document.rows[1][0], "[[C001@7F2A9C4D]]");
  assert.equal(document.rows[2][0], "[[C001@7F2A9C4D]]");

  const roundTripped = parseCsvText(stringifyCsv(document));
  const inspection = inspectCsvTokens(roundTripped);
  assert.deepEqual(inspection.taskIds, [taskId]);
  assert.equal(inspection.occurrences.length, 8);

  const restored = restoreCsvValues(roundTripped, protectedResult.mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.equal(restored.restoredOccurrences, 8);
  assert.equal(roundTripped.rows[1][0], "浙江ABC染整");
  assert.equal(roundTripped.rows[1][4], "重点,客户");
  assert.equal(roundTripped.rows[2][4], "跨行\n备注");
  assert.equal(inspectCsvTokens(roundTripped).occurrences.length, 0);
});

test("CSV 叙述字段只替换已确认实体并保留其余内容", () => {
  const document = parseCsvText("业务员,客户名称,产品内部编码,业务员反馈\n张三,浙江ABC染整,HT-825GK,张三反馈：浙江ABC染整的 HT-825GK 已完成第二轮测试。");
  const analysis = analyzeCsv(document);
  const selected = analysis.columns.map((column) => ({
    ...column,
    processingMode: column.header === "业务员反馈" ? "inline" : "whole",
  }));
  const result = tokenizeCsv(document, selected, "7F2A9C4D");

  assert.equal(result.uniqueValues, 3);
  assert.equal(result.replacedCells, 6);
  assert.equal(document.rows[1][3], "[[S001@7F2A9C4D]]反馈：[[C001@7F2A9C4D]]的 [[P001@7F2A9C4D]] 已完成第二轮测试。");
  const restored = restoreCsvValues(document, result.mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.equal(document.rows[1][3], "张三反馈：浙江ABC染整的 HT-825GK 已完成第二轮测试。");
});

test("CSV 能识别未知代号、混合任务和改写代号", () => {
  const mixed = parseCsvText("客户,产品\n[[C001@7F2A9C4D]],[[P001@11223344]]");
  assert.deepEqual(inspectCsvTokens(mixed).taskIds.sort(), ["11223344", "7F2A9C4D"]);

  const unknown = restoreCsvValues(parseCsvText("客户\n[[C999@7F2A9C4D]]"), {
    "[[C001@7F2A9C4D]]": { value: { type: "string", value: "浙江ABC染整" } },
  });
  assert.equal(unknown.restoredOccurrences, 0);
  assert.equal(unknown.unresolved.length, 1);

  const altered = parseCsvText("客户,产品\n客户 C001,[[P001@7F2A");
  const findings = inspectCsvAlteredTokens(altered, {
    "[[C001@7F2A9C4D]]": { value: { type: "string", value: "浙江ABC染整" } },
    "[[P001@7F2A9C4D]]": { value: { type: "string", value: "HT-825GK" } },
  });
  assert.equal(findings.length, 2);
  assert.ok(findings.some((item) => item.value === "C001"));
  assert.ok(findings.some((item) => item.value.startsWith("[[P001")));
});

test("CSV 自动识别分号分隔并保留 CRLF", () => {
  const document = parseCsvText("客户名称;销售人员;备注\r\n浙江ABC染整;张三;正常\r\n");
  assert.equal(document.delimiter, ";");
  assert.equal(document.newline, "\r\n");
  assert.equal(stringifyCsv(document), "客户名称;销售人员;备注\r\n浙江ABC染整;张三;正常\r\n");
});

test("CSV 对未闭合引号失败关闭", () => {
  assert.throws(() => parseCsvText('客户名称,备注\n浙江ABC染整,"未闭合'), /未闭合/);
});

test("CSV 支持中英文混合表头、特殊符号和短编码边界", () => {
  const document = parseCsvText(
    '\uFEFF客户名称（Customer Name）,Product Code,销售负责人 / Sales Rep,Follow-up Notes\r\n'
      + '华东客户-A&B（一期）,A1,Amy 张,"Amy 张反馈：A1 已交付华东客户-A&B（一期），XA12 不应被部分替换"\r\n',
  );
  const analysis = analyzeCsv(document);
  assert.deepEqual(
    analysis.columns.slice(0, 3).map((column) => column.category),
    ["customer", "product", "sales"],
  );
  assert.equal(analysis.columns[3].recommendedMode, "inline");

  const selected = analysis.columns.map((column) => ({
    ...column,
    processingMode: column.header === "Follow-up Notes" ? "inline" : "whole",
  }));
  const result = tokenizeCsv(document, selected, "7F2A9C4D");
  assert.equal(result.replacedCells, 6);
  assert.equal(
    document.rows[1][3],
    "[[S001@7F2A9C4D]]反馈：[[P001@7F2A9C4D]] 已交付[[C001@7F2A9C4D]]，XA12 不应被部分替换",
  );

  const restored = restoreCsvValues(document, result.mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.equal(document.rows[1][3], "Amy 张反馈：A1 已交付华东客户-A&B（一期），XA12 不应被部分替换");
});

test("两个字母的英文姓名只在独立出现时进行文中替换", () => {
  const document = parseCsvText("销售人员,备注\nBo,Bo 已完成；Boon 不是同一姓名");
  const analysis = analyzeCsv(document);
  const selected = analysis.columns.map((column) => ({
    ...column,
    processingMode: column.header === "备注" ? "inline" : "whole",
  }));
  const result = tokenizeCsv(document, selected, "7F2A9C4D");

  assert.equal(result.replacedCells, 2);
  assert.equal(document.rows[1][1], "[[S001@7F2A9C4D]] 已完成；Boon 不是同一姓名");
});
