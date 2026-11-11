/**
 * 批量完成说明硬校验（B-58，v1.27）：
 * - 批量状态变更必须带 pointer_note（回归）；
 * - 批量标「已执行」必须逐任务有完成说明（新写或继承合格旧详情）；
 * - 修改/构建型：核心文件/契约/避坑指南 + 路径必须真实存在；
 * - 查询/调研型：查询结论/数据来源/后续建议，允许无路径（跳过存在性校验）。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { SUMMARY_DETAIL, makeEnv, rejectsWith } from "./helpers.js";

const BUILD_DETAIL = "核心文件：无\n契约/文档：无\n避坑指南：无";
const RESEARCH_DETAIL = "查询结论：确认了 A 方案可行\n数据来源：检索了 src/missing.ts（不存在）+ 会话记录\n后续建议：先实现 A，再补 B";
/** 祖先链汇总（B-62）：写任何节点详情都必须同时更新父链，这里是最短链路 requirement。 */
const ANCESTOR = { "R-001": SUMMARY_DETAIL };

/** @param {any} env */
async function seedTwoTasks(env) {
  await env.compass.init();
  await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
  await env.compass.plan({ parent_id: "R-001", title: "任务一", human_line: "任务一" });
  await env.compass.plan({ parent_id: "R-001", title: "任务二", human_line: "任务二" });
  await env.compass.update({
    task_ids: ["R-001-T-1", "R-001-T-2"],
    exec_state: "进行中",
    pointer_note: "批量开工"
  });
}

test("批量状态变更必须带 pointer_note（回归）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    const err = await rejectsWith(
      env.compass.update({ task_ids: ["R-001-T-1", "R-001-T-2"], exec_state: "已阻塞" }),
      "E_POINTER_NOTE_REQUIRED"
    );
    assert.match(err.message, /pointer_note/);
    const tree = await env.store.readTree();
    assert.equal(tree.root.children[0].children[0].exec_state, "进行中", "整批未生效");
  } finally {
    await env.cleanup();
  }
});

test("批量已执行：无 details 且无合格旧详情 ⇒ E_BATCH_DETAIL_REQUIRED（整批不写）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    const err = await rejectsWith(
      env.compass.update({ task_ids: ["R-001-T-1", "R-001-T-2"], exec_state: "已执行", pointer_note: "批量完成" }),
      "E_BATCH_DETAIL_REQUIRED"
    );
    assert.match(err.message, /批量标记已执行时，必须为每个任务提供简要的完成说明，或者至少继承原有的 detail 并要求补充。/);
    assert.deepEqual(new Set(err.details.missing), new Set(["R-001-T-1", "R-001-T-2"]));
    const tree = await env.store.readTree();
    assert.equal(tree.root.children[0].children[0].exec_state, "进行中", "状态未变");
    assert.equal(await env.store.readDetail("R-001-T-1"), "", "详情未写");
  } finally {
    await env.cleanup();
  }
});

test("批量已执行 + details（修改型）⇒ 写入详情、状态与追溯（A41）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    const res = await env.compass.update({
      task_ids: ["R-001-T-1", "R-001-T-2"],
      exec_state: "已执行",
      pointer_note: "批量完成（附完成说明）",
      details: {
        ...ANCESTOR,
        "R-001-T-1": BUILD_DETAIL,
        "R-001-T-2": { kind: "build", text: BUILD_DETAIL }
      }
    });
    assert.deepEqual(new Set(res.updated), new Set(["R-001-T-1", "R-001-T-2", "R-001"]));
    for (const id of ["R-001-T-1", "R-001-T-2"]) {
      assert.equal(await env.store.readDetail(id), BUILD_DETAIL, `${id} 详情已整段写入`);
      const tree = await env.store.readTree();
      const node = tree.root.children[0].children.find((child) => child.id === id);
      assert.equal(node.exec_state, "已执行");
      assert.equal(node.pointers.at(-1).note, "批量完成（附完成说明）");
    }
  } finally {
    await env.cleanup();
  }
});

test("批量已执行 + 查询/调研型：允许路径不存在（跳过存在性校验）（A41）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    const res = await env.compass.update({
      task_ids: ["R-001-T-1", "R-001-T-2"],
      exec_state: "已执行",
      pointer_note: "调研完成",
      details: {
        ...ANCESTOR,
        "R-001-T-1": RESEARCH_DETAIL,
        "R-001-T-2": { kind: "research", text: RESEARCH_DETAIL }
      }
    });
    assert.equal(res.updated.length, 3);
    assert.match(await env.store.readDetail("R-001-T-1"), /src\/missing\.ts/);
  } finally {
    await env.cleanup();
  }
});

