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
  findCsvFormulaCells,
  findCsvSensitiveResiduals,
} from "../src/csvCore.js";

test("CSV 残留扫描覆盖生僻字、emoji、单字和短数字，保留独立编码边界", () => {
  for (const value of ["𠮷田产品", "产品🔒A", "李", "825", "825 "]) {
    const document = { rows: [["产品名称", "备注"], [value, `本次采购${value}，请跟进。`]] };
    const result = tokenizeCsv(document, analyzeCsv(document).columns.slice(0, 1), "ABCDEF12");
    assert.equal(findCsvSensitiveResiduals(document, result.mapping).length, 1, value);
  }
  const mapping = { token: { value: { type: "string", value: "825" } } };
  assert.deepEqual(findCsvSensitiveResiduals({ rows: [["9825", "X825A"]] }, mapping), []);
});

test("CSV Unicode 文中替换完整往返，短实体需整格替换才能消除残留", () => {
  for (const value of ["𠮷田产品", "产品🔒A", "李", "825"]) {
    const original = [["产品名称", "备注"], [value, `采购${value}。`]];
    const document = { rows: structuredClone(original) };
    const columns = analyzeCsv(document).columns.map((column, index) => ({ ...column, processingMode: index ? "inline" : "whole" }));
    const result = tokenizeCsv(document, columns, "ABCDEF12");
    assert.equal(findCsvSensitiveResiduals(document, result.mapping).length, ["李", "825"].includes(value) ? 1 : 0);
    restoreCsvValues(document, result.mapping);
    assert.deepEqual(document.rows, original);
    const whole = tokenizeCsv(document, columns.map(column => ({ ...column, processingMode: "whole" })), "ABCDEF12");
    assert.deepEqual(findCsvSensitiveResiduals(document, whole.mapping), []);
    restoreCsvValues(document, whole.mapping);
    assert.deepEqual(document.rows, original);
  }
});

test("CSV 行列和字段数在解析时限流，恰好上限允许", () => {
  const limits = { rows: 3, columns: 2, cells: 6 };
  assert.equal(parseCsvText("a,b\n1,2\n3,4", limits).rows.length, 3);
  for (const input of ["a,b\n1,2\n3,4\n5,6", "a,b,c\n1,2,3", "a,b\n1,2\n3,4"]) {
    const bounds = input === "a,b\n1,2\n3,4" ? { ...limits, cells: 5 } : limits;
    assert.throws(() => parseCsvText(input, bounds), error => error.code === "CSV_LIMIT_EXCEEDED");
  }
  // A malformed tail must not be reached after the limit was already exceeded.
  assert.throws(() => parseCsvText('a,b\n1,2\n3,4\n5,6\n"broken', limits), error => error.code === "CSV_LIMIT_EXCEEDED");
});

test("CSV 分隔符采样保留引号、内嵌分隔符和多行字段", () => {
  for (const delimiter of [",", ";", "\t"]) {
    const document = { delimiter, newline: "\r\n", trailingNewline: true, rows: [["客户名称", "备注"], ...Array.from({ length: 30 }, () => ["甲公司", '含,;\t以及"引号"\n多行'])] };
    assert.deepEqual(parseCsvText(stringifyCsv(document)).rows, document.rows);
  }
});

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
  assert.equal(document.rows[1][0], "[[客户名称:C001@7F2A9C4D]]");
  assert.equal(document.rows[2][0], "[[客户名称:C001@7F2A9C4D]]");

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
  assert.equal(document.rows[1][3], "[[业务员:S001@7F2A9C4D]]反馈：[[客户名称:C001@7F2A9C4D]]的 [[产品内部编码:P001@7F2A9C4D]] 已完成第二轮测试。");
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
    "[[销售负责人/SalesRep:S001@7F2A9C4D]]反馈：[[ProductCode:P001@7F2A9C4D]] 已交付[[客户名称(CustomerNam:C001@7F2A9C4D]]，XA12 不应被部分替换",
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
  assert.equal(document.rows[1][1], "[[销售人员:S001@7F2A9C4D]] 已完成；Boon 不是同一姓名");
});

test("CSV 对包含已知实体的叙述列默认建议文中替换", () => {
  const document = parseCsvText("客户名称,产品内部编码,销售人员,业务员反馈\n浙江ABC染整,HT-825GK,张三,张三反馈：浙江ABC染整的 HT-825GK 已完成测试。");
  const analysis = analyzeCsv(document);
  const feedback = analysis.columns.find((column) => column.header === "业务员反馈");

  assert.equal(feedback.suggested, true);
  assert.equal(feedback.recommendedMode, "inline");
  assert.ok(analysis.suggestedColumnIds.includes(feedback.id));
});

test("CSV 脱敏后能定位未选叙述列中的真实值残留", () => {
  const document = parseCsvText("客户名称,产品内部编码,销售人员,业务员反馈\n浙江ABC染整,HT-825GK,张三,张三反馈：浙江ABC染整的 HT-825GK 已完成测试。");
  const analysis = analyzeCsv(document);
  const selected = analysis.columns.filter((column) => column.header !== "业务员反馈");
  const result = tokenizeCsv(document, selected, "7F2A9C4D");
  const residuals = findCsvSensitiveResiduals(document, result.mapping);

  assert.equal(residuals.length, 3);
  assert.ok(residuals.every((item) => item.location === "第 2 行，第 4 列"));
});

test("CSV 残留检查不会把正式代号内的同名短码当成真实值", () => {
  const document = parseCsvText("客户名称,备注\nC001,客户 C001 需要继续跟进");
  const analysis = analyzeCsv(document);
  const result = tokenizeCsv(document, analysis.columns, "7F2A9C4D");

  assert.equal(document.rows[1][0], "[[客户名称:C001@7F2A9C4D]]");
  assert.deepEqual(findCsvSensitiveResiduals(document, result.mapping), []);
});

test("CSV 识别可能被 Excel 执行的公式型字段", () => {
  const document = parseCsvText("客户,备注\nA,=HYPERLINK(\"https://example.test\")\nB,-120\nC,+cmd|' /C calc'!A0");
  const findings = findCsvFormulaCells(document);
  assert.equal(findings.length, 2);
  assert.match(findings[0].value, /^=/);
  assert.match(findings[1].value, /^\+/);
});

test("CSV 空列不会被默认勾选", () => {
  const analysis = analyzeCsv(parseCsvText("客户名称,销售人员\r\n虚构客户甲,\r\n虚构客户乙,\r\n"));
  assert.deepEqual(analysis.suggestedColumnIds, [analysis.columns.find((column) => column.header === "客户名称").id]);
});
