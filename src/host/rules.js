/**
 * 全局规则文件（$DSH_HOME/AGENTS.md）里的 dsh-compass 标记区块：安装 / 升级 / 移除。
 * 设计契约：docs/schema-v2.md §7。
 *
 * 约束：
 * - 只动 <!-- dsh-compass:begin --> 与 <!-- dsh-compass:end --> 之间的内容；
 * - 区块外一个字节都不改；
 * - 标记残缺（只有一半）时拒绝自动修改（避免误删用户内容）。
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CODES, CompassError } from "../core/errors.js";

export const RULE_BEGIN = "<!-- dsh-compass:begin -->";
export const RULE_END = "<!-- dsh-compass:end -->";

/** 规则区块正文（与方案 §7.2 保持逐字一致；升级时整块替换，不堆叠）。 */
export const RULE_BODY = `每轮结束前自查：先调 compass_status；这轮只要做了会改变板面的事（进度、新任务、裁决、详情、补录），就用 compass_update/compass_plan 落板并同步写 detail；turns_since_board_update>0 时按规则补录；确认什么都没变才忽略。

补充规则：
1. 用户已确认开工的任务才可 compass_plan；商量阶段不写板。新需求先用 compass_require 落需求与原话，再拆任务。
2. 废弃父节点时，task_ids 必须覆盖整棵子树，或 pointer_note 写明哪几条故意不废及原因。
3. 复活类转移（废弃/替代 → 待裁决）的 pointer_note 必须写明"因 X 推翻上次废弃结论"。
4. 父任务 human_line 或基线需求变更后，AI 需自查子树是否仍成立：
   多了 plan，少了标废弃，粒度变了废弃+新建；不受影响则不动。
5. 需求层 exec_state 由插件按子任务机械聚合（全部已执行→已执行；任一已阻塞→已阻塞；任一进行中或混合→进行中；全未开始→未开始）；AI 不得手写需求层 exec_state（会被拒绝），只更新任务层状态。
6. 补中间步骤/插入节点用 compass_plan 的 after/before（同父兄弟 id），不要建在末尾再废弃重建；ID 序号只代表创建顺序，显示顺序以 children 位置为准。
7. 写 detail 按「交接文档」而不是流水账：每次 compass_update(detail=…) 必须含三段锚点——①核心文件：改动/依赖的具体路径（如 src/api/user.ts）；②契约/文档：必须遵守的规范或接口说明（如 docs/contract-v1.md）；③避坑指南：接手 AI 必须注意什么。没有的项写「无」。
8. 发现板与事实不符（漏记、错位、状态过期）时先补录再继续，不要只改代码不落板。
9. 开工前先建完整任务树（含未开始），执行中逐步推进状态；不要等做完才补记。
10. 层级按从属关系组织：子任务挂到对应父任务下（验收/优化项挂对应验收任务），不要全平铺在需求层；已有节点换父用 compass_move。
11. 子任务状态或详情变化后，同步更新父任务/需求节点的 detail（父详情是给 AI 读的滚动汇总，插件不自动汇总）。
12. 旧文档迁移（compass_migrate）后，先用 compass_read(scope=baseline) 核对「最初说法」是否逐字正确，确认后再继续。
13. 卡住时把执行态标为「已阻塞」，并在 detail 第一行写「阻塞：等什么 / 谁能解 / 下一步」；解除后改回「进行中」并在 detail 写一句解除原因。
14. history 边界：compass_import / 历史会话扫描只用于「新会话且交接不足需溯源」与「跨会话数据修复/审计（先向用户说明）」；当前上下文已有的诉求/原话不得再用 history 重拉。当前会话原话直接作为 original_text 传给 compass_require/compass_change（插件逐字校验后锁定），不传或跨会话时交给插件按 refs 取回。
15. 标记已执行必须写完成说明：单节点用 detail，批量用 details（逐任务）；修改/构建型含「核心文件 / 契约 / 避坑指南」（路径必须真实存在），查询/调研型含「查询结论 / 数据来源 / 后续建议」（可无路径）；三段必须各起一行、标签在行首、段内容非空（只把标签写进句子里不算，会被拒绝）；旧详情不满足标准时必须重写，不能靠“继承”糊弄。
16. 防重复任务：compass_plan/compass_update 返回 possible_duplicates 警告、或 compass_status 的 health.duplicate_pairs 命中时，先确认是否同一问题；同一问题把旧任务标「已替代」并在 dead_reason 写清被谁取代，不要留同题未开始任务。
17. 需求行由子任务机械聚合（不可手写）；需求即将聚合为「已执行」时，插件会硬校验需求详情含「验收范围 / 完成结论 / 遗留风险」三段，缺则报 E_REQUIREMENT_DETAIL_REQUIRED。所以标记最后一个子任务之前，先给需求节点写完成汇总（compass_update task_ids:["R-00x"] detail:…）。
18. 整条祖先链一起更新：任何一次写节点详情（detail 或完成说明）都必须同时更新**所有祖先**（父任务、父级的父级、需求）的汇总详情，用 details 传 { "<祖先id>": "验收范围：…\\n完成结论：…\\n遗留风险：…" }；缺任一祖先 ⇒ E_ANCESTOR_DETAIL_REQUIRED（整次操作不落盘）。不要只更新直接父级。`;

