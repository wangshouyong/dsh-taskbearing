import assert from "node:assert/strict";
import test from "node:test";

import {
  FLASH_ATTR,
  describeJumpStatus,
  findLoadEarlier,
  highlight,
  isLoadEarlierLabel,
  jumpToTurn,
  locateTurn,
  resolveJumpTarget,
  turnSelector
} from "../src/client/turn-jump.js";

function makeElement(doc, turn) {
  const attributes = new Map();
  return {
    turn,
    scrolled: null,
    scrollIntoView(options) { this.scrolled = options; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    ownerDocument: doc
  };
}

function makeDoc({ loadedTurns = [], pages = [], labels = ["加载更早"] }) {
  let loaded = [...loadedTurns];
  const queue = pages.map((page) => [...page]);
  const elements = new Map();
  const elementFor = (turn) => {
    if (!elements.has(turn)) elements.set(turn, makeElement(doc, turn));
    return elements.get(turn);
  };
  const buttons = labels.map((label) => ({
    textContent: label,
    clicked: 0,
    click() { this.clicked += 1; const next = queue.shift(); if (next) loaded = [...loaded, ...next]; }
  }));
  const doc = {
    head: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return { id: "", textContent: "", setAttribute() {} }; },
    querySelectorAll(selector) {
      if (selector === "button") return buttons;
      if (selector.startsWith("[data-turn-tail")) {
        const turn = Number(/="(\d+)"/.exec(selector)?.[1]);
        return loaded.includes(turn) ? [elementFor(turn)] : [];
      }
      return [];
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  };
  return { doc, buttons };
}

test("turnSelector / isLoadEarlierLabel：中英文按钮文案", () => {
  assert.equal(turnSelector(7), '[data-turn-tail="7"]');
  assert.equal(isLoadEarlierLabel("加载更早"), true);
  assert.equal(isLoadEarlierLabel("Load earlier"), true);
  assert.equal(isLoadEarlierLabel(" 加载更早的消息 "), true);
  assert.equal(isLoadEarlierLabel("发送"), false);
});

test("locateTurn：目标已渲染 ⇒ 滚动居中 + 高亮，无需加载", async () => {
  const { doc, buttons } = makeDoc({ loadedTurns: [3, 4] });
  const result = await locateTurn(4, { document: doc, sleep: async () => {}, now: () => 0 });
  assert.equal(result.ok, true);
  assert.equal(result.pages, 0);
  assert.equal(buttons[0].clicked, 0);
});

test("locateTurn：目标较旧 ⇒ 逐页点「加载更早」直到命中（高亮属性写入）", async () => {
  const { doc, buttons } = makeDoc({ loadedTurns: [5], pages: [[4], [3]] });
  const result = await locateTurn(3, { document: doc, sleep: async () => {}, now: () => 0 });
  assert.equal(result.ok, true);
  assert.equal(result.pages, 2);
  assert.equal(buttons[0].clicked, 2);
  const target = doc.querySelector(turnSelector(3));
  assert.equal(target.getAttribute(FLASH_ATTR), "1");
  assert.deepEqual(target.scrolled, { block: "center", behavior: "smooth" });
});

test("locateTurn：无锚点且无「加载更早」⇒ 超时返回原因", async () => {
  const { doc } = makeDoc({ loadedTurns: [9], labels: [] });
  let tick = 0;
  const result = await locateTurn(2, { document: doc, sleep: async () => {}, now: () => (tick += 1), timeoutMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "turn-not-rendered");
  assert.equal(result.pages, 0);
});

test("jumpToTurn：跨会话先 openSession 再定位；同会话不重复打开；无 turn / 打开失败", async () => {
  const { doc } = makeDoc({ loadedTurns: [6] });
  const opened = [];
  const ok = await jumpToTurn(
    { sessionId: "session-other", turn: 6, currentSessionId: "session-now", openSession: (id) => (opened.push(id), true) },
    { document: doc, sleep: async () => {}, now: () => 0 }
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(opened, ["session-other"]);
  const same = await jumpToTurn(
    { sessionId: "session-now", turn: 6, currentSessionId: "session-now", openSession: (id) => (opened.push(id), true) },
    { document: doc, sleep: async () => {}, now: () => 0 }
  );
  assert.equal(same.ok, true);
  assert.deepEqual(opened, ["session-other"]);
  assert.equal((await jumpToTurn({ sessionId: "session-now", turn: null }, { document: doc })).reason, "no-turn");
  const failed = await jumpToTurn(
    { sessionId: "session-other", turn: 6, currentSessionId: "session-now", openSession: () => false },
    { document: doc }
  );
  assert.equal(failed.reason, "open-failed");
});

test("highlight：写入高亮属性", () => {
  const el = makeElement(null, 1);
  assert.equal(highlight(el, null, 1), true);
  assert.equal(el.getAttribute(FLASH_ATTR), "1");
});

test("findLoadEarlier：无按钮返回 null", () => {
  assert.equal(findLoadEarlier(makeDoc({ labels: [] }).doc), null);
});

// ---------------------------------------------------------------- B-61：跳转前轮次核验

test("resolveJumpTarget：无核验器时按原 turn；宿主还原/缺失/日志不可读各自返回原因", async () => {
  const noRequest = await resolveJumpTarget({ sessionId: "session-a", turn: 7, at: null });
  assert.deepEqual(noRequest, { targetTurn: 7, meta: null, reason: null });

  const exact = await resolveJumpTarget({
    sessionId: "session-a",
    turn: 7,
    at: "2026-11-11T12:00:00.000Z",
    request: async () => ({ exists: true, log_available: true, turn_count: 9, turn: 7, source: "exact", requested_turn: 7 })
  });
  assert.equal(exact.targetTurn, 7);
  assert.equal(exact.reason, null);

  const corrected = await resolveJumpTarget({
    sessionId: "session-a",
    turn: 38,
    at: "2026-11-11T09:21:49.131Z",
    request: async () => ({ exists: true, log_available: true, turn_count: 10, turn: 3, source: "by-at", requested_turn: 38 })
  });
  assert.equal(corrected.targetTurn, 3, "旧版写错的 turn 按 at 还原");
  assert.equal(corrected.meta.source, "by-at");

  const missing = await resolveJumpTarget({
    sessionId: "session-a",
    turn: 38,
    at: null,
    request: async () => ({ exists: true, log_available: true, turn_count: 10, turn: null, source: null, requested_turn: 38 })
  });
  assert.equal(missing.targetTurn, null);
  assert.equal(missing.reason, "turn-missing");

  const noLog = await resolveJumpTarget({
    sessionId: "session-a",
    turn: 3,
    at: null,
    request: async () => ({ exists: false, log_available: false, turn_count: null, turn: null, source: null })
  });
  assert.equal(noLog.targetTurn, null);
  assert.equal(noLog.reason, "log-unavailable");

  const failed = await resolveJumpTarget({
    sessionId: "session-a",
    turn: 3,
    at: null,
    request: async () => {
      throw new Error("E_HOST_OUTDATED");
    }
  });
  assert.equal(failed.targetTurn, 3, "宿主核验失败时退回旧行为（按原 turn 尝试）");
  assert.equal(failed.reason, "lookup-failed");
  assert.match(failed.error, /E_HOST_OUTDATED/);
});

test("describeJumpStatus：成功/按时间还原/日志缺失/轮次不存在/未渲染都有人话（不静默）", () => {
  const corrected = describeJumpStatus(
    { ok: true, turn: 3 },
    { targetTurn: 3, reason: null, meta: { source: "by-at", requested_turn: 38, turn_count: 10 } }
  );
  assert.match(corrected, /戳记第 38 轮/);
  assert.match(corrected, /还原为第 3 轮/);

  assert.match(
    describeJumpStatus({ ok: true }, { targetTurn: 3, reason: null, meta: { source: "exact", requested_turn: 3 } }),
    /已定位第 3 轮/
  );
  assert.match(
    describeJumpStatus({ ok: false, reason: "log-unavailable" }, { targetTurn: null, reason: "log-unavailable", meta: { log_available: false } }),
    /没有可读的日志/
  );
  assert.match(
    describeJumpStatus(
      { ok: false, reason: "turn-missing" },
      { targetTurn: null, reason: "turn-missing", meta: { requested_turn: 38, turn_count: 10 } }
    ),
    /只有 10 轮.*第 38 轮不存在/
  );
  assert.match(describeJumpStatus({ ok: false, reason: "no-turn" }, { targetTurn: null, reason: "no-turn", meta: {} }), /无轮次信息/);
  assert.match(
    describeJumpStatus(
      { ok: false, reason: "turn-not-rendered", pages: 3 },
      { targetTurn: 3, reason: null, meta: { turn_count: 10 } }
    ),
    /未能定位第 3 轮（会话日志共 10 轮）/
  );
  assert.match(describeJumpStatus({ ok: false, reason: "open-failed" }, { targetTurn: 3, reason: null, meta: {} }), /打开会话失败/);
});

test("describeJumpStatus：子代理会话跳父会话要说明（不说成在原会话定位）", () => {
  const text = describeJumpStatus(
    { ok: true, turn: 4 },
    { targetTurn: 4, reason: null, meta: { origin: "subagent", target_session: "session-parent", turn_count: 10, source: "parent-at" } }
  );
  assert.match(text, /子代理会话/);
  assert.match(text, /父会话定位第 4 轮/);
  const failed = describeJumpStatus(
    { ok: false, reason: "turn-not-rendered" },
    { targetTurn: 4, reason: null, meta: { origin: "subagent", target_session: "session-parent", turn_count: 10 } }
  );
  assert.match(failed, /已打开父会话/);
});