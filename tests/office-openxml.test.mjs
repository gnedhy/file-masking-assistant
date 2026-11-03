import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  analyzeDocxProtectionPackage,
  assertNoSensitiveValuesInOfficePackage,
  findAlteredTokens,
  inspectOfficePackage,
  loadOfficePackage,
  restoreOfficePackage,
  tokenizeDocxPackage,
  validateDocxProtectionStructure,
  scrubOfficeMetadata,
} from "../src/officeOpenXmlCore.js";

const TASK = "7F2A9C4D";
const C = `[[C001@${TASK}]]`;
const P = `[[P001@${TASK}]]`;
const S = `[[S001@${TASK}]]`;
const mapping = {
  [C]: { value: { type: "string", value: "浙江ABC染整有限公司" } },
  [P]: { value: { type: "string", value: "HT-825GK" } },
  [S]: { value: { type: "string", value: "张三" } },
};

test("short aliases in Office attributes and relationships are unsupported", async () => {
  const bytes = await packageBytes("pptx", {
    "ppt/slides/slide1.xml": '<p:sld name="产品-K7M4-01"><a:p><a:r><a:t>客户-K7M4-01</a:t></a:r></a:p></p:sld>',
    "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Target="人员-K7M4-01"/></Relationships>',
  });
  const { zip } = await loadOfficePackage(bytes, "pptx");
  const inspection = await inspectOfficePackage(zip, "pptx");
  assert.equal(inspection.occurrences.length, 1);
  assert.equal(inspection.unsupportedOccurrences.length, 2);
});

function contentTypes(format) {
  const type = format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
  return `<?xml version="1.0"?><Types><Override ContentType="${type}"/></Types>`;
}

function wParagraph(...parts) {
  return `<w:p>${parts.map((part, index) => `<w:r><w:rPr><w:b w:val="${index ? 0 : 1}"/></w:rPr><w:t>${part}</w:t></w:r>`).join("")}</w:p>`;
}

function aParagraph(...parts) {
  return `<a:p>${parts.map((part, index) => `<a:r><a:rPr b="${index ? 0 : 1}"/><a:t>${part}</a:t></a:r>`).join("")}</a:p>`;
}

async function packageBytes(format, files = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes(format));
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array" });
}

test("DOCX restores body, tables, text boxes, headers, footers and split tokens", async () => {
  const split = [C.slice(0, 6), C.slice(6, 13), C.slice(13)];
  const bytes = await packageBytes("docx", {
    "word/document.xml": `<w:document><w:body>${wParagraph("客户：", ...split)}<w:tbl><w:tr><w:tc>${wParagraph(P)}</w:tc></w:tr></w:tbl><w:txbxContent>${wParagraph(S)}</w:txbxContent></w:body></w:document>`,
    "word/header1.xml": `<w:hdr>${wParagraph(C)}</w:hdr>`,
    "word/footer1.xml": `<w:ftr>${wParagraph(S)}</w:ftr>`,
    "word/media/image1.png": new Uint8Array([1, 2, 3, 4]),
  });
  const { zip, format } = await loadOfficePackage(bytes, "docx");
  const before = await inspectOfficePackage(zip, format, mapping);
  assert.equal(before.occurrences.length, 5);
  assert.deepEqual(new Set(before.checkedAreas), new Set(["正文、表格和文本框", "页眉", "页脚"]));
  assert.equal(before.altered.length, 0);

  const restored = await restoreOfficePackage(zip, format, mapping);
  assert.equal(restored.restoredOccurrences, 5);
  const documentXml = await zip.file("word/document.xml").async("string");
  assert.match(documentXml, /浙江ABC染整有限公司/);
  assert.match(documentXml, /HT-825GK/);
  assert.match(documentXml, /张三/);
  assert.match(documentXml, /<w:rPr><w:b w:val="0"\/><\/w:rPr><w:t>浙江ABC染整有限公司<\/w:t>/);
  assert.deepEqual(await zip.file("word/media/image1.png").async("uint8array"), new Uint8Array([1, 2, 3, 4]));
  const after = await inspectOfficePackage(zip, format, mapping);
  assert.equal(after.occurrences.length, 0);
});

