/**
 * 报错兜底闭环测试（v1.34）：
 * 模拟「AI 第一次写错 → 只读报错 → 按报错改一次 → 成功」的完整闭环。
 *
 * 每个用例都要求报错本身可执行（四要素）：
 *   ① 说清缺什么（缺段名 / 缺哪个 id / 哪条路径不存在）
 *   ② 说清正确格式（每段单独一行、标签在行首、标签后用「：」）
 *   ③ 给出可照抄的示例
 *   ④ 给出下一步动作（哪个工具、哪个参数、是否必须同批）
 * 缺任何一项，这个用例都算失败——这是「报错兜底能不能成立」的机械证据。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { makeEnv, rejectsWith } from "./helpers.js";

/** 汇总三段（祖先链 / 需求层通用）。 */
const SUMMARY = "验收范围：该节点下全部任务\n完成结论：已完成并留证据\n遗留风险：无";

/**
 * 断言报错是「可执行的」：四要素里该有的都在。
 * @param {Error & {details?: any}} err
 * @param {{missing?: RegExp[], needsFormat?: boolean, needsExample?: boolean, needsNextStep?: boolean, tool?: RegExp, extra?: RegExp[]}} [expect]
 */
function assertActionable(err, expect = {}) {
  const text = String(err?.message ?? "");
  for (const pattern of expect.missing ?? []) {
    assert.match(text, pattern, `报错没有说清缺什么：${text}`);
  }
  if (expect.needsFormat !== false) {
    assert.match(text, /每段单独占一行|标签在行首|单独位于行首/, `报错没有说明正确格式：${text}`);
  }
  if (expect.needsExample !== false) {
    assert.match(text, /例如：/, `报错没有给可照抄的示例：${text}`);
  }
  if (expect.needsNextStep !== false) {
    assert.match(text, /下一步：/, `报错没有给下一步动作：${text}`);
    assert.match(text, expect.tool ?? /compass_update/, `下一步没有点名工具：${text}`);
  }
  for (const pattern of expect.extra ?? []) {
    assert.match(text, pattern, `报错缺少额外要素：${text}`);
  }
}

/** @param {Awaited<ReturnType<typeof makeEnv>>} env */
async function seedOneTask(env) {
  await env.compass.init();
  const requirement = await env.compass.require({ title: "需求A", human_line: "报错兜底", surface: "报错兜底" });
  const task = await env.compass.plan({ parent_id: requirement.requirement_id, title: "任务1", human_line: "任务一" });
  return { requirementId: requirement.requirement_id, taskId: task.task_id };
}

test("闭环①：完成说明三段挤在一行 ⇒ 报错指出「写了但格式不对」并给出格式/示例/下一步，改格式一次通过", async () => {
  const env = await makeEnv();
  try {
    const { requirementId, taskId } = await seedOneTask(env);
    const err = await rejectsWith(
      env.compass.update({
        task_ids: [taskId],
        exec_state: "已执行",
        pointer_note: "完成",
        detail: "核心文件：无 契约：无 避坑指南：无"
      }),
      "E_DETAIL_CONTENT_INVALID"
    );
    assertActionable(err, {
      missing: [/写了但格式不对/, /契约/, /避坑指南/],
      extra: [/标签必须单独位于行首/]
    });
    // AI 只按报错改格式（内容不变），并把祖先链汇总一起补上 ⇒ 一次通过
    const fixed = await env.compass.update({
      task_ids: [taskId],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: "核心文件：无\n契约：无\n避坑指南：无",
      details: { [requirementId]: SUMMARY }
    });
    assert.ok(fixed.updated.includes(taskId));
    const detail = await env.store.readDetail(taskId);
    assert.match(detail, /^核心文件：无/m);
  } finally {
    await env.cleanup();
  }
});

test("闭环②：完成说明缺段 ⇒ 报错列缺失段落 + 示例 + 下一步，补齐一次通过", async () => {
  const env = await makeEnv();
  try {
    const { requirementId, taskId } = await seedOneTask(env);
    const err = await rejectsWith(
      env.compass.update({
        task_ids: [taskId],
        exec_state: "已执行",
        pointer_note: "完成",
        detail: "核心文件：无"
      }),
      "E_DETAIL_CONTENT_INVALID"
    );
    assertActionable(err, { missing: [/缺少「契约、避坑指南」/], extra: [/核心文件：/] });
    const fixed = await env.compass.update({
      task_ids: [taskId],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: "核心文件：无\n契约：无\n避坑指南：无",
      details: { [requirementId]: SUMMARY }
    });
    assert.ok(fixed.updated.includes(taskId));
  } finally {
    await env.cleanup();
  }
});

