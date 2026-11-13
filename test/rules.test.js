import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RULE_BEGIN,
  RULE_END,
  buildRuleBlock,
  installRuleBlock,
  locateRuleBlock,
  removeRuleBlock
} from "../src/host/rules.js";

async function tempRules(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-compass-rules-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "AGENTS.md");
}

test("install：文件不存在时新建，只含标记区块", async (t) => {
  const file = await tempRules(t);
  const result = await installRuleBlock(file);
  assert.equal(result.status, "installed");
  const text = await fs.readFile(file, "utf8");
  assert.ok(text.startsWith(RULE_BEGIN));
  assert.ok(text.trimEnd().endsWith(RULE_END));
  assert.ok(text.includes("需求层 exec_state 由插件按子任务机械聚合"));
});

test("install：已有用户规则时追加，区块外内容零改动", async (t) => {
  const file = await tempRules(t);
  const userContent = "# 我的规则\n\n- 别动我\n";
  await fs.writeFile(file, userContent, "utf8");

  const result = await installRuleBlock(file);
  assert.equal(result.status, "installed");

  const text = await fs.readFile(file, "utf8");
  assert.ok(text.startsWith(userContent), "用户原有内容必须原样保留在开头");
  assert.ok(text.includes(RULE_BEGIN));
});

test("install：重复调用幂等", async (t) => {
  const file = await tempRules(t);
  await installRuleBlock(file);
  const before = await fs.readFile(file, "utf8");
  const second = await installRuleBlock(file);
  assert.equal(second.status, "unchanged");
  assert.equal(await fs.readFile(file, "utf8"), before);
});

test("install：升级替换区块内内容，不堆叠", async (t) => {
  const file = await tempRules(t);
  await fs.writeFile(file, `# 用户规则\n\n${RULE_BEGIN}\n旧版内容\n${RULE_END}\n\n尾巴\n`, "utf8");

  const result = await installRuleBlock(file);
  assert.equal(result.status, "updated");

  const text = await fs.readFile(file, "utf8");
  assert.equal((text.match(new RegExp(RULE_BEGIN, "g")) ?? []).length, 1);
  assert.ok(!text.includes("旧版内容"));
  assert.ok(text.includes("# 用户规则"));
  assert.ok(text.trimEnd().endsWith("尾巴"));
});

test("install：标记残缺 → 拒绝自动修改（E_STORE_CORRUPT）", async (t) => {
  const file = await tempRules(t);
  await fs.writeFile(file, `# 用户规则\n${RULE_BEGIN}\n只有开始\n`, "utf8");
  await assert.rejects(() => installRuleBlock(file), (err) => err.code === "E_STORE_CORRUPT");
  assert.ok((await fs.readFile(file, "utf8")).includes("只有开始"), "拒绝后不得改动文件");
});

test("remove：移除区块且保留用户内容；不存在时 absent", async (t) => {
  const file = await tempRules(t);
  await fs.writeFile(file, "# 用户规则\n\n用户尾巴\n", "utf8");
  assert.deepEqual((await removeRuleBlock(file)).status, "absent");

  await installRuleBlock(file);
  const removed = await removeRuleBlock(file);
  assert.equal(removed.status, "removed");

  const text = await fs.readFile(file, "utf8");
  assert.ok(!text.includes(RULE_BEGIN));
  assert.ok(text.includes("# 用户规则"));
});

test("buildRuleBlock / locateRuleBlock：边界稳定", () => {
  const block = buildRuleBlock();
  const text = `前置\n${block}\n后置`;
  const located = locateRuleBlock(text);
  assert.equal(located.present, true);
  assert.equal(located.broken, false);
  assert.equal(text.slice(located.begin, located.end + RULE_END.length), block);
});

