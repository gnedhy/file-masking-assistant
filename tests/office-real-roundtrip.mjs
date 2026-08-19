import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  inspectOfficePackage,
  loadOfficePackage,
  restoreOfficePackage,
} from "../src/officeOpenXmlCore.js";

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("请提供验证输出目录");

const taskId = "FF3C30F7";
const mapping = {
  [`[[C001@${taskId}]]`]: { value: { type: "string", value: "浙江ABC染整" } },
  [`[[P001@${taskId}]]`]: { value: { type: "string", value: "HT-825GK" } },
  [`[[S001@${taskId}]]`]: { value: { type: "string", value: "张三" } },
};

const cases = [
  { format: "docx", name: "AI处理结果_跨格式验证.docx", minimum: 6 },
  { format: "pptx", name: "AI处理结果_跨格式验证.pptx", minimum: 5 },
];

for (const item of cases) {
  const inputPath = path.join(outputDirectory, item.name);
  const original = await fs.readFile(inputPath);
  const { zip, format } = await loadOfficePackage(original, item.format);
  assert.equal(format, item.format);
  const before = await inspectOfficePackage(zip, format, mapping);
  assert.equal(before.taskIds.length, 1);
  assert.equal(before.taskIds[0], taskId);
  assert.ok(before.occurrences.length >= item.minimum, `${item.name} 代号数量不足`);
  assert.equal(before.unsupportedOccurrences.length, 0);
  assert.equal(before.altered.length, 0);

  const restored = await restoreOfficePackage(zip, format, mapping);
  assert.equal(restored.restoredOccurrences, before.occurrences.length);
  const after = await inspectOfficePackage(zip, format, mapping);
  assert.equal(after.occurrences.length, 0);
  assert.equal(after.unsupportedOccurrences.length, 0);
  assert.equal(after.altered.length, 0);

  const outputName = item.name.replace(`.${format}`, `_还原版_${taskId}.${format}`);
  const restoredPath = path.join(outputDirectory, outputName);
  await fs.writeFile(restoredPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(JSON.stringify({ format, inputPath, restoredPath, restoredOccurrences: restored.restoredOccurrences, checkedAreas: restored.checkedAreas }));
}