test("修改型完成说明含不存在路径 ⇒ E_DETAIL_PATH_NOT_FOUND；缺段落 ⇒ E_DETAIL_CONTENT_INVALID（A41）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-1", "R-001-T-2"],
        exec_state: "已执行",
        pointer_note: "完成",
        details: {
          "R-001-T-1": "核心文件：`src/ghost.ts`\n契约/文档：无\n避坑指南：无",
          "R-001-T-2": BUILD_DETAIL
        }
      }),
      "E_DETAIL_PATH_NOT_FOUND"
    );
    await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-1", "R-001-T-2"],
        exec_state: "已执行",
        pointer_note: "完成",
        details: {
          "R-001-T-1": "核心文件：无\n契约/文档：无\n避坑指南：无",
          "R-001-T-2": "只写了结论，没有结构"
        }
      }),
      "E_DETAIL_CONTENT_INVALID"
    );
    const tree = await env.store.readTree();
    assert.equal(tree.root.children[0].children[0].exec_state, "进行中", "失败不落盘");
  } finally {
    await env.cleanup();
  }
});

test("details 分类约束（B-62）：未知 key / 非祖先 / 祖先汇总缺段 / 单节点 detail+details 组合", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    // 未知 key
    await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-1", "R-001-T-2"],
        exec_state: "已执行",
        pointer_note: "完成",
        details: { ...ANCESTOR, "R-001-T-1": BUILD_DETAIL, "R-001-T-2": BUILD_DETAIL, "R-404": BUILD_DETAIL }
      }),
      "E_INVALID_ARG"
    );
    // 祖先汇总缺三段（不能只写一句「父级已更新」糊过去）
    const bad = await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-1"],
        exec_state: "已执行",
        pointer_note: "完成",
        detail: BUILD_DETAIL,
        details: { "R-001": "父级已更新" }
      }),
      "E_ANCESTOR_DETAIL_REQUIRED"
    );
    assert.deepEqual(new Set(bad.details.missing), new Set(["验收范围", "完成结论", "遗留风险"]));
    // 单节点完成：detail（任务）+ details（祖先汇总）可以同传，两个文件都落盘
    const ok = await env.compass.update({
      task_ids: ["R-001-T-1"],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: BUILD_DETAIL,
      details: ANCESTOR
    });
    assert.deepEqual(new Set(ok.updated), new Set(["R-001-T-1", "R-001"]));
    assert.equal(await env.store.readDetail("R-001-T-1"), BUILD_DETAIL);
    assert.equal(await env.store.readDetail("R-001"), SUMMARY_DETAIL, "祖先链汇总已写");
    // 非已执行状态下，details 不能拿来给节点自身写详情（只能给祖先汇总）
    await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-2"],
        exec_state: "进行中",
        pointer_note: "继续",
        details: { "R-001-T-2": BUILD_DETAIL }
      }),
      "E_INVALID_ARG"
    );
  } finally {
    await env.cleanup();
  }
});

test("祖先链整条链路（B-62）：子任务写详情必须同时更新父任务与需求，缺一级就拒绝", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
    await env.compass.plan({ parent_id: "R-001", title: "父任务", human_line: "父任务" });
    await env.compass.plan({ parent_id: "R-001-T-1", title: "子任务", human_line: "子任务" });
    const missing = await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-1-T-1"],
        exec_state: "已执行",
        pointer_note: "完成",
        detail: BUILD_DETAIL
      }),
      "E_ANCESTOR_DETAIL_REQUIRED"
    );
    assert.deepEqual(new Set(missing.details.missing_ancestors), new Set(["R-001-T-1", "R-001"]));
    // 只补一级也不行
    await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-1-T-1"],
        exec_state: "已执行",
        pointer_note: "完成",
        detail: BUILD_DETAIL,
        details: { "R-001-T-1": SUMMARY_DETAIL }
      }),
      "E_ANCESTOR_DETAIL_REQUIRED"
    );
    // 整条链路一起写 ⇒ 成功，父链详情与需求聚合同时落盘
    const ok = await env.compass.update({
      task_ids: ["R-001-T-1-T-1"],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: BUILD_DETAIL,
      details: { "R-001-T-1": SUMMARY_DETAIL, "R-001": SUMMARY_DETAIL }
    });
    assert.ok(ok.updated.includes("R-001-T-1-T-1"));
    assert.equal(await env.store.readDetail("R-001-T-1"), SUMMARY_DETAIL);
    assert.equal(await env.store.readDetail("R-001"), SUMMARY_DETAIL);
    const tree = await env.store.readTree();
    assert.equal(tree.root.children[0].exec_state, "进行中", "父任务本身仍是未开始 ⇒ 需求聚合为进行中（聚合计入父任务节点）");
  } finally {
    await env.cleanup();
  }
});

