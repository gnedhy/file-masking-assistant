import test from "node:test";
import assert from "node:assert/strict";
import { filterOperations, summarizeOperations, operationsCsv } from "../src/operationReports.js";
test("filters, distinct tasks, download requests and CSV formula neutralization", () => {
  const base={userId:"u1",taskId:"A",time:"2026-10-28T08:00:00Z",format:"txt",inputName:"=HYPERLINK(\"x\")"};
  const rows=[{...base,action:"import_protect",result:"requested"},{...base,action:"protect",result:"success"},{...base,action:"restore",result:"success"},{...base,action:"restore",result:"missing"},...Array.from({length:2},()=>({...base,action:"download_restore",result:"requested"})),{...base,action:"export_records",result:"requested"},{...base,action:"inspect_restore",result:"failed"}];
  assert.deepEqual(summarizeOperations(rows),{users:1,protected:1,restored:1,failed:1,imports:1,downloads:2});
  assert.equal(filterOperations(rows,{from:"2026-10-28",to:"2026-10-28",user:"u1",format:"txt",query:"hyperlink",result:"failed"}).length,1);
  assert.equal(filterOperations(rows,{from:"2026-10-29",to:"2026-10-28"}).length,0);
  const csv=operationsCsv(rows,true);assert.ok(csv.startsWith("\uFEFF"));assert.ok(csv.includes("虚构示例"));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('""x""'));
  for(const name of ["+1","-1","@SUM(1)","  =1","\t=1"]){assert.ok(operationsCsv([{...base,inputName:name}]).includes("'"+name));}
});
