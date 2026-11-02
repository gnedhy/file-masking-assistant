import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTask, taskKeyResolver } from "../src/operationTasks.js";

const step = (action, result, extra = {}) => ({ userId: "u1", userName: "测试", time: extra.time ?? `2026-11-02T08:0${extra.n ?? 0}:00.000Z`, action, result, ...extra });

test("同一次操作的步骤归入它生成的任务，状态点按脱敏和还原分别判断", () => {
  const events = [
    step("import_protect", "requested", { operationId: "op1", inputName: "销售.xlsx", n: 1 }),
    step("inspect_protect", "success", { operationId: "op1", n: 2 }),
    step("protect", "success", { operationId: "op1", taskId: "T1", marker: "K7M4", format: "xlsx", n: 3 }),
    step("import_restore", "requested", { operationId: "op2", inputName: "AI.xlsx", n: 4 }),
    step("restore", "partial", { operationId: "op2", taskId: "T1", n: 5 }),
    step("import_protect", "requested", { operationId: "op3", inputName: "资料.pdf", n: 6 }),
    step("inspect_protect", "failed", { operationId: "op3", n: 7 }),
  ];
  const keyOf = taskKeyResolver(events);
  const groups = Map.groupBy(events, keyOf);
  assert.equal(groups.size, 2);
  const [masked, rejected] = [...groups].map(([key, steps]) => summarizeTask(key, steps));
  assert.deepEqual({ title: masked.title, marker: masked.marker, protect: masked.protect, restore: masked.restore, steps: masked.events.length }, { title: "销售.xlsx", marker: "K7M4", protect: "done", restore: "partial", steps: 5 });
  assert.deepEqual({ title: rejected.title, protect: rejected.protect, restore: rejected.restore, taskId: rejected.taskId }, { title: "资料.pdf", protect: "failed", restore: "none", taskId: null });
  assert.equal(masked.lastTime, "2026-11-02T08:05:00.000Z");
});

test("还原成功优先于失败的尝试；没有文件名时用操作名称", () => {
  const done = summarizeTask("k", [
    step("protect", "success", { taskId: "T2", n: 1 }),
    step("restore", "failed", { taskId: "T2", n: 2 }),
    step("restore", "success", { taskId: "T2", n: 3 }),
  ]);
  assert.equal(done.restore, "done");
  assert.equal(summarizeTask("e", [step("export_records", "requested")]).title, "导出操作记录");
});
