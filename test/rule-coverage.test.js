/**
 * 规则瘦身的「多场景覆盖测试」（v1.35 / 0.1.6）：
 *
 * 瘦身的判断依据（用户提出）：
 * - 报错兜底只对「AI 已经动手做的那一步」有效；对「AI 没想起来要做的动作」无效。
 * - 所以「发起时机 / 判断类」规则一条都不能删，只能删「写入格式细则」（它由插件硬校验兜底）。
 *
 * 本测试用一张场景矩阵把这件事变成机械证据：
 *   A. 时机类场景：每个场景必须在规则区块里找到对应指令（否则就是漏删/漏留）。
 *   B. 格式类场景：规则区块不再写细则，但对应的硬校验报错必须仍然给「格式 + 示例 + 下一步」，
 *      证明能力没有消失，只是换到了报错载体上。
 *   C. 每一条保留下来的规则都必须至少被一个场景引用（防止「留着但没人测」）。
 *   D. 体积预算 + 回滚路径（装回旧区块再升级回来）。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RULE_BEGIN, RULE_BODY, RULE_END, buildRuleBlock, installRuleBlock } from "../src/host/rules.js";
import { makeEnv, rejectsWith } from "./helpers.js";

const SUMMARY = "验收范围：该节点下全部任务\n完成结论：已完成并留证据\n遗留风险：无";

/**
 * 时机类场景矩阵：rule = 覆盖的规则编号（1..9），keywords = 规则区块里必须出现的关键指令。
 * 这些场景的共同点：**AI 不主动做就永远不会有报错**，所以只能靠规则。
 */
const TIMING_SCENARIOS = [
  { id: "每轮自查", rule: 0, keywords: ["compass_status", "落板"] },
  { id: "开工先规划", rule: 1, keywords: ["开工先规划", "compass_plan", "完整任务树"] },
  { id: "新需求先落需求", rule: 1, keywords: ["compass_require"] },
  { id: "层级从属", rule: 2, keywords: ["层级按从属组织", "compass_move"] },
  { id: "中间插入", rule: 2, keywords: ["after/before", "废弃重建"] },
  { id: "状态变更留痕", rule: 3, keywords: ["pointer_note"] },
  { id: "卡住标阻塞", rule: 3, keywords: ["已阻塞", "阻塞：等什么 / 谁能解 / 下一步"] },
  { id: "需求状态不可手写", rule: 3, keywords: ["需求层 exec_state 由插件按子任务机械聚合"] },
  { id: "详情按交接文档写", rule: 4, keywords: ["交接文档", "核心文件", "避坑指南"] },
  { id: "父链滚动汇总", rule: 4, keywords: ["滚动汇总"] },
  { id: "需求汇总时机", rule: 4, keywords: ["验收范围", "完成结论", "遗留风险"] },
  { id: "漏记先补录", rule: 5, keywords: ["漏记先补录"] },
  { id: "祖先链同批更新", rule: 5, keywords: ["整条祖先链"] },
  { id: "history 边界", rule: 6, keywords: ["history 边界", "original_text"] },
  { id: "防重复任务", rule: 7, keywords: ["防重复", "已替代", "dead_reason"] },
  { id: "废弃覆盖子树", rule: 8, keywords: ["整棵子树"] },
  { id: "复活写明推翻理由", rule: 8, keywords: ["推翻上次废弃结论"] },
  { id: "迁移后核对基线", rule: 9, keywords: ["compass_migrate", "scope=baseline"] }
];

/** 格式类场景（已下沉到报错）：规则区块里不该再写细则，但报错必须仍然可执行。 */
const FORMAT_SCENARIOS = [
  { id: "完成说明三段格式", leak: ["标签在行首"] },
  { id: "祖先链缺哪个 id", leak: ["E_ANCESTOR_DETAIL_REQUIRED"] },
  { id: "需求汇总硬门", leak: ["E_REQUIREMENT_DETAIL_REQUIRED"] },
  { id: "批量 details 逐任务", leak: ["details（逐任务）"] }
];

test("A. 时机类场景：规则区块必须逐条覆盖（这些规则删了就没有兜底）", () => {
  const gaps = [];
  for (const scenario of TIMING_SCENARIOS) {
    const missing = scenario.keywords.filter((keyword) => !RULE_BODY.includes(keyword));
    if (missing.length > 0) gaps.push(`${scenario.id}（缺：${missing.join("、")}）`);
  }
  assert.deepEqual(gaps, [], `规则区块漏掉了时机类场景：${gaps.join("；")}`);
});

test("C. 每条保留的规则 1..9 都必须至少被一个场景引用（不允许留着没人测）", () => {
  const referenced = new Set(TIMING_SCENARIOS.map((scenario) => scenario.rule).filter((rule) => rule > 0));
  const missing = [];
  for (let rule = 1; rule <= 9; rule += 1) {
    if (!referenced.has(rule)) missing.push(rule);
  }
  assert.deepEqual(missing, [], `这些规则没有场景覆盖：${missing.join("、")}`);
  const numbers = [...RULE_BODY.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9], "规则条数必须是 9 条且编号连续");
});

