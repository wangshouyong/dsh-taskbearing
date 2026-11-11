/**
 * 会话日志轮次解析（v1.30 / B-61）：追溯跳转的核验/还原依据。
 * 用真实 zstd 多帧日志（与 DSH 持久化同格式）落临时目录测试，不读真实会话。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  currentTurnFromLog,
  findSessionLogFile,
  isSessionId,
  readSessionMeta,
  readSessionTurns,
  resolveTurnForJump,
  turnAtTime,
  workspaceSessionKey
} from "../src/host/history.js";

const SESSION = "session-0123abcd-1111-2222-3333-444455556666";

/** @param {string} dir @param {Array<any>} events */
async function writeSessionLog(dir, events) {
  await fs.mkdir(dir, { recursive: true });
  const body = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  await fs.writeFile(path.join(dir, "session.v4.jsonl.zstd"), zlib.zstdCompressSync(Buffer.from(body, "utf8")));
}

/** @param {string} logFile @param {Array<any>} events 追加一帧（模拟日志持续写入） */
async function appendSessionLog(logFile, events) {
  const body = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  const existing = await fs.readFile(logFile);
  await fs.writeFile(logFile, Buffer.concat([existing, zlib.zstdCompressSync(Buffer.from(body, "utf8"))]));
}

const T = (iso) => Date.parse(iso);
const startEvent = (turn, iso) => ({ type: "turn/start", data: { turn }, time: T(iso) });
const endEvent = (turn, iso) => ({ type: "turn/end", data: { turn }, time: T(iso) });

async function makeEnv(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-history-turns-"));
  const sessionsRoot = path.join(root, "sessions");
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const logFile = path.join(sessionsRoot, workspaceSessionKey(workspace), SESSION, "session.v4.jsonl.zstd");
  await writeSessionLog(path.dirname(logFile), [
    startEvent(1, "2026-11-11T08:00:00.000Z"),
    endEvent(1, "2026-11-11T08:10:00.000Z"),
    startEvent(2, "2026-11-11T08:20:00.000Z"),
    endEvent(2, "2026-11-11T08:40:00.000Z"),
    startEvent(3, "2026-11-11T08:49:25.604Z"),
    endEvent(3, "2026-11-11T10:31:05.238Z"),
    startEvent(4, "2026-11-11T10:31:05.300Z")
  ]);
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, sessionsRoot, workspace, logFile };
}

test("findSessionLogFile：按工作区 key 命中；非法/未知会话返回 null（B-61）", async (t) => {
  const env = await makeEnv(t);
  assert.equal(await findSessionLogFile({ sessionsRoot: env.sessionsRoot, workspacePath: env.workspace, sessionId: SESSION }), env.logFile);
  assert.equal(await findSessionLogFile({ sessionsRoot: env.sessionsRoot, workspacePath: env.workspace, sessionId: "session-unknown" }), null);
  assert.equal(await findSessionLogFile({ sessionsRoot: env.sessionsRoot, workspacePath: env.workspace, sessionId: "not-a-session" }), null);
});

test("findSessionLogFile：跨工作区兜底（指针来自其它工作区的会话）", async (t) => {
  const env = await makeEnv(t);
  const otherWorkspace = path.join(env.root, "other-ws");
  await fs.mkdir(otherWorkspace, { recursive: true });
  // 传一个不匹配任何会话目录的 workspacePath ⇒ 触发跨工作区扫描
  const found = await findSessionLogFile({ sessionsRoot: env.sessionsRoot, workspacePath: otherWorkspace, sessionId: SESSION });
  assert.equal(found, env.logFile);
});

