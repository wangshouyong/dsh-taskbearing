import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { registerCompassRoutes } from "../src/host/routes.js";
import { resolveWorkspacePath } from "../src/core/paths.js";
import { createCompass } from "../src/core/tools.js";
import { Store } from "../src/core/store.js";
import { buildRuleBlock, RULE_BEGIN } from "../src/host/rules.js";
import { workspaceSessionKey } from "../src/host/history.js";

const SUMMARY_DETAIL = "验收范围：该节点下全部任务与验收项\n完成结论：已完成并留证据\n遗留风险：无";

const LOG_SESSION = "session-0123abcd-1111-2222-3333-444455556666";

async function makeEnv(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-routes-"));
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const storageRoot = path.join(root, "storages");
  const sessionsRoot = path.join(root, "sessions");
  await fs.mkdir(sessionsRoot, { recursive: true });
  const captured = { spec: null };
  const ctx = {
    webServer: {
      register(spec) {
        captured.spec = spec;
        return () => {};
      }
    }
  };
  const rulesPath = path.join(root, "AGENTS.md");
  await fs.writeFile(rulesPath, `# 用户指令\n\n${buildRuleBlock()}\n\n用户自己的内容\n`, "utf8");
  const dispose = registerCompassRoutes(ctx.webServer, { storageRoot, pluginVersion: "0.1.0", rulesPath, sessionsRoot });
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
    return { status: res.status, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
  };

  return { root, workspace, storageRoot, sessionsRoot, rulesPath, call };
}

