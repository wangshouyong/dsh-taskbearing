/**
 * 局部刷新（B-40 / A27）：行签名与行 diff 的纯函数测试。
 * 渲染层用 React.memo + areRowPropsEqual；这里保证「签名覆盖渲染依赖 + diff 正确」。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { areRowPropsEqual, diffRowSigs, rowSignature, visibleRows } from "../src/client/board-view.js";

const PTR = (note, at) => ({ session: "s", at, note });

function node(id, overrides = {}) {
  return {
    id,
    kind: id.startsWith("R-") && !id.includes("-T-") ? "requirement" : "task",
    title: `title ${id}`,
    human_line: `human ${id}`,
    exec_state: "未开始",
    verdict_state: null,
    dead_reason: null,
    merged_into: null,
    pointers: [PTR("建", "2026-11-11T01:00:00Z")],
    children: [],
    ...overrides
  };
}

function makeTree() {
  return {
    schema: 1,
    root: { id: "ROOT", kind: "project", children: [node("R-001", { children: [node("R-001-T-1"), node("R-001-T-2")] })] }
  };
}

test("rowSignature：同一行内容相同 ⇒ 签名相同；渲染依赖变化 ⇒ 签名变化", () => {
  const tree = makeTree();
  const rows = visibleRows(tree, "all", { "R-001": true });
  const base = rows.map((row) => rowSignature(row));
  assert.deepEqual(
    rows.map((row) => rowSignature(row)),
    base,
    "同内容重复计算签名必须稳定"
  );

  const requirementRow = rows[0];
  assert.notEqual(rowSignature({ ...requirementRow, expanded: false }), base[0], "展开态影响签名");
  assert.notEqual(rowSignature({ ...requirementRow, depth: 2 }), base[0], "深度影响签名");

  const task = tree.root.children[0].children[0];
  const taskRow = rows.find((row) => row.node.id === task.id);
  assert.notEqual(rowSignature({ ...taskRow, node: { ...task, exec_state: "已执行" } }), base[rows.indexOf(taskRow)]);
  assert.notEqual(
    rowSignature({ ...taskRow, node: { ...task, verdict_state: "待裁决" } }),
    base[rows.indexOf(taskRow)],
    "裁决态影响签名"
  );
});

test("rowSignature：需求行签名包含子树机械计数（后代状态变化必须触发重渲染）", () => {
  const tree = makeTree();
  const rows = visibleRows(tree, "all", { "R-001": true });
  const before = rowSignature(rows[0]);
  tree.root.children[0].children[0].exec_state = "已执行";
  const after = rowSignature(rows[0]);
  assert.notEqual(before, after, "后代状态变化会改变需求行计数，签名必须变化");
});

test("diffRowSigs：只报告新增/变化/删除的行", () => {
  const tree = makeTree();
  const prevRows = visibleRows(tree, "all", { "R-001": true }).map((row) => ({ ...row, signature: rowSignature(row) }));

  // 改一个任务的执行态：只有该行 changed
  tree.root.children[0].children[0].exec_state = "进行中";
  const changedRows = visibleRows(tree, "all", { "R-001": true }).map((row) => ({ ...row, signature: rowSignature(row) }));
  const changed = diffRowSigs(prevRows, changedRows);
  // 需求行计数也变，所以 changed 含需求行 + 该任务行
  assert.deepEqual(new Set(changed.changed), new Set(["R-001", "R-001-T-1"]));
  assert.deepEqual(changed.added, []);
  assert.deepEqual(changed.removed, []);

  // 折叠后子行消失：removed
  const collapsed = visibleRows(tree, "all", {}).map((row) => ({ ...row, signature: rowSignature(row) }));
  const diff2 = diffRowSigs(changedRows, collapsed);
  assert.deepEqual(new Set(diff2.removed), new Set(["R-001-T-1", "R-001-T-2"]));
  assert.deepEqual(diff2.changed, ["R-001"], "需求行展开态变化");
  assert.deepEqual(diff2.added, []);
});

test("diffRowSigs：新增节点与无变化", () => {
  const tree = makeTree();
  const prevRows = visibleRows(tree, "all", { "R-001": true }).map((row) => ({ ...row, signature: rowSignature(row) }));
  assert.equal(diffRowSigs(prevRows, prevRows).changedCount, 0, "同输入无变化");

  tree.root.children[0].children.push(node("R-001-T-3"));
  const nextRows = visibleRows(tree, "all", { "R-001": true }).map((row) => ({ ...row, signature: rowSignature(row) }));
  const diff = diffRowSigs(prevRows, nextRows);
  assert.deepEqual(diff.added, ["R-001-T-3"]);
  assert.deepEqual(new Set(diff.changed), new Set(["R-001"]), "需求行计数变化");
});

test("areRowPropsEqual：签名相同且回调稳定 ⇒ 跳过重渲染", () => {
  const onToggle = () => {};
  const onOpenDetail = () => {};
  const base = { signature: "sig-1", onToggle, onOpenDetail };
  assert.equal(areRowPropsEqual(base, { ...base }), true);
  assert.equal(areRowPropsEqual(base, { ...base, signature: "sig-2" }), false);
  assert.equal(areRowPropsEqual(base, { ...base, onToggle: () => {} }), false);
  assert.equal(areRowPropsEqual(base, { ...base, onOpenDetail: () => {} }), false);
});
