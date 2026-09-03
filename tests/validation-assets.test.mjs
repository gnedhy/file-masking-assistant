import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { parseCsvText, restoreCsvValues, stringifyCsv } from "../src/csvCore.js";
import { analyzeDocxProtectionPackage, inspectOfficePackage, loadOfficePackage, restoreOfficePackage, tokenizeDocxPackage } from "../src/officeOpenXmlCore.js";
import { inspectHtmlText, restoreHtmlText } from "../src/htmlCore.js";
import { inspectTextTokens, restoreText } from "../src/textCore.js";

const root = path.resolve(process.env.VALIDATION_ASSET_DIR || "tests/output/validation-assets");
const mapFile = path.join(root, "00_测试说明", "本机映射_仅测试_A14F2026.json");
const vault = JSON.parse(await fs.readFile(mapFile, "utf8"));
const { mapping, taskId } = vault;
const outputDir = path.join(root, "06_还原输出");
const window = new JSDOM("<!doctype html><html><body></body></html>").window;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("CSV sample restores all formal tokens and matches original values", async () => {
  const input = await fs.readFile(path.join(root, "02_脱敏样本", `销售测试数据_脱敏版_${taskId}.csv`), "utf8");
  const document = parseCsvText(input);
  const restored = restoreCsvValues(document, mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.ok(restored.restoredOccurrences >= 18);
  const output = stringifyCsv(document);
  assert.doesNotMatch(output, /\[\[/);
  assert.match(output, /浙江ABC染整有限公司/);
  await fs.writeFile(path.join(outputDir, `销售测试数据_还原版_${taskId}.csv`), `\uFEFF${output.replace(/^\uFEFF/, "")}`, "utf8");
});

for (const format of ["txt", "md"]) {
  test(`${format.toUpperCase()} sample restores all formal tokens and preserves text format`, async () => {
    const stem = format === "txt" ? "业务跟进" : "客户分析";
    const safe = await fs.readFile(path.join(root, "08_文本样本", `${stem}_脱敏版_${taskId}.${format}`), "utf8");
    const original = await fs.readFile(path.join(root, "08_文本样本", `${stem}_原始版.${format}`), "utf8");
    const inspection = inspectTextTokens(safe);
    assert.equal(inspection.taskIds[0], taskId);
    const restored = restoreText(safe, mapping);
    assert.equal(restored.unresolved.length, 0);
    assert.equal(restored.text, original);
    assert.doesNotMatch(restored.text, /\[\[/);
    await fs.writeFile(path.join(outputDir, `${stem}_还原版_${taskId}.${format}`), restored.text, "utf8");
  });
}

for (const format of ["docx", "pptx"]) {
  test(`${format.toUpperCase()} baseline restores and keeps unmodified package parts byte-identical`, async () => {
    const folder = format === "pptx" ? "03_PPTX样本" : "04_DOCX样本";
    const name = `销售经营分析_代号版_${taskId}.${format}`;
    const bytes = await fs.readFile(path.join(root, folder, name));
    const { zip, format: detected } = await loadOfficePackage(bytes, format);
    assert.equal(detected, format);
    const before = await inspectOfficePackage(zip, format, mapping);
    assert.equal(before.taskIds.length, 1);
    assert.equal(before.taskIds[0], taskId);
    assert.equal(before.unsupportedOccurrences.length, 0);
    assert.equal(before.altered.length, 0);
    assert.ok(before.occurrences.length >= (format === "pptx" ? 18 : 8));

    const preserved = new Map();
    for (const entry of Object.values(zip.files)) {
      const mutable = entry.name.endsWith(".xml") && (entry.name.startsWith("ppt/slides/") || entry.name.startsWith("ppt/notesSlides/") || /^word\/(document|header\d*|footer\d*)\.xml$/i.test(entry.name));
      if (entry.dir || mutable) continue;
      preserved.set(entry.name, sha256(await entry.async("nodebuffer")));
    }
    const restored = await restoreOfficePackage(zip, format, mapping);
    assert.equal(restored.restoredOccurrences, before.occurrences.length);
    const after = await inspectOfficePackage(zip, format, mapping);
    assert.equal(after.occurrences.length, 0);
    assert.equal(after.unsupportedOccurrences.length, 0);
    assert.equal(after.altered.length, 0);
    for (const [entryName, hash] of preserved) assert.equal(sha256(await zip.file(entryName).async("nodebuffer")), hash, entryName);

    await fs.writeFile(path.join(outputDir, `销售经营分析_还原版_${taskId}.${format}`), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  });
}

test("DOCX original completes candidate selection, protection and restoration", async () => {
  const bytes = await fs.readFile(path.join(root, "04_DOCX样本", "销售经营分析_原始版.docx"));
  const { zip } = await loadOfficePackage(bytes, "docx");
  const documentXml = await zip.file("word/document.xml").async("string");
  assert.match(documentXml, /<w:tblW w:type="dxa" w:w="8640"\/>/);
  assert.equal((documentXml.match(/<w:gridCol w:w="4320"\/>/g) ?? []).length, 2);
  const analysis = await analyzeDocxProtectionPackage(zip);
  assert.ok(analysis.candidates.length >= 6);
  const protectedResult = await tokenizeDocxPackage(zip, analysis.candidates, taskId);
  assert.ok(protectedResult.replacedOccurrences >= 9);
  assert.equal((await inspectOfficePackage(zip, "docx", protectedResult.mapping)).unsupportedOccurrences.length, 0);
  await fs.writeFile(path.join(outputDir, `销售经营分析_脱敏版_${taskId}.docx`), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  await restoreOfficePackage(zip, "docx", protectedResult.mapping);
  const after = await inspectOfficePackage(zip, "docx", protectedResult.mapping);
  assert.equal(after.occurrences.length, 0);
  const visible = ["word/document.xml", "word/header1.xml", "word/footer1.xml"]
    .map((name) => zip.file(name)).filter(Boolean);
  const xml = (await Promise.all(visible.map((entry) => entry.async("string")))).join("\n");
  assert.match(xml, /浙江ABC染整有限公司/);
  assert.match(xml, /NOVA Textiles \(Vietnam\) Co., Ltd\./);
  await fs.writeFile(path.join(outputDir, `销售经营分析_完整往返还原版_${taskId}.docx`), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
});

test("PPTX failure variants are blocked with the expected reason", async () => {
  const cases = [
    ["异常_未知代号", "UNRESOLVED_TOKENS"], ["异常_混合任务", "MIXED_TASKS"],
    ["异常_残缺代号", "ALTERED_TOKENS"], ["异常_OLE嵌入", "EMBEDDED_OBJECTS"],
    ["异常_损坏文件", "INVALID_OFFICE_PACKAGE"],
  ];
  for (const [name, expected] of cases) {
    const bytes = await fs.readFile(path.join(root, "03_PPTX样本", `${name}_${taskId}.pptx`));
    try {
      const { zip, format } = await loadOfficePackage(bytes, "pptx");
      const inspection = await inspectOfficePackage(zip, format, mapping);
      const unknown = inspection.uniqueTokens.filter((token) => !mapping[token]);
      let code = null;
      if (inspection.taskIds.length !== 1) code = "MIXED_TASKS";
      else if (unknown.length) code = "UNRESOLVED_TOKENS";
      else if (inspection.altered.length) code = "ALTERED_TOKENS";
      assert.equal(code, expected, name);
    } catch (error) {
      assert.equal(error.code, expected, name);
    }
  }
});

test("Swiss HTML restores visible tokens, removes executable content and retains static layout CSS", async () => {
  const html = await fs.readFile(path.join(root, "05_HTML样本", `销售经营分析_Swiss代号版_${taskId}.html`), "utf8");
  const inspection = inspectHtmlText(html, window, mapping);
  assert.equal(inspection.taskIds[0], taskId);
  assert.ok(inspection.occurrences.length >= 18);
  assert.equal(inspection.unsupportedOccurrences.length, 0);
  const result = restoreHtmlText(html, window, mapping);
  const restoredDocument = new JSDOM(result.html).window.document;
  assert.equal(restoredDocument.querySelectorAll("script,iframe,form,object,embed").length, 0);
  assert.equal(restoredDocument.querySelectorAll('[src^="http"], [href^="http"]').length, 0);
  assert.match(result.html, /<style/i);
  assert.match(result.html, /浙江ABC染整有限公司/);
  assert.match(result.html, /Content-Security-Policy/i);
  assert.doesNotMatch(result.html, /\[\[/);
  await fs.writeFile(path.join(outputDir, `销售经营分析_Swiss还原版_${taskId}.html`), result.html, "utf8");
});

test("HTML token placement and tampering variants fail closed", async () => {
  const cases = [
    ["异常_脚本位置含代号", "UNSUPPORTED_CONTENT"], ["异常_URL位置含代号", "UNSUPPORTED_CONTENT"],
    ["异常_事件属性含代号", "UNSUPPORTED_CONTENT"], ["异常_混合任务", "MIXED_TASKS"],
  ];
  for (const [name, expected] of cases) {
    const html = await fs.readFile(path.join(root, "05_HTML样本", `${name}_${taskId}.html`), "utf8");
    assert.throws(() => restoreHtmlText(html, window, mapping), (error) => error.code === expected, name);
  }
});

test("HTML with one altered token fails closed", async () => {
  const html = await fs.readFile(path.join(root, "05_HTML样本", `异常_残缺代号_${taskId}.html`), "utf8");
  assert.throws(() => restoreHtmlText(html, window, mapping), (error) => error.code === "ALTERED_TOKENS");
});
