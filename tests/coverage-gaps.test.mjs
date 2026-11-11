import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { analyzeWorkbook, classifyHeader, coveredValues, isLongNumber, residualMatches, restoreWorkbookValues, splitNames, spreadsAcrossWorkbook, tokenizeWorkbook } from "../src/xlsxCore.js";
import { analyzeCsv, findCsvSensitiveResiduals, parseCsvText, restoreCsvValues, stringifyCsv, tokenizeCsv } from "../src/csvCore.js";
import { isValidCreditCode, sensitiveNumberCandidates } from "../src/sensitivePatterns.js";
import { findWorkbookCandidates } from "../src/workbookCandidates.js";

const TASK = { tokenFormat: "short", marker: "K7M4" };

function workbook(rows) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("销售明细");
  for (const row of rows) sheet.addRow(row);
  return book;
}
const allText = book => {
  const texts = [];
  book.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => texts.push(String(cell.text)))));
  return texts.join("\n");
};
const chosenColumns = book => {
  const analysis = analyzeWorkbook(book);
  return analysis.columns.filter(column => analysis.suggestedColumnIds.includes(column.id));
};

test("已勾选列里的手机号，写在备注里的同一个号码也会替换，并能还原", () => {
  const book = workbook([
    ["客户名称", "联系人", "手机", "数量", "备注"],
    ["广州宏图化工有限公司", "张伟", "13812345678", 100, "找张伟，电话13812345678"],
    ["佛山南海新材料有限公司", "李娜", "13900001111", 13812345678, "订单号2026138123456789"],
  ]);
  const result = tokenizeWorkbook(book, chosenColumns(book), TASK);
  const text = allText(book);
  assert.ok(!text.includes("电话13812345678"), text);
  // A quantity that happens to equal the number, and a longer run of digits containing it, are left alone.
  assert.equal(book.getWorksheet("销售明细").getCell("D3").value, 13812345678);
  assert.ok(text.includes("订单号2026138123456789"));
  restoreWorkbookValues(book, result.mapping);
  assert.equal(book.getWorksheet("销售明细").getCell("E2").value, "找张伟，电话13812345678");
});

test("长号码在别处的文字里也算残留，数量和短数字仍只按整格比较", () => {
  assert.equal(isLongNumber("13812345678"), true);
  assert.equal(isLongNumber("020-12345678"), true);
  assert.equal(isLongNumber("1234567"), false);
  assert.equal(isLongNumber("12,345,678.00"), false);
  assert.equal(spreadsAcrossWorkbook("13812345678"), true);
  assert.equal(spreadsAcrossWorkbook("2026"), false);
  assert.equal(residualMatches("电话13812345678", "13812345678"), true);
  assert.equal(residualMatches("单号913812345678", "13812345678"), false);
  assert.equal(residualMatches("共 100 件", "100"), false);
});

test("联系人一格写多个名字：各自得到代号，别处单独出现的也替换，并能还原", () => {
  const book = workbook([
    ["客户名称", "联系人", "备注"],
    ["广州宏图化工有限公司", "张伟/刘洋", "刘洋已确认"],
    ["佛山南海新材料有限公司", "李娜", "正常"],
  ]);
  const columns = chosenColumns(book);
  assert.ok(coveredValues(book, columns).has("刘洋"));
  const result = tokenizeWorkbook(book, columns, TASK);
  const sheet = book.getWorksheet("销售明细");
  assert.match(sheet.getCell("B2").value, /^人员-K7M4-\d+\/人员-K7M4-\d+$/);
  assert.ok(!allText(book).includes("刘洋"));
  restoreWorkbookValues(book, result.mapping);
  assert.equal(sheet.getCell("B2").value, "张伟/刘洋");
  assert.equal(sheet.getCell("C2").value, "刘洋已确认");
});

test("拆分名字只针对中文名称，英文公司名和括号里的逗号不拆", () => {
  assert.deepEqual(splitNames("张伟、刘洋"), ["张伟", "、", "刘洋"]);
  assert.equal(splitNames("Foo Co., Ltd."), null);
  assert.equal(splitNames("广州宏图（华南，一部）化工有限公司"), null);
  assert.equal(splitNames("张伟/无"), null);
  assert.equal(splitNames("张伟"), null);
});

