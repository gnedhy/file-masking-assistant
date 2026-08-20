import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { inspectHtmlText, restoreHtmlText } from "../src/htmlCore.js";

const window = new JSDOM("<!doctype html><html><body></body></html>").window;
const TASK = "7F2A9C4D";
const C = `[[C001@${TASK}]]`;
const P = `[[P001@${TASK}]]`;
const S = `[[S001@${TASK}]]`;
const mapping = {
  [C]: { value: { type: "string", value: "浙江ABC染整有限公司" } },
  [P]: { value: { type: "string", value: "HT-825GK" } },
  [S]: { value: { type: "string", value: "张三" } },
};

test("HTML restores visible text and approved descriptive attributes", () => {
  const html = `<!doctype html><html><head><title>${C} 销售简报</title></head><body><h1>${C}</h1><img alt="${P}" aria-label="负责人 ${S}"><p>${P} / ${S}</p></body></html>`;
  const result = restoreHtmlText(html, window, mapping);
  assert.equal(result.restoredOccurrences, 6);
  assert.match(result.html, /浙江ABC染整有限公司/);
  assert.match(result.html, /HT-825GK/);
  assert.match(result.html, /张三/);
  assert.doesNotMatch(result.html, /\[\[/);
});

test("HTML blocks tokens in script, style, URL and event attributes", () => {
  for (const html of [
    `<script>const customer='${C}'</script><p>${C}</p>`,
    `<style>.x{background:url('${C}')}</style><p>${C}</p>`,
    `<a href="https://example.test/${C}">${C}</a>`,
    `<div onclick="send('${C}')">${C}</div>`,
  ]) assert.throws(() => restoreHtmlText(html, window, mapping), (error) => error.code === "UNSUPPORTED_CONTENT");
});

test("HTML removes executable and remote content when it contains no tokens", () => {
  const html = `<html><body><script>alert(1)</script><form action="https://evil.test"><input></form><img src="https://evil.test/pixel" alt="${C}"><p>${P}</p></body></html>`;
  const result = restoreHtmlText(html, window, mapping);
  assert.doesNotMatch(result.html, /<script|<form|evil\.test|<input/i);
  assert.match(result.html, /Content-Security-Policy/i);
  assert.ok(result.removed.elements >= 2);
  assert.ok(result.removed.remoteResources >= 1);
});

test("HTML rejects unknown, mixed, altered and token-free documents", () => {
  assert.throws(() => restoreHtmlText(`<p>[[X999@${TASK}]]</p>`, window, mapping), (error) => error.code === "UNRESOLVED_TOKENS");
  assert.throws(() => restoreHtmlText(`<p>${C} [[C001@AAAAAAAA]]</p>`, window, mapping), (error) => error.code === "MIXED_TASKS");
  assert.throws(() => restoreHtmlText(`<p>C001</p>`, window, mapping), (error) => error.code === "ALTERED_TOKENS");
  assert.throws(() => restoreHtmlText("<p>无代号</p>", window, mapping), (error) => error.code === "NO_TOKENS");
});

test("HTML partially restores exact tokens without guessing altered tokens", () => {
  const altered = `[[C00X@${TASK}]]`;
  const result = restoreHtmlText(`<p>${C}</p><code>${altered}</code>`, window, mapping);
  assert.equal(result.restoredOccurrences, 1);
  assert.equal(result.partialRestore, true);
  assert.deepEqual(result.unresolved, [{ location: "<code> 可见文字", value: altered }]);
  assert.match(result.html, /浙江ABC染整有限公司/);
  assert.match(result.html, /\[\[C00X@7F2A9C4D\]\]/);
});

test("HTML inspection reports removals without executing the page", () => {
  const inspection = inspectHtmlText(`<script>fetch('https://evil.test')</script><p>${C}</p>`, window, mapping);
  assert.equal(inspection.occurrences.length, 1);
  assert.equal(inspection.removed.elements, 1);
});
