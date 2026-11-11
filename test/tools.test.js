import assert from "node:assert/strict";
import test from "node:test";

import { SUMMARY_DETAIL, makeEnv, rejectsWith } from "./helpers.js";

const ORIGINAL = "把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏";
const captureOk = async () => ({ text: ORIGINAL, session: "s-8f3a", at: "2026-11-11T14:30:52.000Z" });

async function boot(t, opts = {}) {
  const env = await makeEnv(opts);
  t.after(() => env.cleanup());
  await env.compass.init();
  return env;
}

async function seedRequirement(env, overrides = {}) {
  return env.compass.require({
    title: "PPT 矢量转可拖顶点形状",
    human_line: "把 PPT 里的图变成能拖顶点的形状",
    surface: "把 PPT 里的图变成能拖顶点的形状",
    ...overrides
  });
}

test("require：建需求 + 基线 v1 + 原话锁定 + 追溯链自动填", async (t) => {
  const env = await boot(t, { capture: captureOk });
  const result = await seedRequirement(env);

  assert.equal(result.requirement_id, "R-001");
  assert.equal(result.version, "v1");
  assert.equal(result.original_locked, true);
  assert.deepEqual(result.warnings, []);

  const tree = await env.compass.read({ scope: "tree" });
  const requirement = tree.root.children[0];
  assert.equal(requirement.kind, "requirement");
  assert.equal(requirement.exec_state, "未开始");
  assert.equal(requirement.pointers.length, 1);
  assert.equal(requirement.pointers[0].session, "s-test");
  assert.equal(requirement.pointers[0].turn, 7);
  assert.match(requirement.pointers[0].at, /^\d{4}-\d{2}-\d{2}T/);

  const baseline = await env.compass.read({ scope: "baseline" });
  const version = baseline.requirements[0].versions[0];
  assert.equal(version.original, ORIGINAL);
  assert.equal(version.originalLock, true);
  assert.deepEqual(version.msg, { session: "s-8f3a", at: "2026-11-11T14:30:52.000Z" });
});

test("require：原话取不回 → original_locked=false + warning，不阻断写入", async (t) => {
  const env = await boot(t);
  const result = await seedRequirement(env);
  assert.equal(result.original_locked, false);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "E_ORIGINAL_UNRESOLVED");

  const baseline = await env.compass.read({ scope: "baseline" });
  assert.equal(baseline.requirements[0].versions[0].originalLock, false);
  assert.equal(baseline.requirements[0].versions[0].original, "");
});

test("plan：需求下建任务、任务下建步骤；id 连续", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);

  const task1 = await env.compass.plan({ parent_id: "R-001", title: "曲线能拖控制点", human_line: "让曲线也能拖控制点" });
  const task2 = await env.compass.plan({ parent_id: "R-001", title: "矩形能拖顶点", human_line: "矩形也能拖顶点" });
  const step = await env.compass.plan({
    parent_id: task1.task_id,
    title: "贝塞尔控制点持久化",
    human_line: "松手后控制点能存住",
    detail: "# 贝塞尔\n- 控制点持久化"
  });

  assert.equal(task1.task_id, "R-001-T-1");
  assert.equal(task2.task_id, "R-001-T-2");
  assert.equal(step.task_id, "R-001-T-1-T-1");

  const lite = await env.compass.read({ scope: "tree-lite" });
  assert.deepEqual(
    lite.map((n) => [n.id, n.kind]),
    [
      ["R-001", "requirement"],
      ["R-001-T-1", "task"],
      ["R-001-T-1-T-1", "task"],
      ["R-001-T-2", "task"]
    ]
  );
});

test("plan：parent_id 缺失 / 不存在 / 挂在 project 根下", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await rejectsWith(env.compass.plan({ title: "x", human_line: "y" }), "E_PARENT_REQUIRED");
  await rejectsWith(env.compass.plan({ parent_id: "R-404", title: "x", human_line: "y" }), "E_PARENT_NOT_FOUND");
  await rejectsWith(env.compass.plan({ parent_id: "ROOT", title: "x", human_line: "y" }), "E_INVALID_ARG");
});

test("update：patch 语义、同值幂等、pointer 追加", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await env.compass.plan({ parent_id: "R-001", title: "曲线能拖控制点", human_line: "让曲线也能拖控制点" });

  const first = await env.compass.update({ task_ids: ["R-001-T-1"], exec_state: "进行中", pointer_note: "开始" });
  assert.deepEqual(first.updated, ["R-001-T-1"]);

  const again = await env.compass.update({ task_ids: ["R-001-T-1"], exec_state: "进行中", pointer_note: "重复" });
  assert.deepEqual(again.updated, []);
  assert.deepEqual(again.unchanged, ["R-001-T-1"]);

  const tree = await env.compass.read({ scope: "tree" });
  const task = tree.root.children[0].children[0];
  assert.equal(task.exec_state, "进行中");
  assert.equal(task.pointers.length, 2);
  assert.equal(task.pointers.at(-1).note, "开始");
});

