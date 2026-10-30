import test from "node:test";
import assert from "node:assert/strict";
import { validateCredential, readTaskCredential } from "../src/taskIdentity.js";
import { tokenizeCsv, inspectCsvTokens, restoreCsvValues, analyzeCsv, parseCsvText } from "../src/csvCore.js";
import { inspectAlteredTextTokens } from "../src/textCore.js";
import {
  createEntityToken,
  parseEntityToken,
  sanitizeSemanticLabel,
  tokenPattern,
} from "../src/tokenFormat.js";

test("new tasks create semantic tokens from the existing field name", () => {
  const token = createEntityToken({ label: "产品名称", category: "product", prefix: "P", sequence: 1, taskId: "7F2A9C4D" });
  assert.equal(token, "[[产品名称:P001@7F2A9C4D]]");
  assert.deepEqual(parseEntityToken(token), {
    token,
    semanticLabel: "产品名称",
    shortToken: "P001",
    taskId: "7F2A9C4D",
    formatVersion: 2,
  });
});

test("legacy tokens remain valid and restorable", () => {
  const token = "[[P001@7F2A9C4D]]";
  assert.equal(tokenPattern("").test(token), true);
  assert.deepEqual(parseEntityToken(token), {
    token,
    semanticLabel: null,
    shortToken: "P001",
    taskId: "7F2A9C4D",
    formatVersion: 1,
  });
});

test("semantic labels are safe, bounded, and have category fallbacks", () => {
  assert.equal(sanitizeSemanticLabel(" 产品[名称]:\u200B@内部编号超长字段名称测试 ", "product"), "产品名称内部编号超长字段名称测试".slice(0, 16));
  assert.equal(sanitizeSemanticLabel("产品|型号`说明", "product"), "产品型号说明");
  assert.equal(sanitizeSemanticLabel("手动添加", "custom"), "敏感信息");
  assert.equal(sanitizeSemanticLabel("", "sales"), "销售人员");
});

test("malformed semantic tokens are rejected", () => {
  assert.equal(parseEntityToken("[[产品名称:P001@7F2A]]"), null);
  assert.equal(parseEntityToken("[[产品@名称:P001@7F2A9C4D]]"), null);
  assert.throws(() => createEntityToken({ label: "产品名称", prefix: "Q", sequence: 1, taskId: "7F2A9C4D" }), /prefix/i);
});

test("short aliases have independent marker identity and extend beyond 99", () => {
  const taskId = { tokenFormat: "short", marker: "K7M4" };
  const token = createEntityToken({ prefix: "P", sequence: 100, taskId });
  assert.equal(token, "产品-K7M4-100");
  assert.equal(parseEntityToken(token).taskId, null);
  assert.equal(parseEntityToken(token).marker, "K7M4");
  assert.equal(parseEntityToken("产品-k7m4-01"), null);
  assert.equal(parseEntityToken("产品-K7M4-01abc"), null);
  const document = parseCsvText(`产品名称\n${Array.from({ length: 105 }, (_, i) => `型号${i}`).join("\n")}\n型号0`);
  const result = tokenizeCsv(document, analyzeCsv(document).columns, taskId);
  assert.equal(result.uniqueValues, 105);
  assert.equal(document.rows.at(-1)[0], "产品-K7M4-01");
  assert.equal(document.rows[100][0], token);
  assert.deepEqual(inspectCsvTokens(document).taskIds, ["short:K7M4"]);
  assert.equal(restoreCsvValues(document, result.mapping).restoredOccurrences, 106);
});

test("recognizable altered aliases do not silently pass", () => {
  for (const token of ["产品-k7m4-01", "产品－K7M4－01", "产品-K7M4", "产品-K7M4-1", "产品 K7M4 01", "产品-K7M4-01abc"]) {
    assert.ok(inspectAlteredTextTokens(token, {}).length, token);
  }
});

test("credential structure is strict and oversized input is never read", async () => {
  const valid = { version: 1, taskId: "3c9c8560-f817-41e6-a563-84c839a68bb7", marker: "K7M4", verification: "a".repeat(32) };
  assert.deepEqual(validateCredential(valid), valid);
  for (const bad of [{ ...valid, mapping: {} }, { ...valid, marker: "abcd" }, { ...valid, verification: "a".repeat(16) }, { ...valid, version: 0 }, []]) assert.throws(() => validateCredential(bad), { code: "INVALID_CREDENTIAL" });
  await assert.rejects(readTaskCredential({ size: 16385, arrayBuffer() { assert.fail("must not read"); } }), { code: "INVALID_CREDENTIAL" });
});
