import assert from "node:assert/strict";
import test from "node:test";

import {
  FLASH_ATTR,
  describeJumpStatus,
  findChatScroller,
  findLoadEarlier,
  findTurnRailButton,
  highlight,
  isLoadEarlierLabel,
  isTurnRailLabel,
  isVisibleInScroller,
  jumpToTurn,
  locateTurn,
  resolveJumpTarget,
  scrollIntoScroller,
  turnSelector
} from "../src/client/turn-jump.js";

const ROW_HEIGHT = 500;
const TURN_HEIGHT = 100;
const TURN_PITCH = 400;

/** 带真实几何/滚动模型的假聊天容器：轮次尾巴 getBoundingClientRect 随 scrollTop 变化。 */
function makeScroller({ turns = [], rails = [], pages = [], ignoreScroll = false, labels = ["加载更早"] } = {}) {
  const scroller = {
    _top: 0,
    scrollHeight: Math.max(ROW_HEIGHT, ...turns.map((turn) => Number(turn) * TURN_PITCH + TURN_HEIGHT)),
    clientHeight: ROW_HEIGHT,
    scrollTo(options) {
      this.scrollTop = Number(options?.top ?? this.scrollTop);
    },
    getBoundingClientRect() {
      return { top: 0, bottom: ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 800 };
    },
    ownerDocument: null
  };

  Object.defineProperty(scroller, "scrollTop", {
    get() { return this._top; },
    set(value) { if (!ignoreScroll) this._top = Number(value); },
    enumerable: true,
    configurable: true
  });

  const elements = new Map();
  const elementFor = (turn) => {
    if (elements.has(turn)) return elements.get(turn);
    const element = {
      turn,
      ownerDocument: null,
      attrs: {},
      getBoundingClientRect() {
        const offset = turn * TURN_PITCH;
        const top = offset - scroller.scrollTop;
        return { top, bottom: top + TURN_HEIGHT, height: TURN_HEIGHT, left: 0, right: 400 };
      },
      setAttribute(name, value) { this.attrs[name] = value; },
      removeAttribute(name) { delete this.attrs[name]; },
      getAttribute(name) { return this.attrs[name] ?? null; }
    };
    elements.set(turn, element);
    return element;
  };

  const loaded = new Set(turns);
  const buttons = [];
  for (const label of labels) {
    buttons.push({
      textContent: label,
      isPage: true,
      click() {
        const next = pages.shift();
        if (next) for (const turn of next) loaded.add(turn);
        this.clicked = (this.clicked ?? 0) + 1;
      }
    });
  }
  for (const turn of rails) {
    buttons.push({
      textContent: "",
      aria: `加载并跳转到第 ${turn} 轮`,
      getAttribute(name) { return name === "aria-label" ? this.aria : null; },
      click() {
        this.clicked = (this.clicked ?? 0) + 1;
        // 宿主原生跳转：把对应轮次拉到可视区（模拟 ChatNavigation 落位）
        if (!ignoreScroll) scroller.scrollTop = turn * TURN_PITCH - 200;
      }
    });
  }

  const doc = {
    head: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return { id: "", textContent: "", setAttribute() {} }; },
    querySelectorAll(selector) {
      if (selector === "button") return buttons;
      if (selector === "[data-conversation-scroll]") return [scroller];
      if (selector.startsWith("[data-turn-tail")) {
        const turn = Number(/="(\d+)"/.exec(selector)?.[1]);
        return loaded.has(turn) ? [elementFor(turn)] : [];
      }
      return [];
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  };
  scroller.ownerDocument = doc;
  return { doc, scroller, buttons, loaded };
}

test("turnSelector / isLoadEarlierLabel / isTurnRailLabel：中英文文案", () => {
  assert.equal(turnSelector(7), '[data-turn-tail="7"]');
  assert.equal(isLoadEarlierLabel("加载更早"), true);
  assert.equal(isLoadEarlierLabel("Load earlier"), true);
  assert.equal(isLoadEarlierLabel(" 加载更早的消息 "), true);
  assert.equal(isLoadEarlierLabel("发送"), false);
  assert.equal(isTurnRailLabel("跳转到第 3 轮", 3), true);
  assert.equal(isTurnRailLabel("加载并跳转到第 3 轮", 3), true);
  assert.equal(isTurnRailLabel("Jump to turn 3", 3), true);
  assert.equal(isTurnRailLabel("Load and jump to turn 3", 3), true);
  assert.equal(isTurnRailLabel("跳转到第 4 轮", 3), false);
});

test("findChatScroller：优先宿主 [data-conversation-scroll]", () => {
  const { doc, scroller } = makeScroller({ turns: [1, 2] });
  assert.equal(findChatScroller(doc), scroller);
});

