import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import pptxgen from "pptxgenjs";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const outputRoot = path.resolve(process.argv[2] || "tests/output/validation-assets");
const docxTableWidth = { width: { size: 8640, type: WidthType.DXA }, columnWidths: [4320, 4320] };

const taskId = "A14F2026";
const tokens = {
  customer1: `[[C001@${taskId}]]`, customer2: `[[C002@${taskId}]]`, customer3: `[[C003@${taskId}]]`,
  product1: `[[P001@${taskId}]]`, product2: `[[P002@${taskId}]]`, product3: `[[P003@${taskId}]]`,
  sales1: `[[S001@${taskId}]]`, sales2: `[[S002@${taskId}]]`, sales3: `[[S003@${taskId}]]`,
};
const mapping = {
  [tokens.customer1]: { value: { type: "string", value: "浙江ABC染整有限公司" }, category: "customer", header: "客户名称" },
  [tokens.customer2]: { value: { type: "string", value: "NOVA Textiles (Vietnam) Co., Ltd." }, category: "customer", header: "客户名称" },
  [tokens.customer3]: { value: { type: "string", value: "苏州锦&纺供应链（华东）事业部" }, category: "customer", header: "客户名称" },
  [tokens.product1]: { value: { type: "string", value: "HT-825GK" }, category: "product", header: "产品内部编码" },
  [tokens.product2]: { value: { type: "string", value: "ECO/Soft-X2.0" }, category: "product", header: "产品内部编码" },
  [tokens.product3]: { value: { type: "string", value: "染整助剂-A+B（试制）" }, category: "product", header: "产品内部编码" },
  [tokens.sales1]: { value: { type: "string", value: "张三" }, category: "sales", header: "销售人员" },
  [tokens.sales2]: { value: { type: "string", value: "Alice Chen" }, category: "sales", header: "销售人员" },
  [tokens.sales3]: { value: { type: "string", value: "王·小明 / XM-Wang" }, category: "sales", header: "销售人员" },
};

const salesRows = [
  ["2026-01", "华东", "浙江ABC染整有限公司", "C-ZJ-0001", "HT-825GK", "张三", 128000, 32, "重点客户，HT-825GK 二次复购"],
  ["2026-01", "华南", "NOVA Textiles (Vietnam) Co., Ltd.", "VN/NOVA-88", "ECO/Soft-X2.0", "Alice Chen", 96500, 21, "英文客户与符号编码"],
  ["2026-02", "华东", "苏州锦&纺供应链（华东）事业部", "SZ-J&F-02", "染整助剂-A+B（试制）", "王·小明 / XM-Wang", 75200, 18, "中英混合姓名"],
  ["2026-02", "华东", "浙江ABC染整有限公司", "C-ZJ-0001", "ECO/Soft-X2.0", "张三", 141000, 29, "客户名称重复，用于一致 Token"],
  ["2026-03", "华南", "NOVA Textiles (Vietnam) Co., Ltd.", "VN/NOVA-88", "HT-825GK", "Alice Chen", 112800, 25, "产品交叉购买"],
  ["2026-03", "华东", "苏州锦&纺供应链（华东）事业部", "SZ-J&F-02", "HT-825GK", "王·小明 / XM-Wang", 88600, 19, "长名称用于排版溢出复核"],
];

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeRows() {
  const replacements = new Map([
    ["浙江ABC染整有限公司", tokens.customer1], ["NOVA Textiles (Vietnam) Co., Ltd.", tokens.customer2],
    ["苏州锦&纺供应链（华东）事业部", tokens.customer3], ["HT-825GK", tokens.product1],
    ["ECO/Soft-X2.0", tokens.product2], ["染整助剂-A+B（试制）", tokens.product3], ["张三", tokens.sales1],
    ["Alice Chen", tokens.sales2], ["王·小明 / XM-Wang", tokens.sales3],
  ]);
  return salesRows.map((row) => row.map((value, index) => {
    if ([2, 4, 5].includes(index)) return replacements.get(value) ?? value;
    if (index === 8) {
      let text = value;
      for (const [source, token] of replacements) text = String(text).replaceAll(source, token);
      return text;
    }
    return value;
  }));
}

