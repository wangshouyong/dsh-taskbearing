import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCompass } from "../src/core/tools.js";
import { Store } from "../src/core/store.js";
import { checkVerdictTransition, assertVerdictInput } from "../src/core/state.js";
import { validateTree, flattenLite } from "../src/core/tree.js";
import { badgesFor, countDescendants, formatCounts, isVisible, pinnedNodes } from "../src/client/board-view.js";

function makeTree() {
  return {
    schema: 1,
    root: {
      id: "ROOT",
      kind: "project",
      children: [
        {
          id: "R-001",
          kind: "requirement",
          title: "需求",
          human_line: "需求",
          exec_state: "进行中",
          verdict_state: null,
          dead_reason: null,
          merged_into: null,
          pointers: [],
          children: [
            { id: "R-001-T-1", kind: "task", title: "任务A", human_line: "任务A", exec_state: "进行中", verdict_state: null, dead_reason: null, merged_into: null, pointers: [], children: [] },
            { id: "R-001-T-2", kind: "task", title: "任务B", human_line: "任务B", exec_state: "进行中", verdict_state: "冲突", dead_reason: null, merged_into: null, pointers: [], children: [] },
            { id: "R-001-T-3", kind: "task", title: "任务C", human_line: "任务C", exec_state: "已执行", verdict_state: "待裁决", dead_reason: null, merged_into: null, pointers: [], children: [] }
          ]
        }
      ]
    }
  };
}

async function makeCompass(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-v114-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = Store.forWorkspace({ storageRoot: path.join(root, "storages"), workspacePath: path.join(root, "ws") });
  const compass = createCompass({ store, sessionId: "s-v114", turn: 9, now: () => new Date("2026-11-11T12:00:00.000Z") });
  await compass.init();
  await compass.require({ title: "需求", human_line: "需求", surface: "需求" });
  return { compass, store };
}

test("冲突态：合法输入与非终端约束", () => {
  assert.equal(assertVerdictInput("冲突"), "冲突");
  assert.equal(checkVerdictTransition(null, "冲突").legal, true);
  assert.equal(checkVerdictTransition("冲突", "待裁决").legal, true);
  assert.equal(checkVerdictTransition("待裁决", "冲突").legal, true);
  assert.equal(checkVerdictTransition("冲突", "已废弃").legal, true);
  assert.equal(checkVerdictTransition("冲突", "已确认继续").legal, true);
  assert.equal(checkVerdictTransition("冲突", "null").legal, true);
  assert.equal(checkVerdictTransition("已废弃", "冲突").legal, false);
  assert.equal(checkVerdictTransition("冲突", "冲突").legal, true);
});

test("冲突态：update 可写、非终端不带 dead_reason、可转废弃", async (t) => {
  const { compass } = await makeCompass(t);
  const task = await compass.plan({ parent_id: "R-001", title: "任务", human_line: "任务" });
  await compass.update({ task_ids: [task.task_id], verdict_state: "冲突", pointer_note: "与旧需求撞车" });
  let tree = await compass.read({ scope: "tree" });
  let node = tree.root.children[0].children[0];
  assert.equal(node.verdict_state, "冲突");
  assert.equal(node.dead_reason, null);

  await compass.update({ task_ids: [task.task_id], verdict_state: "待裁决", pointer_note: "升级为待拍板" });
  tree = await compass.read({ scope: "tree" });
  node = tree.root.children[0].children[0];
  assert.equal(node.verdict_state, "待裁决");

  await compass.update({
    task_ids: [task.task_id],
    verdict_state: "已废弃",
    dead_reason: "用户拍板不做",
    pointer_note: "拍板废弃"
  });
  tree = await compass.read({ scope: "tree" });
  node = tree.root.children[0].children[0];
  assert.equal(node.verdict_state, "已废弃");
  assert.equal(node.dead_reason, "用户拍板不做");
});

test("冲突态：树校验与 UI（视图可见、钉顶、橙色徽标、计数）", () => {
  const tree = makeTree();
  validateTree(tree);

  assert.equal(isVisible(tree.root.children[0].children[1], "current"), true);
  assert.equal(isVisible(tree.root.children[0].children[1], "active"), true);
  const pinned = pinnedNodes(tree);
  assert.deepEqual(pinned.map((entry) => entry.node.id).sort(), ["R-001-T-2", "R-001-T-3"]);
  const badges = badgesFor(tree.root.children[0].children[1]).map((badge) => `${badge.label}:${badge.tone}`);
  assert.deepEqual(badges, ["进行中:blue", "冲突:orange"]);
  const counts = countDescendants(tree.root.children[0]);
  assert.equal(counts.total, 3);
  assert.equal(counts.pendingVerdict, 1);
  assert.equal(counts.conflict, 1);
  assert.match(formatCounts(counts), /冲突 1/);
});

test("compass_move：换父 + after 定位、ID 不变、追溯链追加", async (t) => {
  const { compass, store } = await makeCompass(t);
  const a = await compass.plan({ parent_id: "R-001", title: "A", human_line: "A" });
  const b = await compass.plan({ parent_id: "R-001", title: "B", human_line: "B" });
  const c = await compass.plan({ parent_id: "R-001", title: "C", human_line: "C" });

  const moved = await compass.move({ source_id: c.task_id, parent_id: a.task_id, pointer_note: "C 其实属于 A" });
  assert.deepEqual(moved, { moved: c.task_id, from: "R-001", to: a.task_id });
  const tree = await store.readTree();
  const nodeA = tree.root.children[0].children.find((child) => child.id === a.task_id);
  const nodeC = nodeA.children.find((child) => child.id === c.task_id);
  assert.ok(nodeC, "C 应挂到 A 下");
  assert.equal(nodeC.pointers.at(-1).note, "C 其实属于 A");
  assert.equal(nodeA.children.length, 1);
  const top = tree.root.children[0].children.map((child) => child.id);
  assert.deepEqual(top, [a.task_id, b.task_id]);

  // 换父后在 B 之后插入另一个节点
  const d = await compass.plan({ parent_id: "R-001", title: "D", human_line: "D" });
  await compass.move({ source_id: d.task_id, parent_id: a.task_id });
  const tree2 = await store.readTree();
  const nodeA2 = tree2.root.children[0].children.find((child) => child.id === a.task_id);
  assert.deepEqual(nodeA2.children.map((child) => child.id), [c.task_id, d.task_id]);
  validateTree(tree2);
});

test("compass_move：拒绝成环 / 移动需求 / 挂到项目根，数据不变", async (t) => {
  const { compass, store } = await makeCompass(t);
  const a = await compass.plan({ parent_id: "R-001", title: "A", human_line: "A" });
  const a1 = await compass.plan({ parent_id: a.task_id, title: "A1", human_line: "A1" });
  const before = JSON.stringify(await store.readTree());

  await assert.rejects(
    () => compass.move({ source_id: a.task_id, parent_id: a1.task_id }),
    (err) => err.code === "E_INVALID_ARG"
  );
  await assert.rejects(
    () => compass.move({ source_id: "R-001", parent_id: a.task_id }),
    (err) => err.code === "E_INVALID_ARG"
  );
  await assert.rejects(
    () => compass.move({ source_id: a.task_id, parent_id: "ROOT" }),
    (err) => err.code === "E_INVALID_ARG"
  );
  assert.equal(JSON.stringify(await store.readTree()), before);
});