test("CSV 里一格多个名字同样拆开替换并能还原", () => {
  const source = "客户名称,联系人,备注\n广州宏图化工有限公司,张伟、刘洋,刘洋已确认\n佛山南海新材料有限公司,李娜,正常\n";
  const document = parseCsvText(source);
  const analysis = analyzeCsv(document);
  const result = tokenizeCsv(document, analysis.columns.filter(column => analysis.suggestedColumnIds.includes(column.id)), TASK);
  assert.ok(!stringifyCsv(document).includes("刘洋"));
  assert.deepEqual(findCsvSensitiveResiduals(document, result.mapping), []);
  restoreCsvValues(document, result.mapping);
  assert.ok(stringifyCsv(document).includes("张伟、刘洋,刘洋已确认"));
});

test("地址、账号、税号等列名会被识别为需要替换的列", () => {
  for (const header of ["收货地址", "地址", "开户行及账号", "银行账号", "对公账号", "税号", "纳税人识别号", "统一社会信用代码", "车牌号", "QQ号", "工号", "传真"]) {
    assert.equal(classifyHeader(header).category, "contact", header);
  }
  for (const header of ["地区", "区域", "账期", "数量", "备注"]) assert.equal(classifyHeader(header).category, "custom", header);
});

test("分组书写的银行卡、写明是账号的对公账号、统一社会信用代码会自动识别", () => {
  assert.equal(isValidCreditCode("91350100M000100Y43"), true);
  assert.equal(isValidCreditCode("91350100M000100Y44"), false);
  const found = sensitiveNumberCandidates("卡号 6222 0212 3456 7890 128\n开户行：工行广州分行 账号：3602000109200123456\n税号91350100M000100Y43\n金额 3602000109200123456 元以上的数字不算账号");
  const labels = Object.fromEntries(found.map(item => [item.value, item.label]));
  assert.equal(labels["3602000109200123456"], "银行账号");
  assert.equal(labels["91350100M000100Y43"], "统一社会信用代码");
});

test("表单里「地址：…」这类标签后面的内容会列为候选", () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("客户资料");
  sheet.addRow(["企业名称", "广州宏图化工有限公司"]);
  sheet.addRow(["地址", "广州市天河区体育西路103号"]);
  const found = findWorkbookCandidates(book);
  assert.ok(found.candidates.some(item => item.value === "广州市天河区体育西路103号"));
});

// ---------- Fewer needless stops ----------
import JSZip from "jszip";
import { flattenHyperlinks, inspectWorkbookTokens } from "../src/xlsxCore.js";
import { assertNoSensitiveValuesInXlsxPackage, preflightXlsxPackage } from "../src/xlsxPackageCore.js";

const CUSTOMER = "广州宏图化工有限公司";
const salesBook = () => workbook([
  ["客户名称", "产品编码", "数量"],
  [CUSTOMER, "A1", 100],
  ["佛山南海新材料有限公司", "B22", 20],
]);
const noteOf = cell => typeof cell.note === "string" ? cell.note : cell.note.texts.map(part => part.text).join("");
async function reload(book) {
  const buffer = await book.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  return { buffer, loaded };
}

test("带超链接的文件不再被拦下：链接去掉、文字照常替换；外部数据连接仍然拦截", async () => {
  const book = salesBook();
  book.getWorksheet("销售明细").getCell("E2").value = { text: CUSTOMER, hyperlink: "https://example.com/hongtu" };
  book.getWorksheet("销售明细").getCell("E3").value = { text: "sales@example.com", hyperlink: "mailto:sales@example.com" };
  const { buffer, loaded } = await reload(book);
  await preflightXlsxPackage(buffer);
  assert.equal(flattenHyperlinks(loaded), 2);
  const result = tokenizeWorkbook(loaded, chosenColumns(loaded), TASK);
  assert.match(loaded.getWorksheet("销售明细").getCell("E2").value, /^客户-K7M4-\d+$/);
  const output = await loaded.xlsx.writeBuffer();
  await assertNoSensitiveValuesInXlsxPackage(output, result.mapping);
  const zip = await JSZip.loadAsync(output);
  for (const name of Object.keys(zip.files)) if (/\.rels$/.test(name)) assert.ok(!/example\.com/.test(await zip.file(name).async("string")), name);

  const linked = await JSZip.loadAsync(buffer);
  linked.file("xl/_rels/workbook.xml.rels", (await linked.file("xl/_rels/workbook.xml.rels").async("string")).replace("</Relationships>", '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="file:///C:/other.xlsx" TargetMode="External"/></Relationships>'));
  await assert.rejects(preflightXlsxPackage(await linked.generateAsync({ type: "nodebuffer" })), { code: "EXTERNAL_RELATIONSHIPS" });
});

