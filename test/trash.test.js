import assert from "node:assert/strict";
import test from "node:test";

import { buildBundle, importBundle } from "../src/core/exchange.js";
import { Store } from "../src/core/store.js";
import { collectTrashed, countDescendants, findNode, pruneTrashed, validateTree } from "../src/core/tree.js";
import {
  TRASH_BACKUP_FORMAT,
  cleanupTrashBackups,
  discardNodes,
  inspectPurge,
  readTrashBackup,
  removeNode,
  restoreNodes,
  writeTrashBackup
} from "../src/core/trash.js";
import { makeEnv, rejectsWith } from "./helpers.js";

/**
 * 建一块最小的板：需求下 2 个任务，任务 1 下 1 个步骤。
 * @param {Awaited<ReturnType<typeof makeEnv>>} env
 */
async function seedBoard(env) {
  const { compass } = env;
  await compass.init();
  const requirement = await compass.require({ title: "需求A", human_line: "一次性咨询混进任务清单", surface: "回收站需求" });
  const task1 = await compass.plan({ parent_id: requirement.requirement_id, title: "任务1", human_line: "要改的东西" });
  const task2 = await compass.plan({ parent_id: requirement.requirement_id, title: "任务2", human_line: "另一件事" });
  const step = await compass.plan({ parent_id: task1.task_id, title: "步骤1", human_line: "细节步骤" });
  return { requirementId: requirement.requirement_id, task1: task1.task_id, task2: task2.task_id, step: step.task_id };
}

test("discard：打删除标记后视图/计数排除，执行态与裁决态原样保留（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    const tree = await env.store.readTree();
    const at = env.now.toISOString();
    const result = discardNodes(tree, [ids.task1], at);
    assert.deepEqual(result.discarded, [ids.task1]);
    assert.deepEqual(result.skipped, []);
    await env.store.writeTree(tree); // 合法标记：写入即通过 validateTree

    const pruned = pruneTrashed(tree);
    assert.equal(findNode(pruned, ids.task1), null);
    assert.equal(findNode(pruned, ids.step), null, "整棵子树随祖先一起隐藏");
    assert.ok(findNode(pruned, ids.task2));
    const requirement = findNode(pruned, ids.requirementId);
    assert.equal(countDescendants(requirement).total, 1, "机械计数只数可见后代");

    const raw = findNode(tree, ids.task1);
    assert.equal(raw.exec_state, "未开始", "丢弃不碰执行态");
    assert.equal(raw.verdict_state, null, "丢弃不碰裁决态（不是「已废弃」）");
    assert.equal(raw.trashedAt, at);
    assert.equal(raw.pointers.length, 1, "丢弃不写追溯链（它是面板侧动作）");

    const entries = collectTrashed(tree);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].node.id, ids.task1);
    assert.equal(entries[0].descendants, 1);
    assert.equal(entries[0].parent_id, ids.requirementId);
  } finally {
    await env.cleanup();
  }
});

test("discard：需求层丢弃 → 整条需求聚合不计入，还原后聚合恢复（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    // 两个任务都进「进行中」，让需求聚合为「进行中」（不需要完成说明）
    await env.compass.update({ task_ids: [ids.task1, ids.task2], exec_state: "进行中", pointer_note: "开工" });
    let tree = await env.store.readTree();
    assert.equal(findNode(tree, ids.requirementId).exec_state, "进行中");

    discardNodes(tree, [ids.task2], env.now.toISOString());
    await env.store.writeTree(tree);
    tree = await env.store.readTree();
    assert.equal(findNode(tree, ids.requirementId).exec_state, "进行中", "只剩进行中任务时聚合仍是进行中");

    discardNodes(tree, [ids.task1], env.now.toISOString());
    await env.store.writeTree(tree);
    tree = await env.store.readTree();
    assert.equal(findNode(tree, ids.requirementId).exec_state, "未开始", "全部丢弃后聚合为未开始（可见任务为空）");

    restoreNodes(tree, [ids.task1, ids.task2]);
    await env.store.writeTree(tree);
    tree = await env.store.readTree();
    assert.equal(findNode(tree, ids.requirementId).exec_state, "进行中", "还原后聚合回到丢弃前");
    assert.equal(findNode(tree, ids.task2).trashedAt, undefined);
  } finally {
    await env.cleanup();
  }
});

test("restore：父节点还在回收站时拒绝还原子节点（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    const tree = await env.store.readTree();
    discardNodes(tree, [ids.requirementId], env.now.toISOString());
    const err = await rejectsWith(Promise.resolve().then(() => restoreNodes(tree, [ids.step])), "E_TRASH_NOT_FOUND");
    assert.equal(err.details?.trashed_ancestor, ids.requirementId);
    await env.store.writeTree(tree);
  } finally {
    await env.cleanup();
  }
});

test("purge：需求禁止物理删除；任务可删且有 merged_into 引用时拒绝（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    let tree = await env.store.readTree();
    discardNodes(tree, [ids.requirementId], env.now.toISOString());
    await rejectsWith(Promise.resolve().then(() => inspectPurge(tree, ids.requirementId)), "E_PURGE_FORBIDDEN");

    // 未丢弃的节点也不能直接删（必须先丢进回收站）
    await rejectsWith(Promise.resolve().then(() => inspectPurge(tree, ids.task2)), "E_TRASH_NOT_FOUND");

    // 任务被其它节点 merged_into 引用 ⇒ 拒绝删除
    tree = await env.store.readTree();
    restoreNodes(tree, [ids.requirementId]);
    discardNodes(tree, [ids.task1], env.now.toISOString());
    const t2 = findNode(tree, ids.task2);
    t2.merged_into = ids.task1;
    await rejectsWith(Promise.resolve().then(() => inspectPurge(tree, ids.task1)), "E_PURGE_FORBIDDEN");
  } finally {
    await env.cleanup();
  }
});