/** 写一份真实格式（zstd 帧）的会话日志：第 3 轮未结束。 */
async function writeSessionLog(sessionsRoot, workspace, sessionId) {
  const dir = path.join(sessionsRoot, workspaceSessionKey(workspace), sessionId);
  await fs.mkdir(dir, { recursive: true });
  const time = Date.parse("2026-11-11T08:49:25.604Z");
  const events = [
    { type: "turn/start", data: { turn: 1 }, time: time - 3_600_000 },
    { type: "turn/end", data: { turn: 1 }, time: time - 3_000_000 },
    { type: "turn/start", data: { turn: 2 }, time: time - 2_000_000 },
    { type: "turn/end", data: { turn: 2 }, time: time - 1_000_000 },
    { type: "turn/start", data: { turn: 3 }, time }
  ];
  await fs.writeFile(
    path.join(dir, "session.v4.jsonl.zstd"),
    zlib.zstdCompressSync(Buffer.from(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8"))
  );
}

async function seed(storageRoot, workspace) {
  const store = Store.forWorkspace({ storageRoot, workspacePath: workspace });
  const compass = createCompass({ store, sessionId: "s-1" });
  await compass.init();
  await compass.require({ title: "需求一", human_line: "做需求一", surface: "做需求一" });
  await compass.plan({ parent_id: "R-001", title: "任务A", human_line: "做任务A" });
  return { store, compass };
}

test("POST /file-exists：文件/目录/缺失/越界拒绝，只读（B-56/A39）", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  await fs.mkdir(path.join(env.workspace, "sub"));
  await fs.writeFile(path.join(env.workspace, "a.ts"), "export {};", "utf8");

  const res = await env.call("POST", "/api/compass/file-exists", {
    cwd: env.workspace,
    paths: ["a.ts", "sub", "missing.ts", "../escape.ts", ""]
  });
  assert.equal(res.status, 200);
  const byPath = Object.fromEntries(res.body.results.map((item) => [item.path, item]));
  assert.deepEqual({ exists: byPath["a.ts"].exists, kind: byPath["a.ts"].kind }, { exists: true, kind: "file" });
  assert.deepEqual({ exists: byPath.sub.exists, kind: byPath.sub.kind }, { exists: true, kind: "directory" });
  assert.deepEqual({ exists: byPath["missing.ts"].exists, kind: byPath["missing.ts"].kind }, { exists: false, kind: "missing" });
  assert.equal(byPath["../escape.ts"].kind, "unknown", "相对路径越界不检测");
  assert.equal(byPath[""].kind, "unknown", "空路径 unknown");

  const abs = await env.call("POST", "/api/compass/file-exists", {
    cwd: env.workspace,
    paths: [path.join(env.workspace, "a.ts")]
  });
  assert.equal(abs.body.results[0].exists, true, "绝对路径可用");

  const tooMany = await env.call("POST", "/api/compass/file-exists", {
    cwd: env.workspace,
    paths: Array.from({ length: 51 }, (_, index) => `f-${index}.ts`)
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error.code, "E_INVALID_ARG");

  // 只读：检测不产生任何文件
  const before = (await fs.readdir(env.workspace)).sort();
  await env.call("POST", "/api/compass/file-exists", { cwd: env.workspace, paths: ["a.ts", "missing.ts"] });
  const after = (await fs.readdir(env.workspace)).sort();
  assert.deepEqual(after, before);
});

test("注册前缀路由；/current 需要绝对路径 cwd", async (t) => {
  const env = await makeEnv(t);
  const bad = await env.call("GET", "/api/compass/current?cwd=relative/path");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "E_INVALID_ARG");

  const ok = await env.call("GET", `/api/compass/current?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.initialized, false);
  assert.equal(ok.body.cwd, resolveWorkspacePath(env.workspace), "cwd 应为规范化后的工作区路径（realpath + 正斜杠）");

  await seed(env.storageRoot, env.workspace);
  const after = await env.call("GET", `/api/compass/current?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(after.body.initialized, true);
  assert.equal(after.body.dataDir.includes("storages"), true);
});

test("/tree 返回整树；ifmtime 命中返回 changed:false", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);

  const first = await env.call("GET", `/api/compass/tree?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.changed, true);
  assert.equal(first.body.tree.root.children.length, 1);
  const mtime = first.body.mtimeMs;

  const second = await env.call("GET", `/api/compass/tree?cwd=${encodeURIComponent(env.workspace)}&ifmtime=${mtime}`);
  assert.equal(second.status, 200);
  assert.equal(second.body.changed, false);
});

test("/detail 返回 AI 详情与备注；/note 只写备注（不碰 AI 栏）", async (t) => {
  const env = await makeEnv(t);
  const { compass } = await seed(env.storageRoot, env.workspace);
  await compass.update({ task_ids: ["R-001-T-1"], detail: "AI 详情内容", details: { "R-001": SUMMARY_DETAIL }, pointer_note: "补详情" });

  const detail = await env.call("GET", `/api/compass/detail?cwd=${encodeURIComponent(env.workspace)}&id=R-001-T-1`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.detail, "AI 详情内容");

  const save = await env.call("POST", "/api/compass/note", { cwd: env.workspace, id: "R-001-T-1", content: "用户备注" });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const after = await env.call("GET", `/api/compass/detail?cwd=${encodeURIComponent(env.workspace)}&id=R-001-T-1`);
  assert.equal(after.body.detail, "AI 详情内容");
  assert.equal(after.body.note, "用户备注");

  const bad = await env.call("POST", "/api/compass/note", { cwd: env.workspace, id: "../etc", content: "x" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "E_PATH_INVALID");
});

test("/ui-state 与 /prefs：读写与校验", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);

  const initial = await env.call("GET", `/api/compass/ui-state?cwd=${encodeURIComponent(env.workspace)}`);
  assert.deepEqual(initial.body, { expanded: {}, rememberExpand: false });

  const put = await env.call("PUT", "/api/compass/ui-state", { cwd: env.workspace, expanded: { "R-001": true }, rememberExpand: true });
  assert.equal(put.status, 200);
  const after = await env.call("GET", `/api/compass/ui-state?cwd=${encodeURIComponent(env.workspace)}`);
  assert.deepEqual(after.body, { expanded: { "R-001": true }, rememberExpand: true });

  const prefs0 = await env.call("GET", "/api/compass/prefs");
  assert.deepEqual(prefs0.body, { view: "current" });
  const putP = await env.call("PUT", "/api/compass/prefs", { view: "active" });
  assert.equal(putP.status, 200);
  const prefs1 = await env.call("GET", "/api/compass/prefs");
  assert.deepEqual(prefs1.body, { view: "active" });

  const bad = await env.call("PUT", "/api/compass/prefs", { view: "nope" });
  assert.equal(bad.status, 400);
});

test("/baseline 返回需求明面与原话锁定状态", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  const res = await env.call("GET", `/api/compass/baseline?cwd=${encodeURIComponent(env.workspace)}&id=R-001`);
  assert.equal(res.status, 200);
  assert.equal(res.body.id, "R-001");
  assert.equal(res.body.surface, "做需求一");
  assert.equal(res.body.originalLock, false);

  const missing = await env.call("GET", `/api/compass/baseline?cwd=${encodeURIComponent(env.workspace)}&id=R-404`);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "E_REQUIREMENT_NOT_FOUND");
});

test("未初始化：/tree 返回 404（E_NOT_INITIALIZED），不静默", async (t) => {
  const env = await makeEnv(t);
  const res = await env.call("GET", `/api/compass/tree?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "E_NOT_INITIALIZED");
});

