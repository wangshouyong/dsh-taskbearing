/**
 * v2.0 核心（B-45）：已阻塞状态。
 * 变更流/备注事件日志已随 v1.24 移除（B-46 废止，见契约附录 C）。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BLOCKED_STATE, EXEC_STATES, assertExecState } from "../src/core/state.js";
import { makeEnv, rejectsWith } from "./helpers.js";

test("已阻塞：执行线枚举、update 接受、树校验通过、可回退（A30）", async () => {
  assert.deepEqual(EXEC_STATES, ["未开始", "进行中", "已阻塞", "已执行"]);
  assert.equal(BLOCKED_STATE, "已阻塞");
  assert.equal(assertExecState("已阻塞"), "已阻塞");
  assert.throws(() => assertExecState("阻塞"), (err) => err.code === "E_INVALID_ARG");

  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "阻塞需求", human_line: "阻塞需求", surface: "阻塞需求" });
    await env.compass.plan({ parent_id: "R-001", title: "等接口", human_line: "等接口" });

    const blocked = await env.compass.update({
      task_ids: ["R-001-T-1"],
      exec_state: "已阻塞",
      pointer_note: "等第三方接口，需人工介入"
    });
    assert.deepEqual(blocked.updated, ["R-001-T-1"]);
    const tree = await env.store.readTree();
    assert.equal(tree.root.children[0].children[0].exec_state, "已阻塞");
    assert.equal(tree.root.children[0].children[0].pointers.at(-1).note, "等第三方接口，需人工介入");

    // 回退到进行中
    await env.compass.update({ task_ids: ["R-001-T-1"], exec_state: "进行中", pointer_note: "接口已通，继续" });
    assert.equal((await env.store.readTree()).root.children[0].children[0].exec_state, "进行中");

    // 非法值拒绝且数据不变
    await rejectsWith(
      env.compass.update({ task_ids: ["R-001-T-1"], exec_state: "卡住", pointer_note: "x" }),
      "E_INVALID_ARG"
    );
    assert.equal((await env.store.readTree()).root.children[0].children[0].exec_state, "进行中");
  } finally {
    await env.cleanup();
  }
});