test("update：状态变更缺 note → 拒绝；无 writable 字段 → 拒绝", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await rejectsWith(env.compass.update({ task_ids: ["R-001"], exec_state: "进行中" }), "E_POINTER_NOTE_REQUIRED");
  await rejectsWith(env.compass.update({ task_ids: ["R-001"] }), "E_INVALID_ARG");
  await rejectsWith(env.compass.update({ task_ids: [], exec_state: "进行中", pointer_note: "x" }), "E_INVALID_ARG");
});

test("update：非法转移（null → 已废弃）", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await rejectsWith(
    env.compass.update({ task_ids: ["R-001"], verdict_state: "已废弃", dead_reason: "用户拍板", pointer_note: "拍板" }),
    "E_INVALID_TRANSITION"
  );
});

test("update：废弃必须覆盖整棵子树，否则返回缺失 id", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await env.compass.plan({ parent_id: "R-001", title: "曲线能拖控制点", human_line: "让曲线也能拖控制点" });
  await env.compass.plan({ parent_id: "R-001", title: "矩形能拖顶点", human_line: "矩形也能拖顶点" });
  await env.compass.update({ task_ids: ["R-001"], verdict_state: "待裁决", pointer_note: "撞车，提请裁决" });

  const err = await rejectsWith(
    env.compass.update({
      task_ids: ["R-001"],
      verdict_state: "已废弃",
      dead_reason: "用户第 31 轮拍板",
      pointer_note: "主会话拍板废弃"
    }),
    "E_SUBTREE_INCOMPLETE"
  );
  assert.deepEqual(err.details.missing.sort(), ["R-001-T-1", "R-001-T-2"]);

  const ok = await env.compass.update({
    task_ids: ["R-001", "R-001-T-1", "R-001-T-2"],
    verdict_state: "已废弃",
    dead_reason: "用户第 31 轮拍板",
    pointer_note: "主会话拍板废弃整棵子树"
  });
  assert.deepEqual(ok.updated.sort(), ["R-001", "R-001-T-1", "R-001-T-2"]);

  const tree = await env.compass.read({ scope: "tree" });
  for (const node of [tree.root.children[0], ...tree.root.children[0].children]) {
    assert.equal(node.verdict_state, "已废弃");
    assert.equal(node.dead_reason, "用户第 31 轮拍板");
  }
});

test("update：复活清空 dead_reason；已确认继续 落板回 null", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await env.compass.update({ task_ids: ["R-001"], verdict_state: "待裁决", pointer_note: "撞车" });
  await env.compass.update({
    task_ids: ["R-001"],
    verdict_state: "已废弃",
    dead_reason: "用户拍板废弃",
    pointer_note: "拍板废弃"
  });

  await env.compass.update({ task_ids: ["R-001"], verdict_state: "待裁决", pointer_note: "因新证据推翻上次废弃结论" });
  let tree = await env.compass.read({ scope: "tree" });
  assert.equal(tree.root.children[0].verdict_state, "待裁决");
  assert.equal(tree.root.children[0].dead_reason, null);

  const confirmed = await env.compass.update({
    task_ids: ["R-001"],
    verdict_state: "已确认继续",
    pointer_note: "主会话拍板继续做"
  });
  assert.deepEqual(confirmed.verdict_normalized, ["R-001"]);

  tree = await env.compass.read({ scope: "tree" });
  assert.equal(tree.root.children[0].verdict_state, null);
  assert.equal(tree.root.children[0].dead_reason, null);
  assert.equal(tree.root.children[0].pointers.at(-1).note, "主会话拍板继续做");
});

test("update：terminal 缺 dead_reason → 拒绝", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await env.compass.update({ task_ids: ["R-001"], verdict_state: "待裁决", pointer_note: "撞车" });
  await rejectsWith(
    env.compass.update({ task_ids: ["R-001"], verdict_state: "已替代", pointer_note: "拍板替代" }),
    "E_DEAD_REASON_REQUIRED"
  );
});

