import { test, expect } from "@playwright/test";

// Runs against the shared PostgreSQL test server, where test-admin starts as the only admin.
const ORIGIN = "http://127.0.0.1:4175";
// Whatever happened in the test, leave test-admin as the only admin so the next browser starts clean.
test.afterEach(async ({ context }) => {
  const as = async user => {
    await context.request.post("/__test/session", { headers: { Origin: ORIGIN }, data: { user } });
    return (await context.request.get("/api/v1/session")).json();
  };
  const set = (session, userId, isAdmin) => context.request.post("/api/v1/access/admins", { headers: { Origin: ORIGIN, "x-csrf-token": session.csrf }, data: { userId, isAdmin } });
  const bob = await as("bob");
  if (bob.isAdmin) await set(bob, "test-admin", true);
  const admin = await as("admin");
  if (admin.isAdmin) await set(admin, "test-bob", false);
});

test("权限配置：仅管理员可见；普通用户的使用统计只含本人；同步通讯录后授予并取消管理员", async ({ page, context }) => {
  const login = async user => {
    const response = await context.request.post("/__test/session", { headers: { Origin: "http://127.0.0.1:4175" }, data: { user } });
    expect(response.ok()).toBe(true);
  };
  await login("bob");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "操作记录", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "权限配置", exact: true })).toHaveCount(0);
  expect((await context.request.get("/api/v1/access")).status()).toBe(403);
  // Ordinary users also get the statistics button, limited to their own records.
  await page.getByRole("button", { name: "操作记录", exact: true }).click();
  await page.getByRole("dialog", { name: "操作记录" }).getByRole("button", { name: "使用统计", exact: true }).click();
  const own = page.getByRole("region", { name: "使用统计", exact: true });
  await expect(own.getByText("仅本人", { exact: true })).toBeVisible();
  await expect(own.getByText(/仅统计本人的记录/)).toBeVisible();
  await expect(own.getByRole("heading", { name: "活跃用户" })).toHaveCount(0);
  await expect(own.getByLabel("用户")).toHaveCount(0);
  expect((await context.request.get("/api/v1/operation-report?user=test-alice")).status()).toBe(403);
  await own.getByRole("button", { name: "返回文件处理" }).click();

  await login("admin");
  await page.reload();
  await page.getByRole("button", { name: "权限配置", exact: true }).click();
  const settings = page.getByRole("region", { name: "权限配置" });
  await expect(settings.getByRole("heading", { name: "权限配置", level: 1 })).toBeFocused();
  await settings.getByRole("button", { name: "同步通讯录" }).click();
  // The old sync time is already on the page; wait for this sync to finish before changing anyone.
  await expect(settings.getByRole("button", { name: "同步通讯录" })).toBeEnabled();
  await expect(settings.getByText(/上次同步：.*3 个部门 · 3 人/)).toBeVisible();
  await settings.getByRole("combobox", { name: "部门" }).selectOption({ label: "　财务部" });
  const bob = settings.getByRole("listitem").filter({ hasText: "test-bob" });
  await expect(settings.getByRole("navigation", { name: "通讯录分页" })).toHaveText("共 1 人");
  await bob.getByRole("button", { name: "设为管理员" }).click();
  await expect(settings.getByRole("status").filter({ hasText: "测试员工乙 已设为管理员" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "管理员（2）" })).toBeVisible();

  await login("bob");
  expect((await (await context.request.get("/api/v1/session")).json()).isAdmin).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "权限配置", exact: true }).click();
  // bob takes the rights away from test-admin, then test-admin gives them back and removes bob again.
  await page.getByRole("region", { name: "权限配置" }).getByRole("listitem").filter({ hasText: "test-admin" }).first().getByRole("button", { name: "取消管理员" }).click();
  await expect(page.getByRole("heading", { name: "管理员（1）" })).toBeVisible();
  await expect(page.getByRole("region", { name: "权限配置" }).getByRole("listitem").filter({ hasText: "test-bob" }).first().getByRole("button", { name: "取消管理员" })).toBeDisabled();
  await page.getByRole("region", { name: "权限配置" }).getByRole("listitem").filter({ hasText: "test-admin" }).first().getByRole("button", { name: "设为管理员" }).click();
  await expect(page.getByRole("heading", { name: "管理员（2）" })).toBeVisible();

  await login("admin");
  const restore = await context.request.post("/api/v1/access/admins", { headers: { Origin: "http://127.0.0.1:4175", "x-csrf-token": (await (await context.request.get("/api/v1/session")).json()).csrf }, data: { userId: "test-bob", isAdmin: false } });
  expect(restore.ok()).toBe(true);
  const changes = (await restore.json()).changes.slice(0, 4).map(c => `${c.actorName}:${c.targetName}:${c.change}`);
  expect(changes).toEqual(["测试管理员:测试员工乙:revoke", "测试员工乙:测试管理员:grant", "测试员工乙:测试管理员:revoke", "测试管理员:测试员工乙:grant"]);
});
