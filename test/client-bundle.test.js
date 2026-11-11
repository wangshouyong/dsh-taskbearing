/**
 * client 侧导出包摘要（B-41 / A15 UI 确认面板）：纯函数测试。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { describeBundle, summarizeBundle } from "../src/client/bundle-view.js";

const bundle = {
  format: "dsh-taskboard-bundle",
  schema: 1,
  exported_at: "2026-11-11T12:00:00.000Z",
  plugin_version: "0.1.0",
  workspace: { workspace_id: "demo-abc12345", name: "demo", original_path: "D:/work/demo" },
  tree: {
    root: {
      id: "ROOT",
      children: [
        {
          id: "R-001",
          kind: "requirement",
          children: [
            { id: "R-001-T-1", kind: "task", children: [] },
            { id: "R-001-T-2", kind: "task", children: [{ id: "R-001-T-2-T-1", kind: "task", children: [] }] }
          ]
        },
        { id: "R-002", kind: "requirement", children: [] }
      ]
    }
  },
  details: { "R-001-T-1": { md: "a", note: "" }, "R-001-T-2": { md: "", note: "b" } }
};

test("summarizeBundle：统计需求/节点/详情，保留来源信息", () => {
  const summary = summarizeBundle(bundle);
  assert.equal(summary.format, "dsh-taskboard-bundle");
  assert.equal(summary.schema, 1);
  assert.equal(summary.workspace_name, "demo");
  assert.equal(summary.original_path, "D:/work/demo");
  assert.equal(summary.requirements, 2);
  assert.equal(summary.nodes, 5);
  assert.equal(summary.details, 2);
});

test("summarizeBundle：空/畸形包不抛错（返回 null 字段与 0 计数）", () => {
  assert.deepEqual(
    summarizeBundle(null),
    {
      format: null,
      schema: null,
      exported_at: null,
      plugin_version: null,
      workspace_name: null,
      original_path: null,
      nodes: 0,
      requirements: 0,
      details: 0
    }
  );
  const weird = summarizeBundle({ schema: "1", tree: {}, details: [] });
  assert.equal(weird.schema, null);
  assert.equal(weird.nodes, 0);
});

test("describeBundle：确认文案包含来源、时间、版本与内容计数", () => {
  const text = describeBundle(summarizeBundle(bundle));
  assert.match(text, /来源工作区：demo/);
  assert.match(text, /原始路径：D:\/work\/demo/);
  assert.match(text, /导出时间：2026-11-11T12:00:00\.000Z/);
  assert.match(text, /插件版本：0\.1\.0/);
  assert.match(text, /2 需求 · 5 节点 · 2 个详情\/备注/);
});