test("DOCX protection identifies labeled content and preserves first-run style", async () => {
  const customer = "浙江ABC染整有限公司";
  const bytes = await packageBytes("docx", {
    "word/document.xml": `<w:document><w:body>${wParagraph("客户名称：", customer.slice(0, 4), customer.slice(4))}<w:tbl><w:tr><w:tc>${wParagraph("产品内部编码")}</w:tc><w:tc>${wParagraph("销售人员")}</w:tc></w:tr><w:tr><w:tc>${wParagraph("HT-825GK")}</w:tc><w:tc>${wParagraph("张三")}</w:tc></w:tr></w:tbl>${wParagraph(`建议由张三继续跟进${customer}`)}</w:body></w:document>`,
    "word/header1.xml": `<w:hdr>${wParagraph(`客户名称：${customer}`)}</w:hdr>`,
    "word/footer1.xml": `<w:ftr>${wParagraph("销售人员：张三")}</w:ftr>`,
  });
  const { zip } = await loadOfficePackage(bytes, "docx");
  const analysis = await analyzeDocxProtectionPackage(zip);
  assert.deepEqual(new Set(analysis.candidates.map((item) => item.value)), new Set([customer, "HT-825GK", "张三"]));
  const tokenized = await tokenizeDocxPackage(zip, analysis.candidates, TASK);
  assert.equal(tokenized.uniqueValues, 3);
  assert.equal(tokenized.replacedOccurrences, 7);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /<w:rPr><w:b w:val="0"\/><\/w:rPr><w:t>\[\[客户名称:C001@7F2A9C4D\]\]<\/w:t>/);
  assert.doesNotMatch(xml, /浙江ABC染整有限公司|HT-825GK|张三/);
  const restored = await restoreOfficePackage(zip, "docx", tokenized.mapping);
  assert.equal(restored.restoredOccurrences, 7);
});

test("DOCX protection fails closed on comments, revisions, controls, fields and notes", async () => {
  for (const files of [
    { "word/document.xml": `<w:document>${wParagraph("正文")}</w:document>`, "word/comments.xml": `<w:comments><w:comment w:id="0">${wParagraph("批注")}</w:comment></w:comments>` },
    { "word/document.xml": `<w:document><w:ins>${wParagraph("修订")}</w:ins></w:document>` },
    { "word/document.xml": `<w:document><w:sdt>${wParagraph("控件")}</w:sdt></w:document>` },
    { "word/document.xml": `<w:document><w:fldSimple w:instr="DATE">${wParagraph("域")}</w:fldSimple></w:document>` },
    { "word/document.xml": `<w:document>${wParagraph("正文")}</w:document>`, "word/footnotes.xml": `<w:footnotes><w:footnote w:id="1">${wParagraph("脚注")}</w:footnote></w:footnotes>` },
  ]) {
    const { zip } = await loadOfficePackage(await packageBytes("docx", files), "docx");
    await assert.rejects(() => validateDocxProtectionStructure(zip), (error) => error.code === "UNSUPPORTED_DOCX_STRUCTURE");
  }
});

test("DOCX protection rejects external relationships and scrubs document metadata", async () => {
  const bytes = await packageBytes("docx", {
    "word/document.xml": `<w:document>${wParagraph("客户名称：浙江ABC染整")}</w:document>`,
    "word/_rels/document.xml.rels": '<Relationships><Relationship TargetMode="External" Target="https://example.test/template.dotx"/></Relationships>',
    "docProps/core.xml": "<cp:coreProperties><dc:title>客户项目</dc:title><dc:creator>张三</dc:creator></cp:coreProperties>",
    "docProps/app.xml": "<Properties><Company>浙江ABC染整</Company><Manager>张三</Manager></Properties>",
    "docProps/custom.xml": '<Properties><property name="客户名称"><vt:lpwstr>浙江ABC染整</vt:lpwstr></property></Properties>',
  });
  const { zip } = await loadOfficePackage(bytes, "docx");
  await assert.rejects(() => validateDocxProtectionStructure(zip), (error) => error.code === "UNSUPPORTED_DOCX_STRUCTURE" && error.details.some((item) => item.includes("外部链接")));
  zip.remove("word/_rels/document.xml.rels");
  await scrubOfficeMetadata(zip);
  assert.equal((await zip.file("docProps/core.xml").async("string")).includes("张三"), false);
  assert.equal((await zip.file("docProps/app.xml").async("string")).includes("浙江ABC染整"), false);
  assert.equal((await zip.file("docProps/custom.xml").async("string")).includes("客户名称"), false);
});

test("DOCX protection blocks selected values left in an unhandled XML part", async () => {
  const { zip } = await loadOfficePackage(await packageBytes("docx", {
    "word/document.xml": `<w:document>${wParagraph(C)}</w:document>`,
    "word/charts/chart1.xml": "<c:chart><c:v>浙江ABC染整有限公司</c:v></c:chart>",
  }), "docx");
  await assert.rejects(() => assertNoSensitiveValuesInOfficePackage(zip, mapping), (error) => error.code === "SENSITIVE_RESIDUALS" && error.details[0].includes("chart1.xml"));
});

