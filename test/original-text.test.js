/**
 * 原话写入与校验（B-53，v1.24）：AI 传入 original_text + 插件与当前会话逐字比对；
 * 含注入块识别（B-26 修订）与互斥校验。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { verifyOriginalText, isInjectedUserText, stripSystemReminders } from "../src/host/session.js";
import { makeEnv, rejectsWith } from "./helpers.js";

const REAL = "把弹出层改成居中大弹窗，别再把内容裁掉";

/** 构造 deriveMessages 的假会话：真实用户消息 + 机器注入快照。 */
function fakeExec() {
  const messages = [
    { role: "user", content: "<system-reminder>技能清单</system-reminder>", at: 1 },
    { role: "assistant", content: "好的", at: 2 },
    { role: "user", content: REAL, at: 3 },
    {
      role: "user",
      content:
        "Time sampled while preparing turn 2, step 27: 2026-11-11T21:51:04+08:00[Asia/Shanghai]\nBrowser time zone for this request: Asia/Shanghai.\nElapsed since the preceding step context: unavailable.",
      at: 4
    }
  ];
  return { agent: { session: { header: { id: "s-test", cwd: "D:/ws" }, deriveMessages: () => messages } } };
}

test("verifyOriginalText：与当前会话用户消息逐字一致才通过，注入块不算用户消息", () => {
  const exec = fakeExec();
  const ok = verifyOriginalText(REAL, { exec });
  assert.equal(ok.ok, true);
  assert.equal(ok.index, 2, "命中真实用户消息（注入块被排除）");
  assert.equal(ok.at, new Date(3).toISOString());

  assert.equal(verifyOriginalText(`${REAL}。`, { exec }).ok, false, "多一个标点也拒绝");
  assert.equal(verifyOriginalText("把弹出层改成居中弹窗", { exec }).ok, false, "转述/改写拒绝");
  assert.equal(verifyOriginalText("技能清单", { exec }).ok, false, "注入块文本不得作为原话");
  assert.equal(verifyOriginalText("", { exec }).ok, false);
  assert.equal(verifyOriginalText(REAL, { exec: null }).ok, false, "无会话上下文不通过");
});

test("注入块识别：Time-sampled 运行时快照判为机器注入", () => {
  const snapshot =
    "Time sampled while preparing turn 2, step 27: 2026-11-11T21:51:04+08:00[Asia/Shanghai]\nBrowser time zone for this request: Asia/Shanghai.";
  assert.equal(isInjectedUserText(snapshot), true);
  assert.equal(isInjectedUserText(REAL), false);
  assert.equal(stripSystemReminders(`<system-reminder>x</system-reminder>${REAL}`), REAL);
});

test("compass_require(original_text)：校验通过即锁定，基线可逐字回读（A38）", async () => {
  const env = await makeEnv({
    verify: async (text) => (text === REAL ? { ok: true, at: "2026-11-11T13:40:28.000Z", index: 2, turn: 5 } : { ok: false })
  });
  try {
    await env.compass.init();
    const res = await env.compass.require({
      title: "弹窗重设计",
      human_line: "把详情弹窗改成居中大弹窗",
      surface: "详情弹窗改居中大弹窗",
      original_text: REAL
    });
    assert.equal(res.original_locked, true);
    const baseline = await env.compass.read({ scope: "baseline" });
    const version = baseline.requirements.find((item) => item.id === "R-001").versions[0];
    assert.equal(version.original, REAL, "原话逐字落盘");
    assert.equal(version.originalLock, true);
    assert.equal(version.msg.session, "s-test");
    assert.equal(version.msg.at, "2026-11-11T13:40:28.000Z");
  } finally {
    await env.cleanup();
  }
});

test("compass_require(original_text)：改写版 ⇒ E_ORIGINAL_MISMATCH 且数据不写（A38）", async () => {
  const env = await makeEnv({
    verify: async (text) => (text === REAL ? { ok: true, at: "2026-11-11T13:40:28.000Z", index: 2 } : { ok: false })
  });
  try {
    await env.compass.init();
    await rejectsWith(
      env.compass.require({
        title: "弹窗重设计",
        human_line: "把详情弹窗改成居中大弹窗",
        surface: "详情弹窗改居中大弹窗",
        original_text: "把弹出层改成居中弹窗（我顺手改了两个词）"
      }),
      "E_ORIGINAL_MISMATCH"
    );
    const tree = await env.store.readTree();
    assert.equal(tree.root.children.length, 0, "任务树不写");
    const baseline = await env.compass.read({ scope: "baseline" });
    assert.equal(baseline.requirements.length, 0, "基线不写");
  } finally {
    await env.cleanup();
  }
});

test("original_text 与 original_refs 互斥；无校验器时拒绝（A38）", async () => {
  const env = await makeEnv({
    verify: async (text) => (text === REAL ? { ok: true, at: "2026-11-11T13:40:28.000Z", index: 2 } : { ok: false })
  });
  try {
    await env.compass.init();
    await rejectsWith(
      env.compass.require({
        title: "x",
        human_line: "x",
        surface: "x",
        original_text: REAL,
        original_refs: "current"
      }),
      "E_INVALID_ARG"
    );
  } finally {
    await env.cleanup();
  }

  const bare = await makeEnv();
  try {
    await bare.compass.init();
    await rejectsWith(
      bare.compass.require({ title: "y", human_line: "y", surface: "y", original_text: REAL }),
      "E_ORIGINAL_MISMATCH"
    );
  } finally {
    await bare.cleanup();
  }
});

test("compass_change(original_text)：新版本同样逐字校验（A38）", async () => {
  const env = await makeEnv({
    verify: async (text) => (text === REAL ? { ok: true, at: "2026-11-11T13:40:28.000Z", index: 2 } : { ok: false })
  });
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "初始明面" });
    const res = await env.compass.change({
      requirement_id: "R-001",
      new_text: "新的明面",
      reason: "用户补充",
      original_text: REAL
    });
    assert.equal(res.appended, "v2");
    assert.equal(res.original_locked, true);
    const baseline = await env.compass.read({ scope: "baseline" });
    const v2 = baseline.requirements[0].versions[1];
    assert.equal(v2.original, REAL);
    assert.equal(v2.reason, "用户补充");

    await rejectsWith(
      env.compass.change({
        requirement_id: "R-001",
        new_text: "再来一版",
        reason: "再改",
        original_text: REAL.slice(0, 10)
      }),
      "E_ORIGINAL_MISMATCH"
    );
  } finally {
    await env.cleanup();
  }
});
