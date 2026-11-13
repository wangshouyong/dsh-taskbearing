import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { registerCompassRoutes } from "../src/host/routes.js";
import { Store } from "../src/core/store.js";
import { createCompass } from "../src/core/tools.js";
import { findNode } from "../src/core/tree.js";

/**
 * 路由测试环境：临时 storage + 临时工作区 + 真实 handler 调用（与 routes.test.js 同款）。
 * @param {import("node:test").TestContext} t
 */
async function makeEnv(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-trash-routes-"));
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const storageRoot = path.join(root, "storages");
  const captured = { spec: null };
  const dispose = registerCompassRoutes(
    {
      register(spec) {
        captured.spec = spec;
        return () => {};
      }
    },
    { storageRoot, pluginVersion: "0.1.33" }
  );
  t.after(async () => {
    dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  const handler = captured.spec.handler;
  const call = async (method, url, body) => {
    const req = { url: `http://localhost${url}`, method, body };
    const res = {
      status: 0,
      body: "",
      headers: {},
      writeHead(code, headers) {
        this.status = code;
        this.headers = headers ?? {};
      },
      end(data) {
        this.body = String(data ?? "");
      }
    };
    await handler(req, res);
    return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
  };

  const store = Store.forWorkspace({ storageRoot, workspacePath: workspace });
  const compass = createCompass({ store, sessionId: "s-test", turn: 3, now: () => new Date("2026-11-12T12:00:00.000Z") });
  return { root, workspace, storageRoot, store, compass, call };
}

/** 建需求 + 2 任务 + 1 步骤，并给任务写详情与备注（覆盖 purge 删除文件的分支）。 */
async function seed(env) {
  const { compass, store } = env;
  await compass.init();
  const requirement = await compass.require({ title: "需求A", human_line: "一次性咨询混进清单", surface: "回收站需求" });
  const task1 = await compass.plan({ parent_id: requirement.requirement_id, title: "任务1", human_line: "要改的东西" });
  const task2 = await compass.plan({ parent_id: requirement.requirement_id, title: "任务2", human_line: "另一件事" });
  const step = await compass.plan({ parent_id: task1.task_id, title: "步骤1", human_line: "细节步骤" });
  await store.writeDetail(task1.task_id, "核心文件：无\n契约：无\n避坑指南：无");
  await store.writeNote(task1.task_id, "面板备注");
  return { requirementId: requirement.requirement_id, task1: task1.task_id, task2: task2.task_id, step: step.task_id };
}

test("POST /discard：打删除标记，GET /tree 带出 trashedAt（v1.33）", async (t) => {
  const env = await makeEnv(t);
  const ids = await seed(env);

  const res = await env.call("POST", "/api/compass/discard", { cwd: env.workspace, ids: [ids.task1] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.discarded, [ids.task1]);
  assert.equal(res.body.trash_count, 1);
  assert.match(res.body.at, /^\d{4}-\d{2}-\d{2}T/);

  const tree = await env.call("GET", `/api/compass/tree?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(tree.status, 200);
  const node = findNode(tree.body.tree, ids.task1);
  assert.ok(node.trashedAt, "面板需要拿到标记来渲染回收站");
  assert.equal(node.exec_state, "未开始");
});

test("POST /discard：非法入参与不存在的节点（v1.33）", async (t) => {
  const env = await makeEnv(t);
  await seed(env);
  const empty = await env.call("POST", "/api/compass/discard", { cwd: env.workspace, ids: [] });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.code, "E_INVALID_ARG");
  const missing = await env.call("POST", "/api/compass/discard", { cwd: env.workspace, ids: ["R-999-T-1"] });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "E_TASK_NOT_FOUND");
});

test("POST /restore：还原后标记消失、trash_count 归零（v1.33）", async (t) => {
  const env = await makeEnv(t);
  const ids = await seed(env);
  await env.call("POST", "/api/compass/discard", { cwd: env.workspace, ids: [ids.task1] });
  const res = await env.call("POST", "/api/compass/restore", { cwd: env.workspace, ids: [ids.task1] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.restored, [ids.task1]);
  assert.equal(res.body.trash_count, 0);
  const tree = await env.store.readTree();
  assert.equal(findNode(tree, ids.task1).trashedAt, undefined);
});

test("POST /purge：缺二次确认 / 需求层 / 未丢弃 ⇒ 拒绝（v1.33）", async (t) => {
  const env = await makeEnv(t);
  const ids = await seed(env);

  await env.call("POST", "/api/compass/discard", { cwd: env.workspace, ids: [ids.task1, ids.requirementId] });
  const noConfirm = await env.call("POST", "/api/compass/purge", { cwd: env.workspace, id: ids.task1 });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error.code, "E_INVALID_ARG");

  const requirement = await env.call("POST", "/api/compass/purge", {
    cwd: env.workspace,
    id: ids.requirementId,
    confirm: "DELETE"
  });
  assert.equal(requirement.status, 400);
  assert.equal(requirement.body.error.code, "E_PURGE_FORBIDDEN");

  const notTrashed = await env.call("POST", "/api/compass/purge", {
    cwd: env.workspace,
    id: ids.task2,
    confirm: "DELETE"
  });
  assert.equal(notTrashed.status, 400);
  assert.equal(notTrashed.body.error.code, "E_TRASH_NOT_FOUND");
});

test("POST /purge：备份到 data/trash、删子树与详情/备注文件、树里不再出现（v1.33）", async (t) => {
  const env = await makeEnv(t);
  const ids = await seed(env);
  await env.call("POST", "/api/compass/discard", { cwd: env.workspace, ids: [ids.task1] });

  const res = await env.call("POST", "/api/compass/purge", {
    cwd: env.workspace,
    id: ids.task1,
    confirm: "DELETE"
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.purged, ids.task1);
  assert.equal(res.body.descendants, 1, "连带删除 1 个后代（步骤）");
  assert.match(res.body.backup, /^trash\//);
  assert.equal(res.body.trash_count, 0);

  const backupFile = path.join(env.store.dataDir, res.body.backup);
  const backup = JSON.parse(await fs.readFile(backupFile, "utf8"));
  assert.equal(backup.format, "dsh-taskboard-trash");
  assert.equal(backup.root_id, ids.task1);
  assert.deepEqual(backup.ids.sort(), [ids.task1, ids.step].sort());
  assert.equal(backup.details[ids.task1].md.includes("核心文件"), true, "备份里带详情原文");
  assert.equal(backup.details[ids.task1].note, "面板备注");

  const tree = await env.store.readTree();
  assert.equal(findNode(tree, ids.task1), null);
  assert.equal(findNode(tree, ids.step), null, "后代一起物理删除");
  assert.ok(findNode(tree, ids.task2), "兄弟节点不受影响");

  const detailFile = env.store.detailPath(ids.task1);
  const noteFile = env.store.notePath(ids.task1);
  await assert.rejects(fs.access(detailFile), /ENOENT/);
  await assert.rejects(fs.access(noteFile), /ENOENT/);
});
