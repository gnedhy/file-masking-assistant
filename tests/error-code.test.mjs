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