test("别处有一格等于已选短编码时直接替换，不再报残留；夹在文字里的短编码不动", async () => {
  const book = salesBook();
  const summary = book.addWorksheet("汇总");
  summary.addRow(["编码", "说明"]);
  summary.addRow(["A1", "型号A12缺货"]);
  const result = tokenizeWorkbook(book, chosenColumns(book), TASK);
  assert.match(summary.getCell("A2").value, /^产品-K7M4-\d+$/);
  assert.equal(summary.getCell("B2").value, "型号A12缺货");
  await assertNoSensitiveValuesInXlsxPackage(await book.xlsx.writeBuffer(), result.mapping);
  restoreWorkbookValues(book, result.mapping);
  assert.equal(summary.getCell("A2").value, "A1");
});

test("批注里的名称换成代号并能还原；页眉里的名称隐去；带名称的下拉列表去掉", async () => {
  const book = salesBook();
  const sheet = book.getWorksheet("销售明细");
  sheet.getCell("C2").note = `${CUSTOMER} 要求加急`;
  sheet.getCell("C3").note = { texts: [{ font: { bold: true }, text: "注意：" }, { text: `${CUSTOMER}回款慢` }] };
  sheet.headerFooter.oddHeader = `&C${CUSTOMER} 销售表`;
  sheet.getCell("D2").dataValidation = { type: "list", formulae: [`"${CUSTOMER},其他"`] };
  sheet.getCell("D3").dataValidation = { type: "list", formulae: ['"是,否"'] };
  const result = tokenizeWorkbook(book, chosenColumns(book), TASK);
  const { buffer, loaded } = await reload(book);
  await assertNoSensitiveValuesInXlsxPackage(buffer, result.mapping);
  // The protected copy opens again for restoring even though its notes hold aliases.
  await preflightXlsxPackage(buffer);
  const out = loaded.getWorksheet("销售明细");
  assert.match(noteOf(out.getCell("C2")), /^客户-K7M4-\d+ 要求加急$/);
  assert.equal(out.headerFooter.oddHeader, "&C*** 销售表");
  assert.equal(out.getCell("D2").dataValidation, undefined);
  assert.deepEqual(out.getCell("D3").dataValidation.formulae, ['"是,否"']);
  const before = inspectWorkbookTokens(loaded).occurrences.length;
  const restored = restoreWorkbookValues(loaded, result.mapping);
  assert.equal(restored.restoredOccurrences, before);
  assert.equal(noteOf(out.getCell("C2")), `${CUSTOMER} 要求加急`);
  assert.equal(noteOf(out.getCell("C3")), `注意：${CUSTOMER}回款慢`);
});

test("AI 返回的文件里带链接的单元格，代号也能还原", () => {
  const book = salesBook();
  const result = tokenizeWorkbook(book, chosenColumns(book), TASK);
  const sheet = book.getWorksheet("销售明细");
  const token = sheet.getCell("A2").value;
  sheet.getCell("E2").value = { text: `${token} 官网`, hyperlink: "https://example.com" };
  assert.equal(inspectWorkbookTokens(book).occurrences.filter(item => item.kind === "link").length, 1);
  restoreWorkbookValues(book, result.mapping);
  assert.deepEqual(sheet.getCell("E2").value, { text: `${CUSTOMER} 官网`, hyperlink: "https://example.com" });
  assert.equal(inspectWorkbookTokens(book).occurrences.length, 0);
});

test("同一个文件里既有链接又有批注：只写在批注里的号码和公司也会列为候选并替换", async () => {
  const book = salesBook();
  const sheet = book.getWorksheet("销售明细");
  sheet.getCell("D2").value = { text: "sales@hongtu.com", hyperlink: "mailto:sales@hongtu.com" };
  sheet.getCell("D2").note = `${CUSTOMER} 的采购邮箱`;
  sheet.getCell("C3").note = "李工电话 13900001111，东莞恒通贸易有限公司待开票";
  const { buffer, loaded } = await reload(book);
  await preflightXlsxPackage(buffer);
  flattenHyperlinks(loaded);
  const columns = chosenColumns(loaded);
  const found = findWorkbookCandidates(loaded, coveredValues(loaded, columns));
  const values = found.candidates.map(item => item.value);
  for (const expected of ["13900001111", "东莞恒通贸易有限公司", "sales@hongtu.com"]) assert.ok(values.includes(expected), `${expected} in ${values}`);
  const result = tokenizeWorkbook(loaded, columns, TASK, found.candidates);
  const output = await loaded.xlsx.writeBuffer();
  await assertNoSensitiveValuesInXlsxPackage(output, result.mapping);
  const zip = await JSZip.loadAsync(output);
  let all = "";
  for (const file of Object.values(zip.files)) if (/\.(xml|vml|rels)$/.test(file.name)) all += await file.async("string");
  for (const real of [CUSTOMER, "13900001111", "东莞恒通", "hongtu.com"]) assert.ok(!all.includes(real), real);
});

