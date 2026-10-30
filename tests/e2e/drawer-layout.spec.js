import { test, expect } from "@playwright/test";
import path from "node:path";
import os from "node:os";

test("抽屉关闭保留退出动画，结束后解锁并恢复焦点", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]:not([accept=".json"])').setInputFiles({ name: "虚构动效验证.txt", mimeType: "text/plain", buffer: Buffer.from("客户名称：虚构测试公司") });
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    for (const kind of ["tasks", "details"]) {
      const trigger = page.getByRole("button", { name: kind === "tasks" ? "查看存储状态" : "确认替换内容 查看并调整", exact: true });
      for (const action of ["button", "scrim", "escape"]) {
        await trigger.click();
        const drawer = page.getByRole("dialog", { name: kind === "tasks" ? "本机任务" : "替换内容", exact: true });
        const frames = await drawer.evaluate((element, action) => {
          const close = () => {
            if (action === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            else (action === "scrim" ? element.previousElementSibling : element.querySelector(".drawer-head button")).click();
          };
          close();
          close();
          const animations = element.getAnimations();
          animations.forEach(animation => animation.pause());
          element.previousElementSibling.getAnimations().forEach(animation => animation.pause());
          return animations.map(animation => ({ duration: animation.effect.getTiming().duration, end: animation.effect.getKeyframes().at(-1) }));
        }, action);
        expect(frames).toHaveLength(1);
        expect(frames[0].duration).toBe(200);
        expect(frames[0].end.opacity).toBe("0");
        expect(frames[0].end.transform).toBe(reducedMotion === "reduce" ? "none" : `translateX(${kind === "tasks" ? -22 : 22}px)`);
        await expect(drawer).toHaveAttribute("data-closing", "true");
        await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
        await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
        await drawer.evaluate(element => [element, element.previousElementSibling].forEach(target => target.getAnimations().forEach(animation => animation.play())));
        await expect(drawer).toHaveCount(0);
        await expect(page.locator(".drawer-scrim")).toHaveCount(0);
        await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
        await expect(trigger).toBeFocused();
      }
    }
  }
});

test("任务与详情抽屉固定标题、独立滚动并适配主题和窄屏", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { saveVault } = await import("/src/vaultStore.js");
    for (let i = 0; i < 8; i++) await saveVault({ taskId: `AAAA000${i}`, taskName: `虚构滚动验证任务${i}`, createdAt: new Date().toISOString(), mapping: { a: "虚构内容" } });
  });
  await page.locator('input[type="file"]:not([accept=".json"])').setInputFiles({ name: "虚构抽屉验证.txt", mimeType: "text/plain", buffer: Buffer.from("客户名称：虚构测试公司\n产品名称：DEMO-01") });
  for (const theme of ["light", "dark"]) {
    const select = page.getByRole("combobox", { name: "界面颜色模式" });
    if (await select.isVisible()) await select.selectOption(theme);
    else await page.getByRole("button", { name: theme === "light" ? "浅色模式" : "深色模式", exact: true }).click();
    for (const kind of ["tasks", "details"]) {
      const trigger = page.getByRole("button", { name: kind === "tasks" ? "查看全部任务" : "确认替换内容 查看并调整", exact: true });
      await trigger.click();
      const drawer = page.getByRole("dialog", { name: kind === "tasks" ? "本机任务" : "替换内容", exact: true });
      const head = drawer.locator(".drawer-head");
      const body = drawer.locator(".drawer-body");
      await expect(drawer).toBeVisible();
      await expect(body).toHaveCSS("overflow-y", "auto");
      await expect(drawer).toHaveCSS("overflow-y", "hidden");
      // Finish the existing entrance before measuring fixed positions.
      await drawer.evaluate(async element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      const before = await head.boundingBox();
      const pageScroll = await page.evaluate(() => scrollY);
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect((await head.boundingBox()).y).toBeCloseTo(before.y, 0);
      expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
      const bounds = await drawer.boundingBox();
      if (page.viewportSize().width <= 960) {
        expect(bounds.x).toBe(0);
        expect(bounds.width).toBe(page.viewportSize().width);
      } else {
        const edge = kind === "tasks" ? bounds.x : page.viewportSize().width - bounds.x - bounds.width;
        expect(edge).toBeGreaterThanOrEqual(12);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await body.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: path.join(os.tmpdir(), `masking-drawer-${testInfo.project.name}-${theme}-${kind}.png`) });
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  }
});
