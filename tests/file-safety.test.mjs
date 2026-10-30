import assert from "node:assert/strict";
import test from "node:test";
import { highRiskTextFindings, occurrenceBaseline, occurrenceComparison, protectedOutputName, restoredOutputName, suspiciousTextFindings } from "../src/fileSafety.js";

test("还原文件名按任务标签命名且不重复编号", () => {
  const legacy = { taskId: "2A5F9A87" };
  const short = { taskId: "c566f90e-20cc-44ac-9af0-587b72caf687", marker: "X55K" };
  assert.equal(restoredOutputName("脱敏文件_2A5F9A87.txt", "txt", legacy), "还原文件_2A5F9A87.txt");
  assert.equal(restoredOutputName("脱敏文件_X55K.txt", "txt", short), "还原文件_X55K.txt");
  assert.equal(restoredOutputName("AI分析结果.docx", "docx", legacy), "AI分析结果_还原版_2A5F9A87.docx");
  assert.equal(restoredOutputName("报告_脱敏版_2A5F9A87.xlsx", "xlsx", legacy), "报告_还原版_2A5F9A87.xlsx");
  assert.equal(restoredOutputName("报告_X55K.md", "md", short), "报告_还原版_X55K.md");
  assert.equal(restoredOutputName("脱敏文件_X55K_还原版_X55K.txt", "txt", short), "还原文件_X55K.txt");
  assert.equal(restoredOutputName("page.v2.html", "html", legacy), "page.v2_还原版_2A5F9A87.html");
});

test("脱敏输出不携带原文件名并保存出现次数", () => {
  assert.equal(protectedOutputName("docx", "A1B2C3D4"), "脱敏文件_A1B2C3D4.docx");
  const occurrences = [{ token: "A" }, { token: "A" }, { token: "B" }];
  assert.deepEqual(occurrenceBaseline(occurrences), { A: 2, B: 1 });
  assert.deepEqual(occurrenceComparison({ A: 2, B: 1 }, [{ token: "A" }, { token: "C" }]), {
    original: 3,
    returned: 2,
    missing: 2,
    added: 1,
    byToken: [
      { token: "A", semanticLabel: null, original: 2, returned: 1, missing: 1, added: 0 },
      { token: "B", semanticLabel: null, original: 1, returned: 0, missing: 1, added: 0 },
      { token: "C", semanticLabel: null, original: 0, returned: 1, missing: 0, added: 1 },
    ],
  });
});

test("出现次数比较逐代号说明缺失和新增位置", () => {
  const product = "[[产品名称:P001@A1B2C3D4]]";
  const customer = "[[C001@A1B2C3D4]]";
  const added = "[[备注:X001@A1B2C3D4]]";
  assert.deepEqual(occurrenceComparison({ [product]: 2, [customer]: 1 }, [{ token: product }, { token: added }]), {
    original: 3,
    returned: 2,
    missing: 2,
    added: 1,
    byToken: [
      { token: product, semanticLabel: "产品名称", original: 2, returned: 1, missing: 1, added: 0 },
      { token: customer, semanticLabel: null, original: 1, returned: 0, missing: 1, added: 0 },
      { token: added, semanticLabel: "备注", original: 0, returned: 1, missing: 0, added: 1 },
    ],
  });
});

test("文本预检提示隐藏字符和高风险字段", () => {
  assert.equal(suspiciousTextFindings("客户\u200B甲").length, 1);
  const labels = highRiskTextFindings("联系人 13800138000 test@example.com 身份证 110101199001011234").map((item) => item.label);
  assert.deepEqual(labels, ["手机号码", "电子邮箱", "身份证号码"]);
});
