import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chooseTheme } from "./theme-helper.js";
import ExcelJS from "exceljs";

test("集中记录：真实数据库、本人权限、管理员统计、导出与文件往返", async ({ page, context }, info) => {
  test.setTimeout(60000);
  const login = async user => {
    const response=await context.request.post('/__test/session',{headers:{Origin:'http://127.0.0.1:4175','x-test-secret':'isolated-test-login-secret-not-for-deployment'},data:{user}});
    expect(response.ok()).toBe(true); return response.json();
  };
  const alice=await login('alice');
  const prefix=`闭环_${randomUUID().slice(0,8)}`;
  await page.goto('/');
  await page.waitForFunction(async()=>Boolean((await import('/src/operationSync.js')).getOperationSyncState().session));
  await page.locator('input[type=file]:not([accept=".json"])').setInputFiles({name:`${prefix}.txt`,mimeType:'text/plain',buffer:Buffer.from('客户名称：虚构测试企业\n产品名称：虚构产品甲')});
  await page.getByRole('button',{name:'生成脱敏文件',exact:true}).click();
  const generated=page.waitForEvent('download');
  await page.getByRole('link',{name:'下载脱敏文件',exact:true}).click();
  const safe=await generated;
  await page.getByRole('button',{name:'导入 AI 处理后的文件',exact:true}).click();
  await page.locator('input[type=file]:not([accept=".json"])').setInputFiles({name:safe.suggestedFilename(),mimeType:'text/plain',buffer:await fs.readFile(await safe.path())});
  await page.getByRole('button',{name:'生成还原文件',exact:true}).click();
  const restored=page.waitForEvent('download');await page.getByRole('link',{name:'下载还原文件',exact:true}).click();
  expect(await fs.readFile(await (await restored).path(),'utf8')).toContain('虚构测试企业');
  await page.evaluate(async()=>{await (await import('/src/operationSync.js')).retryOperationSync();});
  await expect.poll(async()=>page.evaluate(async()=>(await import('/src/operationSync.js')).getOperationSyncState().pending)).toBe(0);
  await page.getByRole('button',{name:'操作记录',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'操作记录',exact:true});
  await expect(drawer.getByText('测试员工甲 · 只记录操作和文件名')).toBeVisible();
  await drawer.getByLabel('搜索',{exact:true}).fill(prefix);
  await expect(drawer.locator('.operation-tasks > li').first()).toBeVisible();
  expect((await context.request.get('/api/v1/operation-events?user=test-bob')).status()).toBe(403);
  // Records and restore data share one service and one session now.
  expect((await context.request.get('/api/v1/vault-tasks')).status()).toBe(200);
  await drawer.getByRole('button',{name:'关闭操作记录'}).click();
  await login('admin');
  await page.evaluate(async()=>{await (await import('/src/operationSync.js')).retryOperationSync();});
  await page.getByRole('button',{name:'操作记录',exact:true}).click();
  await drawer.getByRole('button',{name:'使用统计',exact:true}).click();
  const central=page.getByRole('region',{name:'使用统计',exact:true});
  await expect(central.getByText('全部人员',{exact:true})).toBeVisible();
  await expect(central.locator('.usage-tile dt')).toHaveText(['成功脱敏任务','有还原结果的任务','使用人数','失败操作']);
  await expect(central.getByRole('heading',{name:'活跃用户'})).toBeVisible();
  // Searching narrows the numbers and the detail list on the server.
  const reports=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/v1/operation-report'&&url.searchParams.get('query'))reports.push(url.searchParams.get('query'));});
  await central.locator('.usage-filters > summary').click();
  await central.getByLabel('搜索',{exact:true}).fill(prefix);
  await expect.poll(()=>reports.at(-1)).toBe(prefix);
  await expect(central.locator('.usage-tile').first()).toContainText('1');
  await central.locator('.usage-detail > summary').click();
  // The detail lists tasks; opening one shows its steps.
  const firstTask=central.locator('.task-row').first();
  await expect(firstTask).toContainText(prefix);
  await expect(firstTask).toContainText('测试员工甲');
  await firstTask.locator('.task-row__main').click();
  await expect(firstTask.getByRole('list',{name:/的操作步骤$/}).getByRole('listitem').first()).toBeVisible();
  await expect(central.locator('.task-row')).not.toContainText(['查看全员记录']);
  await page.route('**/api/v1/operation-report?*',route=>route.fulfill({status:503,json:{code:'RECORDS_UNAVAILABLE'}}));
  await central.getByRole('button',{name:'最近 7 天',exact:true}).click();
  await expect(central.getByRole('alert')).toContainText('暂时无法读取统计');
  await page.unroute('**/api/v1/operation-report?*');
  await central.getByRole('button',{name:'重新读取',exact:true}).click();
  await expect(central.locator('.usage-tile').first()).toBeVisible();
  // The detail list stays open across the reload.
  await expect(central.locator('.usage-detail')).toHaveAttribute('open','');
  for (const theme of ['浅色','深色','系统']) {
    await chooseTheme(page,{ 浅色:'light', 深色:'dark', 系统:'system' }[theme]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({animations:'disabled',path:path.join(os.tmpdir(),`central-records-${info.project.name}-${theme}.png`)});
  }
  const exported=page.waitForEvent('download');await central.getByRole('button',{name:'导出明细',exact:true}).click();
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(await (await exported).path());
  expect(book.worksheets.map(ws=>ws.name)).toEqual(['统计分析','明细','数据表']);
  const detail=JSON.stringify(book.getWorksheet('明细').getSheetValues());
  expect(detail).toContain(prefix);expect(detail).toContain('测试员工甲');expect(detail).not.toContain('虚构测试企业');
  expect(JSON.stringify(book.getWorksheet('统计分析').getSheetValues())).toContain('活跃用户');expect(JSON.stringify(book.getWorksheet('数据表').getSheetValues())).toContain('人员排行');
  await central.getByRole('button',{name:'返回文件处理'}).click();
  await expect(page.getByRole('link',{name:'再次下载',exact:true})).toBeVisible();
});
