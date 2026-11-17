// Renders each guide HTML to a 2x PNG and an A4 PDF. Usage: node docs/测试指引/render.mjs [name...]
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.join(here, "../../package.json"))("@playwright/test");
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["反馈指引", "使用指引"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 2 });
for (const name of names) {
  await page.goto(pathToFileURL(path.join(here, name + ".html")).href);
  await page.evaluate(() => window.guideReady);
  const height = await page.evaluate(() => document.body.scrollHeight);
  console.log(name, "height", height, height > 1754 ? "(over one A4 page)" : "");
  await page.screenshot({ path: path.join(here, name + ".png"), fullPage: true });
  await page.pdf({ path: path.join(here, name + ".pdf"), width: "1240px", height: Math.max(1754, height) + "px", printBackground: true });
}
await browser.close();
