import assert from "node:assert/strict";
import test from "node:test";

import { emptyTree, flattenLite, countDescendants, validateTree } from "../src/core/tree.js";

const REMOTE = { session: "s-8f3a", at: "2026-11-11T14:31:07.000Z", note: "提出需求" };

/** @returns {any} */
function baseTree() {
  return {
    schema: 1,
    root: {
      id: "ROOT",
      kind: "project",
      children: [
        {
          id: "R-001",
          kind: "requirement",
          title: "PPT 矢量转可拖顶点形状",
          human_line: "把 PPT 里的图变成能拖顶点的形状",
          exec_state: "进行中",
          verdict_state: null,
          dead_reason: null,
          merged_into: null,
          pointers: [REMOTE],
          children: [
            {
              id: "R-001-T-1",
              kind: "task",
              title: "曲线能拖控制点",
              human_line: "让曲线也能拖控制点",
              exec_state: "未开始",
              verdict_state: null,
              dead_reason: null,
              merged_into: null,
              pointers: [],
              children: [
                {
                  id: "R-001-T-1-T-1",
                  kind: "task",
                  title: "贝塞尔控制点持久化",
                  human_line: "松手后控制点能存住",
                  exec_state: "已执行",
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
      ]
    }
  };
}

function corrupt(mutate) {
  const tree = structuredClone(baseTree());
  mutate(tree);
  assert.throws(() => validateTree(tree), (err) => err.code === "E_STORE_CORRUPT");
}

test("合法树通过校验", () => {
  assert.doesNotThrow(() => validateTree(baseTree()));
  assert.doesNotThrow(() => validateTree(emptyTree()));
});

test("schema 过高 → E_SCHEMA_VERSION", () => {
  const tree = { ...emptyTree(), schema: 99 };
  assert.throws(() => validateTree(tree), (err) => err.code === "E_SCHEMA_VERSION");
});

test("结构非法 → E_STORE_CORRUPT", () => {
  corrupt((t) => (t.root.id = "T-001"));
  corrupt((t) => (t.root.exec_state = "进行中"));
  corrupt((t) => (t.root.children[0].kind = "task"));
  corrupt((t) => (t.root.children[0].children[0].children[0].kind = "requirement"));
  corrupt((t) => (t.root.children[0].id = t.root.children[0].children[0].id));
  corrupt((t) => (t.root.children[0].dead_reason = "无证据就废弃"));
});

test("终端裁决必须带 dead_reason；非终端不得带", () => {
  corrupt((t) => (t.root.children[0].verdict_state = "已废弃"));
  const t = baseTree();
  t.root.children[0].verdict_state = "已废弃";
  t.root.children[0].dead_reason = "用户第 31 轮拍板";
  assert.doesNotThrow(() => validateTree(t));
});

test("追溯链字段校验", () => {
  corrupt((t) => delete t.root.children[0].pointers[0].session);
  corrupt((t) => (t.root.children[0].pointers[0].at = "昨天"));
  corrupt((t) => (t.root.children[0].pointers[0].note = " "));
  corrupt((t) => (t.root.children[0].pointers[0].turn = -1));
  corrupt((t) => (t.root.children[0].pointers[0].turn = 1.5));
});

test("已确认继续 不落板", () => {
  corrupt((t) => (t.root.children[0].verdict_state = "已确认继续"));
});

test("merged_into 必须指向存在节点且不能自指", () => {
  corrupt((t) => (t.root.children[0].merged_into = "R-999"));
  corrupt((t) => (t.root.children[0].merged_into = "R-001"));
  const t = baseTree();
  t.root.children[0].merged_into = "R-001-T-1";
  assert.doesNotThrow(() => validateTree(t));
});

test("tree-lite：带 kind、不带 pointers，profile 根不出现", () => {
  const lite = flattenLite(baseTree());
  assert.deepEqual(
    lite.map((n) => n.id),
    ["R-001", "R-001-T-1", "R-001-T-1-T-1"]
  );
  assert.deepEqual(Object.keys(lite[0]).sort(), ["exec_state", "human_line", "id", "kind", "title", "verdict_state"]);
});

test("机械计数：只数后代、按状态分组", () => {
  const tree = baseTree();
  const counts = countDescendants(tree.root.children[0]);
  assert.equal(counts.total, 2);
  assert.equal(counts.byExec["未开始"], 1);
  assert.equal(counts.byExec["已执行"], 1);
});
