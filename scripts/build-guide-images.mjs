// Cuts the annotated screenshots out of the printable guides (docs/测试指引) into small JPEGs for the in-app 使用指南.
// Run after re-taking the guide screenshots: node scripts/build-guide-images.mjs
import { chromium } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guides = path.join(root, "docs", "测试指引");
const out = path.join(root, "public", "guide");
// Output names, in the order the figures appear in each guide.
const PAGES = [
  ["使用指引.html", ["use-1-review", "use-2-download", "use-3-copy", "use-4-import", "use-5-restore"]],
  ["反馈指引.html", ["feedback-result", "feedback-dialog", "feedback-button", "feedback-center"]],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1.6 });
  for (const [file, names] of PAGES) {
    await page.goto(pathToFileURL(path.join(guides, file)).href);
    await page.evaluate(() => window.guideReady);
    const figures = page.locator("figure.shot");
    if (await figures.count() !== names.length) throw new Error(`${file}: expected ${names.length} screenshots, found ${await figures.count()}`);
    for (const [index, name] of names.entries()) {
      const target = path.join(out, `${name}.jpg`);
      await figures.nth(index).screenshot({ path: target, type: "jpeg", quality: 82 });
      console.log(`${name}.jpg  ${Math.round((await stat(target)).size / 1024)} KB`);
    }
  }
} finally {
  await browser.close();
}
