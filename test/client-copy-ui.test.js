import assert from "node:assert/strict";
import test from "node:test";

import { formatHandoff, requirementIdOf } from "../src/client/copy-format.js";
import { normalizePrefs, normalizeUiState, persistableExpanded, toggleExpanded } from "../src/client/ui-state.js";
import { nextDirty, shouldFetchNow, shouldPoll } from "../src/client/polling.js";

const node = {
  id: "R-001-T-1",
  title: "曲线能拖控制点",
  human_line: "让曲线也能拖控制点",
  exec_state: "进行中",
  verdict_state: "待裁决",
  pointers: [
    { session: "s-1", at: "2026-11-11T01:00:00Z", note: "开始" },
    { session: "s-1", at: "2026-11-11T02:00:00Z", note: "撞车" }
  ]
};

test("formatHandoff：包含 id/路径/两线状态/追溯链/需求明面/两栏正文", () => {
  const text = formatHandoff(
    node,
    ["把 PPT 里的图变成能拖顶点的形状", "让曲线也能拖控制点"],
    { id: "R-001", surface: "把 PPT 里的图变成能拖顶点的形状" },
    "详情正文",
    "用户备注"
  );
  assert.match(text, /# 任务交接：R-001-T-1 曲线能拖控制点/);
  assert.match(text, /任务路径：把 PPT 里的图变成能拖顶点的形状 › 让曲线也能拖控制点/);
  assert.match(text, /执行状态：进行中/);
  assert.match(text, /裁决状态：待裁决/);
  assert.match(text, /追溯链：s-1 · 2026-11-11T01:00:00Z 开始；s-1 · 2026-11-11T02:00:00Z 撞车/);
  assert.match(text, /所属需求：R-001 明面——把 PPT 里的图变成能拖顶点的形状/);
  assert.match(text, /## 详情（AI 写）\n详情正文/);
  assert.match(text, /## 用户备注\n用户备注/);
});

test("formatHandoff：无备注省略备注节；无详情用占位", () => {
  const text = formatHandoff(node, ["A", "B"], null, "", "");
  assert.doesNotMatch(text, /## 用户备注/);
  assert.match(text, /（暂无详情）/);
});

test("requirementIdOf：从任意层级 id 推出需求 id", () => {
  assert.equal(requirementIdOf("R-001"), "R-001");
  assert.equal(requirementIdOf("R-001-T-1"), "R-001");
  assert.equal(requirementIdOf("R-001-T-1-T-1"), "R-001");
  assert.equal(requirementIdOf("T-1"), null);
});

test("normalizePrefs：默认值与非法 view 兜底", () => {
  assert.deepEqual(normalizePrefs(null), { view: "current", rememberExpand: false });
  assert.deepEqual(normalizePrefs({ view: "active", rememberExpand: true }), { view: "active", rememberExpand: true });
  assert.deepEqual(normalizePrefs({ view: "nope" }), { view: "current", rememberExpand: false });
});

test("toggleExpanded / persistableExpanded", () => {
  const once = toggleExpanded({}, "R-001");
  assert.deepEqual(once, { "R-001": true });
  assert.deepEqual(toggleExpanded(once, "R-001"), { "R-001": false });
  assert.deepEqual(persistableExpanded({ rememberExpand: true }, once), once);
  assert.deepEqual(persistableExpanded({ rememberExpand: false }, once), {});
});

test("normalizeUiState：非法输入兜底", () => {
  assert.deepEqual(normalizeUiState(null), { expanded: {}, rememberExpand: false });
  assert.deepEqual(normalizeUiState({ expanded: { A: true }, rememberExpand: true }), { expanded: { A: true }, rememberExpand: true });
  assert.deepEqual(normalizeUiState({ expanded: [1, 2] }), { expanded: {}, rememberExpand: false });
});

test("shouldPoll / shouldFetchNow / nextDirty：刷新调度", () => {
  assert.equal(shouldPoll({ tabVisible: true, docVisible: true, editing: false }), true);
  assert.equal(shouldPoll({ tabVisible: false, docVisible: true, editing: false }), false);
  assert.equal(shouldPoll({ tabVisible: true, docVisible: true, editing: true }), false);

  assert.equal(shouldFetchNow({ justBecameVisible: true, justFinishedEditing: false, manual: false }), true);
  assert.equal(shouldFetchNow({ justBecameVisible: false, justFinishedEditing: true, manual: false }), true);
  assert.equal(shouldFetchNow({ justBecameVisible: false, justFinishedEditing: false, manual: true }), true);
  assert.equal(shouldFetchNow({ justBecameVisible: false, justFinishedEditing: false, manual: false }), false);

  assert.deepEqual(nextDirty({ changed: true, editing: true }), { dirty: true });
  assert.deepEqual(nextDirty({ changed: true, editing: false }), { dirty: false });
});
