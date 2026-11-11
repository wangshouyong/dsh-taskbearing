import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import {
  createHistoryReader,
  decodeSessionLog,
  extractUserMessages,
  listWorkspaceSessions,
  readSessionUserMessages,
  workspaceSessionKey
} from "../src/host/history.js";

const ENCODER = new TextEncoder();

/** 造一份多帧 zstd 会话日志。 */
async function writeSessionLog(file, events, frames = 2) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const chunk = Math.ceil(lines.length / frames);
  const parts = [];
  for (let i = 0; i < frames; i += 1) {
    const slice = lines.slice(i * chunk, (i + 1) * chunk);
    if (!slice) continue;
    parts.push(zlib.zstdCompressSync(ENCODER.encode(slice)));
  }
  await fs.writeFile(file, Buffer.concat(parts));
}

function makeEvents() {
  return [
    { seq: 1, type: "session", data: {}, time: 1000 },
    { seq: 2, type: "turn/start", data: { turn: 1 }, time: 1001 },
    {
      seq: 3,
      type: "user/message",
      time: 1002,
      data: { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "把 PPT 里的图变成能拖顶点的形状" }] }
    },
    {
      seq: 4,
      type: "user/message",
      time: 1003,
      data: { role: "user", source: { kind: "runtime-context" }, content: [{ type: "text", text: "Current runtime context. 注入内容" }] }
    },
    { seq: 5, type: "turn/end", data: { turn: 1 }, time: 1004 },
    { seq: 6, type: "turn/start", data: { turn: 2 }, time: 1005 },
    {
      seq: 7,
      type: "user/message",
      time: 1006,
      data: { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "另外矩形也要能拖" }] }
    }
  ];
}

test("workspaceSessionKey：ASCII 与中文路径编码（实测样本反推）", () => {
  assert.equal(workspaceSessionKey("D:\\work\\demo"), "--D-work-demo--");
  assert.equal(workspaceSessionKey("D:\\work\\测试-杂活"), "--D-work-~6D4B~8BD5-~6742~6D3B--");
  assert.equal(workspaceSessionKey("C:\\Users\\demo\\OneDrive\\文档\\ChatGPT Forge"), "--C-Users-demo-OneDrive-~6587~6863-ChatGPT-Forge--");
});

test("decodeSessionLog / extractUserMessages：多帧拼接、只收 source.kind=user", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-history-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "session.lz");
  await writeSessionLog(file, makeEvents(), 3);
  const buf = await fs.readFile(file);
  const text = decodeSessionLog(buf);
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const messages = extractUserMessages(events);
  assert.deepEqual(
    messages.map((message) => ({ index: message.index, text: message.text })),
    [
      { index: 1, text: "把 PPT 里的图变成能拖顶点的形状" },
      { index: 2, text: "另外矩形也要能拖" }
    ]
  );
  assert.equal(messages[0].turn, 1);
  assert.equal(messages[1].turn, 2);
});

test("listWorkspaceSessions / createHistoryReader：按工作区定位、preview 与 readMessage", async (t) => {
  const sessionsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "compass-sessions-"));
  t.after(() => fs.rm(sessionsRoot, { recursive: true, force: true }));

  const workspacePath = path.join("D:", "work", "demo");
  const key = workspaceSessionKey(workspacePath);
  await writeSessionLog(path.join(sessionsRoot, key, "session-a", "session.v4.jsonl.zstd"), makeEvents(), 2);
  // 另一个工作区的会话不应出现
  await writeSessionLog(path.join(sessionsRoot, "--D-other--", "session-b", "session.v4.jsonl.zstd"), makeEvents(), 1);

  const sessions = await listWorkspaceSessions({ sessionsRoot, workspacePath });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session, "session-a");

  const reader = createHistoryReader({ sessionsRoot, workspacePath });
  const listed = await reader.listMessages({ limit: 10 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].session, "session-a");
  assert.equal(listed[0].messages.length, 2);

  const message = await reader.readMessage({ session: "session-a", index: 2 });
  assert.equal(message?.text, "另外矩形也要能拖");
  assert.equal(message?.at, new Date(1006).toISOString());

  assert.equal(await reader.readMessage({ session: "session-a", index: 99 }), null);
  assert.equal(await reader.readMessage({ session: "nope", index: 1 }), null);
});

test("readSessionUserMessages：注入消息被 source 过滤，不混入原话", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "compass-session-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSessionLog(path.join(dir, "session.v4.jsonl.zstd"), makeEvents(), 1);
  const messages = await readSessionUserMessages(dir);
  assert.deepEqual(
    messages.map((message) => message.text),
    ["把 PPT 里的图变成能拖顶点的形状", "另外矩形也要能拖"]
  );
});