test("闭环③：两套内容标准都不满足 ⇒ 报错同时给出两套格式与显式声明方式，按其一补齐通过", async () => {
  const env = await makeEnv();
  try {
    const { requirementId, taskId } = await seedOneTask(env);
    const err = await rejectsWith(
      env.compass.update({
        task_ids: [taskId],
        exec_state: "已执行",
        pointer_note: "完成",
        detail: "做完了"
      }),
      "E_DETAIL_CONTENT_INVALID"
    );
    assertActionable(err, {
      missing: [/既不符合「修改\/构建型」/, /也不符合「查询\/调研型」/],
      extra: [/查询结论：/, /kind:"build"\|"research"/]
    });
    const fixed = await env.compass.update({
      task_ids: [taskId],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: "查询结论：已确认\n数据来源：会话日志\n后续建议：无",
      details: { [requirementId]: SUMMARY }
    });
    assert.ok(fixed.updated.includes(taskId));
  } finally {
    await env.cleanup();
  }
});

test("闭环④：只写子节点详情、不更新祖先链 ⇒ 报错给缺失 id + 同批示例，补 details 一次通过", async () => {
  const env = await makeEnv();
  try {
    const { requirementId, taskId } = await seedOneTask(env);
    const err = await rejectsWith(
      env.compass.update({ task_ids: [taskId], detail: "核心文件：无\n契约：无\n避坑指南：无" }),
      "E_ANCESTOR_DETAIL_REQUIRED"
    );
    assertActionable(err, {
      missing: [new RegExp(`缺少：${requirementId}`)],
      extra: [/同一次 compass_update/, new RegExp(`details:\\s*\\{"${requirementId}"`)],
      // 必须强调「同批」，否则 AI 会拆成第二次调用
      needsFormat: true
    });
    const fixed = await env.compass.update({
      task_ids: [taskId],
      detail: "核心文件：无\n契约：无\n避坑指南：无",
      details: { [requirementId]: SUMMARY }
    });
    assert.ok(fixed.updated.includes(taskId));
  } finally {
    await env.cleanup();
  }
});

test("闭环⑤：回填把需求聚合为已执行但需求 item 没写汇总 ⇒ 报错给格式与重试方式，补 detail 后重试通过", async () => {
  const env = await makeEnv();
  try {
    // 回填是 E_REQUIREMENT_DETAIL_REQUIRED 的真实可达路径（update 路径会先被祖先链门挡住）
    const history = {
      listMessages: async () => [
        {
          session: "s-hist",
          cwd: env.workspace,
          messages: [{ index: 1, at: "2026-11-11T14:30:00+08:00", turn: 1, text: "历史原话" }]
        }
      ],
      readMessage: async (ref) => ({
        session: ref.session,
        index: ref.index,
        at: "2026-11-11T14:30:00+08:00",
        turn: 1,
        text: "历史原话"
      })
    };
    const { createCompass } = await import("../src/core/tools.js");
    const compass = createCompass({ store: env.store, sessionId: "s-test", turn: 7, now: () => env.now, history });
    await compass.init();
    const requirementItem = {
      type: "requirement",
      title: "回填需求",
      human_line: "历史需求",
      refs: [{ session: "s-hist", index: 1 }]
    };
    const taskItem = {
      type: "task",
      parent_id: "R-001",
      title: "回填任务",
      human_line: "历史任务",
      exec_state: "已执行",
      detail: "核心文件：无\n契约：无\n避坑指南：无",
      refs: [{ session: "s-hist", index: 1 }]
    };

    const err = await rejectsWith(
      compass.import({ mode: "apply", items: [requirementItem, taskItem] }),
      "E_REQUIREMENT_DETAIL_REQUIRED"
    );
    assertActionable(err, {
      missing: [/验收范围/, /完成结论/, /遗留风险/],
      tool: /compass_import/,
      extra: [/本次未写入任何数据/]
    });
    // 按报错给需求 item 补 detail（三段各一行）后重试 ⇒ 成功
    const fixed = await compass.import({
      mode: "apply",
      items: [{ ...requirementItem, detail: SUMMARY }, taskItem]
    });
    assert.equal(fixed.mode, "apply");
    assert.equal(fixed.created.length, 2);
    const requirementDetail = await env.store.readDetail("R-001");
    assert.match(requirementDetail, /^验收范围：/m);
  } finally {
    await env.cleanup();
  }
});

test("闭环⑥：批量标记已执行缺完成说明 ⇒ 报错逐 id 给示例，按 details 补齐一次通过", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    const requirement = await env.compass.require({ title: "需求A", human_line: "批量", surface: "批量" });
    const t1 = await env.compass.plan({ parent_id: requirement.requirement_id, title: "任务1", human_line: "任务一" });
    const t2 = await env.compass.plan({ parent_id: requirement.requirement_id, title: "任务2", human_line: "任务二" });
    const err = await rejectsWith(
      env.compass.update({
        task_ids: [t1.task_id, t2.task_id],
        exec_state: "已执行",
        pointer_note: "批量完成"
      }),
      "E_BATCH_DETAIL_REQUIRED"
    );
    assertActionable(err, {
      missing: [/缺少可继承的合格完成说明/, new RegExp(t1.task_id), new RegExp(t2.task_id)],
      extra: [new RegExp(`"${t1.task_id}":"核心文件`)]
    });
    const fixed = await env.compass.update({
      task_ids: [t1.task_id, t2.task_id],
      exec_state: "已执行",
      pointer_note: "批量完成",
      details: {
        [t1.task_id]: "核心文件：无\n契约：无\n避坑指南：无",
        [t2.task_id]: "核心文件：无\n契约：无\n避坑指南：无",
        [requirement.requirement_id]: SUMMARY
      }
    });
    assert.equal(fixed.updated.includes(t1.task_id) && fixed.updated.includes(t2.task_id), true);
  } finally {
    await env.cleanup();
  }
});

