import assert from "node:assert/strict";
import test from "node:test";
import { highRiskTextFindings, occurrenceBaseline, occurrenceComparison, protectedOutputName, suspiciousTextFindings } from "../src/fileSafety.js";

test("脱敏输出不携带原文件名并保存出现次数", () => {
  assert.equal(protectedOutputName("docx", "A1B2C3D4"), "脱敏文件_A1B2C3D4.docx");
  const occurrences = [{ token: "A" }, { token: "A" }, { token: "B" }];
  assert.deepEqual(occurrenceBaseline(occurrences), { A: 2, B: 1 });
  assert.deepEqual(occurrenceComparison({ A: 2, B: 1 }, [{ token: "A" }, { token: "C" }]), { original: 3, returned: 2, missing: 2, added: 1 });
});

test("文本预检提示隐藏字符和高风险字段", () => {
  assert.equal(suspiciousTextFindings("客户\u200B甲").length, 1);
  const labels = highRiskTextFindings("联系人 13800138000 test@example.com 身份证 110101199001011234").map((item) => item.label);
  assert.deepEqual(labels, ["手机号码", "电子邮箱", "身份证号码"]);
});
