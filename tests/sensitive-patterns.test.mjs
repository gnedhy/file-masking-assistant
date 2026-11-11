import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { isValidBankCard, isValidIdNumber, sensitiveNumberCandidates } from "../src/sensitivePatterns.js";
import { analyzeCsv, parseCsvText } from "../src/csvCore.js";
import { analyzeText } from "../src/textCore.js";
import { classifyHeader, hiddenContent } from "../src/xlsxCore.js";
import { findWorkbookCandidates, locateValue } from "../src/workbookCandidates.js";

// Made-up numbers whose check digits are computed here, so the tests never hold a real person's data.
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const idWithCheck = base => base + "10X98765432"[WEIGHTS.reduce((sum, weight, index) => sum + weight * Number(base[index]), 0) % 11];
const cardWithLuhn = base => {
  for (let check = 0; check < 10; check += 1) if (isValidBankCard(base + check)) return base + check;
  throw new Error("no check digit");
};
const ID = idWithCheck("11010119900101123");
const CARD = cardWithLuhn("622202123456789");

test("身份证号和银行卡号必须校验位正确才算", () => {
  assert.equal(isValidIdNumber(ID), true);
  assert.equal(isValidIdNumber(ID.slice(0, 17) + (ID.endsWith("0") ? "1" : "0")), false);
  assert.equal(isValidIdNumber("110101189901011234"), false);
  assert.equal(isValidBankCard(CARD), true);
  assert.equal(isValidBankCard(CARD.slice(0, 15) + ((Number(CARD.at(-1)) + 1) % 10)), false);
  assert.equal(isValidBankCard("1234567890123456"), false);
});

test("从文字里找出手机、固话、身份证、银行卡、邮箱，普通数字不会被当成它们", () => {
  const text = [`联系人 13800138000，座机 010-12345678`, `身份证 ${ID}，卡号 ${CARD}`, "邮箱 zhang.san@example.com", "金额 1234567890123456 元，订单号 20261105001，手机 138001380001"].join("\n");
  const found = Object.fromEntries(sensitiveNumberCandidates(text).map(item => [item.value, item.label]));
  assert.deepEqual(found, { "13800138000": "手机号", "010-12345678": "固定电话", [ID]: "身份证号", [CARD]: "银行卡号", "zhang.san@example.com": "邮箱" });
});

test("同一个号码出现多次只列一个，并记下次数；身份证不会再被当成银行卡", () => {
  const [phone] = sensitiveNumberCandidates("甲 13800138000\n乙 13800138000\n丙 13800138000");
  assert.equal(phone.count, 3);
  assert.equal(phone.contexts.length, 3);
  assert.deepEqual(sensitiveNumberCandidates(ID).map(item => item.label), ["身份证号"]);
});

test("电话、邮箱、身份证、银行卡等表头会被默认建议", () => {
  for (const header of ["手机", "联系电话", "电话号码", "邮箱", "身份证号", "银行账号", "卡号", "Phone", "联系方式(手机/微信)"]) assert.equal(classifyHeader(header).category, "contact", header);
  for (const header of ["数量", "金额", "备注", "日期"]) assert.notEqual(classifyHeader(header).category, "contact", header);
});

test("TXT / Word 文字里的手机号和邮箱默认列为关键词", () => {
  const analysis = analyzeText(`客户：虚构星河化工\n手机：13800138000\n邮箱：无\n备注：请联系 zhang@example.com`, "txt");
  const labels = Object.fromEntries(analysis.candidates.map(item => [item.value, item.label]));
  assert.match(labels["13800138000"], /^手机/);
  assert.equal(labels["zhang@example.com"], "邮箱");
  assert.ok(!("无" in labels), "占位符不是关键词");
  assert.ok(analysis.suggestedCandidateIds.length >= 2);
});

test("CSV：手机列已被选中的不再重复列出，备注里的号码单独列出", () => {
  const document = parseCsvText(`客户名称,手机,备注\r\n虚构星河化工,13800138000,另有座机 010-12345678\r\n虚构东骏纺织,13900139000,/\r\n`);
  const analysis = analyzeCsv(document);
  assert.ok(analysis.columns.find(column => column.header === "手机").suggested);
  assert.deepEqual(analysis.candidates.map(item => item.value), ["010-12345678"]);
  assert.deepEqual(analysis.suggestedCandidateIds, analysis.candidates.map(item => item.id));
  assert.deepEqual(analysis.cells.find(cell => cell.text.includes("010-")), { sheet: "CSV", row: 2, column: 3, text: "另有座机 010-12345678" });
});

test("Excel：关键词记下出现的位置，手动添加的名称也能查到位置", () => {
  const workbook = new ExcelJS.Workbook();
  const form = workbook.addWorksheet("资料");
  form.getCell("A4").value = "企业名称"; form.getCell("B4").value = "虚构星河化工有限公司";
  form.getCell("A5").value = "联系电话"; form.getCell("B5").value = "13800138000";
  const notes = workbook.addWorksheet("跟进");
  notes.getCell("C7").value = "已联系虚构星河化工有限公司，手机 13800138000";
  const { candidates, cells } = findWorkbookCandidates(workbook);
  const company = candidates.find(item => item.value === "虚构星河化工有限公司");
  assert.deepEqual(company.locations, [{ sheet: "资料", row: 4, column: 2 }, { sheet: "跟进", row: 7, column: 3 }]);
  const phone = candidates.find(item => item.value === "13800138000");
  assert.equal(phone.label, "手机号");
  assert.deepEqual(phone.locations, [{ sheet: "资料", row: 5, column: 2 }, { sheet: "跟进", row: 7, column: 3 }]);
  assert.deepEqual(locateValue(cells, "已联系"), [{ sheet: "跟进", row: 7, column: 3 }]);
});

test("隐藏的工作表、行、列会被统计出来，没有隐藏内容时返回空", () => {
  const workbook = new ExcelJS.Workbook();
  const open = workbook.addWorksheet("明细");
  open.getCell("A1").value = "客户";
  open.getCell("A2").value = "甲";
  open.getCell("A3").value = "乙";
  assert.equal(hiddenContent(workbook), null);
  open.getRow(3).hidden = true;
  open.getColumn(2).hidden = true;
  workbook.addWorksheet("内部", { state: "hidden" }).getCell("A1").value = "x";
  assert.deepEqual(hiddenContent(workbook), { sheets: 1, rows: 1, columns: 1 });
});
