/**
 * 会话可用性 / 轮次核验路由（v1.30 / B-61）。
 * 客户端会话快照会漏掉历史会话（假阴性），追溯跳转又曾因旧版写错 turn 而失败；
 * 这两个只读接口用会话日志给出权威答案。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { createCompass } from "../src/core/tools.js";
import { Store } from "../src/core/store.js";
import { workspaceSessionKey } from "../src/host/history.js";
import { registerCompassRoutes } from "../src/host/routes.js";

const SESSION = "session-0123abcd-1111-2222-3333-444455556666";

async function makeEnv(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-session-routes-"));
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const storageRoot = path.join(root, "storages");
  const sessionsRoot = path.join(root, "sessions");
  await fs.mkdir(sessionsRoot, { recursive: true });
  const captured = { spec: null };
  const webServer = {
    register(spec) {
      captured.spec = spec;
      return () => {};
    }
  };
  const dispose = registerCompassRoutes(webServer, {
    storageRoot,
    pluginVersion: "0.1.0",
    rulesPath: path.join(root, "AGENTS.md"),
    sessionsRoot
  });
  t.after(async () => {
    dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  const handler = captured.spec.handler;
  const call = async (method, url) => {
    const req = { url: `http://localhost${url}`, method };
    const res = {
      status: 0,
      body: "",
      writeHead(code) {
        this.status = code;
      },
      end(data) {
        this.body = String(data ?? "");
      }
    };
    await handler(req, res);
    return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
  };
  return { root, workspace, storageRoot, sessionsRoot, call };
}

/** 第 1/2 轮已结束、第 3 轮未结束的会话日志（真实 zstd 帧格式）。 */
async function writeSessionLog(sessionsRoot, workspace) {
  const dir = path.join(sessionsRoot, workspaceSessionKey(workspace), SESSION);
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

test("GET /session-links：按会话日志核验存在性，覆盖客户端快照假阴性（B-61）", async (t) => {
  const env = await makeEnv(t);
  const store = Store.forWorkspace({ storageRoot: env.storageRoot, workspacePath: env.workspace });
  await createCompass({ store, sessionId: SESSION }).init();
  await writeSessionLog(env.sessionsRoot, env.workspace);

  const res = await env.call(
    "GET",
    `/api/compass/session-links?cwd=${encodeURIComponent(env.workspace)}&ids=${SESSION},session-missing-0000,not-a-session`
  );
  assert.equal(res.status, 200);
  const byId = Object.fromEntries(res.body.sessions.map((item) => [item.session, item]));
  assert.equal(byId[SESSION].exists, true, "日志存在 ⇒ 可跳转（不再显示会话不可用）");
  assert.equal(byId[SESSION].openable, true);
  assert.equal(byId["session-missing-0000"].exists, false);
  assert.equal(byId["not-a-session"].exists, false, "非法 id 不当作会话");

  // 子代理会话（裸 UUID）：存在但不可直接打开 ⇒ 给父会话，UI 可跳父会话
  const subagent = "0d6e42f5-faf6-40b1-8a57-6d5ae7951ec5";
  const subDir = path.join(env.sessionsRoot, workspaceSessionKey(env.workspace), subagent);
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(
    path.join(subDir, "session.v4.jsonl.zstd"),
    zlib.zstdCompressSync(
      Buffer.from(
        `${[
          JSON.stringify({ type: "session", version: 4, id: subagent, cwd: env.workspace, parentSession: SESSION, origin: "subagent" }),
          JSON.stringify({ type: "turn/start", data: { turn: 1 }, time: Date.parse("2026-11-11T09:20:00.000Z") })
        ].join("\n")}\n`,
        "utf8"
      )
    )
  );
  const subRes = await env.call(
    "GET",
    `/api/compass/session-links?cwd=${encodeURIComponent(env.workspace)}&ids=${subagent}`
  );
  assert.equal(subRes.body.sessions[0].exists, true);
  assert.equal(subRes.body.sessions[0].openable, false, "子代理会话不能在主界面直接打开");
  assert.equal(subRes.body.sessions[0].target_session, SESSION);

  const missingRoot = await env.call("GET", `/api/compass/session-links?cwd=${encodeURIComponent(env.workspace)}&ids=`);
  assert.equal(missingRoot.status, 200);
  assert.deepEqual(missingRoot.body.sessions, []);
});

test("GET /session-turn：旧版错误轮次按 at 还原，日志缺失/轮次缺失如实返回（B-61）", async (t) => {
  const env = await makeEnv(t);
  const store = Store.forWorkspace({ storageRoot: env.storageRoot, workspacePath: env.workspace });
  await createCompass({ store, sessionId: SESSION }).init();
  await writeSessionLog(env.sessionsRoot, env.workspace);
  const base = `/api/compass/session-turn?cwd=${encodeURIComponent(env.workspace)}&session=${SESSION}`;

  // 现场案例：pointer 写的是第 38 轮，at 落在第 3 轮 ⇒ 还原为第 3 轮并标注 by-at
  const repaired = await env.call("GET", `${base}&turn=38&at=${encodeURIComponent("2026-11-11T09:21:49.131Z")}`);
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.log_available, true);
  assert.equal(repaired.body.turn_count, 3);
  assert.equal(repaired.body.turn, 3);
  assert.equal(repaired.body.source, "by-at");
  assert.equal(repaired.body.requested_turn, 38);

  // 正确轮次 ⇒ exact
  const exact = await env.call("GET", `${base}&turn=3&at=${encodeURIComponent("2026-11-11T09:21:49.131Z")}`);
  assert.equal(exact.body.turn, 3);
  assert.equal(exact.body.source, "exact");

  // 没有 at 且轮次不存在 ⇒ 不猜测
  const missing = await env.call("GET", `${base}&turn=38`);
  assert.equal(missing.body.turn, null);
  assert.equal(missing.body.turn_count, 3);

  // 会话日志不存在 ⇒ log_available=false（UI 必须显式降级）
  const noLog = await env.call(
    "GET",
    `/api/compass/session-turn?cwd=${encodeURIComponent(env.workspace)}&session=session-deadbeef-0000-0000-0000-000000000000&turn=3`
  );
  assert.equal(noLog.status, 200);
  assert.equal(noLog.body.log_available, false);
  assert.equal(noLog.body.exists, false);
});