test("闭环⑦：状态变更缺 pointer_note ⇒ 报错给可直接照抄的写法，补上后通过", async () => {
  const env = await makeEnv();
  try {
    const { taskId } = await seedOneTask(env);
    const err = await rejectsWith(
      env.compass.update({ task_ids: [taskId], exec_state: "进行中" }),
      "E_POINTER_NOTE_REQUIRED"
    );
    assertActionable(err, { needsFormat: false, needsExample: false, extra: [/pointer_note:"按用户裁决改为进行中"/] });
    const fixed = await env.compass.update({
      task_ids: [taskId],
      exec_state: "进行中",
      pointer_note: "按用户裁决改为进行中"
    });
    assert.ok(fixed.updated.includes(taskId));
  } finally {
    await env.cleanup();
  }
});

test("闭环⑧：废弃缺 dead_reason ⇒ 报错给示例，补上后通过", async () => {
  const env = await makeEnv();
  try {
    const { requirementId, taskId } = await seedOneTask(env);
    await env.compass.update({ task_ids: [taskId], verdict_state: "待裁决", pointer_note: "提请裁决" });
    const err = await rejectsWith(
      env.compass.update({ task_ids: [taskId], verdict_state: "已废弃", pointer_note: "裁决废弃" }),
      "E_DEAD_REASON_REQUIRED"
    );
    assertActionable(err, {
      needsFormat: false,
      needsExample: false,
      extra: [/dead_reason:"用户裁决/]
    });
    const fixed = await env.compass.update({
      task_ids: [taskId],
      verdict_state: "已废弃",
      dead_reason: "用户裁决：这条不做了，与 R-002 重复",
      pointer_note: "裁决废弃"
    });
    assert.ok(fixed.updated.includes(taskId));
    assert.ok(requirementId);
  } finally {
    await env.cleanup();
  }
});

test("闭环⑨：废弃未覆盖子树 ⇒ 报错列出缺失子节点 + 下一步，补齐整棵子树后通过", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    const requirement = await env.compass.require({ title: "需求A", human_line: "子树", surface: "子树" });
    const task = await env.compass.plan({ parent_id: requirement.requirement_id, title: "任务1", human_line: "任务一" });
    const step = await env.compass.plan({ parent_id: task.task_id, title: "步骤1", human_line: "步骤一" });
    await env.compass.update({ task_ids: [task.task_id], verdict_state: "待裁决", pointer_note: "提请裁决" });
    const err = await rejectsWith(
      env.compass.update({
        task_ids: [task.task_id],
        verdict_state: "已废弃",
        dead_reason: "用户裁决：整块不做了",
        pointer_note: "裁决废弃"
      }),
      "E_SUBTREE_INCOMPLETE"
    );
    assertActionable(err, {
      needsFormat: false,
      needsExample: false,
      missing: [new RegExp(step.task_id)],
      extra: [/同一次 compass_update 的 task_ids/]
    });
    const fixed = await env.compass.update({
      task_ids: [task.task_id, step.task_id],
      verdict_state: "已废弃",
      dead_reason: "用户裁决：整块不做了",
      pointer_note: "裁决废弃"
    });
    assert.equal(fixed.updated.includes(task.task_id) && fixed.updated.includes(step.task_id), true);
  } finally {
    await env.cleanup();
  }
});

test("闭环⑩：详情里写了不存在的文件路径 ⇒ 报错点名路径 + 整改指引，改成真实内容后通过", async () => {
  const env = await makeEnv();
  try {
    const { requirementId, taskId } = await seedOneTask(env);
    const err = await rejectsWith(
      env.compass.update({
        task_ids: [taskId],
        detail: "核心文件：src/not-exist-xyz.js\n契约：无\n避坑指南：无"
      }),
      "E_DETAIL_PATH_NOT_FOUND"
    );
    assertActionable(err, {
      needsFormat: false,
      needsExample: false,
      needsNextStep: false,
      missing: [/src\/not-exist-xyz\.js/],
      extra: [/建议操作：/, /严禁捏造路径/]
    });
    const fixed = await env.compass.update({
      task_ids: [taskId],
      detail: "核心文件：无（该文件不存在，已核实）\n契约：无\n避坑指南：无",
      details: { [requirementId]: SUMMARY }
    });
    assert.ok(fixed.updated.includes(taskId));
  } finally {
    await env.cleanup();
  }
});
