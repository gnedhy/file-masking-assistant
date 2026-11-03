import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import fs from "node:fs/promises";

// AI-style output (multi-slide deck with table, notes, bold runs, grouped shapes and a chart; styled HTML report with a Chart.js chart)
// built from fixtures whose marker AAAA is swapped for the task's real marker. See build-ai-style-fixtures.py.
const TOKEN = /(客户|产品|人员|信息)-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-\d{2,}/;
const fileInput = (page) => page.locator('input[type="file"]:not([accept=".json"])');

async function download(page, name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name, exact: true }).click();
  const file = await pending;
  return fs.readFile(await file.path());
}

// The chart's data workbook is a package inside the package, so it is rewritten the same way.
async function swapMarker(bytes, marker) {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files).filter((entry) => /\.(xml|xlsx)$/.test(entry))) {
    zip.file(name, name.endsWith(".xlsx")
      ? await swapMarker(await zip.file(name).async("nodebuffer"), marker)
      : (await zip.file(name).async("string")).replaceAll("-AAAA-", `-${marker}-`));
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function withMarker(format, marker) {
  const bytes = await fs.readFile(`tests/fixtures/ai-style-${format === "pptx" ? "deck.pptx" : "report.html"}`);
  return format === "html" ? Buffer.from(bytes.toString("utf8").replaceAll("-AAAA-", `-${marker}-`)) : swapMarker(bytes, marker);
}

async function deckParts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = (pattern) => Promise.all(Object.keys(zip.files).filter((name) => pattern.test(name)).map((name) => zip.file(name).async("string")));
  const workbook = await JSZip.loadAsync(await zip.file(/^ppt\/embeddings\/[^/]+\.xlsx$/)[0].async("nodebuffer"));
  return {
    slides: (await read(/^ppt\/(slides|notesSlides)\/[^/]+\.xml$/)).join("\n"),
    chart: (await read(/^ppt\/charts\/chart\d+\.xml$/)).join("\n"),
    chartData: await workbook.file("xl/sharedStrings.xml").async("string"),
    core: await zip.file("docProps/core.xml").async("string"),
  };
}

for (const format of ["pptx", "html"]) {
  test(`表格脱敏后，AI 生成的 ${format.toUpperCase()} 在界面上按简短代号完整还原`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "格式往返不依赖视口");
    test.setTimeout(90000);
    await page.goto("/");
    await fileInput(page).setInputFiles("tests/fixtures/销售明细_功能测试.xlsx");
    await page.getByRole("button", { name: "生成脱敏文件" }).click();
    await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible({ timeout: 30000 });
    await download(page, "下载脱敏文件");
    const { marker, values } = await page.evaluate(async () => {
      const store = await import("/src/vaultStore.js");
      const [summary] = await store.listVaultSummaries();
      const vault = await store.loadVault(summary.taskId);
      const used = Object.entries(vault.mapping).filter(([alias]) => /-0[12]$/.test(alias));
      return { marker: vault.marker, values: used.map(([, entry]) => String(entry.value?.value ?? entry.value)) };
    });

    await page.getByRole("button", { name: /^还原处理文件/ }).click();
    await page.getByRole("button", { name: "切换并清空" }).click();
    await fileInput(page).setInputFiles({ name: `AI 汇报.${format}`, mimeType: "application/octet-stream", buffer: await withMarker(format, marker) });
    await expect(page.locator(".restore-task-match")).toBeVisible({ timeout: 20000 });
    for (const area of format === "pptx" ? ["幻灯片文字和表格", "演讲者备注", "图表文字和数据", "文档属性（标题、主题等）"] : ["图表脚本中的文字"]) {
      await expect(page.locator(".compatibility-check dd").first()).toContainText(area);
    }
    // The deck and the report use 6 of the sheet's tokens; that is normal for a new file, not missing content.
    await expect(page.locator(".compatibility-check")).toHaveAttribute("data-content-loss", "false");
    await expect(page.locator(".compatibility-check")).toContainText("没用到的属于正常改写");
    if (format === "html") await expect(page.locator(".compatibility-check")).toContainText("保留了 2 段图表脚本，在隔离框架中运行");
    await page.getByRole("button", { name: "生成还原文件" }).click();
    await expect(page.getByRole("link", { name: "下载还原文件" })).toBeVisible({ timeout: 30000 });
    const restored = await download(page, "下载还原文件");

    expect(values).toHaveLength(6);
    if (format === "pptx") {
      const { slides, chart, chartData, core } = await deckParts(restored);
      expect(values.filter((value) => !slides.includes(value))).toEqual([]);
      for (const part of [chart, chartData, core]) expect(part).toContain(values[0]);
      for (const part of [slides, chart, chartData, core]) expect(part).not.toMatch(TOKEN);
      return;
    }
    // A page with chart scripts is wrapped in a sandboxed frame; the page itself is the frame's srcdoc.
    const wrapper = restored.toString("utf8");
    expect(wrapper).toContain('<iframe sandbox="allow-scripts"');
    expect(wrapper).not.toMatch(/<script/);
    const text = wrapper.match(/srcdoc="([^"]*)"/)[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    expect(values.filter((value) => !text.includes(value))).toEqual([]);
    expect(wrapper).not.toMatch(TOKEN);
    expect(text).toContain("<table>");
    expect(text).toContain("border-collapse");
    expect(text).toContain('<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>');
    expect(text).toContain(`labels:['${values[0]}',`);
    expect(text).toContain("connect-src 'none'");
    expect(text).toContain("RTCPeerConnection");
  });
}
