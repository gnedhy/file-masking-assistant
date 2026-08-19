import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  findAlteredTokens,
  inspectOfficePackage,
  loadOfficePackage,
  restoreOfficePackage,
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
  const bytes = await packageBytes("docx", {
    "word/document.xml": `<w:document><w:body>${wParagraph(C)}</w:body></w:document>`,
  });
  const richTextMapping = {
    [C]: {
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

test("inspection reports mixed tasks, unknown tokens and unsupported chart tokens", async () => {
  const mixed = `[[C001@AAAAAAAA]]`;
  const unknown = `[[X999@${TASK}]]`;
  const bytes = await packageBytes("pptx", {
    "ppt/slides/slide1.xml": `<p:sld>${aParagraph(C, mixed, unknown)}</p:sld>`,
    "ppt/charts/chart1.xml": `<c:chart><c:tx><a:t>${P}</a:t></c:tx></c:chart>`,
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
