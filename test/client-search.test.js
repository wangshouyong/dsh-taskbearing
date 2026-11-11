import assert from "node:assert/strict";
import test from "node:test";

import { searchRows, matchesQuery, normalizeQuery } from "../src/client/board-view.js";

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
          title: "PPT 矢量转可拖顶点形状",
          human_line: "把 PPT 里的图变成能拖顶点的形状",
          exec_state: "进行中",
          verdict_state: null,
          dead_reason: null,
          merged_into: null,
          pointers: [PTR("建需求", "2026-11-11T01:00:00Z")],
          children: [
            {
              id: "R-001-T-1",
              kind: "task",
              title: "曲线能拖控制点",
              human_line: "让曲线也能拖控制点",
              exec_state: "进行中",
              verdict_state: null,
              dead_reason: null,
              merged_into: null,
              pointers: [],
              children: [
                {
                  id: "R-001-T-1-T-1",
                  kind: "task",
                  title: "松手后控制点能存住",
                  human_line: "松手后控制点位置要能存住",
                  exec_state: "未开始",
                  verdict_state: null,
                  dead_reason: null,
                  merged_into: null,
                  pointers: [],
                  children: []
                }
              ]
            },
            {
              id: "R-001-T-2",
              kind: "task",
              title: "矩形也能拖顶点",
              human_line: "矩形也要能拖",
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
          title: "导出相关",
          human_line: "导出 PDF",
          exec_state: "未开始",
          verdict_state: "已废弃",
          dead_reason: "用户说先不做导出",
          merged_into: null,
          pointers: [],
          children: [
            {
              id: "R-002-T-1",
              kind: "task",
              title: "导出按钮",
              human_line: "加导出按钮",
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

test("normalizeQuery / matchesQuery：大小写、首尾空白、多词全命中", () => {
  assert.equal(normalizeQuery("  CDP  "), "cdp");
  const node = { title: "CDP 真机验收", human_line: "用 CDP 浏览器验前端", dead_reason: "被废弃：改用 playwright" };
  assert.equal(matchesQuery(node, ["cdp"]), true);
  assert.equal(matchesQuery(node, ["cdp", "浏览器"]), true);
  assert.equal(matchesQuery(node, ["cdp", "不存在"]), false);
  assert.equal(matchesQuery({ title: "X", human_line: "Y", dead_reason: "改用 playwright" }, ["playwright"]), true);
});

test("searchRows：空查询回退普通视图（searching=false）", () => {
  const result = searchRows(makeTree(), "current", {}, "   ");
  assert.equal(result.searching, false);
  assert.equal(result.matchCount, 0);
  assert.deepEqual(result.rows.map((row) => row.node.id), ["R-001"]);
});

test("searchRows：命中深层节点时祖先链自动展开、未命中兄弟隐藏、命中数正确", () => {
  const result = searchRows(makeTree(), "current", {}, "松手后");
  assert.equal(result.searching, true);
  assert.equal(result.matchCount, 1);
  assert.deepEqual(
    result.rows.map((row) => row.node.id),
    ["R-001", "R-001-T-1", "R-001-T-1-T-1"]
  );
  assert.ok(result.rows.every((row) => row.expanded));
});

test("searchRows：视图内过滤（只看当前时已废弃需求即使命中也不出现）", () => {
  const tree = makeTree();
  const current = searchRows(tree, "current", {}, "导出");
  assert.equal(current.matchCount, 0);
  assert.deepEqual(current.rows, []);

  const all = searchRows(tree, "all", {}, "导出");
  assert.equal(all.matchCount, 2);
  assert.deepEqual(all.rows.map((row) => row.node.id), ["R-002", "R-002-T-1"]);
});

test("searchRows：多词跨字段命中（title + human_line）", () => {
  const result = searchRows(makeTree(), "current", {}, "矩形 顶点");
  assert.equal(result.matchCount, 1);
  assert.deepEqual(result.rows.map((row) => row.node.id), ["R-001", "R-001-T-2"]);
});

test("searchRows：无命中时 rows 为空（由 UI 显示空结果提示）", () => {
  const result = searchRows(makeTree(), "current", {}, "绝对不存在的词");
  assert.equal(result.searching, true);
  assert.equal(result.matchCount, 0);
  assert.deepEqual(result.rows, []);
});