test("readSessionTurns：turn/start↔turn/end 成对成区间，升序；日志追加后自动重读", async (t) => {
  const env = await makeEnv(t);
  const turns = await readSessionTurns(env.logFile);
  assert.deepEqual(
    turns.map((item) => item.turn),
    [1, 2, 3, 4]
  );
  assert.equal(turns[0].end !== null, true);
  assert.equal(turns[2].end !== null, true);
  assert.equal(turns[3].end, null, "第 4 轮未结束");

  await appendSessionLog(env.logFile, [endEvent(4, "2026-11-11T11:00:00.000Z"), startEvent(5, "2026-11-11T11:05:00.000Z")]);
  const next = await readSessionTurns(env.logFile);
  assert.deepEqual(
    next.map((item) => item.turn),
    [1, 2, 3, 4, 5]
  );
  assert.equal(next[4].end, null);
});

test("turnAtTime：时间落在轮次区间内；不在任何轮次返回 null", async (t) => {
  const env = await makeEnv(t);
  const turns = await readSessionTurns(env.logFile);
  assert.equal(turnAtTime(turns, "2026-11-11T08:30:00.000Z"), 2);
  assert.equal(turnAtTime(turns, "2026-11-11T08:49:25.680Z"), 3, "边界时刻归当前轮");
  assert.equal(turnAtTime(turns, "2026-11-11T10:00:00.000Z"), 3);
  assert.equal(turnAtTime(turns, "2026-11-11T07:00:00.000Z"), null, "第一轮之前");
  assert.equal(turnAtTime(turns, "not-a-time"), null);
  assert.equal(turnAtTime(null, "2026-11-11T08:30:00.000Z"), null);
});

test("resolveTurnForJump：正确轮次=exact；旧版错 turn 按 at 还原=by-at；无 at 且轮次不存在=null", async (t) => {
  const env = await makeEnv(t);

  const exact = await resolveTurnForJump({
    sessionsRoot: env.sessionsRoot,
    workspacePath: env.workspace,
    sessionId: SESSION,
    turn: 3,
    at: "2026-11-11T09:21:49.131Z"
  });
  assert.equal(exact.log_available, true);
  assert.equal(exact.turn_count, 4);
  assert.equal(exact.turn, 3);
  assert.equal(exact.source, "exact");

  // 现场案例：旧版插件把轮次写成 38，真实轮次是 3（按 at 还原并标注 by-at）
  const repaired = await resolveTurnForJump({
    sessionsRoot: env.sessionsRoot,
    workspacePath: env.workspace,
    sessionId: SESSION,
    turn: 38,
    at: "2026-11-11T09:21:49.131Z"
  });
  assert.equal(repaired.turn, 3);
  assert.equal(repaired.source, "by-at");
  assert.equal(repaired.requested_turn, 38);

  const missing = await resolveTurnForJump({
    sessionsRoot: env.sessionsRoot,
    workspacePath: env.workspace,
    sessionId: SESSION,
    turn: 38,
    at: null
  });
  assert.equal(missing.log_available, true);
  assert.equal(missing.turn, null, "轮次不存在且无 at ⇒ 不猜测");
  assert.equal(missing.turn_count, 4);

  // 有 at 但落在轮次区间外，而 turn 真实存在 ⇒ 接受 turn
  const exactNoAt = await resolveTurnForJump({
    sessionsRoot: env.sessionsRoot,
    workspacePath: env.workspace,
    sessionId: SESSION,
    turn: 2,
    at: "2026-11-11T07:00:00.000Z"
  });
  assert.equal(exactNoAt.turn, 2);
  assert.equal(exactNoAt.source, "exact-no-at");

  const noLog = await resolveTurnForJump({
    sessionsRoot: env.sessionsRoot,
    workspacePath: env.workspace,
    sessionId: "session-deadbeef-0000-0000-0000-000000000000",
    turn: 3,
    at: null
  });
  assert.equal(noLog.exists, false);
  assert.equal(noLog.log_available, false);
  assert.equal(noLog.turn, null);
});