async function writeCsvAssets() {
  const headers = ["月份", "区域", "客户名称", "客户编码", "产品内部编码", "销售人员", "销售金额", "数量", "业务备注"];
  const asCsv = (rows) => `\uFEFF${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
  await fs.writeFile(path.join(outputRoot, "01_输入数据", "销售测试数据_原始版.csv"), asCsv(salesRows), "utf8");
  await fs.writeFile(path.join(outputRoot, "02_脱敏样本", `销售测试数据_脱敏版_${taskId}.csv`), asCsv(safeRows()), "utf8");
  await fs.writeFile(path.join(outputRoot, "00_测试说明", `本机映射_仅测试_${taskId}.json`), JSON.stringify({ taskId, taskName: "多格式销售验证", mapping }, null, 2), "utf8");
}

function addSlideChrome(slide, index, title, section) {
  slide.background = { color: index % 3 === 0 ? "111827" : "F8FAFC" };
  const dark = index % 3 === 0;
  slide.addText(section.toUpperCase(), { x: 0.45, y: 0.25, w: 4.5, h: 0.28, fontFace: "Aptos", fontSize: 9, bold: true, color: dark ? "93C5FD" : "2563EB", charSpacing: 1.5 });
  slide.addText(`${String(index).padStart(2, "0")} / 08`, { x: 11.6, y: 0.25, w: 1.1, h: 0.28, fontFace: "Aptos", fontSize: 9, color: dark ? "CBD5E1" : "64748B", align: "right" });
  slide.addText(title, { x: 0.45, y: 0.75, w: 12.1, h: 0.68, fontFace: "Microsoft YaHei", fontSize: 28, bold: false, color: dark ? "FFFFFF" : "0F172A", margin: 0 });
  return { dark };
}

async function writePptxAssets() {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "文件脱敏助手验证";
  pptx.subject = "跨格式实名还原压力测试";
  pptx.title = "销售经营分析（脱敏代号版）";
  pptx.company = "Local Validation";
  pptx.lang = "zh-CN";
  pptx.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei", lang: "zh-CN" };

  let slide = pptx.addSlide();
  slide.background = { color: "0018A8" };
  slide.addText("SALES / SAFE ROUND TRIP", { x: 0.55, y: 0.45, w: 5.2, h: 0.3, fontFace: "Aptos", fontSize: 10, color: "DBEAFE", charSpacing: 2 });
  slide.addText([ { text: "销售经营分析\n", options: { breakLine: true } }, { text: tokens.customer1, options: { italic: true } } ], { x: 0.55, y: 1.45, w: 11.8, h: 2.2, fontFace: "Microsoft YaHei", fontSize: 38, color: "FFFFFF", bold: false, margin: 0 });
  slide.addText(`任务 ${taskId} · 代号应保持完整，实名只在本机还原`, { x: 0.55, y: 5.95, w: 8, h: 0.45, fontSize: 15, color: "DBEAFE" });
  slide.addNotes(`封面只说明任务边界，不包含代号映射。`);

  slide = pptx.addSlide(); addSlideChrome(slide, 2, "销售总览", "Overview");
  slide.addText("642,100", { x: 0.55, y: 1.8, w: 3.2, h: 1.05, fontSize: 46, color: "2563EB", bold: true, margin: 0 });
  slide.addText("累计销售金额", { x: 0.6, y: 2.9, w: 2.8, h: 0.4, fontSize: 15, color: "64748B" });
  slide.addText(`${tokens.customer1} 与 ${tokens.customer2} 贡献主要收入；${tokens.sales1} 负责最大单客户。`, { x: 4.2, y: 1.9, w: 8, h: 1.3, fontSize: 21, color: "0F172A", breakLine: false, margin: 0.08 });
  slide.addNotes(`核对总额与客户贡献，不要改写 ${tokens.customer1}。`);

  slide = pptx.addSlide(); addSlideChrome(slide, 3, "客户贡献", "Customers");
  slide.addTable([
    [{ text: "客户代号" }, { text: "销售额" }, { text: "占比" }],
    [{ text: tokens.customer1 }, { text: "269,000" }, { text: "41.9%" }],
    [{ text: tokens.customer2 }, { text: "209,300" }, { text: "32.6%" }],
    [{ text: tokens.customer3 }, { text: "163,800" }, { text: "25.5%" }],
  ], { x: 0.65, y: 1.7, w: 12, h: 3.7, border: { pt: 1, color: "475569" }, color: "FFFFFF", fill: "111827", fontFace: "Aptos", fontSize: 17, margin: 0.1, rowH: 0.7 });
  slide.addNotes("表格内代号覆盖客户排名和多页重复场景。");

  slide = pptx.addSlide(); addSlideChrome(slide, 4, "产品结构", "Products");
  slide.addText(`${tokens.product1}`, { x: 0.6, y: 1.8, w: 3.6, h: 0.7, fontSize: 30, color: "2563EB", bold: true });
  slide.addText(`${tokens.product2}`, { x: 4.6, y: 1.8, w: 3.6, h: 0.7, fontSize: 30, color: "16A34A", bold: true });
  slide.addText(`${tokens.product3}`, { x: 8.6, y: 1.8, w: 4.1, h: 0.7, fontSize: 25, color: "EA580C", bold: true });
  slide.addShape(pptx.ShapeType.rect, { x: 1.1, y: 3.2, w: 2.2, h: 2.4, fill: { color: "2563EB" }, line: { color: "2563EB" } });
  slide.addShape(pptx.ShapeType.rect, { x: 5.1, y: 3.8, w: 2.2, h: 1.8, fill: { color: "16A34A" }, line: { color: "16A34A" } });
  slide.addShape(pptx.ShapeType.rect, { x: 9.1, y: 4.9, w: 2.2, h: 0.7, fill: { color: "EA580C" }, line: { color: "EA580C" } });
  slide.addNotes("图表数据不含正式代号，代号只在普通文字区域。");

  slide = pptx.addSlide(); addSlideChrome(slide, 5, "销售人员表现", "People");
  slide.addText(`${tokens.sales1} 269,000`, { x: 0.7, y: 1.8, w: 4.2, h: 0.75, fontSize: 28, color: "0F172A" });
  slide.addText(`${tokens.sales2} 209,300`, { x: 0.7, y: 3, w: 4.2, h: 0.75, fontSize: 28, color: "0F172A" });
  slide.addText(`${tokens.sales3} 163,800`, { x: 0.7, y: 4.2, w: 5.2, h: 0.75, fontSize: 28, color: "0F172A" });
  slide.addText("长实名还原后可能换行；这属于需要人工复核的视觉风险，不应被描述为视觉无损。", { x: 6.4, y: 2, w: 5.7, h: 1.8, fontSize: 21, color: "334155", margin: 0 });
  slide.addNotes("销售人员页覆盖中文、英文和中英混合姓名。");

  slide = pptx.addSlide(); addSlideChrome(slide, 6, "月度趋势", "Trend");
  slide.addText("JAN 224,500  →  FEB 216,200  →  MAR 201,400", { x: 0.7, y: 2.3, w: 7.2, h: 1.2, fontSize: 26, color: "DBEAFE", bold: true, margin: 0 });
  slide.addText(`${tokens.customer1} 在 2 月达到单月峰值；${tokens.product1} 在三个客户中均有成交。`, { x: 8.5, y: 2.2, w: 4, h: 2, fontSize: 22, color: "FFFFFF", margin: 0 });
  slide.addNotes("趋势页检验图表保留以及普通文字代号还原。");

  slide = pptx.addSlide(); addSlideChrome(slide, 7, "客户 × 产品交叉分析", "Cross Analysis");
  const splitToken = tokens.customer2;
  slide.addText([
    { text: splitToken.slice(0, 5), options: { bold: true, color: "2563EB" } },
    { text: splitToken.slice(5, 12), options: { italic: true, color: "7C3AED" } },
    { text: splitToken.slice(12), options: { underline: { color: "EA580C" }, color: "EA580C" } },
  ], { x: 0.7, y: 1.8, w: 5.3, h: 0.8, fontSize: 27, margin: 0 });
  slide.addText(`跨文本片段代号与 ${tokens.product1} 同时出现。`, { x: 0.7, y: 3, w: 6.2, h: 0.8, fontSize: 22, color: "0F172A" });
  slide.addText(`${tokens.customer3} → ${tokens.product3}`, { x: 7.2, y: 2.2, w: 5.2, h: 0.8, fontSize: 23, color: "0F172A" });
  slide.addNotes("本页第一个客户代号被拆成三个连续文本片段，必须精确拼接。");

  slide = pptx.addSlide(); addSlideChrome(slide, 8, "风险、机会与行动建议", "Actions");
  slide.addText("01", { x: 0.6, y: 1.7, w: 1.1, h: 0.8, fontSize: 42, color: "2563EB" });
  slide.addText(`${tokens.customer1}：扩大 ${tokens.product2} 复购。`, { x: 1.8, y: 1.8, w: 9.8, h: 0.7, fontSize: 23, color: "0F172A" });
  slide.addText("02", { x: 0.6, y: 3, w: 1.1, h: 0.8, fontSize: 42, color: "2563EB" });
  slide.addText(`${tokens.sales2}：跟进 ${tokens.customer2} 的下一阶段需求。`, { x: 1.8, y: 3.1, w: 10.2, h: 0.7, fontSize: 23, color: "0F172A" });
  slide.addText("03", { x: 0.6, y: 4.3, w: 1.1, h: 0.8, fontSize: 42, color: "2563EB" });
  slide.addText(`复核 ${tokens.sales3} 的长实名换行与演讲者备注。`, { x: 1.8, y: 4.4, w: 10.2, h: 0.7, fontSize: 23, color: "0F172A" });
  slide.addNotes(`最后复核：${tokens.sales3} 的代号也出现在演讲者备注中。`);

  const baseline = path.join(outputRoot, "03_PPTX样本", `销售经营分析_代号版_${taskId}.pptx`);
  await pptx.writeFile({ fileName: baseline });

  const baseBytes = await fs.readFile(baseline);
  const variants = [
    ["未知代号", (text) => text.replace(tokens.customer1, `[[X999@${taskId}]]`)],
    ["混合任务", (text) => text.replace(tokens.customer1, `[[C001@BBBB2026]]`)],
    ["残缺代号", (text) => text.replace(tokens.customer1, `[[C001@${taskId.slice(0, 4)}`)],
  ];
  for (const [label, mutate] of variants) {
    const zip = await JSZip.loadAsync(baseBytes);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !entry.name.endsWith(".xml")) continue;
      const xml = await entry.async("string");
      if (xml.includes(tokens.customer1)) zip.file(entry.name, mutate(xml));
    }
    await fs.writeFile(path.join(outputRoot, "03_PPTX样本", `异常_${label}_${taskId}.pptx`), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  }
  const embedded = await JSZip.loadAsync(baseBytes);
  embedded.file("ppt/embeddings/oleObject1.bin", new Uint8Array([1, 2, 3, 4]));
  await fs.writeFile(path.join(outputRoot, "03_PPTX样本", `异常_OLE嵌入_${taskId}.pptx`), await embedded.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  await fs.writeFile(path.join(outputRoot, "03_PPTX样本", `异常_损坏文件_${taskId}.pptx`), baseBytes.subarray(0, Math.min(800, baseBytes.length)));
}

async function writeDocxAssets() {
  const originalDoc = new Document({
    creator: "文件脱敏助手验证",
    title: "销售分析 DOCX 原始版",
    sections: [{
      headers: { default: new Header({ children: [new Paragraph("客户名称：NOVA Textiles (Vietnam) Co., Ltd.")] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("销售人员：Alice Chen")] })] }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: "销售经营分析", bold: true, size: 38 })] }),
        new Paragraph({ children: [new TextRun("客户名称："), new TextRun({ text: "浙江ABC", bold: true }), new TextRun({ text: "染整有限公司", italics: true })] }),
        new Table({ ...docxTableWidth, rows: [
          new TableRow({ children: [new TableCell({ children: [new Paragraph("产品内部编码")]}), new TableCell({ children: [new Paragraph("销售人员")]})] }),
          new TableRow({ children: [new TableCell({ children: [new Paragraph("HT-825GK")]}), new TableCell({ children: [new Paragraph("张三")]})] }),
          new TableRow({ children: [new TableCell({ children: [new Paragraph("染整助剂-A+B（试制）")]}), new TableCell({ children: [new Paragraph("王·小明 / XM-Wang")]})] }),
        ] }),
        new Paragraph("建议：由张三跟进浙江ABC染整有限公司的 ECO/Soft-X2.0 复购。"),
      ],
    }],
  });
  await fs.writeFile(path.join(outputRoot, "04_DOCX样本", "销售经营分析_原始版.docx"), await Packer.toBuffer(originalDoc));

  const split = tokens.customer1;
  const doc = new Document({
    creator: "文件脱敏助手验证",
    title: "销售分析 DOCX 代号版",
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun(`任务 ${taskId} · ${tokens.customer2}`)] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`负责人 ${tokens.sales2}`)] })] }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: "销售经营分析", bold: true, size: 38 })] }),
        new Paragraph({ children: [new TextRun("客户："), new TextRun({ text: split.slice(0, 6), bold: true }), new TextRun({ text: split.slice(6, 13), italics: true }), new TextRun(split.slice(13))] }),
        new Table({ ...docxTableWidth, rows: [
          new TableRow({ children: [new TableCell({ children: [new Paragraph("产品")]}), new TableCell({ children: [new Paragraph("负责人")]})] }),
          new TableRow({ children: [new TableCell({ children: [new Paragraph(tokens.product1)]}), new TableCell({ children: [new Paragraph(tokens.sales1)]})] }),
          new TableRow({ children: [new TableCell({ children: [new Paragraph(tokens.product3)]}), new TableCell({ children: [new Paragraph(tokens.sales3)]})] }),
        ] }),
        new Paragraph(`建议：由 ${tokens.sales1} 跟进 ${tokens.customer1} 的 ${tokens.product2} 复购。`),
      ],
    }],
  });
  const baseline = path.join(outputRoot, "04_DOCX样本", `销售经营分析_代号版_${taskId}.docx`);
  await fs.writeFile(baseline, await Packer.toBuffer(doc));
}

const page = (id, layout, number, title, body, theme = "light") => `
<section class="slide ${theme}" data-layout="${layout}" data-animate="cascade" data-slide-id="${id}">
  <div class="canvas-card">
    <div class="chrome-min"><div class="l">SAFE SALES / ${title}</div><div class="r">${String(number).padStart(2, "0")} / 08</div></div>
    <div style="flex:1;display:grid;grid-template-rows:auto 1fr;gap:5vh;align-content:start">
      <h2 data-anim="title" style="font-family:var(--sans),var(--sans-zh);font-weight:200;font-size:min(5.2vw,9.2vh);line-height:.94;letter-spacing:-.035em;color:var(--text-primary)">${title}</h2>
      <div data-anim="body" style="font-family:var(--sans),var(--sans-zh);font-size:max(18px,1.25vw);line-height:1.55;color:var(--text-secondary)">${body}</div>
    </div>
  </div>
</section>`;

async function writeHtmlAssets() {
  const slides = [
    `<section class="slide accent" data-layout="SWISS-COVER-ASCII" data-animate="hero" data-slide-id="cover"><div class="canvas-card"><canvas class="ascii-bg" aria-hidden="true"></canvas><div class="chrome-min"><div class="l">SAFE SALES · TEST DECK</div><div class="r">01 / 08</div></div><div style="flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:2.6vh"><div data-anim="kicker" class="t-meta" style="color:rgba(255,255,255,.78);letter-spacing:.22em">LOCAL TOKEN ROUND TRIP</div><h1 data-anim="title" style="align-self:center;font-family:var(--sans),var(--sans-zh);font-weight:200;font-size:min(8vw,14vh);line-height:.94;letter-spacing:-.025em;color:#fff">销售经营分析<br><span style="font-style:italic;font-weight:300">${tokens.customer1}</span></h1><div data-anim="lead" class="lead" style="color:rgba(255,255,255,.86)">任务 ${taskId} · AI 只看到可分析、可还原的代号</div></div></div></section>`,
    page("overview", "S06", 2, "销售总览", `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3vw"><div><strong style="font-size:5vw;color:var(--accent)">642,100</strong><br>累计销售额</div><div><strong style="font-size:5vw">3</strong><br>客户代号</div><div><strong style="font-size:5vw">3</strong><br>产品代号</div></div>`),
    page("customers", "S07", 3, "客户贡献", `<p><strong>${tokens.customer1}</strong> 贡献 41.9%</p><p>${tokens.customer2} 贡献 32.6%</p><p>${tokens.customer3} 贡献 25.5%</p>`, "dark"),
    page("products", "S11", 4, "产品结构", `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2vw"><div>${tokens.product1}<br><strong>329,400</strong></div><div>${tokens.product2}<br><strong>237,500</strong></div><div>${tokens.product3}<br><strong>75,200</strong></div></div>`),
    page("people", "S14", 5, "销售人员表现", `<ol><li>${tokens.sales1} · 269,000</li><li>${tokens.sales2} · 209,300</li><li>${tokens.sales3} · 163,800</li></ol>`),
    page("trend", "S19", 6, "月度趋势", `<div style="display:flex;gap:4vw;align-items:end;height:32vh"><div style="height:90%;width:18%;background:var(--accent)"></div><div style="height:86%;width:18%;background:var(--ink)"></div><div style="height:80%;width:18%;background:#9ca3af"></div></div><p>${tokens.customer1} 在 2 月达到单月峰值。</p>`, "dark"),
    page("cross", "S21", 7, "客户 × 产品", `<p>${tokens.customer2} → ${tokens.product1}</p><p>${tokens.customer3} → ${tokens.product3}</p><p>负责人：${tokens.sales3}</p>`),
    `<section class="slide split" data-layout="SWISS-CLOSING-ASCII" data-animate="split-statement" data-slide-id="closing"><div class="canvas-card"><div class="split-half"><div class="half b-accent" style="padding:5.6vh 3.6vw 4.4vh;position:relative"><canvas class="ascii-bg" aria-hidden="true"></canvas><div data-anim="manifesto" style="position:relative;z-index:1"><div class="t-meta" style="color:#fff">ACTION</div><h2 style="font-size:min(6vw,10vh);font-weight:200;color:#fff">还原真实内容<br>复核排版边界</h2></div></div><div class="half" style="padding:5.6vh 3.6vw 4.4vh"><div class="chrome-min"><div class="l">TAKEAWAYS</div><div class="r">08 / 08</div></div><div data-anim="rules" style="font-size:max(18px,1.2vw);line-height:1.7"><p>01 · ${tokens.customer1}：扩大复购</p><p>02 · ${tokens.sales2}：跟进需求</p><p style="color:var(--accent)">03 · 下载后复核换行与布局</p></div></div></div></div></section>`,
  ].join("\n");
  const note = (id, title, section, minutes, purpose, transition) => ({
    id, title, section, minutes, purpose,
    talk: ["先读页面上的关键结论", "指出代号在分析结构中的作用", "提醒实名还原后需要复核排版"],
    transition,
  });
  const notes = `const SPEAKER_NOTES = ${JSON.stringify([
    note("cover", "销售经营分析", "开场", 0.5, "说明本地代号边界", "进入整体经营表现"),
    note("overview", "销售总览", "经营表现", 0.8, "建立销售规模基线", "进一步看客户贡献"),
    note("customers", "客户贡献", "经营表现", 0.8, "识别收入集中度", "切换到产品组合"),
    note("products", "产品结构", "经营表现", 0.8, "比较产品贡献结构", "观察人员表现"),
    note("people", "销售人员表现", "经营表现", 0.8, "比较人员产出并检验长实名", "进入时间趋势"),
    note("trend", "月度趋势", "经营表现", 0.8, "观察月度变化", "转向客户产品交叉"),
    note("cross", "客户产品交叉", "机会判断", 0.8, "识别交叉销售机会", "收束为行动建议"),
    note("closing", "行动建议", "收束", 0.6, "给出可执行的复核动作", "结束演示并进入人工验收"),
  ], null, 2)};\nwindow.__SPEAKER_NOTES__ = SPEAKER_NOTES;`;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>销售经营分析 · 安全还原测试</title><style>
:root{--sans:Arial;--sans-zh:"Microsoft YaHei";--text-primary:#111827;--text-secondary:#4b5563;--accent:#2563eb;--ink:#111827}
*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:var(--text-primary)}.slide{min-height:100vh;padding:5vh 5vw;background:#fff}.slide.dark{background:#111827;color:#fff}.slide.accent{background:#2563eb;color:#fff}.canvas-card{min-height:90vh;display:flex;flex-direction:column;gap:4vh}.chrome-min{display:flex;justify-content:space-between;font:12px var(--sans);letter-spacing:.16em}.split-half{display:grid;grid-template-columns:1fr 1fr;min-height:90vh}.half{min-width:0}.b-accent{background:#2563eb}.lead{font:20px var(--sans-zh)}
</style></head><body><main class="deck">${slides}</main><div id="nav"></div><script>${notes}</script></body></html>`;
  const baseline = path.join(outputRoot, "05_HTML样本", `销售经营分析_Swiss代号版_${taskId}.html`);
  await fs.writeFile(baseline, html, "utf8");
  const variants = {
    "异常_脚本位置含代号": html.replace("window.__SPEAKER_NOTES__", `window.__unsafeCustomer='${tokens.customer1}';\nwindow.__SPEAKER_NOTES__`),
    "异常_URL位置含代号": html.replace("<div id=\"nav\"></div>", `<a href="https://example.test/${tokens.customer1}">外部链接</a><div id="nav"></div>`),
    "异常_事件属性含代号": html.replace("<div id=\"nav\"></div>", `<button onclick="send('${tokens.sales1}')">发送</button><div id="nav"></div>`),
    "异常_混合任务": html.replace(tokens.customer1, "[[C001@BBBB2026]]"),
    "异常_残缺代号": html.replace(tokens.customer1, "[[C001@A14F"),
  };
  for (const [name, content] of Object.entries(variants)) await fs.writeFile(path.join(outputRoot, "05_HTML样本", `${name}_${taskId}.html`), content, "utf8");
}

async function writeTextAssets() {
  const originalTxt = [
    "客户名称：浙江ABC染整有限公司",
    "产品内部编码：HT-825GK",
    "销售人员：张三",
    "业务备注：浙江ABC染整有限公司计划复购 HT-825GK，由张三继续跟进。",
  ].join("\r\n") + "\r\n";
  const safeTxt = originalTxt
    .replaceAll("浙江ABC染整有限公司", tokens.customer1)
    .replaceAll("HT-825GK", tokens.product1)
    .replaceAll("张三", tokens.sales1);
  const originalMd = `---\n负责人: Alice Chen\n---\n\n| 客户名称 | 产品内部编码 | 销售人员 |\n| --- | --- | --- |\n| NOVA Textiles (Vietnam) Co., Ltd. | ECO/Soft-X2.0 | Alice Chen |\n\n\`\`\`text\nNOVA Textiles (Vietnam) Co., Ltd. / ECO/Soft-X2.0\n\`\`\`\n`;
  const safeMd = originalMd
    .replaceAll("NOVA Textiles (Vietnam) Co., Ltd.", tokens.customer2)
    .replaceAll("ECO/Soft-X2.0", tokens.product2)
    .replaceAll("Alice Chen", tokens.sales2);
  await fs.writeFile(path.join(outputRoot, "08_文本样本", "业务跟进_原始版.txt"), `\uFEFF${originalTxt}`, "utf8");
  await fs.writeFile(path.join(outputRoot, "08_文本样本", `业务跟进_脱敏版_${taskId}.txt`), `\uFEFF${safeTxt}`, "utf8");
  await fs.writeFile(path.join(outputRoot, "08_文本样本", "客户分析_原始版.md"), originalMd, "utf8");
  await fs.writeFile(path.join(outputRoot, "08_文本样本", `客户分析_脱敏版_${taskId}.md`), safeMd, "utf8");
}

await Promise.all([
  "00_测试说明", "01_输入数据", "02_脱敏样本", "03_PPTX样本", "04_DOCX样本", "05_HTML样本", "06_还原输出", "07_验证证据", "08_文本样本",
].map((name) => fs.mkdir(path.join(outputRoot, name), { recursive: true })));
await writeCsvAssets();
await writePptxAssets();
await writeDocxAssets();
await writeHtmlAssets();
await writeTextAssets();
console.log(JSON.stringify({ outputRoot, taskId, mappings: Object.keys(mapping).length }, null, 2));