test("update：detail 仅允许单节点，且与备注互不覆盖", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await env.compass.plan({ parent_id: "R-001", title: "曲线能拖控制点", human_line: "让曲线也能拖控制点" });
  await env.compass.plan({ parent_id: "R-001", title: "矩形能拖顶点", human_line: "矩形也能拖顶点" });

  await rejectsWith(
    env.compass.update({ task_ids: ["R-001-T-1", "R-001-T-2"], detail: "x" }),
    "E_INVALID_ARG"
  );

  await env.compass.update({ task_ids: ["R-001-T-1"], detail: "# 详情 v1", details: { "R-001": SUMMARY_DETAIL }, pointer_note: "补充详情" });
  const detail = await env.compass.read({ scope: "detail:R-001-T-1" });
  assert.equal(detail.detail, "# 详情 v1");

  await env.store.writeNote("R-001-T-1", "用户备注");
  const after = await env.compass.read({ scope: "detail:R-001-T-1" });
  assert.equal(after.detail, "# 详情 v1");
  assert.equal(after.note, "用户备注");
});

test("merge：写 merged_into + 追溯链；自指拒绝；允许跨需求", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  await seedRequirement(env, {
    title: "矩形也能拖顶点（重复需求）",
    human_line: "矩形也能拖顶点",
    surface: "矩形也能拖顶点"
  });

  await rejectsWith(
    env.compass.merge({ source_id: "R-002", target_id: "R-002", pointer_note: "x" }),
    "E_SELF_MERGE"
  );

  const merged = await env.compass.merge({ source_id: "R-002", target_id: "R-001", pointer_note: "与 R-001 重复，归并" });
  assert.equal(merged.merged_into, "R-001");

  const tree = await env.compass.read({ scope: "tree" });
  const source = tree.root.children.find((node) => node.id === "R-002");
  assert.equal(source.merged_into, "R-001");
  assert.equal(source.pointers.at(-1).note, "与 R-001 重复，归并");
});

test("change：追加基线版本、刷新明面、记录原因与原话", async (t) => {
  const env = await boot(t, { capture: captureOk });
  await seedRequirement(env);

  env.advance(30 * 60 * 1000);
  const result = await env.compass.change({
    requirement_id: "R-001",
    new_text: "同上，加「原来的静态显示别弄坏」",
    reason: "用户第 12 轮补充约束"
  });
  assert.equal(result.appended, "v2");
  assert.equal(result.original_locked, true);

  const baseline = await env.compass.read({ scope: "baseline" });
  const requirement = baseline.requirements[0];
  assert.equal(requirement.versions.length, 2);
  assert.equal(requirement.surface, "同上，加「原来的静态显示别弄坏」");
  assert.equal(requirement.versions[1].reason, "用户第 12 轮补充约束");
  assert.equal(requirement.versions[1].original, ORIGINAL);
  assert.ok(baseline.raw.includes("v2"));
  assert.ok(baseline.raw.includes("原因：用户第 12 轮补充约束"));
});

test("change：需求不存在 / id 非法", async (t) => {
  const env = await boot(t);
  await rejectsWith(
    env.compass.change({ requirement_id: "R-404", new_text: "x", reason: "y" }),
    "E_REQUIREMENT_NOT_FOUND"
  );
  await rejectsWith(
    env.compass.change({ requirement_id: "PPT-1", new_text: "x", reason: "y" }),
    "E_INVALID_ARG"
  );
});

test("read：scope 非法 / detail 不存在 / project 无详情", async (t) => {
  const env = await boot(t);
  await rejectsWith(env.compass.read({ scope: "nope" }), "E_INVALID_ARG");
  await rejectsWith(env.compass.read({ scope: "detail:R-404" }), "E_TASK_NOT_FOUND");
  await rejectsWith(env.compass.read({ scope: "detail:ROOT" }), "E_INVALID_ARG");
});

test("一致性：每次写操作后 基线 与 需求层节点 对齐", async (t) => {
  const env = await boot(t, { capture: captureOk });
  await seedRequirement(env);
  await seedRequirement(env, { title: "矩形也能拖顶点", human_line: "矩形也能拖顶点", surface: "矩形也能拖顶点" });
  const consistency = await env.store.verifyConsistency();
  assert.equal(consistency.ok, true);
});

test("update：只改 detail 时 updated 必须包含该 id（不能误报 unchanged）", async (t) => {
  const env = await boot(t);
  await seedRequirement(env);
  const task = await env.compass.plan({ parent_id: "R-001", title: "任务", human_line: "任务" });
  const result = await env.compass.update({ task_ids: [task.task_id], detail: "详情正文", details: { "R-001": SUMMARY_DETAIL } });
  assert.deepEqual(new Set(result.updated), new Set([task.task_id, "R-001"]));
  assert.deepEqual(result.rollups, ["R-001"], "祖先链汇总单独列出");
  assert.deepEqual(result.unchanged, []);
  const read = await env.compass.read({ scope: `detail:${task.task_id}` });
  assert.equal(read.detail, "详情正文");
});