test("批量已执行：可继承已满足内容标准的旧详情；不合格旧详情必须补写（A41）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    // T-1 先写一份合格详情（不标已执行）；T-2 只写不值得继承的内容
    await env.compass.update({ task_ids: ["R-001-T-1"], detail: BUILD_DETAIL, details: ANCESTOR });
    await env.compass.update({ task_ids: ["R-001-T-2"], detail: "旧内容", details: ANCESTOR });

    // T-1 可继承；T-2 缺说明 ⇒ 整批拒绝
    const err = await rejectsWith(
      env.compass.update({ task_ids: ["R-001-T-1", "R-001-T-2"], exec_state: "已执行", pointer_note: "完成" }),
      "E_BATCH_DETAIL_REQUIRED"
    );
    assert.deepEqual(err.details.missing, ["R-001-T-2"]);

    // 为 T-2 提供说明后成功；T-1 保留原详情（继承）
    const res = await env.compass.update({
      task_ids: ["R-001-T-1", "R-001-T-2"],
      exec_state: "已执行",
      pointer_note: "完成",
      details: { ...ANCESTOR, "R-001-T-2": BUILD_DETAIL }
    });
    assert.equal(res.updated.length, 3);
    assert.equal(await env.store.readDetail("R-001-T-1"), BUILD_DETAIL, "继承旧详情");
    assert.equal(await env.store.readDetail("R-001-T-2"), BUILD_DETAIL);
  } finally {
    await env.cleanup();
  }
});

test("单节点已执行：必须 detail 或继承合格旧详情（A41）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    await rejectsWith(
      env.compass.update({ task_ids: ["R-001-T-1"], exec_state: "已执行", pointer_note: "完成" }),
      "E_DETAIL_REQUIRED"
    );
    const res = await env.compass.update({
      task_ids: ["R-001-T-1"],
      exec_state: "已执行",
      pointer_note: "完成",
      detail: BUILD_DETAIL,
      details: ANCESTOR
    });
    assert.deepEqual(new Set(res.updated), new Set(["R-001-T-1", "R-001"]));
    assert.equal(await env.store.readDetail("R-001-T-1"), BUILD_DETAIL);
  } finally {
    await env.cleanup();
  }
});

test("幂等重标已执行：已执行节点不需要重复提供完成说明（A41 边界）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    await env.compass.update({
      task_ids: ["R-001-T-1", "R-001-T-2"],
      exec_state: "已执行",
      pointer_note: "完成",
      details: { ...ANCESTOR, "R-001-T-1": BUILD_DETAIL, "R-001-T-2": BUILD_DETAIL }
    });
    // 再批量标一次已执行：状态未变化 ⇒ 不强制重写说明
    const res = await env.compass.update({
      task_ids: ["R-001-T-1", "R-001-T-2"],
      exec_state: "已执行",
      pointer_note: "重复确认（幂等）"
    });
    assert.equal(res.unchanged.length, 2, "状态同值，不算更新");
  } finally {
    await env.cleanup();
  }
});

test("修改/构建型路径必须真实存在：真实路径可写（回归）", async () => {
  const env = await makeEnv();
  try {
    await seedTwoTasks(env);
    await fs.mkdir(path.join(env.workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(env.workspace, "src", "real.ts"), "x", "utf8");
    const res = await env.compass.update({
      task_ids: ["R-001-T-1", "R-001-T-2"],
      exec_state: "已执行",
      pointer_note: "完成",
      details: {
        ...ANCESTOR,
        "R-001-T-1": "核心文件：`src/real.ts`\n契约/文档：无\n避坑指南：无",
        "R-001-T-2": BUILD_DETAIL
      }
    });
    assert.equal(res.updated.length, 3);
  } finally {
    await env.cleanup();
  }
});