test("removeNode：摘掉子树并给出被删 id 列表（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    const tree = await env.store.readTree();
    discardNodes(tree, [ids.task1], env.now.toISOString());
    const removed = removeNode(tree, ids.task1);
    assert.deepEqual(removed.ids.sort(), [ids.task1, ids.step].sort());
    assert.equal(findNode(tree, ids.task1), null);
    assert.equal(findNode(tree, ids.step), null);
    await env.store.writeTree(tree); // 删除后仍是合法树
    assert.equal(collectTrashed(tree).length, 0);
  } finally {
    await env.cleanup();
  }
});

test("trashedAt 合法性：非法时间戳 ⇒ E_STORE_CORRUPT（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    const tree = await env.store.readTree();
    findNode(tree, ids.task1).trashedAt = "昨天";
    assert.throws(() => validateTree(tree), (err) => err?.code === "E_STORE_CORRUPT");
    // 合法 ISO 通过
    findNode(tree, ids.task1).trashedAt = env.now.toISOString();
    assert.doesNotThrow(() => validateTree(tree));
    // 根节点不允许带标记
    tree.root.trashedAt = env.now.toISOString();
    assert.throws(() => validateTree(tree), (err) => err?.code === "E_STORE_CORRUPT");
  } finally {
    await env.cleanup();
  }
});

test("备份：写读往返 + 过期清理（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    const tree = await env.store.readTree();
    discardNodes(tree, [ids.task1], env.now.toISOString());
    const info = inspectPurge(tree, ids.task1);
    const backup = {
      format: TRASH_BACKUP_FORMAT,
      schema: 1,
      purged_at: env.now.toISOString(),
      workspace_id: env.store.workspaceId,
      root_id: info.node.id,
      root_kind: info.node.kind,
      node: info.node,
      ids: info.ids,
      details: { [ids.task1]: { md: "核心文件：无", note: "" } }
    };
    const file = await writeTrashBackup(env.store, backup);
    const roundtrip = await readTrashBackup(file);
    assert.equal(roundtrip.format, TRASH_BACKUP_FORMAT);
    assert.equal(roundtrip.root_id, ids.task1);
    assert.deepEqual(roundtrip.ids.sort(), [ids.task1, ids.step].sort());

    const removedExpired = await cleanupTrashBackups(env.store, { now: Date.now() + 31 * 24 * 60 * 60 * 1000 });
    assert.equal(removedExpired, 1, "超过 30 天的备份被清理");
    const keptFresh = await cleanupTrashBackups(env.store, { now: Date.now() });
    assert.equal(keptFresh, 0);
  } finally {
    await env.cleanup();
  }
});

test("导出/导入往返：回收站标记不丢（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    const tree = await env.store.readTree();
    discardNodes(tree, [ids.task2], env.now.toISOString());
    await env.store.writeTree(tree);

    const bundle = await buildBundle(env.store);
    const json = JSON.parse(JSON.stringify(bundle));

    const root2 = await import("node:fs/promises").then((fs) => fs.mkdtemp(`${env.root}-import-`));
    const workspace2 = `${root2}/ws`;
    await import("node:fs/promises").then((fs) => fs.mkdir(workspace2, { recursive: true }));
    const store2 = Store.forWorkspace({
      storageRoot: `${root2}/storages`,
      workspacePath: workspace2,
      workspaceName: "imported"
    });
    await importBundle(store2, json, { confirm: "IMPORT" });
    const imported = await store2.readTree();
    assert.equal(findNode(imported, ids.task2).trashedAt, env.now.toISOString(), "回收站标记随包迁移");
    assert.equal(pruneTrashed(imported).root.children[0].children.length, 1, "导入后视图同样隐藏被丢弃节点");
    await import("node:fs/promises").then((fs) => fs.rm(root2, { recursive: true, force: true }));
  } finally {
    await env.cleanup();
  }
});

test("AI 侧：read 过滤回收站节点；对回收站节点写入被拒（v1.33）", async () => {
  const env = await makeEnv();
  try {
    const ids = await seedBoard(env);
    const tree = await env.store.readTree();
    discardNodes(tree, [ids.task1], env.now.toISOString());
    await env.store.writeTree(tree);

    const visible = await env.compass.read({ scope: "tree" });
    assert.equal(findNode(visible, ids.task1), null, "compass_read(tree) 不返回回收站节点");
    const lite = await env.compass.read({ scope: "tree-lite" });
    assert.equal(lite.some((node) => node.id === ids.task1), false);

    await rejectsWith(
      env.compass.update({ task_ids: [ids.task1], exec_state: "进行中", pointer_note: "AI 想改回收站里的节点" }),
      "E_TRASH_NOT_FOUND"
    );
    await rejectsWith(
      env.compass.plan({ parent_id: ids.task1, title: "新任务", human_line: "挂到回收站节点下" }),
      "E_TRASH_NOT_FOUND"
    );
    // 还原后 AI 又能写（不锁死）
    const after = await env.store.readTree();
    restoreNodes(after, [ids.task1]);
    await env.store.writeTree(after);
    const updated = await env.compass.update({ task_ids: [ids.task1], exec_state: "进行中", pointer_note: "还原后继续" });
    assert.equal(updated.updated.includes(ids.task1), true);
  } finally {
    await env.cleanup();
  }
});
