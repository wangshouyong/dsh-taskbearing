import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { apply, compassFromExec, createToolDefinitions } from "../src/host/index.js";
import { workspaceSessionKey } from "../src/host/history.js";
import { RULE_BEGIN } from "../src/host/rules.js";
import { TurnTracker } from "../src/host/turn.js";

const REMINDER = "<system-reminder>技能清单注入块</system-reminder>";

/** 造一个假宿主上下文与一段会话。 */
async function makeHost(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-host-"));
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const home = path.join(root, "home");
  process.env.DSH_COMPASS_HOME = home;

  const messages = [
    { role: "system", content: "系统提示" },
    { role: "user", content: `${REMINDER}\n把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏` },
    { role: "assistant", content: "收到" },
    { role: "user", content: "另外矩形也要能拖" }
  ];
  const exec = { agent: { session: { header: { id: "sess-1", cwd: workspace }, deriveMessages: () => messages } } };

  /** @type {Map<string, any>} */
  const registered = new Map();
  /** @type {Map<string, Function>} */
  const handlers = new Map();
  const ctx = {
    tools: { register(def) { registered.set(def.name, def); } },
    on(name, fn) { handlers.set(name, fn); }
  };
  apply(ctx);

  t.after(async () => {
    delete process.env.DSH_COMPASS_HOME;
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, workspace, home, messages, exec, registered, handlers };
}

/** @param {any} result */
function parseResult(result) {
  assert.equal(typeof result?.text, "string");
  return JSON.parse(result.text);
}

test("apply：注册十一个工具并订阅 session/event", async (t) => {
  const host = await makeHost(t);
  assert.deepEqual([...host.registered.keys()].sort(), [
    "compass_change",
    "compass_import",
    "compass_init",
    "compass_merge",
    "compass_migrate",
    "compass_move",
    "compass_plan",
    "compass_read",
    "compass_require",
    "compass_status",
    "compass_update"
  ]);
  assert.equal(typeof host.handlers.get("session/event"), "function");
  assert.equal(typeof host.handlers.get("session/disposed"), "function");
});

test("init → require → plan → update → read：宿主端到端（假 exec）", async (t) => {
  const host = await makeHost(t);
  // 先发一条 turn/start，验证轮次注入
  host.handlers.get("session/event")({ header: { id: "sess-1" } }, { type: "turn/start", data: { turn: 3 } });

  const init = parseResult(await host.registered.get("compass_init").execute({}, host.exec));
  assert.equal(init.created, true);
  assert.equal(init.rule_block, "installed");
  const agentsMd = await fs.readFile(path.join(host.home, "AGENTS.md"), "utf8");
  assert.ok(agentsMd.includes(RULE_BEGIN));
  const dataDir = init.data_dir;
  assert.ok(dataDir.startsWith(path.join(host.home, "storages", "compass")));

  const requirement = parseResult(
    await host.registered.get("compass_require").execute(
      {
        title: "PPT 矢量转可拖顶点形状",
        human_line: "把 PPT 里的图变成能拖顶点的形状",
        surface: "把 PPT 里的图变成能拖顶点的形状"
      },
      host.exec
    )
  );
  assert.equal(requirement.requirement_id, "R-001");
  assert.equal(requirement.original_locked, true);

  // 原话：剥离注入块后的最后一条用户消息
  const baseline = parseResult(await host.registered.get("compass_read").execute({ scope: "baseline" }, host.exec));
  assert.equal(baseline.requirements[0].versions[0].original, "另外矩形也要能拖");

  const task = parseResult(
    await host.registered.get("compass_plan").execute(
      { parent_id: "R-001", title: "曲线能拖控制点", human_line: "让曲线也能拖控制点" },
      host.exec
    )
  );
  assert.equal(task.task_id, "R-001-T-1");

  const updated = parseResult(
    await host.registered.get("compass_update").execute(
      { task_ids: ["R-001-T-1"], exec_state: "进行中", pointer_note: "开始做" },
      host.exec
    )
  );
  assert.deepEqual(updated.updated, ["R-001-T-1"]);

  const tree = parseResult(await host.registered.get("compass_read").execute({ scope: "tree" }, host.exec));
  const node = tree.root.children[0].children[0];
  assert.equal(node.exec_state, "进行中");
  assert.equal(node.pointers.at(-1).session, "sess-1");
  assert.equal(node.pointers.at(-1).turn, 3);

  const lite = parseResult(await host.registered.get("compass_read").execute({ scope: "tree-lite" }, host.exec));
  assert.deepEqual(
    lite.map((entry) => entry.id),
    ["R-001", "R-001-T-1"]
  );
});

test("turn 退化（B-61）：没有 turn/start 且没有会话日志 ⇒ 留空，不用注入消息计数猜测", async (t) => {
  const host = await makeHost(t);
  await host.registered.get("compass_init").execute({}, host.exec);
  await host.registered.get("compass_require").execute(
    { title: "需求", human_line: "人话", surface: "明面" },
    host.exec
  );
  const tree = parseResult(await host.registered.get("compass_read").execute({ scope: "tree" }, host.exec));
  assert.equal(tree.root.children[0].pointers[0].turn, undefined, "取不到权威轮次时留空（不写错误的轮次）");
});

test("turn 退化（B-61）：插件中途加载时用会话日志还原当前轮（不再数注入消息）", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-host-turn-log-"));
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const home = path.join(root, "home");
  const fakeDshHome = path.join(root, "dsh");
  const sessionId = "session-0123abcd-1111-2222-3333-444455556666";
  process.env.DSH_COMPASS_HOME = home;
  process.env.DSH_HOME = fakeDshHome;

  // 会话日志：第 1 轮已结束、第 2 轮未结束；另有大量注入 user 消息（旧实现会数成 30+ 轮）
  const logDir = path.join(fakeDshHome, "sessions", workspaceSessionKey(workspace), sessionId);
  await fs.mkdir(logDir, { recursive: true });
  const time = Date.parse("2026-11-11T08:00:00.000Z");
  const events = [
    { type: "turn/start", data: { turn: 1 }, time },
    { type: "turn/end", data: { turn: 1 }, time: time + 60000 },
    { type: "turn/start", data: { turn: 2 }, time: time + 120000 }
  ];
  for (let index = 0; index < 30; index += 1) {
    events.push({
      type: "user/message",
      time: time + 130000 + index,
      data: { source: { kind: "agent-message" }, message: { role: "user", content: `注入消息 ${index}` } }
    });
  }
  const logFile = path.join(logDir, "session.v4.jsonl.zstd");
  await fs.writeFile(logFile, zlib.zstdCompressSync(Buffer.from(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8")));

  const injectedMessages = [{ role: "system", content: "系统提示" }];
  for (let index = 0; index < 30; index += 1) injectedMessages.push({ role: "user", content: `注入消息 ${index}` });
  const exec = {
    agent: { session: { header: { id: sessionId, cwd: workspace }, deriveMessages: () => injectedMessages } }
  };

  /** @type {Map<string, any>} */
  const registered = new Map();
  const ctx = {
    tools: { register(definition) { registered.set(definition.name, definition); } },
    on() {}
  };
  t.after(async () => {
    delete process.env.DSH_COMPASS_HOME;
    delete process.env.DSH_HOME;
    await fs.rm(root, { recursive: true, force: true });
  });
  apply(ctx);

  await registered.get("compass_init").execute({}, exec);
  await registered.get("compass_require").execute({ title: "需求", human_line: "人话", surface: "明面" }, exec);
  const tree = parseResult(await registered.get("compass_read").execute({ scope: "tree" }, exec));
  assert.equal(tree.root.children[0].pointers[0].turn, 2, "以会话日志的当前轮为准（不是 30 条注入消息）");
});

test("工具错误带 E_* 前缀与 code 属性", async (t) => {
  const host = await makeHost(t);
  await host.registered.get("compass_init").execute({}, host.exec);
  await assert.rejects(
    () => host.registered.get("compass_plan").execute({ title: "x", human_line: "y" }, host.exec),
    (err) => {
      assert.equal(err.code, "E_PARENT_REQUIRED");
      assert.match(err.message, /^E_PARENT_REQUIRED: /);
      return true;
    }
  );
});

test("compassFromExec：缺 cwd 时报 E_INVALID_ARG；同一工作区共享 Store 实例", async (t) => {
  const host = await makeHost(t);
  const deps = { turns: new TurnTracker(), stores: new Map() };
  assert.throws(() => compassFromExec({ agent: { session: { header: { id: "s" } } } }, deps), /E_INVALID_ARG/);
  const a = compassFromExec(host.exec, deps);
  const b = compassFromExec(host.exec, deps);
  assert.equal(a.store, b.store);
});

test("createToolDefinitions：可独立构造（不经过 apply）", async (t) => {
  const host = await makeHost(t);
  const defs = createToolDefinitions({ turns: new TurnTracker(), stores: new Map(), rulesPath: path.join(host.home, "AGENTS.md") });
  assert.equal(Object.keys(defs).length, 11);
  const result = parseResult(await defs.compass_init.execute({}, host.exec));
  assert.equal(result.created, true);
});

test("compass_require(original_text)：宿主侧逐字校验通过/拒绝（A38 宿主端）", async (t) => {
  const host = await makeHost(t);
  await host.registered.get("compass_init").execute({}, host.exec);
  const exact = "另外矩形也要能拖";

  const ok = parseResult(
    await host.registered.get("compass_require").execute(
      { title: "需求", human_line: "人话", surface: "明面", original_text: exact },
      host.exec
    )
  );
  assert.equal(ok.original_locked, true);
  const baseline = parseResult(await host.registered.get("compass_read").execute({ scope: "baseline" }, host.exec));
  assert.equal(baseline.requirements[0].versions[0].original, exact);

  await assert.rejects(
    () =>
      host.registered.get("compass_require").execute(
        { title: "需求2", human_line: "人话2", surface: "明面2", original_text: "另外矩形也要能拖动" },
        host.exec
      ),
    (err) => {
      assert.equal(err.code, "E_ORIGINAL_MISMATCH");
      assert.match(err.message, /E_ORIGINAL_MISMATCH: /);
      return true;
    }
  );
  const tree = parseResult(await host.registered.get("compass_read").execute({ scope: "tree" }, host.exec));
  assert.equal(tree.root.children.length, 1, "校验失败不写数据");
});

test("compass_update(detail)：缺失路径经宿主返回 E_DETAIL_PATH_NOT_FOUND（A40 宿主端）", async (t) => {
  const host = await makeHost(t);
  await host.registered.get("compass_init").execute({}, host.exec);
  await host.registered.get("compass_require").execute(
    { title: "需求", human_line: "人话", surface: "明面" },
    host.exec
  );
  await host.registered.get("compass_plan").execute(
    { parent_id: "R-001", title: "任务", human_line: "任务" },
    host.exec
  );

  await assert.rejects(
    () =>
      host.registered.get("compass_update").execute(
        {
          task_ids: ["R-001-T-1"],
          detail: "核心文件：`src/api/user.ts`\n契约/文档：无\n避坑指南：无"
        },
        host.exec
      ),
    (err) => {
      assert.equal(err.code, "E_DETAIL_PATH_NOT_FOUND");
      assert.match(err.message, /^E_DETAIL_PATH_NOT_FOUND: \[Error\] 详情写入被拒绝。/);
      assert.match(err.message, /原因：检测到详情内容中包含不存在的文件路径 "src\/api\/user\.ts"。/);
      assert.match(err.message, /建议操作：请使用终端命令或文件工具核实当前工作区的真实文件结构/);
      assert.match(err.message, /严禁捏造路径。/);
      return true;
    }
  );
  const tree = parseResult(await host.registered.get("compass_read").execute({ scope: "tree" }, host.exec));
  assert.equal(tree.root.children[0].children[0].pointers.length, 1, "追溯链未变（未写 pointer）");
});

test("原话优先取 session/event 的 source.kind=user 消息（避开 runtime-context 注入）", async (t) => {
  const host = await makeHost(t);
  // 真实会话事件：先真实用户原话，后注入的 runtime-context / 技能清单
  host.handlers.get("session/event")(
    { header: { id: "sess-1" } },
    {
      type: "user/message",
      time: 1794383000000,
      data: { source: { kind: "user" }, message: { role: "user", content: [{ type: "text", text: "把 PPT 里的图变成能拖顶点的形状" }] } }
    }
  );
  host.handlers.get("session/event")(
    { header: { id: "sess-1" } },
    {
      type: "user/message",
      time: 1794383001000,
      data: { source: { kind: "runtime-context" }, message: { role: "user", content: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots." } }
    }
  );

  // deriveMessages：最后一条 user 是注入内容（真实 DSH 行为）
  const injectedExec = {
    agent: {
      session: {
        header: { id: "sess-1", cwd: host.workspace },
        deriveMessages: () => [
          { role: "system", content: "system" },
          { role: "user", content: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots." }
        ]
      }
    }
  };

  await host.registered.get("compass_init").execute({}, injectedExec);
  await host.registered.get("compass_require").execute(
    { title: "需求", human_line: "人话", surface: "明面" },
    injectedExec
  );
  const baseline = parseResult(await host.registered.get("compass_read").execute({ scope: "baseline" }, injectedExec));
  assert.equal(baseline.requirements[0].versions[0].original, "把 PPT 里的图变成能拖顶点的形状");
});