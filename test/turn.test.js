import assert from "node:assert/strict";
import test from "node:test";

import { TurnTracker, resolveTurn } from "../src/host/turn.js";

const s1 = { header: { id: "session-1" } };
const s2 = { header: { id: "session-2" } };
const start = (turn) => ({ type: "turn/start", data: { turn }, time: 1000 + turn });
const end = (turn) => ({ type: "turn/end", data: { turn }, time: 2000 + turn });

test("TurnTracker：turn/start 打开轮次，turn/end 关闭", () => {
  const tracker = new TurnTracker();
  assert.equal(tracker.current("session-1"), null);

  tracker.record(s1, start(1));
  assert.equal(tracker.current("session-1"), 1);
  tracker.record(s1, end(1));
  assert.equal(tracker.current("session-1"), null);
  assert.equal(tracker.last("session-1"), 1);

  tracker.record(s1, start(2));
  assert.equal(tracker.current("session-1"), 2);
});

test("TurnTracker：多会话互不干扰", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, start(1));
  tracker.record(s2, start(7));
  assert.equal(tracker.current("session-1"), 1);
  assert.equal(tracker.current("session-2"), 7);

  tracker.record(s1, end(1));
  assert.equal(tracker.current("session-1"), null);
  assert.equal(tracker.current("session-2"), 7);
  assert.equal(tracker.size, 2);
});

test("TurnTracker：turn/end 的 turn 不匹配时不关闭（防御异常流）", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, start(3));
  tracker.record(s1, end(2));
  assert.equal(tracker.current("session-1"), 3);
});

test("TurnTracker：忽略非法数据与未知事件", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, start(0));
  tracker.record(s1, start(Number.NaN));
  tracker.record(s1, { type: "assistant/message" });
  tracker.record({}, start(1));
  tracker.record(s1, null);
  assert.equal(tracker.current("session-1"), null);
  assert.equal(tracker.size, 0);
});

test("TurnTracker：forget 清理会话", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, start(1));
  tracker.forget(s1);
  assert.equal(tracker.current("session-1"), null);
  assert.equal(tracker.size, 0);
});

test("resolveTurn：session-event 权威；退化用会话日志还原；都取不到留空（v1.30 / B-61）", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, start(4));
  assert.deepEqual(resolveTurn({ sessionId: "session-1", tracker, logTurn: 12 }), { turn: 4, source: "session-event" });

  tracker.record(s1, end(4));
  // 没有 turn/start 可订阅（插件中途加载）：用会话日志还原的轮次，而不是消息条数
  assert.deepEqual(resolveTurn({ sessionId: "session-1", tracker, logTurn: 12 }), { turn: 12, source: "session-log" });

  // 日志也读不到 ⇒ 留空（绝不用注入消息计数猜测轮次）
  assert.deepEqual(resolveTurn({ sessionId: "session-2", tracker: null, logTurn: null }), {
    turn: null,
    source: "unavailable"
  });
  assert.deepEqual(resolveTurn({ sessionId: "session-2", tracker: null, logTurn: 0 }), {
    turn: null,
    source: "unavailable"
  });
});

test("TurnTracker：只记录 source.kind=user 的用户消息，忽略机器注入", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, {
    type: "user/message",
    time: 1000,
    data: { source: { kind: "runtime-context" }, message: { role: "user", content: "Current runtime context." } }
  });
  assert.equal(tracker.lastUser("session-1"), null);

  tracker.record(s1, {
    type: "user/message",
    time: 2000,
    data: { source: { kind: "user" }, message: { role: "user", content: [{ type: "text", text: "真正的用户原话" }] } }
  });
  assert.deepEqual(tracker.lastUser("session-1"), { text: "真正的用户原话", at: new Date(2000).toISOString() });

  tracker.record(s1, {
    type: "user/message",
    time: 3000,
    data: { source: { kind: "skill-catalog" }, message: { role: "user", content: "A skill is a reusable set" } }
  });
  assert.equal(tracker.lastUser("session-1").text, "真正的用户原话");
});
test("TurnTracker：activitiesSince 统计窗口内轮次与工具调用（B-32）", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, { type: "turn/start", data: { turn: 1 }, time: 1000 });
  tracker.record(s1, { type: "tool/call", data: { name: "write" }, time: 1100 });
  tracker.record(s1, { type: "turn/start", data: { turn: 2 }, time: 2000 });
  tracker.record(s1, { type: "tool/call", data: { name: "compass_plan" }, time: 2100 });
  tracker.record(s1, { type: "tool/call", data: { name: "pwsh" }, time: 2200 });

  assert.deepEqual(tracker.activitiesSince("session-1", 1500), { turns: 1, toolCalls: 2 });
  assert.deepEqual(tracker.activitiesSince("session-1", 2500), { turns: 0, toolCalls: 0 });
  assert.deepEqual(tracker.activitiesSince("session-1", 0), { turns: 2, toolCalls: 3 });
  assert.deepEqual(tracker.activitiesSince("no-session", 0), { turns: 0, toolCalls: 0 });
});test("TurnTracker：tool_calls 不含 compass_status 自身调用（B-32 防自计数）", () => {
  const tracker = new TurnTracker();
  tracker.record(s1, { type: "tool/call", data: { name: "write" }, time: 1000 });
  tracker.record(s1, { type: "tool/call", data: { name: "compass_status" }, time: 1100 });
  assert.deepEqual(tracker.activitiesSince("session-1", 0), { turns: 0, toolCalls: 1 });
});