test("isVisibleInScroller：按 rect 与容差判断", () => {
  const { doc } = makeScroller({ turns: [3] });
  const el = doc.querySelector(turnSelector(3));
  const scroller = doc.querySelector("[data-conversation-scroll]");
  assert.equal(isVisibleInScroller(el, scroller), false);
  scroller.scrollTop = TURN_PITCH * 3 - 200;
  assert.equal(isVisibleInScroller(el, scroller), true);
});

test("scrollIntoScroller：算偏移设 scrollTop 并真的把目标滚进视口（不依赖 scrollIntoView）", () => {
  const { doc, scroller } = makeScroller({ turns: [3] });
  const el = doc.querySelector(turnSelector(3));
  const result = scrollIntoScroller(doc, el);
  assert.equal(result.ok, true);
  assert.equal(result.scroller, scroller);
  assert.ok(scroller.scrollTop > 0, "scrollTop 被设置");
  assert.equal(isVisibleInScroller(el, scroller), true, "目标进入视口");
});

test("locateTurn：目标已渲染 ⇒ 立刻滚到 + 高亮（不再只调 scrollIntoView）", async () => {
  const { doc, scroller } = makeScroller({ turns: [3, 4] });
  const result = await locateTurn(4, { document: doc, sleep: async () => {}, now: () => 0 });
  assert.equal(result.ok, true);
  assert.equal(result.via, "scroll");
  assert.equal(result.pages, 0);
  const target = doc.querySelector(turnSelector(4));
  assert.equal(target.getAttribute(FLASH_ATTR), "1");
  assert.equal(isVisibleInScroller(target, scroller), true);
});

test("locateTurn：目标较旧 ⇒ 逐页加载直到命中，仍要真滚到目标", async () => {
  const { doc, scroller, buttons } = makeScroller({ turns: [5], pages: [[4], [3]], rails: [] });
  const result = await locateTurn(3, { document: doc, sleep: async () => {}, now: () => 0 });
  assert.equal(result.ok, true);
  assert.equal(result.pages, 2);
  assert.equal(buttons.filter((b) => b.isPage)[0].clicked, 2);
  const target = doc.querySelector(turnSelector(3));
  assert.equal(target.getAttribute(FLASH_ATTR), "1");
  assert.equal(isVisibleInScroller(target, scroller), true);
});

test("locateTurn：scrollTop 被宿主吞掉（滚动失败）⇒ 用宿主轮次导轨兜底", async () => {
  const { doc, scroller } = makeScroller({ turns: [3], rails: [3], ignoreScroll: true });
  // 导轨点击也只改 scrollTop（被吞）⇒ 必须如实返回 scroll-failed，不能谎报 ok
  const result = await locateTurn(3, { document: doc, sleep: async () => {}, now: () => 0 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "scroll-failed");
  assert.equal(doc.querySelector(turnSelector(3)).getAttribute(FLASH_ATTR), "1", "即使没滚到也保留高亮");
  assert.equal(scroller.scrollTop, 0);
});

test("locateTurn：没有现成锚点、没有导轨、没有「加载更早」⇒ 超时返回原因", async () => {
  const { doc } = makeScroller({ turns: [9], labels: [] });
  let tick = 0;
  const result = await locateTurn(2, { document: doc, sleep: async () => {}, now: () => (tick += 1), timeoutMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "turn-not-rendered");
  assert.equal(result.pages, 0);
});

test("jumpToTurn：跨会话先 openSession 再定位；同会话不重复打开；无 turn / 打开失败", async () => {
  const { doc } = makeScroller({ turns: [6] });
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

test("highlight / findTurnRailButton / findLoadEarlier：基础行为", () => {
  const el = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
    getAttribute(name) { return this.attrs[name] ?? null; }
  };
  assert.equal(highlight(el, null, 1), true);
  assert.equal(el.getAttribute(FLASH_ATTR), "1");
  assert.equal(highlight(el, null, 1), true);

  const { doc } = makeScroller({ turns: [1], rails: [3], labels: [] });
  assert.equal(findLoadEarlier(doc), null);
  assert.equal(findTurnRailButton(doc, 3).getAttribute("aria-label"), "加载并跳转到第 3 轮");
  assert.equal(findTurnRailButton(doc, 2), null);
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

test("describeJumpStatus：成功/按时间还原/日志缺失/轮次不存在/未渲染/滚动失败都有人话（不静默）", () => {
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
  assert.match(
    describeJumpStatus({ ok: false, reason: "scroll-failed" }, { targetTurn: 3, reason: null, meta: {} }),
    /已高亮第 3 轮，但未能滚动到该轮/
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





