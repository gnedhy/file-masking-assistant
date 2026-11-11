import assert from "node:assert/strict";
import test from "node:test";
import { errorCodeOf, failureReason } from "../src/errorPresentation.js";

test("失败记录总有原因：没有错误码的意外错误记为 PROCESSING_ERROR", () => {
  assert.equal(errorCodeOf({ code: "SENSITIVE_RESIDUALS" }), "SENSITIVE_RESIDUALS");
  for (const caught of [new Error("boom"), null, undefined, { code: 42 }, { code: "中文" }, { code: "" }]) {
    assert.equal(errorCodeOf(caught), "PROCESSING_ERROR");
  }
  assert.ok(failureReason("PROCESSING_ERROR"));
});

import { errorPlacesOf, isErrorPlace } from "../src/errorPresentation.js";
import { validateEvent } from "../server/operations-repository.mjs";

test("失败记录带上问题所在的位置类型和数量，不带名称和单元格", () => {
  const caught = { code: "SENSITIVE_RESIDUALS", details: ["批注：广东某某化工有限公司", "批注：清远某某洗涤厂", "工作表名称或定义的名称：某某公司", { sheetName: "销售", row: 5, columnNumber: 2 }, "销售明细!B5：暂不支持的单元格对象未替换"] };
  const places = errorPlacesOf(caught);
  assert.deepEqual(places, ["comment:2", "cell:2", "sheetName:1"]);
  assert.ok(!JSON.stringify(places).includes("某某"));
  assert.deepEqual(errorPlacesOf({ code: "EXTERNAL_RELATIONSHIPS", details: ["xl/worksheets/_rels/sheet1.xml.rels"] }), ["link:1"]);
  assert.deepEqual(errorPlacesOf({ code: "EXTERNAL_RELATIONSHIPS", details: ["xl/_rels/workbook.xml.rels"] }), ["externalLink:1"]);
  assert.deepEqual(errorPlacesOf(new Error("boom")), []);
  assert.equal(failureReason("SENSITIVE_RESIDUALS", places), "还有真实名称没有替换掉（批注 2 处、单元格 2 处、工作表名称 1 处）");
  assert.equal(failureReason("SENSITIVE_RESIDUALS"), "还有真实名称没有替换掉");
});

test("服务端只接受固定清单里的位置类型，拒绝夹带内容", () => {
  const event = extra => ({ version: 1, eventId: "11f7c0c3-4514-4272-a139-d4814bc9a608", operationId: "92c8e74b-9774-4991-899c-aeb4cafada90", time: new Date().toISOString(), action: "protect", result: "failed", errorCode: "SENSITIVE_RESIDUALS", ...extra });
  assert.deepEqual(validateEvent(event({ errorPlaces: ["comment:3", "sheetName:1"] })).errorPlaces, ["comment:3", "sheetName:1"]);
  for (const bad of [["批注：某某公司"], ["comment:某某公司"], ["unknown:1"], ["comment:0"], "comment:1", [], Array(9).fill("comment:1")]) {
    assert.throws(() => validateEvent(event({ errorPlaces: bad })), /INVALID_ERROR_PLACES/, JSON.stringify(bad));
  }
  assert.throws(() => validateEvent({ ...event({ errorPlaces: ["comment:1"] }), result: "success", errorCode: undefined }));
  assert.equal(isErrorPlace("comment:3"), true);
});