// ---------- Short company names ----------
import { companyShortNames, shortNameCandidates } from "../src/companyAbbreviations.js";

test("从公司全称推出简称：去掉地名、后缀和行业词", () => {
  assert.deepEqual(companyShortNames("广州宏图化工有限公司"), ["宏图化工", "宏图"]);
  assert.deepEqual(companyShortNames("广东拓信有机硅科技有限公司"), ["拓信有机硅科技", "拓信"]);
  assert.deepEqual(companyShortNames("清远市清新区山塘镇新洁华洗涤厂"), ["新洁华洗涤", "新洁华"]);
  assert.deepEqual(companyShortNames("广州宏图（华南）化工股份有限公司"), ["宏图化工", "宏图"]);
  assert.deepEqual(companyShortNames("华联超市有限公司"), ["华联超市"]);
  assert.deepEqual(companyShortNames("张伟"), []);
  assert.deepEqual(companyShortNames("广州华南化工有限公司"), ["华南化工"]);
});

test("简称只有在全称之外单独出现时才列为候选，替换后能还原", () => {
  const book = workbook([
    ["客户名称", "数量", "备注"],
    ["广州宏图化工有限公司", 100, "宏图化工本月回款慢，宏图老板下周来访"],
    ["佛山南海新材料有限公司", 20, "正常"],
  ]);
  const columns = chosenColumns(book);
  const covered = coveredValues(book, columns);
  const found = findWorkbookCandidates(book, covered);
  const shorts = shortNameCandidates(covered, found.cells.filter(cell => cell.column !== 1), covered);
  assert.deepEqual(shorts.map(item => [item.value, item.count]), [["宏图化工", 1], ["宏图", 1]]);
  assert.equal(shorts[0].locations[0].row, 2);
  // 南海 is never written on its own, so it is not offered.
  assert.ok(!shorts.some(item => item.value === "南海"));
  const result = tokenizeWorkbook(book, columns, TASK, shorts);
  const sheet = book.getWorksheet("销售明细");
  assert.ok(!allText(book).includes("宏图"));
  assert.match(sheet.getCell("C2").value, /^客户-K7M4-\d+本月回款慢，客户-K7M4-\d+老板下周来访$/);
  restoreWorkbookValues(book, result.mapping);
  assert.equal(sheet.getCell("C2").value, "宏图化工本月回款慢，宏图老板下周来访");
  assert.equal(sheet.getCell("A2").value, "广州宏图化工有限公司");
});

test("CSV 里别处单独出现的客户简称也会列为候选", () => {
  const document = parseCsvText("客户名称,数量,备注\n广州宏图化工有限公司,100,宏图化工本月回款慢\n佛山南海新材料有限公司,20,正常\n");
  const analysis = analyzeCsv(document);
  assert.deepEqual(analysis.candidates.filter(item => item.label === "客户简称").map(item => item.value), ["宏图化工"]);
});

// ---------- Found by the closed-loop run ----------
import { aliasWithGap, replaceAliases } from "../src/tokenFormat.js";
import { tokenizeText, restoreText } from "../src/textCore.js";

