/**
 * 轮次（turn）来源：按权威程度三级取值，**绝不猜测**（v1.30 / B-61 起）。
 *
 * 来源 1（权威）：DSH 会话日志原生 `turn/start` / `turn/end` 事件，`data.turn` 从 1 递增。
 *   插件通过 `ctx.on("session/event", …)` 订阅，工具执行时 `tracker.current(sessionId)` 即当前轮次。
 * 来源 2（退化）：插件在轮次**中途**加载（如启动后才装载插件 / 热更新）时，本次轮次没有
 *   `turn/start` 可订阅 —— 由宿主读当前会话日志还原当前轮（`history.js#currentTurnFromLog`），
 *   编号与 `turn/start` 同源，可安全用于追溯跳转。
 * 来源 3：以上都取不到 ⇒ turn 留空（契约允许 turn 缺失，`at` 是权威时间）。
 *
 * 历史教训（v1.29 及以前）：退化来源曾用「剥离注入后的 user 消息条数」当轮次。
 * DSH 会把 runtime-context / 技能清单 / agent 消息 / 子代理结果等以 user 角色注入，
 * 该计数被注入消息抬高（实测同一动作被记为第 38 / 48 轮，而真实轮次是第 3 轮），
 * 导致追溯链「跳转轮次失败」。该退化来源已删除，改由会话日志还原。
 */

import { messageText } from "./session.js";

/**
 * @typedef {{turn: number, at: string|null} | null} TurnSnapshot
 */

export class TurnTracker {
  /** @type {Map<string, {openTurn: number|null, lastTurn: number|null, lastUser: {text: string, at: string}|null, turnStarts: Array<{turn: number, at: number}>, toolCalls: Array<{name: string, at: number}>}>} */
  #bySession = new Map();

  /**
   * @param {string} sessionId
   * @returns {{openTurn: number|null, lastTurn: number|null, lastUser: {text: string, at: string}|null, turnStarts: Array<{turn: number, at: number}>, toolCalls: Array<{name: string, at: number}>}}
   */
  #entry(sessionId) {
    let entry = this.#bySession.get(sessionId);
    if (!entry) {
      entry = { openTurn: null, lastTurn: null, lastUser: null, turnStarts: [], toolCalls: [] };
      this.#bySession.set(sessionId, entry);
    }
    return entry;
  }

  /**
   * 记录一条会话事件（接 `session/event` 订阅）。
   * @param {any} session
   * @param {{type?: string, data?: {turn?: number}, time?: number}} event
   * @returns {void}
   */
  record(session, event) {
    const sessionId = session?.header?.id ?? session?.id ?? null;
    if (!sessionId || !event || typeof event.type !== "string") return;
    const turn = event?.data?.turn;
    if (event.type === "turn/start") {
      if (!Number.isInteger(turn) || turn < 1) return;
      const entry = this.#entry(sessionId);
      entry.openTurn = turn;
      entry.lastTurn = turn;
      entry.turnStarts.push({ turn, at: Number.isFinite(event.time) ? event.time : Date.now() });
      if (entry.turnStarts.length > 500) entry.turnStarts.splice(0, entry.turnStarts.length - 500);
      return;
    }
    if (event.type === "tool/call") {
      const name = String(event?.data?.name ?? "");
      // compass_status 自身调用不计入活动信号（否则每次自查都会把自己算进去）
      if (name === "compass_status") return;
      const entry = this.#entry(sessionId);
      entry.toolCalls.push({ name, at: Number.isFinite(event.time) ? event.time : Date.now() });
      if (entry.toolCalls.length > 500) entry.toolCalls.splice(0, entry.toolCalls.length - 500);
      return;
    }
    if (event.type === "turn/end") {
      const entry = this.#bySession.get(sessionId);
      if (!entry) return;
      if (entry.openTurn !== null && (turn === undefined || turn === entry.openTurn)) {
        entry.openTurn = null;
      }
      return;
    }
    if (event.type === "user/message") {
      // 只收 source.kind === "user" 的真实用户消息；runtime-context / 技能清单 / 指令基线不算原话
      const sourceKind = event?.data?.source?.kind;
      if (sourceKind !== "user") return;
      const text = messageText(event?.data?.message).trim();
      if (!text) return;
      const entry = this.#entry(sessionId);
      entry.lastUser = {
        text,
        at: new Date(Number.isFinite(event?.time) ? event.time : Date.now()).toISOString()
      };
    }
  }

  /**
   * 最近一条真实用户原话（来自 session/event 的 user/message，source.kind === "user"）。
   * @param {string|null} sessionId
   * @returns {{text: string, at: string} | null}
   */
  lastUser(sessionId) {
    if (!sessionId) return null;
    return this.#bySession.get(sessionId)?.lastUser ?? null;
  }

  /**
   * 当前打开的轮次；没有打开轮次时返回 null（不返回上一轮的旧值）。
   * @param {string|null} sessionId
   * @returns {number|null}
   */
  current(sessionId) {
    if (!sessionId) return null;
    const entry = this.#bySession.get(sessionId);
    return entry?.openTurn ?? null;
  }

  /** @param {string|null} sessionId */
  last(sessionId) {
    if (!sessionId) return null;
    return this.#bySession.get(sessionId)?.lastTurn ?? null;
  }

  /**
   * 板面新鲜度窗口（B-32）：自 `sinceMs` 之后开始的轮次数与观察到的工具调用次数。
   * 只统计插件实例启动后收到的会话事件（启动前的历史轮次不可见，由调用方在 note 说明）。
   * @param {string|null} sessionId
   * @param {number} sinceMs
   * @returns {{turns: number, toolCalls: number}}
   */
  activitiesSince(sessionId, sinceMs) {
    if (!sessionId) return { turns: 0, toolCalls: 0 };
    const entry = this.#bySession.get(sessionId);
    if (!entry) return { turns: 0, toolCalls: 0 };
    const threshold = Number.isFinite(sinceMs) ? sinceMs : 0;
    return {
      turns: entry.turnStarts.filter((item) => item.at > threshold).length,
      toolCalls: entry.toolCalls.filter((item) => item.at > threshold).length
    };
  }

  /** @param {any} session @param {{turn?: number, at?: number|null}} [snapshot] */
  seed(session, snapshot) {
    const sessionId = session?.header?.id ?? session?.id ?? null;
    if (!sessionId) return;
    const entry = this.#entry(sessionId);
    if (Number.isInteger(snapshot?.turn) && snapshot.turn >= 1) entry.lastTurn = snapshot.turn;
  }

  /** 会话销毁时清理。 @param {any} session */
  forget(session) {
    const sessionId = session?.header?.id ?? session?.id ?? null;
    if (sessionId) this.#bySession.delete(sessionId);
  }

  get size() {
    return this.#bySession.size;
  }
}

/**
 * 解析一次落板应写入的 turn。
 * @param {{sessionId: string|null, tracker?: TurnTracker|null, logTurn?: number|null}} input
 *   logTurn：退化来源（会话日志还原的当前轮，见 history.js#currentTurnFromLog）
 * @returns {{turn: number|null, source: "session-event"|"session-log"|"unavailable"}}
 */
export function resolveTurn(input) {
  const { sessionId, tracker, logTurn } = input ?? {};
  const tracked = tracker?.current(sessionId ?? null) ?? null;
  if (Number.isInteger(tracked) && tracked >= 1) return { turn: tracked, source: "session-event" };
  if (Number.isInteger(logTurn) && logTurn >= 1) return { turn: logTurn, source: "session-log" };
  return { turn: null, source: "unavailable" };
}
