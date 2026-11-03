import test from "node:test";
import assert from "node:assert/strict";
import { bucketActivity, dailyActivity, filterOperations, groupByDay, groupOperations, outcomeSummary, rankBy, summarizeOperations, operationsCsv } from "../src/operationReports.js";
test("filters, distinct tasks, download requests and CSV formula neutralization", () => {
  const base={userId:"u1",taskId:"A",time:"2026-10-28T08:00:00Z",format:"txt",inputName:"=HYPERLINK(\"x\")"};
  const rows=[{...base,action:"import_protect",result:"requested"},{...base,action:"protect",result:"success"},{...base,action:"restore",result:"success"},{...base,action:"restore",result:"missing"},...Array.from({length:2},()=>({...base,action:"download_restore",result:"requested"})),{...base,action:"export_records",result:"requested"},{...base,action:"inspect_restore",result:"failed"}];
  assert.deepEqual(summarizeOperations(rows),{users:1,protected:1,restored:1,failed:1,imports:1,downloads:2,likes:0,dislikes:0,satisfaction:null});
  assert.equal(filterOperations(rows,{from:"2026-10-28",to:"2026-10-28",user:"u1",format:"txt",query:"hyperlink",result:"failed"}).length,1);
  assert.equal(filterOperations(rows,{from:"2026-10-29",to:"2026-10-28"}).length,0);
  const csv=operationsCsv(rows,true);assert.ok(csv.startsWith("\uFEFF"));assert.ok(csv.includes("虚构示例"));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('""x""'));
  for(const name of ["+1","-1","@SUM(1)","  =1","\t=1"]){assert.ok(operationsCsv([{...base,inputName:name}]).includes("'"+name));}
});
test("一次文件流程合并为一项，任务相关记录归入制作流程", () => {
  const at = minute => `2026-10-30T08:${String(minute).padStart(2, "0")}:00Z`;
  const rows = [
    { id: 8, action: "download_restore", result: "requested", time: at(8), operationId: "r1", taskId: "A", inputName: "AI.txt", outputName: "还原.txt", format: "txt" },
    { id: 7, action: "restore", result: "partial", time: at(7), operationId: "r1", taskId: "A", inputName: "AI.txt", outputName: "还原.txt", format: "txt" },
    { id: 6, action: "import_restore", result: "requested", time: at(6), operationId: "r1", inputName: "AI.txt", format: "txt" },
    { id: 5, action: "download_credential", result: "requested", time: at(5), taskId: "A", marker: "X55K" },
    { id: 4, action: "download_protect", result: "requested", time: at(4), operationId: "p1", taskId: "A", marker: "X55K", inputName: "源.txt", outputName: "脱敏.txt", format: "txt" },
    { id: 3, action: "protect", result: "success", time: at(3), operationId: "p1", taskId: "A", marker: "X55K", inputName: "源.txt", outputName: "脱敏.txt", format: "txt" },
    { id: 2, action: "save_mapping", result: "success", time: at(3), taskId: "A", marker: "X55K" },
    { id: 1, action: "export_records", result: "requested", time: at(1) },
  ];
  const groups = groupOperations(rows);
  assert.deepEqual(groups.map(g => [g.title, g.result, g.steps.length]), [["还原处理文件", "partial", 3], ["制作脱敏文件", "success", 4], ["导出操作记录", "requested", 1]]);
  assert.equal(groups[0].inputName, "AI.txt");
  assert.equal(groups[1].outputName, "脱敏.txt");
  assert.equal(groups[1].taskLabel, "X55K");
  assert.equal(operationsCsv(rows).trim().split("\n").length, rows.length + 1);
});

test("没有 operationId 的旧记录按任务和类型合并，只检查未生成时如实显示", () => {
  const time = "2026-10-30T08:00:00Z";
  const groups = groupOperations([
    { id: 4, action: "restore", result: "success", time, taskId: "OLD" },
    { id: 3, action: "protect", result: "success", time, taskId: "OLD" },
    { id: 2, action: "inspect_protect", result: "success", time, operationId: "p9", inputName: "只检查.txt" },
    { id: 1, action: "inspect_restore", result: "waiting", time, operationId: "r9", inputName: "待钥匙.txt" },
  ]);
  assert.deepEqual(groups.map(g => [g.kind, g.result]), [["restore", "success"], ["protect", "success"], ["protect", "idle"], ["restore", "waiting"]]);
});

