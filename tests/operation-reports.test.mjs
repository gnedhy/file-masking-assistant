import test from "node:test";
import assert from "node:assert/strict";
import { filterOperations, groupByDay, groupOperations, summarizeOperations, operationsCsv } from "../src/operationReports.js";
test("filters, distinct tasks, download requests and CSV formula neutralization", () => {
  const base={userId:"u1",taskId:"A",time:"2026-10-28T08:00:00Z",format:"txt",inputName:"=HYPERLINK(\"x\")"};
  const rows=[{...base,action:"import_protect",result:"requested"},{...base,action:"protect",result:"success"},{...base,action:"restore",result:"success"},{...base,action:"restore",result:"missing"},...Array.from({length:2},()=>({...base,action:"download_restore",result:"requested"})),{...base,action:"export_records",result:"requested"},{...base,action:"inspect_restore",result:"failed"}];
  assert.deepEqual(summarizeOperations(rows),{users:1,protected:1,restored:1,failed:1,imports:1,downloads:2});
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
