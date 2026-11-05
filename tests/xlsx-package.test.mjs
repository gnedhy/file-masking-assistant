import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { assertNoSensitiveValuesInXlsxPackage, preflightXlsxPackage } from "../src/xlsxPackageCore.js";

async function xlsxBytes(files = {}, contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types><Override ContentType="${contentType}"/></Types>`);
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("xl/worksheets/sheet1.xml", "<worksheet/>");
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  return zip.generateAsync({ type: "uint8array" });
}

test("XLSX package preflight accepts a standard workbook", async () => {
  const result = await preflightXlsxPackage(await xlsxBytes());
  assert.equal(result.worksheetCount, 1);
});

test("short aliases in chart caches, comments or XML attributes fail closed", async () => {
  for (const [name, value] of [
    ["xl/charts/chart1.xml", "<c:cache><c:v>产品-K7M4-01</c:v></c:cache>"],
    ["xl/comments1.xml", "<comments><t>产品-k7m4-01</t></comments>"],
    ["xl/worksheets/sheet1.xml", '<worksheet><c name="产品-K7M4-01"><t>普通文字</t></c></worksheet>'],
  ]) await assert.rejects(() => xlsxBytes({ [name]: value }).then(bytes => preflightXlsxPackage(bytes)), { code: "UNSUPPORTED_CONTENT" });
  await preflightXlsxPackage(await xlsxBytes({ "xl/sharedStrings.xml": "<sst><si><t>产品-K7M4-01</t></si></sst>" }));
});

test("XLSX package preflight rejects format mismatch and macros; attachments and pictures are counted", async () => {
  await assert.rejects(async () => preflightXlsxPackage(await xlsxBytes({}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")), (error) => error.code === "FORMAT_MISMATCH");
  await assert.rejects(async () => preflightXlsxPackage(await xlsxBytes({ "xl/vbaProject.bin": new Uint8Array([1]) })), (error) => error.code === "EMBEDDED_OBJECTS");
  await assert.rejects(async () => preflightXlsxPackage(await xlsxBytes({ "xl/activeX/activeX1.xml": "<ax/>" })), (error) => error.code === "EMBEDDED_OBJECTS");
  // An attached PDF or Word file no longer stops the workbook: it is left out of the protected copy.
  const { media } = await preflightXlsxPackage(await xlsxBytes({ "xl/embeddings/oleObject1.bin": new Uint8Array([1]), "xl/media/image1.png": new Uint8Array([1]) }));
  assert.deepEqual(media, { images: 1, attachments: 1 });
});

test("XLSX package preflight applies compressed, unpacked, entry and worksheet limits", async () => {
  const bytes = await xlsxBytes();
  await assert.rejects(() => preflightXlsxPackage(bytes, { compressedBytes: 1, uncompressedBytes: 999999, entries: 999, worksheets: 999 }), (error) => error.code === "FILE_TOO_LARGE");
  await assert.rejects(() => preflightXlsxPackage(bytes, { compressedBytes: 999999, uncompressedBytes: 1, entries: 999, worksheets: 999 }), (error) => error.code === "PACKAGE_TOO_LARGE");
  await assert.rejects(() => preflightXlsxPackage(bytes, { compressedBytes: 999999, uncompressedBytes: 999999, entries: 1, worksheets: 999 }), (error) => error.code === "PACKAGE_TOO_LARGE");
  await assert.rejects(() => preflightXlsxPackage(bytes, { compressedBytes: 999999, uncompressedBytes: 999999, entries: 999, worksheets: 0 }), (error) => error.code === "PACKAGE_TOO_LARGE");
});

test("XLSX rejects external relationships and residual selected values", async () => {
  const external = await xlsxBytes({
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship TargetMode="External" Target="https://example.test/data.xlsx"/></Relationships>',
  });
  await assert.rejects(() => preflightXlsxPackage(external), (error) => error.code === "EXTERNAL_RELATIONSHIPS");

  const residual = await xlsxBytes({ "docProps/core.xml": "<root>浙江ABC染整</root>" });
  await assert.rejects(
    () => assertNoSensitiveValuesInXlsxPackage(residual, { "[[C001@A1B2C3D4]]": { value: { type: "string", value: "浙江ABC染整" } } }),
    (error) => error.code === "SENSITIVE_RESIDUALS",
  );
});

// Real tests from staff were stopped 27 times: the check found selected values inside the file's own structure.
test("残留检查只看用户能读到的文字：序号、金额、年份、短代码和字体名不再误拦", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const { analyzeWorkbook, tokenizeWorkbook } = await import("../src/xlsxCore.js");
  for (const values of [["1", "2", "3"], ["100", "2500"], ["2026", "2025"], ["A", "B1", "C"], ["宋体", "等线"]]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("客户");
    sheet.addRow(["客户名称", "备注"]);
    values.forEach((value, index) => sheet.addRow([value, `第${index + 1}行`]));
    const column = analyzeWorkbook(workbook).columns.find(c => c.header === "客户名称");
    const result = tokenizeWorkbook(workbook, [{ ...column, processingMode: "whole" }], "AB12CD34");
    await assertNoSensitiveValuesInXlsxPackage(await workbook.xlsx.writeBuffer(), result.mapping);
  }
});

test("真实残留仍会拦下，并用看得懂的位置说明", async () => {
  const mapping = { "[[C001@A1B2C3D4]]": { value: { type: "string", value: "虚构星河化工" } } };
  for (const [part, xml, where] of [
    ["xl/comments1.xml", "<comments><comment><text><t>虚构星河化工 的合同</t></text></comment></comments>", "批注"],
    ["xl/workbook.xml", '<workbook><sheets><sheet name="虚构星河化工" sheetId="1"/></sheets></workbook>', "工作表名称或定义的名称"],
    ["xl/sharedStrings.xml", "<sst><si><t>拜访 虚构星河化工</t></si></sst>", "单元格文字"],
  ]) {
    await assert.rejects(() => xlsxBytes({ [part]: xml }).then(bytes => assertNoSensitiveValuesInXlsxPackage(bytes, mapping)), error => error.code === "SENSITIVE_RESIDUALS" && error.details.some(detail => detail.startsWith(where)));
  }
  // A short code only counts when a whole text equals it, not inside a cell reference or a longer word.
  const code = { "[[C001@A1B2C3D4]]": { value: { type: "string", value: "K52" } } };
  await assertNoSensitiveValuesInXlsxPackage(await xlsxBytes({ "xl/sharedStrings.xml": "<sst><si><t>K5204</t></si></sst>" }), code);
  await assert.rejects(() => xlsxBytes({ "xl/sharedStrings.xml": "<sst><si><t>K52</t></si></sst>" }).then(bytes => assertNoSensitiveValuesInXlsxPackage(bytes, code)), { code: "SENSITIVE_RESIDUALS" });
});