test("/history-summary：只读历史会话摘要（无会话/多会话/跨工作区/未初始化可用）（B-63）", async (t) => {
  const env = await makeEnv(t);
  const url = `/api/compass/history-summary?cwd=${encodeURIComponent(env.workspace)}`;

  // 未初始化也能用（这是空态判断的输入，不依赖任务板）
  const empty = await env.call("GET", url);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { available: true, sessions: 0, latest_at: null, truncated: false });

  const sidA = "session-aaaaaaaa-1111-2222-3333-444455556666";
  const sidB = "session-bbbbbbbb-1111-2222-3333-444455556666";
  await writeSessionLog(env.sessionsRoot, env.workspace, sidA);
  await writeSessionLog(env.sessionsRoot, env.workspace, sidB);
  const workDir = path.join(env.sessionsRoot, workspaceSessionKey(env.workspace));
  const beforeMtimes = {};
  for (const sid of [sidA, sidB]) {
    beforeMtimes[sid] = (await fs.stat(path.join(workDir, sid, "session.v4.jsonl.zstd"))).mtimeMs;
  }

  const two = await env.call("GET", url);
  assert.equal(two.status, 200);
  assert.equal(two.body.sessions, 2);
  assert.equal(typeof two.body.latest_at, "string");
  assert.equal(two.body.truncated, false);

  // 只读：不产生/不修改任何会话文件
  for (const sid of [sidA, sidB]) {
    const after = (await fs.stat(path.join(workDir, sid, "session.v4.jsonl.zstd"))).mtimeMs;
    assert.equal(after, beforeMtimes[sid], "会话日志 mtime 不得变化");
  }

  // 其它工作区不计
  const otherWs = path.join(env.root, "ws2");
  await fs.mkdir(otherWs, { recursive: true });
  const other = await env.call("GET", `/api/compass/history-summary?cwd=${encodeURIComponent(otherWs)}`);
  assert.equal(other.body.sessions, 0);

  // 缺少 cwd ⇒ 明确错误，不猜工作区
  const missing = await env.call("GET", "/api/compass/history-summary");
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "E_INVALID_ARG");
});

test("/status 返回板面新鲜度（只读机械计数）", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  const res = await env.call("GET", `/api/compass/status?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.board_updated_at, "string");
  assert.equal(res.body.turns_since_board_update, 0);
  assert.equal(res.body.tool_calls_since_board_update, 0);
  assert.equal(res.body.suggest, "fresh");
  assert.match(res.body.note, /插件实例启动后/);
});
test("/workspaces 列表：字段、当前标记与孤儿检测（A24）", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  // 孤儿工作区：meta 指向不存在的路径
  const orphanDir = path.join(env.storageRoot, "orphan-1234abcd");
  await fs.mkdir(path.join(orphanDir, "tasks"), { recursive: true });
  await fs.writeFile(path.join(orphanDir, "meta.json"), JSON.stringify({ schema: 1, original_path: "Z:/definitely-missing-workspace", workspace_name: "旧项目" }), "utf8");
  await fs.writeFile(path.join(orphanDir, "tasks", "tree.json"), JSON.stringify({ schema: 1, root: { id: "ROOT", kind: "project", children: [] } }), "utf8");

  const res = await env.call("GET", `/api/compass/workspaces?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 2);
  const current = res.body.workspaces.find((ws) => ws.current);
  assert.ok(current, "应标记当前工作区");
  assert.equal(current.node_count, 2);
  assert.equal(current.orphan, false);
  const orphan = res.body.workspaces.find((ws) => ws.workspace_id === "orphan-1234abcd");
  assert.equal(orphan.orphan, true);
  assert.equal(orphan.exists, false);
  assert.equal(orphan.name, "旧项目");
  assert.equal(orphan.node_count, 0);
});

