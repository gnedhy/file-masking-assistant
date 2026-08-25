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

test("XLSX package preflight rejects format mismatch, macro and embedded objects", async () => {
  await assert.rejects(async () => preflightXlsxPackage(await xlsxBytes({}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")), (error) => error.code === "FORMAT_MISMATCH");
  await assert.rejects(async () => preflightXlsxPackage(await xlsxBytes({ "xl/vbaProject.bin": new Uint8Array([1]) })), (error) => error.code === "EMBEDDED_OBJECTS");
  await assert.rejects(async () => preflightXlsxPackage(await xlsxBytes({ "xl/embeddings/oleObject1.bin": new Uint8Array([1]) })), (error) => error.code === "EMBEDDED_OBJECTS");
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