test("名称后面紧跟数字、字母或横线时仍能原样还原", () => {
  const book = workbook([
    ["客户名称", "备注"],
    ["宏图", "宏图2026年销售表，宏图 2026，宏图-华南，宏图A组"],
  ]);
  const result = tokenizeWorkbook(book, chosenColumns(book), TASK);
  const sheet = book.getWorksheet("销售明细");
  assert.equal(inspectWorkbookTokens(book).occurrences.length, 5);
  assert.ok(inspectWorkbookTokens(book).occurrences.every(item => result.mapping[item.token]));
  restoreWorkbookValues(book, result.mapping);
  assert.equal(sheet.getCell("B2").value, "宏图2026年销售表，宏图 2026，宏图-华南，宏图A组");

  const source = "宏图2026年销售表，张伟A组，宏图-华南区";
  const text = tokenizeText(source, [{ value: "宏图", label: "客户", category: "customer", prefix: "C" }, { value: "张伟", label: "人员", category: "sales", prefix: "S" }], TASK);
  assert.equal(restoreText(text.text, text.mapping).text, source);
  assert.equal(aliasWithGap("客户-K7M4-01", "年"), "客户-K7M4-01");
  assert.equal(replaceAliases("客户-K7M4-01 2026 客户-K7M4-09 2026", token => token === "客户-K7M4-01" ? "宏图" : token), "宏图2026 客户-K7M4-09 2026");
});

test("岗位词、合计行、只写城市的地址不会被当成名称替换", () => {
  const book = workbook([
    ["客户名称", "联系人", "地址", "备注"],
    ["广州宏图化工有限公司", "销售/采购", "广州", "销售部跟进，广州仓发货"],
    ["佛山南海新材料有限公司", "李娜", "佛山市南海区桂城街道灯湖东路1号", "正常"],
    ["合计", "", "", "销售额"],
  ]);
  const result = tokenizeWorkbook(book, chosenColumns(book), TASK);
  const sheet = book.getWorksheet("销售明细");
  assert.equal(sheet.getCell("A4").value, "合计");
  assert.equal(sheet.getCell("C2").value, "广州");
  assert.equal(sheet.getCell("D2").value, "销售部跟进，广州仓发货");
  assert.equal(sheet.getCell("D4").value, "销售额");
  assert.match(sheet.getCell("C3").value, /^信息-K7M4-\d+$/);
  assert.match(sheet.getCell("B2").value, /^人员-K7M4-\d+$/);
  assert.ok(result.mapping);
});

test("人名后的括号说明、空格分隔和「等」字：名字各自替换，公司名的括号不拆", () => {
  assert.deepEqual(splitNames("张伟（经理）/刘洋"), ["张伟", "（经理）/", "刘洋"]);
  assert.deepEqual(splitNames("李娜 赵敏"), ["李娜", " ", "赵敏"]);
  assert.deepEqual(splitNames("张伟、刘洋等"), ["张伟", "、", "刘洋", "等"]);
  assert.deepEqual(splitNames("张伟（经理）"), ["张伟", "（经理）"]);
  assert.equal(splitNames("销售/采购"), null);
  assert.equal(splitNames("某某公司（香港）", "customer"), null);
  assert.deepEqual(splitNames("甲方公司（代付）、乙方公司", "customer"), ["甲方公司（代付）", "、", "乙方公司"]);
});

test("手机号的其他写法、HYPERLINK 公式、批注作者", async () => {
  const found = sensitiveNumberCandidates("电话138-1234-5678 或 138 1234 5678 或 +8613812345678，另 13900001111 和 13900001111");
  assert.deepEqual(found.map(item => [item.value, item.count]), [["13900001111", 2], ["138-1234-5678", 1], ["138 1234 5678", 1], ["+8613812345678", 1]]);
  assert.deepEqual(sensitiveNumberCandidates("账户余额 123456789.00 元"), []);

  const book = salesBook();
  const sheet = book.getWorksheet("销售明细");
  sheet.getCell("D2").value = { formula: 'HYPERLINK("mailto:zhangwei@hongtu.com","发邮件")', result: "发邮件" };
  sheet.getCell("C2").note = { texts: [{ font: { bold: true }, text: "刘妍妍:\n" }, { text: "加急" }] };
  const { loaded } = await reload(book);
  assert.equal(flattenHyperlinks(loaded), 1);
  assert.equal(loaded.getWorksheet("销售明细").getCell("D2").value, "发邮件");
  const result = tokenizeWorkbook(loaded, chosenColumns(loaded), TASK);
  const out = loaded.getWorksheet("销售明细");
  assert.match(noteOf(out.getCell("C2")), /^人员-K7M4-\d+:\n加急$/);
  restoreWorkbookValues(loaded, result.mapping);
  assert.equal(noteOf(out.getCell("C2")), "刘妍妍:\n加急");
});

test("简称本身是行业词时不建议（广州发展贸易有限公司 → 不建议「发展」）", () => {
  assert.deepEqual(companyShortNames("广州发展贸易有限公司"), ["发展贸易"]);
});