test("currentTurnFromLog：未结束轮=当前轮；全部结束=最后一轮+1；无日志=null", async (t) => {
  const env = await makeEnv(t);
  assert.deepEqual(
    await currentTurnFromLog({ sessionsRoot: env.sessionsRoot, workspacePath: env.workspace, sessionId: SESSION }),
    { turn: 4, source: "session-log" }
  );
  assert.equal(
    await currentTurnFromLog({ sessionsRoot: env.sessionsRoot, workspacePath: env.workspace, sessionId: "session-none-000" }),
    null
  );

  // 关闭第 4 轮后（日志暂未写入下一轮 turn/start）⇒ 当前轮 = 5
  await appendSessionLog(env.logFile, [endEvent(4, "2026-11-11T11:00:00.000Z")]);
  assert.deepEqual(
    await currentTurnFromLog({ sessionsRoot: env.sessionsRoot, workspacePath: env.workspace, sessionId: SESSION }),
    { turn: 5, source: "session-log" }
  );
});

// ---------------------------------------------------------------- 子代理会话（裸 UUID）

const SUBAGENT = "0d6e42f5-faf6-40b1-8a57-6d5ae7951ec5";

test("readSessionMeta / isSessionId：识别裸 UUID 子代理会话（origin/parentSession）", async (t) => {
  const env = await makeEnv(t);
  const subDir = path.join(env.sessionsRoot, workspaceSessionKey(env.workspace), SUBAGENT);
  await writeSessionLog(subDir, [
    {
      type: "session",
      version: 4,
      id: SUBAGENT,
      cwd: env.workspace,
      parentSession: SESSION,
      origin: "subagent"
    },
    startEvent(1, "2026-11-11T09:20:00.000Z")
  ]);

  assert.equal(isSessionId(SUBAGENT), true);
  assert.equal(isSessionId(SESSION), true);
  assert.equal(isSessionId("not-a-session"), false);
  const file = await findSessionLogFile({ sessionsRoot: env.sessionsRoot, workspacePath: env.workspace, sessionId: SUBAGENT });
  const meta = await readSessionMeta(file);
  assert.deepEqual(meta, { id: SUBAGENT, cwd: env.workspace, parent_session: SESSION, origin: "subagent" });
  assert.equal(await readSessionMeta(env.logFile), null, "无 session 事件 ⇒ meta=null（不编造）");
});

test("resolveTurnForJump：子代理会话按 at 解析到父会话的对应轮次（跳父会话）", async (t) => {
  const env = await makeEnv(t);
  const subDir = path.join(env.sessionsRoot, workspaceSessionKey(env.workspace), SUBAGENT);
  await writeSessionLog(subDir, [
    { type: "session", version: 4, id: SUBAGENT, cwd: env.workspace, parentSession: SESSION, origin: "subagent" },
    startEvent(1, "2026-11-11T09:20:00.000Z")
  ]);

  const res = await resolveTurnForJump({
    sessionsRoot: env.sessionsRoot,
    workspacePath: env.workspace,
    sessionId: SUBAGENT,
    turn: 1,
    at: "2026-11-11T10:14:05.435Z"
  });
  assert.equal(res.exists, true);
  assert.equal(res.origin, "subagent");
  assert.equal(res.target_session, SESSION);
  assert.equal(res.turn, 3, "父会话该时刻在第 3 轮");
  assert.equal(res.source, "parent-at");

  // 父会话日志不存在 ⇒ 给出 target_session 但 turn=null（不猜测）
  const orphan = "11111111-2222-3333-4444-555555555555";
  const orphanDir = path.join(env.sessionsRoot, workspaceSessionKey(env.workspace), orphan);
  await writeSessionLog(orphanDir, [
    { type: "session", version: 4, id: orphan, cwd: env.workspace, parentSession: "session-missing-parent", origin: "subagent" },
    startEvent(1, "2026-11-11T09:20:00.000Z")
  ]);
  const parentMissing = await resolveTurnForJump({
    sessionsRoot: env.sessionsRoot,
    workspacePath: env.workspace,
    sessionId: orphan,
    turn: 1,
    at: "2026-11-11T10:14:05.435Z"
  });
  assert.equal(parentMissing.target_session, "session-missing-parent");
  assert.equal(parentMissing.turn, null);
  assert.equal(parentMissing.log_available, false);
});