test("按今天、昨天和具体日期分组", () => {
  const now = new Date(2026, 9, 30, 12);
  const group = (y, m, d) => ({ time: new Date(y, m, d, 9).toISOString() });
  assert.deepEqual(groupByDay([group(2026, 9, 30), group(2026, 9, 29), group(2026, 9, 3), group(2025, 11, 31)], now).map(d => d.label), ["今天", "昨天", "10月3日", "2025年12月31日"]);
});
test("每日统计按用户和任务去重，分桶从最新一天往前取整周", () => {
  const time = day => new Date(2026, 9, day, 10).toISOString();
  const row = (day, action, result, taskId = "A", userId = "u1") => ({ time: time(day), action, result, taskId, userId });
  const days = dailyActivity([row(2, "protect", "success"), row(2, "protect", "success"), row(2, "protect", "success", "B", "u2"), row(3, "restore", "missing"), row(3, "restore", "failed", "C")], "2026-10-01", "2026-10-03");
  assert.deepEqual(days.map(d => [d.day, d.protected, d.restored, d.failed]), [["2026-10-01", 0, 0, 0], ["2026-10-02", 2, 0, 0], ["2026-10-03", 0, 1, 1]]);
  const many = Array.from({ length: 9 }, (_, i) => ({ day: `d${i}`, label: `${i}`, protected: 1, restored: 0 }));
  const buckets = bucketActivity(many, 7);
  assert.deepEqual(buckets.map(b => [b.day, b.to, b.protected]), [["d0", "d1", 2], ["d2", "d8", 7]]);
  assert.equal(bucketActivity(many, 1), many);
});

test("完成率不把未发起还原算作失败，异常项只列有数量的类型", () => {
  const row = (action, result) => ({ action, result });
  const summary = outcomeSummary([row("protect", "success"), row("protect", "success"), row("restore", "success"), row("restore", "partial"), row("inspect_restore", "failed"), row("download_protect", "requested"), row("inspect_protect", "success")]);
  assert.equal(summary.rate, 60);
  assert.equal(summary.attention, 2);
  assert.deepEqual(summary.issues.map(i => [i.key, i.count]), [["failed", 1], ["partial", 1]]);
  assert.deepEqual(outcomeSummary([]), { rate: 100, attention: 0, issues: [] });
});

test("排行只计成功脱敏并按数量排序", () => {
  const row = (userName, action = "protect", result = "success") => ({ userId: userName, userName, action, result });
  assert.deepEqual(rankBy([row("甲"), row("乙"), row("乙"), row("丙", "restore"), row("丁", "protect", "failed")], r => r.userId, r => r.userName).map(i => [i.label, i.count]), [["乙", 2], ["甲", 1]]);
});

test("统计报表：对比前一段同样长的时间，普通用户没有人员排行", async () => {
  const { operationReport, previousRange } = await import("../src/operationReports.js");
  assert.deepEqual(previousRange("2026-10-08", "2026-10-14"), { from: "2026-10-01", to: "2026-10-07" });
  const row = (day, userId, action, result, taskId) => ({ time: `${day}T10:00:00+08:00`, userId, userName: userId, action, result, taskId, format: "xlsx" });
  const rows = [row("2026-10-10", "a", "protect", "success", "t1"), row("2026-10-11", "b", "protect", "success", "t2"), row("2026-10-11", "b", "restore", "partial", "t2"), row("2026-10-03", "a", "protect", "success", "t0")];
  const admin = operationReport(rows, { from: "2026-10-08", to: "2026-10-14" });
  assert.equal(admin.span, 7);
  assert.equal(admin.totals.protected, 2);
  assert.equal(admin.previous.protected, 1);
  assert.equal(admin.days.length, 7);
  assert.deepEqual(admin.outcome.issues.map(i => i.key), ["partial"]);
  assert.deepEqual(admin.people.map(p => p.key), ["a", "b"]);
  assert.deepEqual(admin.members.map(m => m.id).sort(), ["a", "b"]);
  const own = operationReport(rows.filter(r => r.userId === "a"), { from: "2026-10-08", to: "2026-10-14" }, { people: false });
  assert.deepEqual([own.people, own.members, own.totals.protected], [[], [], 1]);
});

test("统计报表日期范围：默认最近 30 天，最长一年，只看异常筛选只接受固定值", async () => {
  const { reportRange, buildFilter } = await import("../server/operations-repository.mjs");
  const range = reportRange({});
  assert.equal((new Date(range.to) - new Date(range.from)) / 86400000, 29);
  assert.throws(() => reportRange({ from: "2026-10-10", to: "2026-10-01" }), /INVALID_DATE_RANGE/);
  assert.throws(() => reportRange({ from: "2025-01-01", to: "2026-10-01" }), /INVALID_DATE_RANGE/);
  const filter = buildFilter({ userId: "a", isAdmin: false }, { issues: "1" });
  assert.match(filter.sql, /result = ANY/);
  assert.deepEqual(filter.values.at(-1), ["failed", "partial", "missing", "waiting"]);
  assert.throws(() => buildFilter({ userId: "a", isAdmin: false }, { issues: "yes" }), /INVALID_FILTER/);
});

test("满意度：同一个人对同一次处理改评价只算最后一次，没有评价时为空", () => {
  const rate = (userId, operationId, action, minute) => ({ userId, operationId, action, result: "success", time: `2026-10-10T10:${String(minute).padStart(2, "0")}:00Z` });
  assert.equal(summarizeOperations([]).satisfaction, null);
  const totals = summarizeOperations([rate("a", "op1", "rate_down", 1), rate("a", "op1", "rate_up", 2), rate("a", "op2", "rate_down", 3), rate("b", "op1", "rate_up", 4)]);
  assert.deepEqual([totals.likes, totals.dislikes, totals.satisfaction], [2, 1, 67]);
});
