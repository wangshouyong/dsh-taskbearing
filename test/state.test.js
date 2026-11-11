import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExecState,
  assertVerdictInput,
  checkVerdictTransition,
  normalizeVerdictForStorage
} from "../src/core/state.js";

const legal = [
  [null, "待裁决"],
  ["待裁决", "已废弃"],
  ["待裁决", "已替代"],
  ["待裁决", "已确认继续"],
  ["待裁决", null],
  ["待裁决", "待裁决"],
  ["已废弃", "待裁决"],
  ["已替代", "待裁决"],
  ["已废弃", "已替代"],
  ["已替代", "已废弃"]
];

test("状态转移矩阵：合法项全部通过", () => {
  for (const [from, to] of legal) {
    assert.equal(checkVerdictTransition(from, to).legal, true, `${from} → ${to} 应合法`);
  }
});

const illegal = [
  [null, "已废弃"],
  [null, "已替代"],
  [null, "已确认继续"],
  ["已废弃", null],
  ["已替代", null],
  ["已废弃", "已确认继续"],
  ["已确认继续", "待裁决"]
];

test("状态转移矩阵：非法项全部拒绝，并给可读理由", () => {
  for (const [from, to] of illegal) {
    const result = checkVerdictTransition(from, to);
    assert.equal(result.legal, false, `${from} → ${to} 应非法`);
    assert.ok(result.reason && result.reason.length > 0);
  }
});

test("非法理由能指导纠正动作", () => {
  assert.match(checkVerdictTransition(null, "已废弃").reason, /先标「待裁决」/);
  assert.match(checkVerdictTransition("已废弃", null).reason, /先到「待裁决」/);
});

test("落板归一：已确认继续 → null", () => {
  assert.equal(normalizeVerdictForStorage("已确认继续"), null);
  assert.equal(normalizeVerdictForStorage("待裁决"), "待裁决");
  assert.equal(normalizeVerdictForStorage(null), null);
  assert.equal(normalizeVerdictForStorage(undefined), undefined);
});

test("入参校验：exec / verdict 枚举", () => {
  assert.equal(assertExecState("进行中"), "进行中");
  assert.throws(() => assertExecState("已完成"), (err) => err.code === "E_INVALID_ARG");
  assert.equal(assertVerdictInput(null), null);
  assert.throws(() => assertVerdictInput("已裁决-冲突"), (err) => err.code === "E_INVALID_ARG");
});
