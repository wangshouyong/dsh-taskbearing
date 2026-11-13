/**
 * 全局规则文件（$DSH_HOME/AGENTS.md）里的 dsh-compass 标记区块：安装 / 升级 / 移除。
 * 设计契约：docs/schema-v2.md §7。
 *
 * 约束：
 * - 只动 <!-- dsh-compass:begin --> 与 <!-- dsh-compass:end --> 之间的内容；
 * - 区块外一个字节都不改；
 * - 标记残缺（只有一半）时拒绝自动修改（避免误删用户内容）。
 *
 * v1.35 规则瘦身（2026-11-13）：
 * - 18 条 → 9 条：只保留「发起时机 / 判断类」规则（报错兜不住、只能靠 AI 自觉的部分）；
 * - 「写入格式细则」下沉到插件硬校验的报错文案（报错给四要素：缺什么/格式/示例/下一步，
 *   见 schema-v2 §5.1 与 test/error-feedback-loop.test.js），区块里只留一句指路；
 * - 依据：报错兜底只对「AI 已经动手做的那一步」有效，对「AI 没想起来做的动作」无效，
 *   所以时机类规则一条都不能删；格式类则可以交给报错，前提是报错本身可执行。
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CODES, CompassError } from "../core/errors.js";

export const RULE_BEGIN = "<!-- dsh-compass:begin -->";
export const RULE_END = "<!-- dsh-compass:end -->";

/** 规则区块正文（与方案 §7.2 保持逐字一致；升级时整块替换，不堆叠）。 */
export const RULE_BODY = `每轮结束前自查：先调 compass_status；这轮只要做了会改变板面的事（进度、新任务、裁决、详情、补录），就用 compass_update/compass_plan 落板并同步写 detail；turns_since_board_update>0 时按规则补录；确认什么都没变才忽略。

补充规则（9 条；写入格式细则由插件报错兜底，不写在这里）：
1. 确认即落板：确认要做的就写板，不以「是否开工」为前提；排期排在当前主线之后的，落执行线「未开始」+ 裁决线「待裁决」，并用 after/before 指定它相对当前进行中任务的位置；只有仍在开放讨论、尚未确认要做的事才不写板。新需求先 compass_require 落需求与原话再拆任务；开工前建完整任务树（含未开始），执行中逐步推进，不等到做完才补记。
2. 层级按从属组织：子任务挂对应父任务下（验收/优化项挂验收任务），不要全平铺在需求层；换父用 compass_move；插中间步骤用 compass_plan 的 after/before，不要建在末尾再废弃重建。
3. 状态与阻塞：状态/裁决变更必须带 pointer_note；卡住时把执行态标为「已阻塞」，detail 第一行写「阻塞：等什么 / 谁能解 / 下一步」，解除后改回「进行中」并写解除原因；需求层 exec_state 由插件按子任务机械聚合，不得手写。
4. 详情按交接文档写：核心文件 / 契约/文档 / 避坑指南（查询/调研型写查询结论 / 数据来源 / 后续建议）；子任务或详情变了要同步父链汇总（父详情是给 AI 读的滚动汇总）；需求即将聚合为「已执行」时先写需求汇总（验收范围 / 完成结论 / 遗留风险）。
5. 漏记先补录：发现板与事实不符（漏记、错位、状态过期）先补录再继续；写任何详情或完成说明都必须同批更新整条祖先链（父任务、父级的父级、需求），父链不能停在旧内容。
6. history 边界：compass_import / 历史会话扫描只用于「新会话交接不足需溯源」与「跨会话修复/审计（先向用户说明）」；当前会话原话直接作为 original_text 传给 compass_require/compass_change（插件逐字校验后锁定），不重拉历史。
7. 防重复：compass_plan/compass_update 返回 possible_duplicates 警告、或 health.duplicate_pairs 命中时先确认是否同题；同一问题把旧任务标「已替代」，dead_reason 写清被谁取代，不留同题未开始任务。
8. 废弃/替代必须覆盖整棵子树（或 pointer_note 写明故意不废哪几条及原因）；复活类转移（废弃/替代 → 待裁决）的 pointer_note 写明「因 X 推翻上次废弃结论」。
9. 旧文档迁移（compass_migrate）后用 compass_read(scope=baseline) 核对「最初说法」是否逐字正确，再继续。

格式类硬要求（段落怎么写、路径必须真实存在、祖先链缺哪个 id、批量逐任务说明等）由插件写前校验，并把「缺什么 + 正确格式 + 示例 + 下一步」写进报错：按报错一次改对即可，不必背细则。`;

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
