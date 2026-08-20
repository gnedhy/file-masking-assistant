import test from "node:test";
import assert from "node:assert/strict";
import { addManualCandidate, analyzeText, inspectAlteredTextTokens, inspectTextTokens, restoreText, tokenizeText } from "../src/textCore.js";

const source = [
  "---",
  "项目代号: Atlas-9",
  "---",
  "客户名称：浙江ABC染整有限公司",
  "| 客户名称 | 产品内部编码 | 销售人员 |",
  "| --- | --- | --- |",
  "| 浙江ABC染整有限公司 | HT-825GK | 张三 |",
  "```text",
  "Atlas-9 / 浙江ABC染整有限公司",
  "```",
].join("\r\n");

test("TXT/MD 从明确标签和表格识别候选，并允许手动添加", () => {
  const analysis = analyzeText(source, "md");
  assert.deepEqual(analysis.candidates.map((item) => item.value), ["浙江ABC染整有限公司", "HT-825GK", "张三"]);
  assert.equal(analysis.candidates[0].count, 3);
  const manual = addManualCandidate(analysis, "Atlas-9");
  assert.equal(manual.count, 2);
  assert.equal(manual.prefix, "X");
  assert.throws(() => addManualCandidate(analysis, "不存在"), (error) => error.code === "TEXT_VALUE_NOT_FOUND");
});

test("TXT/MD 精确脱敏与还原保持原有换行和非目标内容", () => {
  const analysis = analyzeText(source, "md");
  const manual = addManualCandidate(analysis, "Atlas-9");
  const tokenized = tokenizeText(source, [...analysis.candidates, manual], "A14F2026");
  assert.equal(tokenized.replacedOccurrences, 7);
  assert.equal(tokenized.text.includes("\r\n"), true);
  assert.equal(tokenized.text.includes("https://"), false, "fixture has no URL and should remain deterministic");
  const inspection = inspectTextTokens(tokenized.text);
  assert.equal(inspection.taskIds[0], "A14F2026");
  assert.equal(inspection.uniqueTokens.length, 4);
  const restored = restoreText(tokenized.text, tokenized.mapping);
  assert.equal(restored.text, source);
  assert.equal(restored.restoredOccurrences, 7);
});

test("TXT/MD 能识别残缺和已知短代号", () => {
  const mapping = { "[[C001@A14F2026]]": { value: { type: "string", value: "真实客户" } } };
  assert.equal(inspectAlteredTextTokens("内容 [[C001@A14F", mapping).length, 1);
  assert.equal(inspectAlteredTextTokens("内容 C001", mapping).length, 1);
  assert.equal(inspectAlteredTextTokens("内容 [[C001@A14F2026]]", mapping).length, 0);
});