/** @returns {string} 完整标记区块（不含文件末尾换行） */
export function buildRuleBlock() {
  return `${RULE_BEGIN}\n${RULE_BODY}\n${RULE_END}`;
}

/**
 * @param {string} text
 * @returns {{present: boolean, broken: boolean, begin: number, end: number}}
 */
export function locateRuleBlock(text) {
  const begin = text.indexOf(RULE_BEGIN);
  const end = text.indexOf(RULE_END);
  if (begin === -1 && end === -1) return { present: false, broken: false, begin, end };
  if (begin === -1 || end === -1 || end < begin) return { present: false, broken: true, begin, end };
  return { present: true, broken: false, begin, end };
}

/**
 * 安装或升级规则区块（幂等）。
 * @param {string} rulesPath 规则文件绝对路径（通常是 $DSH_HOME/AGENTS.md）
 * @param {{block?: string}} [options]
 * @returns {Promise<{status: "installed"|"updated"|"unchanged", path: string}>}
 */
export async function installRuleBlock(rulesPath, options = {}) {
  const block = options.block ?? buildRuleBlock();
  const original = await readText(rulesPath);
  const located = locateRuleBlock(original);

  if (located.broken) {
    throw new CompassError(
      CODES.STORE_CORRUPT,
      "规则文件中的 dsh-compass 标记区块不完整（begin/end 只有其一），拒绝自动修改；请人工修复后再试"
    );
  }

  let next;
  let status;
  if (!located.present) {
    const separator = original.trim() ? (original.endsWith("\n\n") ? "" : original.endsWith("\n") ? "\n" : "\n\n") : "";
    next = `${original}${separator}${block}\n`;
    status = "installed";
  } else {
    const before = original.slice(0, located.begin);
    const after = original.slice(located.end + RULE_END.length);
    const current = original.slice(located.begin, located.end + RULE_END.length);
    if (current === block) return { status: "unchanged", path: rulesPath };
    next = `${before}${block}${after}`;
    status = "updated";
  }

  await writeAtomic(rulesPath, next);
  return { status, path: rulesPath };
}

/**
 * 移除规则区块（卸载清理）。区块不存在时视为已清理。
 * @param {string} rulesPath
 * @returns {Promise<{status: "removed"|"absent", path: string}>}
 */
export async function removeRuleBlock(rulesPath) {
  const original = await readText(rulesPath);
  const located = locateRuleBlock(original);
  if (!located.broken && !located.present) return { status: "absent", path: rulesPath };
  if (located.broken) {
    throw new CompassError(
      CODES.STORE_CORRUPT,
      "规则文件中的 dsh-compass 标记区块不完整，拒绝自动删除；请人工修复后再试"
    );
  }
  const before = original.slice(0, located.begin);
  const after = original.slice(located.end + RULE_END.length);
  const next = `${before.replace(/\n+$/, "")}${after.startsWith("\n") ? "" : "\n"}${after.replace(/^\n+/, "")}`.trimEnd() + "\n";
  await writeAtomic(rulesPath, next === "\n" ? "" : next);
  return { status: "removed", path: rulesPath };
}

/**
 * @param {string} file
 * @returns {Promise<string>} 文件不存在返回空串
 */
async function readText(file) {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw new CompassError(CODES.WRITE_FAILED, `读取规则文件失败：${file}（${err?.message ?? err}）`);
  }
}

/**
 * 原子写：临时文件 + fsync + rename。
 * @param {string} file
 * @param {string} content
 */
async function writeAtomic(file, content) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  let handle;
  try {
    handle = await fs.promises.open(tmp, "w");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(tmp, file);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw new CompassError(CODES.WRITE_FAILED, `写入规则文件失败：${file}（${err?.message ?? err}）`);
  }
}
