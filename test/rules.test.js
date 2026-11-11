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

test("规则 v2：详情三段锚点 + 阻塞写法（B-49）", async () => {
  const { RULE_BODY } = await import("../src/host/rules.js");
  assert.match(RULE_BODY, /交接文档/);
  assert.match(RULE_BODY, /核心文件/);
  assert.match(RULE_BODY, /契约\/文档/);
  assert.match(RULE_BODY, /避坑指南/);
  assert.match(RULE_BODY, /13\. 卡住时把执行态标为「已阻塞」/);
  assert.match(RULE_BODY, /阻塞：等什么 \/ 谁能解 \/ 下一步/);
  assert.match(RULE_BODY, /compass_migrate/);
  // v1.24 规则 14：history 工具使用边界 + 当前会话原话写入方式
  assert.match(RULE_BODY, /14\. history 边界/);
  assert.match(RULE_BODY, /original_text/);
  assert.match(RULE_BODY, /当前上下文已有的诉求\/原话不得再用 history 重拉/);
  // v1.27 规则 15：标记已执行必须写完成说明（两套内容标准）；v1.31 / B-62 结构化 + 祖先链
  assert.match(RULE_BODY, /15\. 标记已执行必须写完成说明/);
  assert.match(RULE_BODY, /details（逐任务）/);
  assert.match(RULE_BODY, /查询结论 \/ 数据来源 \/ 后续建议/);
  assert.match(RULE_BODY, /三段必须各起一行、标签在行首/);
  // v1.31 规则 17：需求完成汇总硬校验
  assert.match(RULE_BODY, /17\. 需求行由子任务机械聚合/);
  assert.match(RULE_BODY, /E_REQUIREMENT_DETAIL_REQUIRED/);
  assert.match(RULE_BODY, /验收范围 \/ 完成结论 \/ 遗留风险/);
  // v1.31 规则 18：整条祖先链一起更新（B-62）
  assert.match(RULE_BODY, /18\. 整条祖先链一起更新/);
  assert.match(RULE_BODY, /E_ANCESTOR_DETAIL_REQUIRED/);
  // 规则条数：18 条编号规则
  const numbers = [...RULE_BODY.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
});
