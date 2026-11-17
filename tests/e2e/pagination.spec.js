import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Long lists page 20 at a time by default; 50 or 100 can be chosen and the choice is remembered.
test("操作记录和使用统计可以选择每页 20 / 50 / 100 条，并记住选择", async ({ page, context }) => {
  const tag = randomUUID().slice(0, 6);
  const origin = "http://127.0.0.1:4174";
  const login = await context.request.post("/__test/session", { headers: { Origin: origin }, data: { user: "alice" } });
  const { csrf } = await login.json();
  const events = Array.from({ length: 25 }, (_, index) => ({ version: 1, eventId: randomUUID(), operationId: randomUUID(), time: new Date(Date.now() - index * 60000).toISOString(), action: "protect", result: "success", format: "xlsx", inputName: `分页_${tag}_${index + 1}.xlsx`, taskId: randomUUID() }));
  expect((await context.request.post("/api/v1/operation-events/batch", { headers: { Origin: origin, "x-csrf-token": csrf }, data: { events } })).ok()).toBe(true);
  expect((await context.request.get("/api/v1/operation-tasks?pageSize=30")).status()).toBe(400);

  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("file-mask-page-size"));
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "操作记录", exact: true });
  await drawer.getByPlaceholder("搜索文件名或任务编号").fill(tag);
  const pager = drawer.getByRole("navigation", { name: "操作记录分页" });
  await expect(pager.getByRole("status")).toHaveText("第 1 / 2 页 · 共 25 个任务");
  await expect(drawer.locator(".operation-tasks > li")).toHaveCount(20);
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(pager.getByRole("status")).toHaveText("第 2 / 2 页 · 共 25 个任务");
  await expect(drawer.locator(".operation-tasks > li")).toHaveCount(5);

  // Choosing 50 goes back to page 1 and shows everything.
  await pager.getByRole("combobox", { name: "每页条数" }).click();
  await pager.getByRole("option", { name: "50 条" }).click();
  await expect(pager.getByRole("status")).toHaveText("第 1 / 1 页 · 共 25 个任务");
  await expect(drawer.locator(".operation-tasks > li")).toHaveCount(25);
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();

  // The statistics detail uses the same remembered size.
  await drawer.getByRole("button", { name: "使用统计", exact: true }).click();
  const stats = page.getByRole("region", { name: "使用统计", exact: true });
  await stats.locator(".usage-filters > summary").click();
  await stats.getByLabel("搜索", { exact: true }).fill(tag);
  await page.keyboard.press("Escape");
  await stats.locator(".usage-detail > summary").click();
  const statsPager = stats.getByRole("navigation", { name: "操作明细分页" });
  await expect(statsPager.getByRole("combobox", { name: "每页条数" })).toHaveText("50 条");
  // Other browsers write to the same test account at the same time, so only the page size is checked here.
  await expect(statsPager.getByRole("status")).toHaveText(/^第 1 \/ \d+ 页 · 共 \d+ 个任务$/);
  expect(await stats.locator(".task-row").count()).toBeLessThanOrEqual(50);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
