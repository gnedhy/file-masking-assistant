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
    `<script type="text/template">${C}</script><p>${C}</p>`,
    `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js?c=${C}"></script><p>${C}</p>`,
    `<script src="https://evil.test/a.js">const customer='${C}'</script><p>${C}</p>`,
    `<style>.x{background:url('${C}')}</style><p>${C}</p>`,
    `<a href="https://example.test/${C}">${C}</a>`,
    `<div onclick="send('${C}')">${C}</div>`,
  ]) assert.throws(() => restoreHtmlText(html, window, mapping), (error) => error.code === "UNSUPPORTED_CONTENT");
});

test("HTML removes executable and remote content when it contains no tokens", () => {
  const html = `<html><body><script src="https://evil.test/a.js"></script><script type="text/vbscript">x</script><form action="https://evil.test"><input></form><img src="https://evil.test/pixel" alt="${C}"><p>${P}</p></body></html>`;
  const result = restoreHtmlText(html, window, mapping);
  assert.doesNotMatch(result.html, /<script|<form|evil\.test|<input/i);
  assert.match(result.html, /Content-Security-Policy" content="default-src 'none'; img-src data:;/i);
  assert.ok(result.removed.elements >= 2);
  assert.ok(result.removed.remoteResources >= 1);
});

test("HTML keeps chart scripts, restores their labels and blocks their network access", () => {
  const quoted = `[[C002@${TASK}]]`;
  const chartMapping = { ...mapping, [quoted]: { value: { type: "string", value: `O'Neil "</script>" \\ \${x}` } } };
  const html = `<html><head><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" onload="x()"></script></head><body><h1>${C}</h1><canvas id="c"></canvas><script>new Chart(c,{data:{labels:['${C}',"${quoted}",\`${P}\`]}});</script></body></html>`;
  const result = restoreHtmlText(html, window, chartMapping);
  assert.equal(result.restoredOccurrences, 4);
  assert.equal(result.keptScripts, 2);
  const wrapper = new JSDOM(result.html).window.document;
  assert.equal(wrapper.querySelectorAll("script").length, 0);
  assert.equal(wrapper.title, "");
  const frame = wrapper.querySelector("iframe");
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  const page = frame.getAttribute("srcdoc");
  assert.doesNotMatch(page, /\[\[|onload/);
  assert.match(page, /<canvas id="c"><\/canvas><script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.0\/dist\/chart\.umd\.min\.js"><\/script><script>new Chart/);
  assert.match(page, /Content-Security-Policy" content="[^"]*connect-src 'none'; frame-src 'none'[^"]*"><script>\(\(\) => \{\s+for \(const name of \["RTCPeerConnection"/);
  for (const policy of [wrapper, new JSDOM(page).window.document]) assert.match(policy.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src 'none'/);
  const labels = page.match(/labels:(\[.*?\])\}/)[1];
  assert.deepEqual(new Function(`return ${labels}`)(), ["浙江ABC染整有限公司", `O'Neil "</script>" \\ \${x}`, "HT-825GK"]);
});

test("HTML without kept scripts stays a plain static page", () => {
  const result = restoreHtmlText(`<html><head><title>${C}</title></head><body><p>${P}</p></body></html>`, window, mapping);
  assert.doesNotMatch(result.html, /<iframe|<script/);
  assert.match(result.html, /<title>浙江ABC染整有限公司<\/title>/);
});

test("HTML rejects unknown, mixed, altered and token-free documents", () => {
  assert.throws(() => restoreHtmlText(`<p>[[X999@${TASK}]]</p>`, window, mapping), (error) => error.code === "UNRESOLVED_TOKENS");
  assert.throws(() => restoreHtmlText(`<p>${C} [[C001@AAAAAAAA]]</p>`, window, mapping), (error) => error.code === "MIXED_TASKS");
  assert.throws(() => restoreHtmlText(`<p>C001</p>`, window, mapping), (error) => error.code === "ALTERED_TOKENS");
  assert.throws(() => restoreHtmlText("<p>无代号</p>", window, mapping), (error) => error.code === "NO_TOKENS");
});

test("HTML restores semantic tokens without changing legacy compatibility", () => {
  const token = `[[客户名称:C001@${TASK}]]`;
  const result = restoreHtmlText(`<p>${token}</p>`, window, {
    [token]: { value: { type: "string", value: "浙江ABC染整有限公司" } },
  });
  assert.equal(result.restoredOccurrences, 1);
  assert.match(result.html, /浙江ABC染整有限公司/);
});

test("HTML recognizes a short code left behind from a semantic token as altered", () => {
  const token = `[[产品名称:P001@${TASK}]]`;
  const semanticMapping = { [token]: { value: { type: "string", value: "HT-825GK" } } };
  assert.throws(() => restoreHtmlText("<p>P001</p>", window, semanticMapping), (error) => error.code === "ALTERED_TOKENS");
});

test("HTML blocks altered tokens even when exact tokens are also present", () => {
  const altered = `[[C00X@${TASK}]]`;
  assert.throws(() => restoreHtmlText(`<p>${C}</p><code>${altered}</code>`, window, mapping), (error) => error.code === "ALTERED_TOKENS");
});

test("HTML inspection reports removals without executing the page", () => {
  const inspection = inspectHtmlText(`<script src="https://evil.test/a.js"></script><script>draw('${C}')</script><p>${C}</p>`, window, mapping);
  assert.equal(inspection.occurrences.length, 2);
  assert.equal(inspection.removed.elements, 1);
  assert.equal(inspection.keptScripts, 1);
});
