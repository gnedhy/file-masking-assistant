import { test, expect } from "@playwright/test";

// Picking only an empty column used to fail with "no values"; empty columns are now marked and cannot be picked.
test("空列标为无内容且不能勾选，其余列照常脱敏", async ({ page }) => {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("原料").addRows([["客户名称", "销售人员", "数量"], ["虚构客户甲", null, 10], ["虚构客户乙", null, 20]]);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "空列.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  await page.getByRole("button", { name: /确认替换内容/ }).click();
  const drawer = page.getByRole("dialog", { name: "替换内容", exact: true });
  const empty = drawer.getByRole("checkbox", { name: /^B 列 · 销售人员 / });
  await expect(empty).toBeDisabled();
  await expect(empty).not.toBeChecked();
  const row = drawer.locator(".column-selection").filter({ hasText: "B 列 · 销售人员" });
  await expect(row).toContainText("这一列没有内容，无需替换");
  await expect(row.locator("em")).toHaveText("无内容");
  await expect(drawer.getByRole("checkbox", { name: /^A 列 · 客户名称 / })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "生成脱敏文件" }).click();
  await expect(page.getByRole("link", { name: "下载脱敏文件" })).toBeVisible();
});
