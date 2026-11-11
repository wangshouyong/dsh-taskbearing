import assert from "node:assert/strict";
import test from "node:test";

import { genuineUserMessages, hostSessionInfo, isInjectedUserText, messageText, readOriginal, stripSystemReminders, userMessages } from "../src/host/session.js";

const REMINDER =
  "<system-reminder>\nA skill is a reusable set of task-specific instructions.\n- `sd-asset-engine`: ...\n</system-reminder>";

const messages = [
  { role: "system", content: "系统提示" },
  { role: "user", content: `${REMINDER}\n把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏` },
  { role: "assistant", content: "好的" },
  { role: "user", content: "另外矩形也要能拖" },
  { role: "assistant", content: "收到" }
];

const session = {
  header: { id: "session-abc", cwd: "D:/work/demo" },
  deriveMessages: () => messages
};
const exec = { agent: { session } };

test("stripSystemReminders：剥掉机器注入块，其余逐字保留", () => {
  const raw = `${REMINDER}\n把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏`;
  assert.equal(stripSystemReminders(raw), "把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏");
});

test("messageText：字符串与分段数组都取纯文本", () => {
  assert.equal(messageText({ content: "abc" }), "abc");
  assert.equal(messageText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }), "ab");
  assert.equal(messageText(null), "");
});

test("userMessages：只收 user 角色，按用户消息计 turn，注入块被剥离", () => {
  const users = userMessages(messages);
  assert.equal(users.length, 2);
  assert.equal(users[0].turn, 1);
  assert.match(users[0].text, /^把 PPT 里的图/);
  assert.equal(users[1].turn, 2);
  assert.equal(users[1].text, "另外矩形也要能拖");
});

test("hostSessionInfo：从 exec 取 sessionId / cwd", () => {
  assert.deepEqual(hostSessionInfo(exec), { sessionId: "session-abc", cwd: "D:/work/demo", session });
  assert.deepEqual(hostSessionInfo(undefined), { sessionId: null, cwd: null, session: null });
});

test("readOriginal：current 取最后一条用户原话（不含注入块）", () => {
  const got = readOriginal("current", { exec, now: () => new Date("2026-11-11T08:00:00.000Z") });
  assert.equal(got.text, "另外矩形也要能拖");
  assert.equal(got.session, "session-abc");
  assert.equal(got.at, "2026-11-11T08:00:00.000Z");
  assert.equal(got.turn, 2);
});

test("readOriginal：按 turn / index 精确取历史原话", () => {
  const byTurn = readOriginal([{ turn: 1 }], { exec });
  assert.match(byTurn.text, /^把 PPT 里的图/);
  assert.equal(byTurn.turn, 1);

  const byIndex = readOriginal({ index: 3 }, { exec });
  assert.equal(byIndex.text, "另外矩形也要能拖");

  const byShort = readOriginal([1], { exec });
  assert.match(byShort.text, /^把 PPT 里的图/);
});

test("readOriginal：refs 指向非 user 消息 / 无会话时返回 null", () => {
  assert.equal(readOriginal({ index: 0 }, { exec }), null);
  assert.equal(readOriginal({ index: 99 }, { exec }), null);
  assert.equal(readOriginal("current", { exec: null }), null);
});

test("isInjectedUserText：runtime-context / 指令基线 / 技能清单判为注入", () => {
  assert.equal(isInjectedUserText("Current runtime context. This snapshot supersedes earlier runtime-context snapshots."), true);
  assert.equal(isInjectedUserText("Current DSH file policy: workspace-write."), true);
  assert.equal(isInjectedUserText("A skill is a reusable set of task-specific instructions."), true);
  assert.equal(isInjectedUserText("把 PPT 里的图变成能拖顶点的形状"), false);

  const injectedMessages = [
    { role: "user", content: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots." },
    { role: "user", content: "x".repeat(3000) },
    { role: "user", content: "另外矩形也要能拖" }
  ];
  assert.deepEqual(
    genuineUserMessages(injectedMessages).map((entry) => entry.text),
    ["另外矩形也要能拖"]
  );
});