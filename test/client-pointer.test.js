/**
 * 追溯指针视图逻辑（B-43 / A28）：会话可用性 / 降级文案 / 格式化。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_STATES,
  describeSessionLink,
  formatPointerAt,
  isValidSessionId,
  pointerRow,
  resolveSessionLinkState,
  sessionLinkState,
  shortSessionId
} from "../src/client/pointer-view.js";

const SESSION = "session-31d0d778-1234-4abc-9def-0123456789ab";

test("isValidSessionId：区分会话 id 与迁移 file 段（含裸 UUID 子代理会话）", () => {
  assert.equal(isValidSessionId(SESSION), true);
  assert.equal(isValidSessionId("0d6e42f5-faf6-40b1-8a57-6d5ae7951ec5"), true, "子代理会话 id 是裸 UUID（v1.30 / B-61）");
  assert.equal(isValidSessionId("file:D:/x/status.md#L3-L9"), false);
  assert.equal(isValidSessionId(""), false);
  assert.equal(isValidSessionId(null), false);
});

test("sessionLinkState：可用 / 不可用 / 归档 / 加载中 / 宿主不支持 / 文件段", () => {
  const base = {
    canOpen: true,
    sessions: { ids: [SESSION], phase: "ready" },
    workspaces: { state: "ready", archivedSessionIds: [] }
  };
  assert.equal(sessionLinkState(SESSION, base), SESSION_STATES.AVAILABLE);
  assert.equal(sessionLinkState("file:D:/x/status.md#L1-L2", base), SESSION_STATES.FILE);
  assert.equal(sessionLinkState("ui-demo-session", base), SESSION_STATES.UNAVAILABLE, "非 session- 前缀的未知来源不当作文件段");
  assert.equal(
    sessionLinkState("session-deadbeef", base),
    SESSION_STATES.UNAVAILABLE,
    "不在会话列表 ⇒ 不可用"
  );
  assert.equal(
    sessionLinkState(SESSION, { ...base, workspaces: { state: "ready", archivedSessionIds: [SESSION] } }),
    SESSION_STATES.ARCHIVED
  );
  assert.equal(sessionLinkState(SESSION, { ...base, sessions: { ids: [], phase: "pending" } }), SESSION_STATES.LOADING);
  assert.equal(sessionLinkState(SESSION, { ...base, canOpen: false }), SESSION_STATES.UNSUPPORTED);
  assert.equal(sessionLinkState(SESSION, { canOpen: true, sessions: null, workspaces: null }), SESSION_STATES.UNSUPPORTED);
  assert.equal(
    sessionLinkState(SESSION, { ...base, workspaces: { state: "error" } }),
    SESSION_STATES.UNAVAILABLE
  );
});

test("resolveSessionLinkState：宿主核验覆盖「会话不可用」假阴性，归档/加载中/文件段保持原判（B-61）", () => {
  // 客户端快照缺该会话 ⇒ sessionLinkState 判 UNAVAILABLE；日志存在 ⇒ 覆盖为 AVAILABLE
  assert.equal(resolveSessionLinkState(SESSION_STATES.UNAVAILABLE, true), SESSION_STATES.AVAILABLE);
  assert.equal(resolveSessionLinkState(SESSION_STATES.UNAVAILABLE, false), SESSION_STATES.UNAVAILABLE);
  assert.equal(resolveSessionLinkState(SESSION_STATES.UNAVAILABLE, undefined), SESSION_STATES.UNAVAILABLE);
  // 已可用/归档/加载中/文件段不被覆盖
  assert.equal(resolveSessionLinkState(SESSION_STATES.AVAILABLE, false), SESSION_STATES.AVAILABLE);
  assert.equal(resolveSessionLinkState(SESSION_STATES.ARCHIVED, true), SESSION_STATES.ARCHIVED);
  assert.equal(resolveSessionLinkState(SESSION_STATES.LOADING, true), SESSION_STATES.LOADING);
  assert.equal(resolveSessionLinkState(SESSION_STATES.FILE, true), SESSION_STATES.FILE);
  // 宿主不支持会话跳转（canOpen=false）时不因日志存在就放行
  assert.equal(resolveSessionLinkState(SESSION_STATES.UNSUPPORTED, true), SESSION_STATES.UNSUPPORTED);
  assert.equal(resolveSessionLinkState(undefined, undefined), SESSION_STATES.UNAVAILABLE);
});

test("describeSessionLink：不可用态必须有可见文案（不静默）", () => {
  for (const state of [
    SESSION_STATES.UNAVAILABLE,
    SESSION_STATES.ARCHIVED,
    SESSION_STATES.LOADING,
    SESSION_STATES.UNSUPPORTED,
    SESSION_STATES.FILE
  ]) {
    assert.ok(describeSessionLink(state).length > 0, `${state} 必须有降级文案`);
  }
  assert.equal(describeSessionLink(SESSION_STATES.AVAILABLE), "");
  assert.match(describeSessionLink(SESSION_STATES.UNAVAILABLE), /会话不可用/);
});

test("shortSessionId / fieldformat：长 id 缩略、ISO 时间格式化、非法输入不编造", () => {
  const short = shortSessionId(SESSION);
  assert.ok(short.length < SESSION.length);
  assert.match(short, /^session-31d0…/);
  assert.equal(shortSessionId("s-1"), "s-1");
  assert.equal(formatPointerAt("2026-11-11T12:34:56.789Z"), "2026-11-11 12:34:56");
  assert.equal(formatPointerAt("not-a-date"), "");
  assert.equal(formatPointerAt(null), "");
});

test("pointerRow：轮次只在合法非负整数时显示，note/session 缺失不抛错", () => {
  const row = pointerRow({ session: SESSION, at: "2026-11-11T12:34:56.789Z", turn: 7, note: "开始" }, 0);
  assert.equal(row.turn, 7);
  assert.equal(row.note, "开始");
  assert.equal(row.at, "2026-11-11 12:34:56");
  assert.ok(row.key.includes(SESSION));

  const weird = pointerRow({ session: SESSION, turn: -1, note: null }, 3);
  assert.equal(weird.turn, null);
  assert.equal(weird.note, "");
  assert.equal(weird.at, "");
});
