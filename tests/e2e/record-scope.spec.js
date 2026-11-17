import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Admins pick whose records the drawer shows: their own, everyone, a department (with the ones under it) or a person.
test("管理员在操作记录里切换“我的 / 全部”，并按部门、人员筛选", async ({ page, context }) => {
  const tag = randomUUID().slice(0, 6);
  const login = async user => {
    const response = await context.request.post("/__test/session", { headers: { Origin: "http://127.0.0.1:4174" }, data: { user } });
    expect(response.ok()).toBe(true);
    return (await response.json()).csrf;
  };
  const file = name => `${name}_${tag}.xlsx`;
  const record = async (user, name, extra = {}) => {
    const csrf = await login(user);
    const operationId = randomUUID();
    const response = await context.request.post("/api/v1/operation-events/batch", {
      headers: { Origin: "http://127.0.0.1:4174", "x-csrf-token": csrf },
      data: { events: [{ version: 1, eventId: randomUUID(), operationId, time: new Date().toISOString(), action: "protect", result: "success", format: "xlsx", inputName: file(name), taskId: randomUUID(), ...extra }] },
    });
    expect(response.ok()).toBe(true);
  };
  // Dev directory: test-admin and test-alice in 销售部, test-bob in 财务部, both under 测试公司.
  await record("alice", "甲的客户表");
  await record("bob", "乙的费用表");
  await record("admin", "管理员的名单");
  const csrf = await login("admin");
  expect((await context.request.post("/api/v1/access/sync", { headers: { Origin: "http://127.0.0.1:4174", "x-csrf-token": csrf } })).ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "操作记录", exact: true });
  const search = drawer.getByPlaceholder("搜索文件名或任务编号");
  await search.fill(tag);
  const tasks = drawer.locator(".operation-tasks");
  const scope = drawer.getByRole("group", { name: "查看范围" });

  // 我的: only my own records.
  await expect(scope.getByRole("button", { name: "我的" })).toHaveAttribute("aria-pressed", "true");
  await expect(tasks).toContainText(file("管理员的名单"));
  await expect(tasks).not.toContainText(file("甲的客户表"));

  // 全部: everyone, with the owner's name on each task.
  await scope.getByRole("button", { name: "全部" }).click();
  await expect(tasks).toContainText(file("甲的客户表"));
  await expect(tasks).toContainText(file("乙的费用表"));
  await expect(tasks).toContainText("测试员工乙");

  // A department keeps only its people; the parent department covers everyone under it.
  // The department and person pickers sit inside the filter fold.
  await drawer.locator(".record-filters-more > summary").click();
  const pick = async (label, option) => {
    await drawer.getByRole("combobox", { name: label }).click();
    await drawer.getByRole("listbox", { name: label }).getByRole("option", { name: option, exact: true }).click();
    await expect(drawer.getByRole("combobox", { name: label })).toHaveText(option);
  };
  await pick("部门", "财务部");
  await expect(tasks).toContainText(file("乙的费用表"));
  await expect(tasks).not.toContainText(file("甲的客户表"));
  await pick("部门", "测试公司");
  await expect(tasks).toContainText(file("甲的客户表"));
  await expect(tasks).toContainText(file("乙的费用表"));

  // The person list follows the department; picking one shows only that person.
  await pick("部门", "销售部");
  await drawer.getByRole("combobox", { name: "人员" }).click();
  await expect(drawer.getByRole("listbox", { name: "人员" }).getByRole("option")).toHaveText(["部门全部人员", "测试管理员", "测试员工甲"]);
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("listbox", { name: "人员" })).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await pick("人员", "测试员工甲");
  await expect(tasks).toContainText(file("甲的客户表"));
  await expect(tasks).not.toContainText(file("管理员的名单"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("普通员工的操作记录没有查看范围切换", async ({ page, context }) => {
  expect((await context.request.post("/__test/session", { headers: { Origin: "http://127.0.0.1:4174" }, data: { user: "alice" } })).ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "操作记录", exact: true });
  await expect(drawer.getByText("操作记录 ·", { exact: false })).toBeVisible();
  await expect(drawer.getByRole("group", { name: "查看范围" })).toHaveCount(0);
  expect((await context.request.get("/api/v1/operation-tasks?department=2")).status()).toBe(403);
});