test("/workspaces/remove：必须二次确认、id 合法、只删 storageRoot 下目录（A24）", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  const list = await env.call("GET", `/api/compass/workspaces?cwd=${encodeURIComponent(env.workspace)}`);
  const id = list.body.workspaces[0].workspace_id;

  const badConfirm = await env.call("POST", "/api/compass/workspaces/remove", { workspace_id: id });
  assert.equal(badConfirm.status, 400);
  const badId = await env.call("POST", "/api/compass/workspaces/remove", { workspace_id: "../etc", confirm: "DELETE" });
  assert.equal(badId.status, 400);
  assert.ok(await fs.stat(path.join(env.storageRoot, id)), "非法请求不得删除目录");

  const ok = await env.call("POST", "/api/compass/workspaces/remove", { workspace_id: id, confirm: "DELETE" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { removed: id });
  await assert.rejects(() => fs.stat(path.join(env.storageRoot, id)), (err) => err.code === "ENOENT");
  const after = await env.call("GET", `/api/compass/workspaces?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(after.body.count, 0);
});

test("/rules/remove：移除规则区块且保留用户内容，重复调用返回 absent（A24）", async (t) => {
  const env = await makeEnv(t);
  const first = await env.call("POST", "/api/compass/rules/remove", {});
  assert.equal(first.status, 200);
  assert.equal(first.body.status, "removed");
  const text = await fs.readFile(env.rulesPath, "utf8");
  assert.equal(text.includes(RULE_BEGIN), false);
  assert.match(text, /用户自己的内容/);
  const second = await env.call("POST", "/api/compass/rules/remove", {});
  assert.equal(second.status, 200);
  assert.equal(second.body.status, "absent");
});
test("/uninstall：强确认、自动清规则区块 + 全部工作区数据（A25）", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  const second = path.join(env.root, "ws-second");
  await fs.mkdir(second, { recursive: true });
  await seed(env.storageRoot, second);

  const bad = await env.call("POST", "/api/compass/uninstall", {});
  assert.equal(bad.status, 400);
  assert.ok(await fs.stat(env.storageRoot), "未确认不得删除任何数据");

  const ok = await env.call("POST", "/api/compass/uninstall", { confirm: "UNINSTALL" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.rules, "removed");
  assert.equal(ok.body.workspaces_removed, 2);
  const remain = await fs.readdir(env.storageRoot).catch(() => []);
  assert.deepEqual(remain, []);
  const text = await fs.readFile(env.rulesPath, "utf8");
  assert.match(text, /用户自己的内容/);
  assert.equal(text.includes(RULE_BEGIN), false);
});

test("/uninstall：规则区块损坏时中止，不删除任何工作区数据（A25）", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  const listBefore = await env.call("GET", `/api/compass/workspaces?cwd=${encodeURIComponent(env.workspace)}`);
  const id = listBefore.body.workspaces[0].workspace_id;
  await fs.writeFile(env.rulesPath, `# 用户指令\n\n${RULE_BEGIN}\n（只有开始没有结束）\n`, "utf8");

  const res = await env.call("POST", "/api/compass/uninstall", { confirm: "UNINSTALL" });
  assert.equal(res.status, 400);
  assert.ok(await fs.stat(path.join(env.storageRoot, id)), "损坏中止后工作区数据必须保留");
});
test("/export：返回 bundle + attachment 头（A15）", async (t) => {
  const env = await makeEnv(t);
  const { store } = await seed(env.storageRoot, env.workspace);
  await store.writeDetail("R-001-T-1", "任务A详情");
  await store.writeNote("R-001-T-1", "备注A");

  const res = await env.call("GET", `/api/compass/export?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.format, "dsh-taskboard-bundle");
  assert.equal(res.body.schema, 1);
  assert.equal(res.body.tree.root.children[0].children[0].id, "R-001-T-1");
  assert.equal(res.body.details["R-001-T-1"].md, "任务A详情");
  assert.equal(res.body.details["R-001-T-1"].note, "备注A");
  assert.match(res.headers["content-disposition"], /^attachment; filename=".+\.json"/);
});

test("/import：空板导入 roundtrip；非空拒绝；confirm 缺失拒绝（A15）", async (t) => {
  const env = await makeEnv(t);
  const { store } = await seed(env.storageRoot, env.workspace);
  await store.writeDetail("R-001-T-1", "任务A详情");
  const exported = await env.call("GET", `/api/compass/export?cwd=${encodeURIComponent(env.workspace)}`);
  const bundle = exported.body;

  const target = path.join(env.root, "ws-import");
  await fs.mkdir(target, { recursive: true });
  const bad = await env.call("POST", "/api/compass/import", { cwd: target, bundle });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "E_INVALID_ARG");

  const ok = await env.call("POST", "/api/compass/import", { cwd: target, bundle, confirm: "IMPORT" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.imported.nodes, 2);
  assert.equal(ok.body.imported.details, 1);

  const tree = await env.call("GET", `/api/compass/tree?cwd=${encodeURIComponent(target)}`);
  assert.equal(tree.status, 200);
  assert.equal(tree.body.tree.root.children[0].children[0].id, "R-001-T-1");
  const detail = await env.call(
    "GET",
    `/api/compass/detail?cwd=${encodeURIComponent(target)}&id=R-001-T-1`
  );
  assert.equal(detail.body.detail, "任务A详情");

  const again = await env.call("POST", "/api/compass/import", { cwd: target, bundle, confirm: "IMPORT" });
  assert.equal(again.status, 400);
  assert.equal(again.body.error.code, "E_INVALID_ARG");
  assert.match(again.body.error.message, /非空/);
});

test("/import：schema 过高拒绝（A15）", async (t) => {
  const env = await makeEnv(t);
  await seed(env.storageRoot, env.workspace);
  const exported = await env.call("GET", `/api/compass/export?cwd=${encodeURIComponent(env.workspace)}`);
  const target = path.join(env.root, "ws-import-2");
  await fs.mkdir(target, { recursive: true });
  const res = await env.call("POST", "/api/compass/import", {
    cwd: target,
    bundle: { ...exported.body, schema: 2 },
    confirm: "IMPORT"
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "E_SCHEMA_VERSION");
});

test("/workspaces：总览 summary（需求数/状态分布/当前）与倒序（A14）", async (t) => {
  const env = await makeEnv(t);
  const { store, compass } = await seed(env.storageRoot, env.workspace);
  await compass.update({ task_ids: ["R-001-T-1"], exec_state: "进行中", pointer_note: "开工" });
  await store.writeDetail("R-001", "需求详情");
  const second = path.join(env.root, "ws-overview");
  await fs.mkdir(second, { recursive: true });
  await seed(env.storageRoot, second);

  const res = await env.call("GET", `/api/compass/workspaces?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.workspaces.length, 2);
  const current = res.body.workspaces.find((ws) => ws.current);
  assert.ok(current, "必须标出当前工作区");
  assert.equal(current.requirement_count, 1);
  // 需求层状态由子任务聚合（v1.28）：任务进行中 ⇒ 需求行也为进行中，节点计数因此为 2
  assert.equal(current.exec.doing, 2);
  assert.equal(current.node_count, 2);
  for (const ws of res.body.workspaces) {
    assert.equal(typeof ws.requirement_count, "number");
    assert.equal(typeof ws.exec.doing, "number");
    assert.equal(typeof ws.verdict.pending, "number");
    assert.equal(typeof ws.updated_at, "string");
  }
  const times = res.body.workspaces.map((ws) => ws.updated_at);
  assert.deepEqual(times, [...times].sort().reverse(), "按更新时间倒序");
});

test("/note：只写备注文件，不再记录变更事件；/changelog 已移除（v1.24，B-46 废止）", async (t) => {
  const env = await makeEnv(t);
  const { store } = await seed(env.storageRoot, env.workspace);

  const saved = await env.call("POST", "/api/compass/note", {
    cwd: env.workspace,
    id: "R-001-T-1",
    content: "用户备注内容",
    sessionId: "session-a"
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.event_log, undefined, "不再返回事件日志状态");
  const note = await fs.readFile(store.notePath("R-001-T-1"), "utf8");
  assert.equal(note, "用户备注内容");
  await assert.rejects(() => fs.stat(path.join(store.dataDir, "events.jsonl")), "不创建 events.jsonl");

  const changelog = await env.call("GET", `/api/compass/changelog?cwd=${encodeURIComponent(env.workspace)}`);
  assert.equal(changelog.status, 404);
  assert.equal(changelog.body.error.code, "E_NOT_FOUND");
});
