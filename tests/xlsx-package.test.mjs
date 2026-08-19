import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { preflightXlsxPackage } from "../src/xlsxPackageCore.js";

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
