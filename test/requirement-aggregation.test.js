/**
 * 需求层执行状态机械聚合（B-59，v1.28）：
 * 需求 exec_state 由子任务推导，AI 不可手写；每次写操作自动同步。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { aggregateRequirementExecState, syncRequirementExecStates } from "../src/core/tree.js";
import { makeEnv, rejectsWith } from "./helpers.js";

const SUMMARY_DETAIL = "验收范围：该节点下全部任务与验收项\n完成结论：已完成并留证据\n遗留风险：无";

/** @param {string} id @param {string} exec @param {any} [overrides] */
function task(id, exec, overrides = {}) {
  return {
    id,
    kind: "task",
    title: id,
    human_line: id,
    exec_state: exec,
    verdict_state: null,
    dead_reason: null,
    merged_into: null,
    pointers: [],
    children: [],
    ...overrides
  };
}

/** @param {any[]} children */
function requirement(children) {
  return { id: "R-001", kind: "requirement", title: "需求", human_line: "需求", exec_state: "未开始", verdict_state: null, pointers: [], children };
}

test("聚合规则：空 / 全未开始 / 全已执行 / 进行中 / 已阻塞优先 / 混合（B-59）", () => {
  assert.equal(aggregateRequirementExecState(requirement([])), "未开始");
  assert.equal(aggregateRequirementExecState(requirement([task("a", "未开始"), task("b", "未开始")])), "未开始");
  assert.equal(aggregateRequirementExecState(requirement([task("a", "已执行"), task("b", "已执行")])), "已执行");
  assert.equal(aggregateRequirementExecState(requirement([task("a", "进行中"), task("b", "已执行")])), "进行中");
  assert.equal(aggregateRequirementExecState(requirement([task("a", "已阻塞"), task("b", "进行中")])), "已阻塞");
  assert.equal(aggregateRequirementExecState(requirement([task("a", "已执行"), task("b", "未开始")])), "进行中");
});

test("聚合规则：忽略已废弃/已替代子树，嵌套任务计入（B-59）", () => {
  const withDead = requirement([
    task("a", "已执行"),
    task("b", "未开始", { verdict_state: "已废弃", dead_reason: "废弃" }),
    task("c", "未开始", { verdict_state: "已替代", dead_reason: "替代" })
  ]);
  assert.equal(aggregateRequirementExecState(withDead), "已执行", "废弃子树不参与聚合");

  const nested = requirement([task("a", "已执行", { children: [task("a-1", "进行中")] })]);
  assert.equal(aggregateRequirementExecState(nested), "进行中", "嵌套任务计入");

  const allDead = requirement([task("a", "已执行", { verdict_state: "已废弃", dead_reason: "x" })]);
  assert.equal(aggregateRequirementExecState(allDead), "未开始", "无活跃任务视为未开始");
});

test("syncRequirementExecStates：就地修正并返回变更需求 id", () => {
  const tree = {
    root: {
      id: "ROOT",
      kind: "project",
      children: [
        requirement([task("a", "已执行")]),
        { ...requirement([task("b", "进行中")]), id: "R-002", exec_state: "进行中" }
      ]
    }
  };
  const changed = syncRequirementExecStates(tree);
  assert.deepEqual(changed, ["R-001"], "只修正 R-001");
  assert.equal(tree.root.children[0].exec_state, "已执行");
  assert.equal(tree.root.children[1].exec_state, "进行中");
});

test("写操作自动同步需求状态：plan/update/迁移（B-59 / A42）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
    await env.compass.plan({ parent_id: "R-001", title: "任务一", human_line: "任务一" });
    await env.compass.plan({ parent_id: "R-001", title: "任务二", human_line: "任务二" });

    // 两个任务都标已执行（带完成说明）⇒ 需求自动变为已执行
    await env.compass.update({
      task_ids: ["R-001-T-1", "R-001-T-2"],
      exec_state: "已执行",
      pointer_note: "完成",
      details: {
        "R-001": SUMMARY_DETAIL,
        "R-001-T-1": "查询结论：无\n数据来源：无\n后续建议：无",
        "R-001-T-2": "查询结论：无\n数据来源：无\n后续建议：无"
      }
    });
    let tree = await env.store.readTree();
    assert.equal(tree.root.children[0].exec_state, "已执行", "需求行自动聚合为已执行");

    // 新增一个未开始任务 ⇒ 需求自动回到进行中
    await env.compass.plan({ parent_id: "R-001", title: "任务三", human_line: "任务三" });
    tree = await env.store.readTree();
    assert.equal(tree.root.children[0].exec_state, "进行中", "新增未开始任务后需求为进行中");

    // 把任务三也完成 ⇒ 需求再次已执行
    await env.compass.update({
      task_ids: ["R-001-T-3"],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: "查询结论：无\n数据来源：无\n后续建议：无",
      details: { "R-001": SUMMARY_DETAIL }
    });
    tree = await env.store.readTree();
    assert.equal(tree.root.children[0].exec_state, "已执行");
  } finally {
    await env.cleanup();
  }
});

test("AI 手写需求层 exec_state ⇒ E_INVALID_ARG，且提示改子任务（B-59 / A42）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
    const err = await rejectsWith(
      env.compass.update({ task_ids: ["R-001"], exec_state: "进行中", pointer_note: "手写需求状态" }),
      "E_INVALID_ARG"
    );
    assert.match(err.message, /需求层执行状态由插件按子任务机械聚合/);
    assert.deepEqual(err.details.requirement_ids, ["R-001"]);
    const tree = await env.store.readTree();
    assert.equal(tree.root.children[0].exec_state, "未开始", "数据未变");
  } finally {
    await env.cleanup();
  }
});

test("move：节点换需求后两边需求状态都重算（B-59 / A42）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求一", human_line: "需求一", surface: "需求一" });
    await env.compass.require({ title: "需求二", human_line: "需求二", surface: "需求二" });
    await env.compass.plan({ parent_id: "R-001", title: "任务", human_line: "任务" });
    await env.compass.update({
      task_ids: ["R-001-T-1"],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: "查询结论：无\n数据来源：无\n后续建议：无",
      details: { "R-001": SUMMARY_DETAIL }
    });
    // move 会让需求二聚合为已执行 ⇒ 它的完成汇总必须先写好（B-62）
    await env.compass.update({ task_ids: ["R-002"], detail: SUMMARY_DETAIL });
    let tree = await env.store.readTree();
    assert.equal(tree.root.children[0].exec_state, "已执行");

    await env.compass.move({ source_id: "R-001-T-1", parent_id: "R-002", pointer_note: "换到需求二" });
    tree = await env.store.readTree();
    assert.equal(tree.root.children[0].exec_state, "未开始", "原需求无活跃任务");
    assert.equal(tree.root.children[1].exec_state, "已执行", "新需求聚合为已执行");
  } finally {
    await env.cleanup();
  }
});
