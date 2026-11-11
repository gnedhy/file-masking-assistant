import { test, expect } from "@playwright/test";
import pg from "pg";

// Runs against the shared PostgreSQL test server. Each run starts with no feedback.
const ORIGIN = "http://127.0.0.1:4175";
test.beforeEach(async () => {
  const client = new pg.Client("postgres://operations_test@127.0.0.1:55434/filemask_operations_test");
  await client.connect();
  try { await client.query("DELETE FROM feedback"); } finally { await client.end(); }
});

test("结果反馈：员工倒赞并附脱敏版，管理员角标、处理，员工收到回复角标", async ({ page, context }) => {
  test.setTimeout(60000);
  const login = async user => { expect((await context.request.post("/__test/session", { headers: { Origin: ORIGIN }, data: { user } })).ok()).toBe(true); };
  const badge = () => page.locator(".feedback-trigger b");

  await login("alice");
  await page.goto("/");
  await page.locator('input[type=file]:not([accept=".json"])').setInputFiles({ name: "反馈样本.txt", mimeType: "text/plain", buffer: Buffer.from("客户名称：虚构测试企业\n产品名称：虚构产品甲") });
  await page.getByRole("button", { name: "生成脱敏文件", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载脱敏文件", exact: true }).click();
  await download;

  await page.getByRole("button", { name: "不满意" }).click();
  const dialog = page.getByRole("dialog", { name: "哪里不满意？" });
  await expect(dialog.getByLabel("脱敏版文件")).toBeChecked();
  // Only alias-carrying files are offered.
  await expect(dialog.getByText("原文件和还原后的文件含真实信息，不会发送。")).toBeVisible();
  await dialog.getByLabel("问题描述").fill("产品名称没有被替换");
  await dialog.getByRole("button", { name: "发送反馈" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("已收到反馈，管理员处理后会回复你。")).toBeVisible();
  await expect(badge()).toHaveCount(0);

  await login("admin");
  await page.reload();
  await expect(badge()).toHaveText("1");
  await page.getByRole("button", { name: /^反馈/ }).click();
  const center = page.getByRole("region", { name: "反馈" });
  const item = center.getByRole("listitem").filter({ hasText: "产品名称没有被替换" });
  await expect(item).toContainText("测试员工甲");
  await expect(item).toContainText("结果反馈 · 脱敏");
  await expect(item.getByRole("link", { name: /脱敏文件_.*\.txt/ })).toBeVisible();
  const attachment = page.waitForEvent("download");
  await item.getByRole("link", { name: /脱敏文件_.*\.txt/ }).click();
  const saved = await (await attachment).path();
  expect((await import("node:fs")).readFileSync(saved, "utf8")).not.toContain("虚构测试企业");
  await item.getByLabel(/处理结果/).fill("已确认，下个版本修复");
  await item.getByRole("button", { name: "标记为已处理" }).click();
  await expect(center.getByText("没有待处理的反馈。")).toBeVisible();
  await expect(badge()).toHaveCount(0);

  await login("alice");
  await page.reload();
  await expect(badge()).toHaveText("1");
  await page.getByRole("button", { name: /^反馈/ }).click();
  await expect(page.getByRole("region", { name: "反馈" }).getByText("已确认，下个版本修复")).toBeVisible();
  await expect(badge()).toHaveCount(0);
});

test("使用反馈：员工从右上角提交，普通员工看不到别人的反馈", async ({ page, context }) => {
  const login = async user => { expect((await context.request.post("/__test/session", { headers: { Origin: ORIGIN }, data: { user } })).ok()).toBe(true); };
  await login("alice");
  await page.goto("/");
  await page.getByRole("button", { name: /^反馈/ }).click();
  const center = page.getByRole("region", { name: "反馈" });
  await center.getByLabel("遇到的问题或建议").fill("希望支持 PDF");
  await center.getByRole("button", { name: "发送给管理员" }).click();
  await expect(center.getByRole("status").filter({ hasText: "反馈已发送给管理员" })).toBeVisible();
  await expect(center.getByRole("listitem").filter({ hasText: "希望支持 PDF" })).toContainText("待处理");
  await login("bob");
  expect((await (await context.request.get("/api/v1/feedback")).json()).items).toEqual([]);
});