test("B. 格式类场景：规则区块里不再写细则，但硬校验报错仍给「格式 + 示例 + 下一步」", async () => {
  // B1 规则区块不得再塞细则（否则瘦身没发生）
  for (const scenario of FORMAT_SCENARIOS) {
    for (const leak of scenario.leak) {
      assert.equal(RULE_BODY.includes(leak), false, `规则区块仍在写格式细则：${scenario.id} / ${leak}`);
    }
  }
  // B2 留一句指路（AI 要知道被拒后按报错改）
  assert.match(RULE_BODY, /由插件写前校验/);
  assert.match(RULE_BODY, /按报错一次改对/);

  // B3 能力仍在：真的触发硬校验，检查报错四要素
  const env = await makeEnv();
  try {
    await env.compass.init();
    const requirement = await env.compass.require({ title: "需求A", human_line: "覆盖矩阵", surface: "覆盖矩阵" });
    const task = await env.compass.plan({ parent_id: requirement.requirement_id, title: "任务1", human_line: "任务一" });

    const completionErr = await rejectsWith(
      env.compass.update({
        task_ids: [task.task_id],
        exec_state: "已执行",
        pointer_note: "完成",
        detail: "核心文件：无 契约：无 避坑指南：无"
      }),
      "E_DETAIL_CONTENT_INVALID"
    );
    assert.match(completionErr.message, /每段单独占一行/, "完成说明报错必须给格式");
    assert.match(completionErr.message, /例如：/, "完成说明报错必须给示例");
    assert.match(completionErr.message, /下一步：/, "完成说明报错必须给下一步");

    const ancestorErr = await rejectsWith(
      env.compass.update({ task_ids: [task.task_id], detail: "核心文件：无\n契约：无\n避坑指南：无" }),
      "E_ANCESTOR_DETAIL_REQUIRED"
    );
    assert.match(ancestorErr.message, /缺少：R-001/, "祖先链报错必须点名缺失 id");
    assert.match(ancestorErr.message, /例如：/, "祖先链报错必须给示例");
    assert.match(ancestorErr.message, /下一步：/, "祖先链报错必须给下一步");

    const pointerErr = await rejectsWith(
      env.compass.update({ task_ids: [task.task_id], exec_state: "进行中" }),
      "E_POINTER_NOTE_REQUIRED"
    );
    assert.match(pointerErr.message, /pointer_note:"/, "pointer_note 报错必须给可照抄写法");

    const pathErr = await rejectsWith(
      env.compass.update({ task_ids: [task.task_id], detail: `核心文件：src/nope-xyz.js\n契约：无\n避坑指南：无`, details: { [requirement.requirement_id]: SUMMARY } }),
      "E_DETAIL_PATH_NOT_FOUND"
    );
    assert.match(pathErr.message, /建议操作：/, "路径报错必须给整改指引");
  } finally {
    await env.cleanup();
  }
});

test("D1. 体积预算：规则正文显著小于瘦身前（18 条 / 2079 字符）", () => {
  assert.ok(RULE_BODY.length <= 1600, `规则正文仍偏长：${RULE_BODY.length}`);
  assert.ok(RULE_BODY.length >= 800, `规则正文过短，可能漏掉时机类规则：${RULE_BODY.length}`);
  const block = buildRuleBlock();
  assert.ok(block.length <= 1700, `整块仍偏长：${block.length}`);
  assert.equal((block.match(new RegExp(RULE_BEGIN, "g")) ?? []).length, 1);
  assert.equal((block.match(new RegExp(RULE_END, "g")) ?? []).length, 1);
});

test("D2. 回滚路径：装回旧 18 条区块 → 再升级回瘦身版，两次都成功且用户内容不变", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-compass-rule-rollback-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "AGENTS.md");
  const oldBlock = await fs.readFile(new URL("./fixtures/rule-block-v1.33-18rules.txt", import.meta.url), "utf8");
  await fs.writeFile(file, `# 我的规则\n\n${buildRuleBlock()}\n`, "utf8");

  // 回滚：装回旧区块
  const rolledBack = await installRuleBlock(file, { block: oldBlock.trim() });
  assert.equal(rolledBack.status, "updated");
  let text = await fs.readFile(file, "utf8");
  assert.ok(text.includes(oldBlock.trim()), "旧区块必须完整装回");
  assert.equal((text.match(new RegExp(RULE_BEGIN, "g")) ?? []).length, 1);

  // 再升级：装回瘦身版
  const upgraded = await installRuleBlock(file);
  assert.equal(upgraded.status, "updated");
  text = await fs.readFile(file, "utf8");
  assert.ok(text.includes(buildRuleBlock()), "必须回到瘦身版");
  assert.ok(text.includes("# 我的规则"), "用户内容必须保留");
  assert.equal((text.match(new RegExp(RULE_BEGIN, "g")) ?? []).length, 1);
});
