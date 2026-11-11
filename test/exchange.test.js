/**
 * 导出 / 导入（B-41 / A15）测试：包格式、校验、roundtrip、空板约束、失败回滚。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  BUNDLE_FORMAT,
  buildBundle,
  importBundle,
  summarizeBundle,
  validateBundle
} from "../src/core/exchange.js";
import { Store } from "../src/core/store.js";
import { createCompass } from "../src/core/tools.js";
import { makeEnv, rejectsWith } from "./helpers.js";

const FIXED_NOW = () => new Date("2026-11-11T12:00:00.000Z");

/**
 * 在 env 里造一块有内容的板：1 需求 + 2 任务（一个带详情、一个带备注、一个带废弃原因）。
 * @param {Awaited<ReturnType<typeof makeEnv>>} env
 */
async function seedBoard(env) {
  await env.compass.init();
  await env.compass.require({ title: "导出需求", human_line: "导出这块板", surface: "导出这块板" });
  await env.compass.plan({ parent_id: "R-001", title: "任务一", human_line: "任务一", detail: "任务一的 AI 详情\n第二行" });
  await env.compass.plan({ parent_id: "R-001", title: "任务二", human_line: "任务二" });
  await env.store.writeNote("R-001-T-2", "用户的备注：注意这点");
  await env.compass.update({
    task_ids: ["R-001-T-2"],
    verdict_state: "待裁决",
    pointer_note: "与老需求撞车"
  });
}

/** @param {any} bundle */
async function assertBundleShape(bundle) {
  assert.equal(bundle.format, BUNDLE_FORMAT);
  assert.equal(bundle.schema, 1);
  assert.equal(typeof bundle.exported_at, "string");
  assert.equal(bundle.tree.root.children.length, 1);
  assert.equal(bundle.tree.root.children[0].children.length, 2);
  assert.equal(typeof bundle.baseline.raw, "string");
  assert.ok(bundle.baseline.raw.includes("导出需求"));
  assert.equal(bundle.details["R-001-T-1"].md, "任务一的 AI 详情\n第二行");
  assert.equal(bundle.details["R-001-T-2"].note, "用户的备注：注意这点");
  assert.equal(bundle.details["R-001"], undefined, "没有详情/备注的节点不出现在 details");
}

test("导出：包结构完整（树/基线原文/详情/备注），且不修改任何数据", async () => {
  const env = await makeEnv();
  try {
    await seedBoard(env);
    const treeBefore = JSON.stringify(await env.store.readTree());
    const baselineBefore = (await env.store.readBaseline()).raw;
    const bundle = await buildBundle(env.store, { now: FIXED_NOW });
    await assertBundleShape(bundle);
    assert.equal(bundle.exported_at, "2026-11-11T12:00:00.000Z");
    assert.equal(bundle.workspace.workspace_id, env.store.workspaceId);
    assert.equal(bundle.workspace.original_path, env.store.workspacePath);
    assert.equal(JSON.stringify(await env.store.readTree()), treeBefore, "导出不得修改树");
    assert.equal((await env.store.readBaseline()).raw, baselineBefore, "导出不得修改基线");
  } finally {
    await env.cleanup();
  }
});

