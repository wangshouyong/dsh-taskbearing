/**
 * 旧会话「暂无数据」空态（B-63 / v1.32）：固定指令 + 文案/动作判定（§8.21）。
 * 纯逻辑单测：不依赖 React / DOM / 真实宿主。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKFILL_PROMPT,
  INIT_PROMPT,
  describeUninitialized,
  formatLatestAt
} from "../src/client/uninitialized.js";

test("回填指令（BACKFILL_PROMPT）：先 init 再 preview→apply，原话只许 refs，禁止代写", () => {
  assert.match(BACKFILL_PROMPT, /compass_status/);
  assert.match(BACKFILL_PROMPT, /compass_init/);
  assert.match(BACKFILL_PROMPT, /compass_import\(mode="preview"\)/);
  assert.match(BACKFILL_PROMPT, /compass_import\(mode="apply"\)/);
  assert.match(BACKFILL_PROMPT, /refs/);
  assert.match(BACKFILL_PROMPT, /禁止代写/);
  assert.match(BACKFILL_PROMPT, /B-29/);
  // 指令不得要求 AI 传入原话正文（B-29：AI 不传原话）
  assert.doesNotMatch(BACKFILL_PROMPT, /original_text/);
  assert.match(INIT_PROMPT, /compass_init/);
});

test("有历史会话：文案报告会话数 + 两个用户选择（回填 primary / 暂不回填）", () => {
  const desc = describeUninitialized({
    history: { available: true, sessions: 3, latest_at: "2026-11-12T06:23:19.000Z", truncated: false },
    dismissed: false,
    backfill: { status: "idle" }
  });
  assert.equal(desc.title, "任务板暂无数据");
  assert.match(desc.message, /3 个历史会话/);
  assert.match(desc.message, /最近/);
  assert.match(desc.message, /回填与否由你决定/);
  assert.doesNotMatch(desc.message, /读取失败|旧版宿主/);
  assert.deepEqual(
    desc.actions.map((action) => [action.id, action.label, action.primary === true]),
    [
      ["backfill", "回填历史会话", true],
      ["dismiss", "暂不回填", false]
    ]
  );
  assert.match(desc.hint, /逐字取回/);
});

test("无历史会话：只提供「让 AI 初始化任务板」+ 复制提示", () => {
  const desc = describeUninitialized({
    history: { available: true, sessions: 0, latest_at: null, truncated: false },
    dismissed: false,
    backfill: { status: "idle" }
  });
  assert.equal(desc.title, "任务板尚未初始化");
  assert.match(desc.message, /还没有任务板数据/);
  assert.doesNotMatch(desc.message, /历史会话（/);
  assert.deepEqual(
    desc.actions.map((action) => action.id),
    ["init", "copy-init"]
  );
  assert.equal(desc.actions[0].primary, true);
});

test("正在发送：按钮禁用并显示发送中（防重复注入）", () => {
  const desc = describeUninitialized({ history: { sessions: 2 }, backfill: { status: "sending" } });
  assert.match(desc.message, /正在把回填指令发进当前会话/);
  const backfill = desc.actions.find((action) => action.id === "backfill");
  assert.equal(backfill.label, "发送中…");
  assert.equal(backfill.disabled, true);
  assert.equal(desc.actions.find((action) => action.id === "dismiss").disabled, true);
});

test("已发送：提示自动刷新 + 刷新/复制入口，不显示暂不回填", () => {
  const desc = describeUninitialized({ history: { sessions: 2 }, backfill: { status: "sent" } });
  assert.match(desc.message, /已发送回填指令/);
  assert.match(desc.message, /自动刷新/);
  assert.deepEqual(
    desc.actions.map((action) => action.id),
    ["refresh", "copy"]
  );
});

test("发送失败降级：必须可见地说明原因并复制指令（不静默、不假装成功）", () => {
  const copied = describeUninitialized({
    history: { sessions: 1 },
    backfill: { status: "fallback", reason: "宿主不支持自动发送（缺少 conversation 服务）", copied: true }
  });
  assert.match(copied.message, /任务板暂无数据/);
  assert.match(copied.hint, /宿主不支持自动发送/);
  assert.match(copied.hint, /已复制到剪贴板/);
  assert.equal(copied.actions[0].id, "copy");
  assert.equal(copied.actions[0].primary, true);

  const copyFailed = describeUninitialized({
    history: { sessions: 1 },
    backfill: { status: "fallback", reason: "发送失败", copied: false }
  });
  assert.match(copyFailed.hint, /自动复制失败/);
  assert.doesNotMatch(copyFailed.message, /已发送/);
});

test("用户选择暂不回填：只收起提示，仍保留回填入口（不初始化、不写盘）", () => {
  const desc = describeUninitialized({ history: { sessions: 4 }, dismissed: true, backfill: { status: "idle" } });
  assert.match(desc.message, /已跳过回填/);
  assert.equal(desc.actions[0].id, "backfill");
  assert.deepEqual(
    desc.actions.map((action) => action.id),
    ["backfill", "refresh"]
  );
});

test("历史摘要不可用（旧宿主缺路由）：不阻塞，给回填与初始化两条路", () => {
  const desc = describeUninitialized({ history: null, dismissed: false, backfill: { status: "idle" } });
  assert.match(desc.hint, /无法读取历史会话摘要/);
  assert.deepEqual(
    desc.actions.map((action) => action.id),
    ["backfill", "dismiss", "init"]
  );
});

test("formatLatestAt：取本地时间展示，非法/缺失返回空串", () => {
  assert.equal(formatLatestAt(null), "");
  assert.equal(formatLatestAt(""), "");
  assert.equal(formatLatestAt("not-a-date"), "");
  assert.match(formatLatestAt("2026-11-12T06:23:19.000Z"), /^2026-11-12 \d{2}:\d{2}$/);
});