async function chartWorkbook(extra = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
  zip.file("xl/sharedStrings.xml", `<sst><si><t>${C}</t></si><si><t>${P}</t></si><si><t>销售额</t></si></sst>`);
  zip.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row><c r="A2" t="s"><v>0</v></c></row></sheetData></worksheet>');
  for (const [path, value] of Object.entries(extra)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array" });
}

function chartPackage(workbook, rels = '<Relationships><Relationship Id="rId1" Target="../embeddings/Microsoft_Excel_Sheet1.xlsx"/></Relationships>') {
  const point = (index, value) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`;
  return packageBytes("pptx", {
    "ppt/slides/slide1.xml": `<p:sld>${aParagraph("客户销售额")}</p:sld>`,
    "ppt/charts/chart1.xml": `<c:chartSpace><c:title><c:tx><c:rich>${aParagraph("重点客户 ", C)}</c:rich></c:tx></c:title><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/>${point(0, C)}${point(1, P)}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache>${point(0, 128000)}${point(1, 86000)}</c:numCache></c:numRef></c:val></c:chartSpace>`,
    "ppt/charts/_rels/chart1.xml.rels": rels,
    "ppt/embeddings/Microsoft_Excel_Sheet1.xlsx": workbook,
  });
}

test("PPTX chart text, categories and the chart's data workbook are restored", async () => {
  const { zip, format } = await loadOfficePackage(await chartPackage(await chartWorkbook()), "pptx");
  const before = await inspectOfficePackage(zip, format, mapping);
  assert.equal(before.occurrences.length, 3);
  assert.equal(before.chartDataOccurrences.length, 2);
  assert.deepEqual(before.altered, []);
  assert.ok(before.checkedAreas.includes("图表文字和数据"));
  assert.equal((await restoreOfficePackage(zip, format, mapping)).restoredOccurrences, 3);
  const chart = await zip.file("ppt/charts/chart1.xml").async("string");
  assert.match(chart, /<c:v>浙江ABC染整有限公司<\/c:v><\/c:pt><c:pt idx="1"><c:v>HT-825GK<\/c:v>/);
  assert.match(chart, /<c:f>Sheet1!\$A\$2:\$A\$3<\/c:f>/);
  const nested = await JSZip.loadAsync(await zip.file("ppt/embeddings/Microsoft_Excel_Sheet1.xlsx").async("uint8array"));
  assert.match(await nested.file("xl/sharedStrings.xml").async("string"), /<t>浙江ABC染整有限公司<\/t><\/si><si><t>HT-825GK<\/t>/);
  const after = await inspectOfficePackage(zip, format);
  assert.equal(after.occurrences.length + after.chartDataOccurrences.length + after.unsupportedOccurrences.length, 0);
});

test("only chart data workbooks are allowed as PPTX embeddings", async () => {
  const unreferenced = await chartPackage(await chartWorkbook(), "<Relationships/>");
  await assert.rejects(() => loadOfficePackage(unreferenced, "pptx"), (error) => error.code === "EMBEDDED_OBJECTS");
  const external = await chartPackage(await chartWorkbook(), '<Relationships><Relationship Target="../embeddings/Microsoft_Excel_Sheet1.xlsx" TargetMode="External"/></Relationships>');
  await assert.rejects(() => loadOfficePackage(external, "pptx"), (error) => error.code === "EMBEDDED_OBJECTS");
  const macro = await chartPackage(await chartWorkbook({ "xl/vbaProject.bin": new Uint8Array([1]) }));
  await assert.rejects(() => loadOfficePackage(macro, "pptx"), (error) => error.code === "EMBEDDED_OBJECTS");
  const ole = await packageBytes("pptx", { "ppt/slides/slide1.xml": `<p:sld>${aParagraph(C)}</p:sld>`, "ppt/embeddings/oleObject1.bin": new Uint8Array([1]) });
  await assert.rejects(() => loadOfficePackage(ole, "pptx"), (error) => error.code === "EMBEDDED_OBJECTS");
});

test("a token left in another part of the chart workbook stops the restore", async () => {
  const { zip, format } = await loadOfficePackage(await chartPackage(await chartWorkbook({ "docProps/core.xml": `<cp:coreProperties><dc:title>${S}</dc:title></cp:coreProperties>` })), "pptx");
  const inspection = await inspectOfficePackage(zip, format, mapping);
  assert.equal(inspection.unsupportedOccurrences.length, 1);
  assert.match(inspection.unsupportedOccurrences[0].location, /图表数据 docProps\/core\.xml/);
});

test("PPTX restores slide text, tables, notes, repeated and split tokens", async () => {
  const split = [C.slice(0, 4), C.slice(4, 10), C.slice(10)];
  const bytes = await packageBytes("pptx", {
    "ppt/slides/slide1.xml": `<p:sld><p:cSld><p:spTree>${aParagraph("客户：", ...split)}<a:tbl>${aParagraph(P)}</a:tbl>${aParagraph(C)}</p:spTree></p:cSld></p:sld>`,
    "ppt/notesSlides/notesSlide1.xml": `<p:notes>${aParagraph(S)}</p:notes>`,
    "ppt/theme/theme1.xml": "<a:theme><a:name>unchanged</a:name></a:theme>",
  });
  const { zip, format } = await loadOfficePackage(bytes, "pptx");
  const before = await inspectOfficePackage(zip, format, mapping);
  assert.equal(before.occurrences.length, 4);
  assert.deepEqual(new Set(before.checkedAreas), new Set(["幻灯片文字和表格", "演讲者备注"]));
  const themeBefore = await zip.file("ppt/theme/theme1.xml").async("string");
  const restored = await restoreOfficePackage(zip, format, mapping);
  assert.equal(restored.restoredOccurrences, 4);
  assert.equal(await zip.file("ppt/theme/theme1.xml").async("string"), themeBefore);
  assert.equal((await inspectOfficePackage(zip, format, mapping)).occurrences.length, 0);
});

test("DOCX 可以还原来自 XLSX 富文本映射的可见文字", async () => {
  const semanticCustomer = `[[客户名称:C001@${TASK}]]`;
  const bytes = await packageBytes("docx", {
    "word/document.xml": `<w:document><w:body>${wParagraph(semanticCustomer)}</w:body></w:document>`,
  });
  const richTextMapping = {
    [semanticCustomer]: {
      value: {
        type: "richText",
        text: "浙江 ABC染整（重点）",
        value: { richText: [{ text: "浙江 ABC" }, { text: "染整（重点）" }] },
      },
    },
  };
  const { zip, format } = await loadOfficePackage(bytes, "docx");
  const restored = await restoreOfficePackage(zip, format, richTextMapping);
  assert.equal(restored.restoredOccurrences, 1);
  assert.match(await zip.file("word/document.xml").async("string"), /浙江 ABC染整（重点）/);
});

test("inspection reports mixed tasks, unknown tokens and unsupported SmartArt tokens", async () => {
  const mixed = `[[C001@AAAAAAAA]]`;
  const unknown = `[[X999@${TASK}]]`;
  const bytes = await packageBytes("pptx", {
    "ppt/slides/slide1.xml": `<p:sld>${aParagraph(C, mixed, unknown)}</p:sld>`,
    "ppt/diagrams/data1.xml": `<dgm:dataModel><a:t>${P}</a:t></dgm:dataModel>`,
  });
  const { zip, format } = await loadOfficePackage(bytes, "pptx");
  const inspection = await inspectOfficePackage(zip, format, mapping);
  assert.deepEqual(new Set(inspection.taskIds), new Set([TASK, "AAAAAAAA"]));
  assert.ok(inspection.uniqueTokens.includes(unknown));
  assert.equal(inspection.unsupportedOccurrences[0].token, P);
});

test("altered known short tokens and partial syntax are detected", () => {
  const xml = `<w:document>${wParagraph("已改成 C001，另一个残缺代号 [[P001@7F2A")}</w:document>`;
  const findings = findAlteredTokens(xml, "docx", mapping);
  assert.ok(findings.includes("C001"));
  assert.ok(findings.some((value) => value.startsWith("[[P001")));
});

test("package checks reject extension mismatch, embedded objects and configured limits", async () => {
  const docx = await packageBytes("docx", { "word/document.xml": `<w:document>${wParagraph(C)}</w:document>` });
  await assert.rejects(() => loadOfficePackage(docx, "pptx"), (error) => error.code === "FORMAT_MISMATCH");

  const embedded = await packageBytes("docx", {
    "word/document.xml": `<w:document>${wParagraph(C)}</w:document>`,
    "word/embeddings/oleObject1.bin": new Uint8Array([1]),
  });
  await assert.rejects(() => loadOfficePackage(embedded, "docx"), (error) => error.code === "EMBEDDED_OBJECTS");
  await assert.rejects(
    () => loadOfficePackage(docx, "docx", { compressedBytes: 1, uncompressedBytes: 1024, entries: 10 }),
    (error) => error.code === "FILE_TOO_LARGE",
  );
  await assert.rejects(
    () => loadOfficePackage(docx, "docx", { compressedBytes: 1024 * 1024, uncompressedBytes: 1, entries: 10 }),
    (error) => error.code === "PACKAGE_TOO_LARGE",
  );
});

test("invalid and token-free packages fail inspection safely", async () => {
  await assert.rejects(() => loadOfficePackage(new Uint8Array([1, 2, 3]), "docx"), (error) => error.code === "INVALID_OFFICE_PACKAGE");
  const bytes = await packageBytes("docx", { "word/document.xml": `<w:document>${wParagraph("没有代号")}</w:document>` });
  const { zip, format } = await loadOfficePackage(bytes, "docx");
  const inspection = await inspectOfficePackage(zip, format, mapping);
  assert.equal(inspection.occurrences.length, 0);
});
