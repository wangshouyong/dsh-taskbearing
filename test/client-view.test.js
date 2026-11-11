import assert from "node:assert/strict";
import test from "node:test";

import {
  badgesFor,
  countDescendants,
  formatCounts,
  isVisible,
  pinnedNodes,
  truncateLine,
  visibleRows
} from "../src/client/board-view.js";

const PTR = (note, at) => ({ session: "s", at, note });

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
          title: "需求一",
          human_line: "做需求一",
          exec_state: "进行中",
          verdict_state: null,
          dead_reason: null,
          merged_into: null,
          pointers: [PTR("建需求", "2026-11-11T01:00:00Z")],
          children: [
            {
              id: "R-001-T-1",
              kind: "task",
              title: "任务A",
              human_line: "做任务A",
              exec_state: "进行中",
              verdict_state: "待裁决",
              dead_reason: null,
              merged_into: null,
              pointers: [PTR("撞车", "2026-11-11T02:00:00Z")],
              children: []
            },
            {
              id: "R-001-T-2",
              kind: "task",
              title: "任务B",
              human_line: "做任务B",
              exec_state: "已执行",
              verdict_state: null,
              dead_reason: null,
              merged_into: null,
              pointers: [],
              children: []
            }
          ]
        },
        {
          id: "R-002",
          kind: "requirement",
          title: "需求二",
          human_line: "做需求二",
          exec_state: "未开始",
          verdict_state: "已废弃",
          dead_reason: "用户拍板不做了",
          merged_into: null,
          pointers: [PTR("废弃", "2026-11-11T03:00:00Z")],
          children: [
            {
              id: "R-002-T-1",
              kind: "task",
              title: "任务C",
              human_line: "做任务C",
              exec_state: "未开始",
              verdict_state: null,
              dead_reason: null,
              merged_into: null,
              pointers: [],
              children: []
            }
          ]
        }
      ]
    }
  };
}

test("isVisible：三视图规则（待裁决任何视图可见；废弃/替代仅完整轨迹）", () => {
  const tree = makeTree();
  const t1 = tree.root.children[0].children[0]; // 待裁决
  const t2 = tree.root.children[0].children[1]; // 已执行
  const r2 = tree.root.children[1]; // 已废弃
  assert.equal(isVisible(t1, "current"), true);
  assert.equal(isVisible(t1, "active"), true);
  assert.equal(isVisible(t2, "current"), true);
  assert.equal(isVisible(t2, "active"), false);
  assert.equal(isVisible(r2, "current"), false);
  assert.equal(isVisible(r2, "all"), true);
});

test("pinnedNodes：跨层级聚合待裁决，按最近 pointer 时间倒序", () => {
  const tree = makeTree();
  const pinned = pinnedNodes(tree);
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].node.id, "R-001-T-1");
  assert.deepEqual(pinned[0].path, ["做需求一"]);
});

test("visibleRows：折叠状态与父子剪枝", () => {
  const tree = makeTree();
  const collapsed = visibleRows(tree, "all", {});
  assert.deepEqual(collapsed.map((r) => r.node.id), ["R-001", "R-002"]);
  const open = visibleRows(tree, "all", { "R-001": true });
  assert.deepEqual(open.map((r) => r.node.id), ["R-001", "R-001-T-1", "R-001-T-2", "R-002"]);
});

test("countDescendants / formatCounts：机械计数只数后代", () => {
  const req = makeTree().root.children[0];
  const counts = countDescendants(req);
  assert.deepEqual(counts, { total: 2, active: 1, blocked: 0, done: 1, pendingVerdict: 1, conflict: 0 });
  assert.equal(formatCounts(counts), "2 条任务 · 进行中 1 · 已执行 1 · 待裁决 1");
});

test("badgesFor：执行态 + 裁决态 + 合并标记", () => {
  const node = { exec_state: "已执行", verdict_state: "已废弃", merged_into: "R-009" };
  const tones = badgesFor(node).map((b) => `${b.label}:${b.tone}`);
  assert.deepEqual(tones, ["已执行:green", "已废弃:muted", "已并入 R-009:muted"]);
});

test("truncateLine：超长截断带省略号", () => {
  assert.equal(truncateLine("短句", 10), "短句");
  assert.equal(truncateLine("x".repeat(100), 10), "xxxxxxxxx…");
  assert.equal(truncateLine(null), "");
});