test("导入：roundtrip 逐字还原（树/基线原文/详情/备注）", async () => {
  const source = await makeEnv();
  const target = await makeEnv();
  try {
    await seedBoard(source);
    const bundle = await buildBundle(source.store, { now: FIXED_NOW });
    const sourceTree = await source.store.readTree();
    const sourceBaseline = (await source.store.readBaseline()).raw;

    const result = await importBundle(target.store, bundle, { confirm: "IMPORT" });
    assert.equal(result.imported.nodes, 3);
    assert.equal(result.imported.details, 2);
    assert.equal(result.imported.baseline_requirements, 1);

    const targetTree = await target.store.readTree();
    assert.deepEqual(targetTree, sourceTree, "树必须逐字段一致");
    assert.equal((await target.store.readBaseline()).raw, sourceBaseline, "基线原文必须逐字一致");
    assert.equal(await target.store.readDetail("R-001-T-1"), "任务一的 AI 详情\n第二行");
    assert.equal(await target.store.readNote("R-001-T-2"), "用户的备注：注意这点");
    const meta = await target.store.readMeta();
    assert.equal(meta.original_path, target.store.workspacePath, "导入后 meta 的 original_path 指向目标工作区");
    assert.equal(meta.imported_from.workspace_id, source.store.workspaceId);
    assert.equal(meta.imported_from.exported_at, "2026-11-11T12:00:00.000Z");
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test("导入：目标板非空拒绝（不半覆盖），空板（init 过但无节点）允许", async () => {
  const source = await makeEnv();
  const nonEmpty = await makeEnv();
  const emptyInitialized = await makeEnv();
  try {
    await seedBoard(source);
    const bundle = await buildBundle(source.store, { now: FIXED_NOW });

    await seedBoard(nonEmpty);
    const err = await rejectsWith(importBundle(nonEmpty.store, bundle, { confirm: "IMPORT" }), "E_INVALID_ARG");
    assert.match(err.message, /非空/);
    const tree = await nonEmpty.store.readTree();
    assert.equal(tree.root.children[0].title, "导出需求", "非空板必须保持原样（此例内容相同，但不得半覆盖）");

    await emptyInitialized.compass.init();
    const result = await importBundle(emptyInitialized.store, bundle, { confirm: "IMPORT" });
    assert.equal(result.imported.nodes, 3);
  } finally {
    await source.cleanup();
    await nonEmpty.cleanup();
    await emptyInitialized.cleanup();
  }
});

test("导入：confirm 缺失 / format 不匹配 / schema 过高 / 树非法 拒绝", async () => {
  const source = await makeEnv();
  const target = await makeEnv();
  try {
    await seedBoard(source);
    const bundle = await buildBundle(source.store, { now: FIXED_NOW });
    await rejectsWith(importBundle(target.store, bundle, {}), "E_INVALID_ARG");
    await rejectsWith(importBundle(target.store, { ...bundle, format: "other" }, { confirm: "IMPORT" }), "E_INVALID_ARG");
    await rejectsWith(importBundle(target.store, { ...bundle, schema: 2 }, { confirm: "IMPORT" }), "E_SCHEMA_VERSION");
    await rejectsWith(importBundle(target.store, { ...bundle, tree: { root: {} } }, { confirm: "IMPORT" }), "E_STORE_CORRUPT");
    assert.equal(await target.store.exists(), false, "非法导入不得创建数据目录");
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test("导入：details id 不在树中 / 需求集合与基线不一致 拒绝", async () => {
  const source = await makeEnv();
  const target = await makeEnv();
  try {
    await seedBoard(source);
    const bundle = await buildBundle(source.store, { now: FIXED_NOW });
    const extraDetail = { ...bundle, details: { ...bundle.details, "R-001-T-9": { md: "x", note: "" } } };
    await rejectsWith(importBundle(target.store, extraDetail, { confirm: "IMPORT" }), "E_STORE_CORRUPT");

    const inconsistent = structuredClone(bundle);
    inconsistent.tree.root.children.push({
      id: "R-002",
      kind: "requirement",
      title: "多的需求",
      human_line: "多的需求",
      exec_state: "未开始",
      verdict_state: null,
      dead_reason: null,
      merged_into: null,
      pointers: [],
      children: []
    });
    await rejectsWith(importBundle(target.store, inconsistent, { confirm: "IMPORT" }), "E_STORE_CORRUPT");
    assert.equal(await target.store.exists(), false, "校验失败不得留下数据");
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test("导入：写入中途失败回滚（未初始化目标 ⇒ 数据目录删除）", async () => {
  const source = await makeEnv();
  const target = await makeEnv();
  try {
    await seedBoard(source);
    const bundle = await buildBundle(source.store, { now: FIXED_NOW });
    const original = target.store.writeDetail.bind(target.store);
    let calls = 0;
    target.store.writeDetail = async (id, content) => {
      calls += 1;
      if (calls === 1) throw new Error("模拟写详情失败");
      return original(id, content);
    };
    await assert.rejects(importBundle(target.store, bundle, { confirm: "IMPORT" }), /模拟写详情失败/);
    assert.equal(await target.store.exists(), false, "回滚后不得留下半套数据");
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test("导入：写入中途失败回滚（空板目标 ⇒ 恢复空树/空基线）", async () => {
  const source = await makeEnv();
  const target = await makeEnv();
  try {
    await seedBoard(source);
    const bundle = await buildBundle(source.store, { now: FIXED_NOW });
    await target.compass.init();
    target.store.writeDetail = async () => {
      throw new Error("模拟写详情失败");
    };
    await assert.rejects(importBundle(target.store, bundle, { confirm: "IMPORT" }), /模拟写详情失败/);
    const tree = await target.store.readTree();
    assert.deepEqual(tree.root.children, [], "回滚后树必须为空");
    const { model } = await target.store.readBaseline();
    assert.deepEqual(model.requirements, [], "回滚后基线必须为空");
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test("validateBundle / summarizeBundle：纯函数口径", async () => {
  const env = await makeEnv();
  try {
    await seedBoard(env);
    const bundle = await buildBundle(env.store, { now: FIXED_NOW });
    const summary = summarizeBundle(bundle);
    assert.equal(summary.nodes, 3);
    assert.equal(summary.requirements, 1);
    assert.equal(summary.details, 2);
    assert.equal(summary.workspace_name, "demo");
    const normalized = validateBundle(bundle);
    assert.equal(normalized.tree.root.children.length, 1);
    assert.equal(normalized.baseline.model.requirements.length, 1);
    assert.equal(normalized.details["R-001-T-2"].note, "用户的备注：注意这点");
  } finally {
    await env.cleanup();
  }
});

test("Store.forWorkspace 的锁参数不影响导入（导入整段持锁）", async () => {
  const source = await makeEnv();
  const target = await makeEnv();
  try {
    await seedBoard(source);
    const bundle = await buildBundle(source.store, { now: FIXED_NOW });
    const locked = Store.forWorkspace({
      storageRoot: target.storageRoot,
      workspacePath: target.workspace,
      workspaceName: "demo",
      lock: { staleMs: 500, heartbeatMs: 100, acquireTimeoutMs: 1_000, retryMs: 10 }
    });
    const result = await importBundle(locked, bundle, { confirm: "IMPORT" });
    assert.equal(result.imported.nodes, 3);
    // 锁已释放
    await fs.access(locked.dataDir);
    const again = await importBundle(
      Store.forWorkspace({ storageRoot: target.storageRoot, workspacePath: target.workspace, workspaceName: "demo" }),
      bundle,
      { confirm: "IMPORT" }
    ).then(
      () => null,
      (err) => err
    );
    assert.equal(again?.code, "E_INVALID_ARG", "目标板已非空，二次导入必须被拒绝");
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});
