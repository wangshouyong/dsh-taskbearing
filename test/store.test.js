import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Store } from "../src/core/store.js";
import { makeEnv, rejectsWith } from "./helpers.js";

test("init：建目录结构、写入 meta/tree/baseline，重复调用幂等", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());

  const first = await env.store.init();
  assert.equal(first.created, true);

  const meta = JSON.parse(await fs.readFile(env.store.metaPath, "utf8"));
  assert.equal(meta.plugin, "dsh-compass");
  assert.equal(meta.schema, 1);
  assert.equal(meta.workspace_name, "demo");
  assert.ok(meta.original_path.endsWith("/ws"));
  assert.equal(meta.path_hash, env.store.workspaceId.split("-").pop());

  const tree = await env.store.readTree();
  assert.equal(tree.root.id, "ROOT");
  assert.equal(tree.root.kind, "project");
  assert.deepEqual(tree.root.children, []);

  const { raw } = await env.store.readBaseline();
  assert.match(raw, /^# 需求基线/);

  const second = await env.store.init();
  assert.equal(second.created, false);
});

test("未初始化：读取抛 E_NOT_INITIALIZED", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());
  await rejectsWith(env.store.readTree(), "E_NOT_INITIALIZED");
  await rejectsWith(env.store.readMeta(), "E_NOT_INITIALIZED");
});

test("工作区不匹配：同一数据目录换个路径 → E_WORKSPACE_MISMATCH", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());
  await env.store.init();
  const other = new Store({
    dataDir: env.store.dataDir,
    workspacePath: path.join(env.root, "another-ws"),
    workspaceName: "demo"
  });
  await rejectsWith(other.init(), "E_WORKSPACE_MISMATCH");
});

test("损坏 JSON → E_STORE_CORRUPT；高版本 schema → E_SCHEMA_VERSION", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());
  await env.store.init();

  await fs.writeFile(env.store.treePath, "{ not json", "utf8");
  await rejectsWith(env.store.readTree(), "E_STORE_CORRUPT");

  await fs.writeFile(
    env.store.treePath,
    JSON.stringify({ schema: 99, root: { id: "ROOT", kind: "project", children: [] } }),
    "utf8"
  );
  await rejectsWith(env.store.readTree(), "E_SCHEMA_VERSION");
});

test("原子写：写入后没有临时文件残留", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());
  await env.store.init();
  const tree = await env.store.readTree();
  await env.store.writeTree(tree);
  const entries = await fs.readdir(path.dirname(env.store.treePath));
  assert.equal(entries.filter((name) => name.includes(".tmp-")).length, 0);
});

test("详情与备注物理分离，互不覆盖", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());
  await env.store.init();

  await env.store.writeDetail("R-001-T-1", "AI 写栏内容");
  await env.store.writeNote("R-001-T-1", "用户备注内容");

  assert.equal(await env.store.readDetail("R-001-T-1"), "AI 写栏内容");
  assert.equal(await env.store.readNote("R-001-T-1"), "用户备注内容");

  await env.store.writeNote("R-001-T-1", "改过的备注");
  assert.equal(await env.store.readDetail("R-001-T-1"), "AI 写栏内容");
  assert.equal(await env.store.readNote("R-001-T-1"), "改过的备注");
});

test("非法 id 不得拼进文件路径（防穿越）", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());
  await env.store.init();
  assert.throws(() => env.store.detailPath("../../etc/passwd"), (err) => err.code === "E_PATH_INVALID");
});

test("一致性自检：基线需求与任务树需求节点对齐", async (t) => {
  const env = await makeEnv();
  t.after(() => env.cleanup());
  await env.store.init();

  const ok = await env.store.verifyConsistency();
  assert.deepEqual(ok, { ok: true, missingInTree: [], missingInBaseline: [] });

  const baseline = await env.store.readBaseline();
  baseline.model.requirements.push({
    id: "R-002",
    title: "幽灵需求",
    surface: "只在基线里",
    versions: [
      {
        version: "v1",
        at: "2026-11-11T14:31:07.000Z",
        summary: "只在基线里",
        original: "",
        originalLock: false,
        msg: null
      }
    ]
  });
  await env.store.writeBaseline(baseline.model);

  const bad = await env.store.verifyConsistency();
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missingInTree, ["R-002"]);
});
