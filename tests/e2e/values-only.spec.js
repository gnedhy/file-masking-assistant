import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fileInput = (page) => page.locator('input[type="file"]:not([accept=".json"])');

async function workbookBuffer(build) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function downloadedText(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "下载脱敏文件" }).click()]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  let text = "";
  for (const file of Object.values(zip.files)) if (/\.(xml|vml|rels)$/.test(file.name)) text += await file.async("string");
  return text;
}

test("工作表名和公式里有客户名：失败页一键只保留值后生成成功", async ({ page }) => {
  const buffer = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("虚构乾泰化工有限公司");
    sheet.addRow(["客户名称", "产品编码", "数量", "是否重点"]);
    sheet.addRow(["虚构乾泰化工有限公司", "HT-825GK", 100, { formula: 'IF(A2="虚构乾泰化工有限公司","是","否")', result: "是" }]);
    sheet.addRow(["虚构拓信科技有限公司", "HT-992", 20, { formula: "C3*2", result: 40 }]);
  });
  await page.goto("/");
  await fileInput(page).setInputFiles({ name: "虚构对账.xlsx", mimeType: XLSX, buffer });
  await expect(page.locator(".values-only")).toContainText("公式 2 个");
  await expect(page.getByRole("switch", { name: "只保留值" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("heading", { name: "还有真实名称没有替换掉" })).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".error-issues")).toContainText("的公式");
  await page.getByRole("button", { name: "只保留值后重新生成" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".success-state")).toContainText("只保留了数值");
  const text = await downloadedText(page);
  expect(text).not.toContain("乾泰");
  expect(text).not.toContain("<f>");
  expect(text).toContain("工作表1");
});

test("检查页打开只保留值：批注、下拉和公式不带进脱敏文件", async ({ page }) => {
  const buffer = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("销售");
    sheet.addRow(["客户名称", "数量", "金额", "等级"]);
    sheet.addRow(["虚构宏图化工有限公司", 2, { formula: "B2*10", result: 20 }, "A"]);
    sheet.addRow(["虚构南海材料有限公司", 3, { formula: "B3*10", result: 30 }, "B"]);
    sheet.getCell("B2").note = "内部备注：加急";
    sheet.getCell("D2").dataValidation = { type: "list", formulae: ['"A,B,C"'] };
  });
  await page.goto("/");
  await fileInput(page).setInputFiles({ name: "虚构销售.xlsx", mimeType: XLSX, buffer });
  await expect(page.locator(".values-only")).toContainText("公式 2 个、批注 1 条、下拉或输入限制 1 处");
  await page.getByRole("switch", { name: "只保留值" }).click();
  await expect(page.getByRole("switch", { name: "只保留值" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible({ timeout: 30000 });
  const text = await downloadedText(page);
  for (const gone of ["<f>", "内部备注", "dataValidation", "宏图"]) expect(text).not.toContain(gone);
  expect(text).toContain("<v>20</v>");
});

test("只有数值的文件不显示只保留值", async ({ page }) => {
  const buffer = await workbookBuffer((workbook) => workbook.addWorksheet("销售").addRows([["客户名称", "数量"], ["虚构宏图化工有限公司", 2]]));
  await page.goto("/");
  await fileInput(page).setInputFiles({ name: "虚构纯值.xlsx", mimeType: XLSX, buffer });
  await expect(page.getByRole("button", { name: "生成脱敏文件" })).toBeVisible();
  await expect(page.locator(".values-only")).toHaveCount(0);
});
