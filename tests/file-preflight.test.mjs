import test from "node:test";
import assert from "node:assert/strict";
import { FILE_SIZE_LIMITS, preflightFile, prepareFile } from "../src/filePreflight.js";
import { highRiskTextFindings, protectedOutputName, suspiciousTextFindings } from "../src/fileSafety.js";

function file(name, bytes, type = "") {
  const value = Uint8Array.from(bytes);
  return { name, type, size: value.byteLength, arrayBuffer: async () => value.buffer };
}

test("一次处理只读取一次原文件，跨操作不保留源文件缓存", async () => {
  let reads = 0;
  const source = { name: "客户.csv", size: 1, type: "text/csv", arrayBuffer: async () => { reads += 1; return Uint8Array.of(65).buffer; } };
  const first = await prepareFile(source, ["csv"]);
  await Promise.all([first.file.arrayBuffer(), first.file.arrayBuffer()]);
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(first.evidence).includes("buffer"), false);
  await prepareFile(source, ["csv"]);
  assert.equal(reads, 2);
  await assert.rejects(() => prepareFile({ ...source, size: FILE_SIZE_LIMITS.csv + 1 }, ["csv"]), error => error.code === "CSV_TOO_LARGE");
  assert.equal(reads, 2);
});

test("预检同时核对入口格式、Office 签名和文本内容", async () => {
  const xlsx = await preflightFile(file("销售.xlsx", [0x50, 0x4b, 0x03, 0x04]), ["xlsx"]);
  assert.equal(xlsx.signature, "ZIP/Office Open XML");

  await assert.rejects(
    () => preflightFile(file("伪装.xlsx", [0x3c, 0x68, 0x74, 0x6d, 0x6c]), ["xlsx"]),
    (error) => error.code === "FORMAT_MISMATCH",
  );
  await assert.rejects(
    () => preflightFile(file("二进制.csv", [0x41, 0x00, 0x42]), ["csv"]),
    (error) => error.code === "INVALID_CSV",
  );
  const markdown = await preflightFile(file("说明.md", [0x23, 0x20, 0x41], "text/markdown"), ["md"]);
  assert.equal(markdown.signature, "文本内容");
  await assert.rejects(
    () => preflightFile(file("二进制.txt", [0x41, 0x00, 0x42]), ["txt"]),
    (error) => error.code === "INVALID_TEXT",
  );
  await assert.rejects(
    () => preflightFile(file("说明.txt", [0x41]), ["xlsx", "csv"]),
    (error) => error.code === "UNSUPPORTED_FILE",
  );
});

test("MIME 不一致只作为证据警告，内容签名仍是决定依据", async () => {
  const result = await preflightFile(file("报告.docx", [0x50, 0x4b, 0x03, 0x04], "application/octet-stream"), ["docx"]);
  assert.equal(result.preflightWarnings.length, 1);
  assert.equal(result.reportedMimeType, "application/octet-stream");
});

test("文件尺寸在读取前按格式限制，并返回预检证据", async () => {
  for (const [format, sizeLimit] of Object.entries(FILE_SIZE_LIMITS)) {
    let oversizedRead = false;
    const oversized = {
      name: `超大.${format}`,
      type: "application/octet-stream",
      size: sizeLimit + 1,
      arrayBuffer: async () => { oversizedRead = true; return new ArrayBuffer(0); },
    };
    const expectedCode = format === "csv" ? "CSV_TOO_LARGE" : ["txt", "md"].includes(format) ? "TEXT_TOO_LARGE" : "FILE_TOO_LARGE";
    await assert.rejects(() => preflightFile(oversized, [format]), (error) => error.code === expectedCode);
    assert.equal(oversizedRead, false, `${format} 超限后不应读取内容`);

    const signature = ["xlsx", "docx", "pptx"].includes(format) ? [0x50, 0x4b, 0x03, 0x04] : [0x41];
    const boundary = {
      name: `边界.${format}`,
      type: "",
      size: sizeLimit,
      arrayBuffer: async () => Uint8Array.from(signature).buffer,
    };
    const result = await preflightFile(boundary, [format]);
    assert.equal(result.fileSize, sizeLimit);
    assert.equal(result.sizeLimit, sizeLimit);
    assert.equal(result.sizeCheck, "passed");
  }
});

test("V2 脱敏文件名不携带原文件名，文本检查识别不可见字符", () => {
  assert.equal(protectedOutputName("xlsx", "A1B2C3D4"), "脱敏文件_A1B2C3D4.xlsx");
  assert.deepEqual(suspiciousTextFindings("普通文字"), []);
  assert.match(suspiciousTextFindings("客户\u200B名称")[0], /U\+200B/);
  assert.deepEqual(highRiskTextFindings("电话 13800138000，邮箱 test@example.com").map((item) => item.label), ["手机号码", "电子邮箱"]);
});