test("规则 v1.35：瘦身后保留全部「发起时机/判断」规则，格式细则下沉到报错", async () => {
  const { RULE_BODY } = await import("../src/host/rules.js");

  // 保留项（报错兜不住的发起时机/判断类）：逐条断言关键指令仍在
  assert.match(RULE_BODY, /compass_status/);
  assert.match(RULE_BODY, /确认即落板/);
  assert.match(RULE_BODY, /不以「是否开工」为前提/);
  assert.match(RULE_BODY, /排期/);
  assert.match(RULE_BODY, /待裁决/);
  assert.match(RULE_BODY, /完整任务树/);
  assert.match(RULE_BODY, /层级按从属组织/);
  assert.match(RULE_BODY, /after\/before/);
  assert.match(RULE_BODY, /compass_move/);
  assert.match(RULE_BODY, /pointer_note/);
  assert.match(RULE_BODY, /卡住时把执行态标为「已阻塞」/);
  assert.match(RULE_BODY, /阻塞：等什么 \/ 谁能解 \/ 下一步/);
  assert.match(RULE_BODY, /需求层 exec_state 由插件按子任务机械聚合/);
  assert.match(RULE_BODY, /交接文档/);
  assert.match(RULE_BODY, /核心文件/);
  assert.match(RULE_BODY, /契约\/文档/);
  assert.match(RULE_BODY, /避坑指南/);
  assert.match(RULE_BODY, /查询结论 \/ 数据来源 \/ 后续建议/);
  assert.match(RULE_BODY, /验收范围 \/ 完成结论 \/ 遗留风险/);
  assert.match(RULE_BODY, /整条祖先链/);
  assert.match(RULE_BODY, /漏记先补录/);
  assert.match(RULE_BODY, /history 边界/);
  assert.match(RULE_BODY, /original_text/);
  assert.match(RULE_BODY, /不重拉历史/);
  assert.match(RULE_BODY, /防重复/);
  assert.match(RULE_BODY, /已替代/);
  assert.match(RULE_BODY, /整棵子树/);
  assert.match(RULE_BODY, /推翻上次废弃结论/);
  assert.match(RULE_BODY, /compass_migrate/);

  // 下沉项（写入格式细则不再写进规则区块，改由插件报错四要素兜底）
  assert.doesNotMatch(RULE_BODY, /三段必须各起一行、标签在行首/);
  assert.doesNotMatch(RULE_BODY, /E_REQUIREMENT_DETAIL_REQUIRED/);
  assert.doesNotMatch(RULE_BODY, /E_ANCESTOR_DETAIL_REQUIRED/);
  assert.doesNotMatch(RULE_BODY, /details（逐任务）/);
  // 但必须留一句明确指路：格式错了按报错改
  assert.match(RULE_BODY, /由插件写前校验/);
  assert.match(RULE_BODY, /按报错一次改对/);

  // 规则条数：9 条，编号连续
  const numbers = [...RULE_BODY.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // 体积预算：必须明显小于瘦身前（18 条 / 2079 字符）
  assert.ok(RULE_BODY.length <= 1600, `规则正文仍偏长：${RULE_BODY.length} 字符`);
});

test("规则升级：旧 18 条区块安装在先 → 升级为瘦身版，整块替换不堆叠、用户内容零改动", async (t) => {
  const { installRuleBlock, RULE_BEGIN, buildRuleBlock } = await import("../src/host/rules.js");
  const oldBlock = await fs.readFile(new URL("./fixtures/rule-block-v1.33-18rules.txt", import.meta.url), "utf8");
  const file = await tempRules(t);
  await fs.writeFile(file, `# 我的规则\n\n${oldBlock.trim()}\n\n尾巴内容\n`, "utf8");

  const result = await installRuleBlock(file);
  assert.equal(result.status, "updated");
  const text = await fs.readFile(file, "utf8");
  assert.equal((text.match(new RegExp(RULE_BEGIN, "g")) ?? []).length, 1);
  assert.ok(text.trimEnd().endsWith("尾巴内容"));
  assert.ok(text.includes("# 我的规则"));
  assert.equal(text.includes(oldBlock.trim()), false, "旧区块必须被整块替换");
  assert.equal(text.includes(buildRuleBlock()), true);
  assert.ok(buildRuleBlock().length < oldBlock.trim().length, "升级后体积必须变小");
});
