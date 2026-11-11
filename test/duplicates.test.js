/**
 * 疑似重复任务检测与闭环（B-60，v1.29）：
 * - plan/update 返回 possible_duplicates 警告（不阻断）；
 * - compass_status 返回 health.duplicate_pairs；
 * - 同一问题必须把旧任务标「已替代」，不能留同题未开始任务。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { boardDuplicateHealth, findSimilarOpenTasks, normalizeForCompare, similarity } from "../src/core/duplicates.js";
import { makeEnv } from "./helpers.js";

const SUMMARY_DETAIL = "验收范围：该节点下全部任务与验收项\n完成结论：已完成并留证据\n遗留风险：无";

/** @param {string} id @param {string} title @param {string} exec @param {any} [overrides] */
function task(id, title, exec, overrides = {}) {
  return {
    id,
    kind: "task",
    title,
    human_line: title,
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
function tree(children) {
  return { schema: 1, root: { id: "ROOT", kind: "project", children } };
}

test("相似度：同题高、无关低、归一化去标点空白（B-60）", () => {
  assert.equal(normalizeForCompare("Compass_Update：批量 硬校验！"), "compassupdate批量硬校验");
  const same = similarity("设置弹窗重设计（v1.23 交付）", "详情弹窗重设计（v1.23 交付）");
  const related = similarity(
    "建议 compass_update 在标记已执行但无详情时返回 warning（待用户定）",
    "compass_update 批量操作硬校验：必须带说明、批量已执行逐任务完成说明、两套内容标准、3 个错误码"
  );
  const unrelated = similarity("统计节点/详情文件、确认跨重启存活", "生成开源仓库快照并脱敏");
  assert.ok(same > 0.6, `同题应高相似，实际 ${same}`);
  assert.ok(related > 0.4, `同主题应超阈值，实际 ${related}`);
  assert.ok(unrelated < 0.4, `无关应低于阈值，实际 ${unrelated}`);
});

test("findSimilarOpenTasks：只返回活跃任务，排除终态/已完成/自身（B-60）", () => {
  const board = tree([
    {
      id: "R-001",
      kind: "requirement",
      title: "需求",
      human_line: "需求",
      exec_state: "未开始",
      verdict_state: null,
      pointers: [],
      children: [
        task("R-001-T-1", "批量操作硬校验：必须带说明", "进行中"),
        task("R-001-T-2", "批量操作硬校验：必须带说明（旧）", "已执行"),
        task("R-001-T-3", "批量操作硬校验：必须带说明（废弃）", "未开始", { verdict_state: "已废弃", dead_reason: "重复" })
      ]
    }
  ]);
  const hits = findSimilarOpenTasks(board, { text: "批量操作硬校验：必须带说明", excludeIds: ["R-001-T-1"] });
  assert.deepEqual(hits.map((hit) => hit.id), [], "活跃同题被 exclude、已完成/废弃不在候选");
  const hits2 = findSimilarOpenTasks(board, { text: "批量操作硬校验：必须带说明" });
  assert.deepEqual(hits2.map((hit) => hit.id), ["R-001-T-1"]);
});

test("boardDuplicateHealth：列出活跃任务间疑似重复对（B-60）", () => {
  const board = tree([
    {
      id: "R-001",
      kind: "requirement",
      title: "需求",
      human_line: "需求",
      exec_state: "未开始",
      verdict_state: null,
      pointers: [],
      children: [
        task("R-001-T-1", "批量操作硬校验：必须带说明（待用户定，旧建议）", "未开始"),
        task("R-001-T-2", "compass_update 批量操作硬校验：必须带说明、批量已执行逐任务完成说明", "已执行"),
        task("R-001-T-3", "批量操作硬校验：必须带说明、批量已执行逐任务完成说明（旧）", "未开始")
      ]
    }
  ]);
  const health = boardDuplicateHealth(board);
  assert.equal(health.open_task_count, 3, "统计活跃任务 + 活跃需求节点");
  assert.ok(health.duplicate_pairs.length >= 1, "T-1/T-3 应命中");
  assert.ok(health.duplicate_pairs.every((pair) => pair.score >= health.threshold));
});

test("plan：建疑似重复任务时返回 POSSIBLE_DUPLICATE 警告（B-60 / A43）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
    const first = await env.compass.plan({
      parent_id: "R-001",
      title: "compass_update 批量操作硬校验：必须带说明",
      human_line: "批量硬校验"
    });
    assert.deepEqual(first.warnings, [], "首个任务无重复");

    const second = await env.compass.plan({
      parent_id: "R-001",
      title: "compass_update 批量操作硬校验：必须带说明（旧任务）",
      human_line: "批量硬校验"
    });
    assert.equal(second.warnings[0]?.code, "POSSIBLE_DUPLICATE");
    assert.deepEqual(second.warnings[0].candidates.map((hit) => hit.id), [first.task_id]);
  } finally {
    await env.cleanup();
  }
});

test("update：标记完成时把板上同题未闭环任务暴露为警告（B-60 / A43）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
    const legacy = await env.compass.plan({
      parent_id: "R-001",
      title: "建议 compass_update 在标记已执行但无详情时返回 warning",
      human_line: "旧建议任务"
    });
    const actual = await env.compass.plan({
      parent_id: "R-001",
      title: "compass_update 批量操作硬校验：必须带说明、批量已执行逐任务完成说明",
      human_line: "批量硬校验"
    });
    const res = await env.compass.update({
      task_ids: [actual.task_id],
      exec_state: "已执行",
      pointer_note: "硬校验落地",
      detail: "核心文件：无\n契约/文档：无\n避坑指南：无",
      details: { "R-001": SUMMARY_DETAIL }
    });
    const dup = res.warnings.find((warning) => warning.code === "POSSIBLE_DUPLICATE");
    assert.ok(dup, "应返回重复警告");
    assert.deepEqual(dup.candidates.map((hit) => hit.id), [legacy.task_id]);
  } finally {
    await env.cleanup();
  }
});

test("require：新需求与板上同题未闭环任务重叠时返回警告（B-60 / A43 跨层级）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求一", human_line: "需求一", surface: "需求一" });
    const legacy = await env.compass.plan({
      parent_id: "R-001",
      title: "建议 compass_update 在标记已执行但无详情时返回 warning",
      human_line: "旧建议任务"
    });
    const res = await env.compass.require({
      title: "compass_update 批量操作硬校验：必须带说明、批量已执行逐任务完成说明",
      human_line: "批量硬校验",
      surface: "批量硬校验"
    });
    const dup = res.warnings.find((warning) => warning.code === "POSSIBLE_DUPLICATE");
    assert.ok(dup, "应返回重复警告");
    assert.deepEqual(dup.candidates.map((hit) => hit.id), [legacy.task_id]);
  } finally {
    await env.cleanup();
  }
});
