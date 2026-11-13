/**
 * 板面新鲜度（B-32）：只读机械计数，不做语义判断。
 * 数据来源：tree.json 的 mtime + 本会话自该时间之后开始的轮次/工具调用（TurnTracker 内存窗口）。
 * v1.31 / B-62：health 增加「已执行但没有详情」的机械自检（旧校验只卡写入，无存量信号）。
 */

import fsp from "node:fs/promises";

import { boardDuplicateHealth } from "../core/duplicates.js";
import { pruneTrashed } from "../core/tree.js";

const MISSING_DETAIL_LIMIT = 50;
const STALE_CHAIN_LIMIT = 20;

/**
 * 存量自检：祖先链是否陈旧（B-62 链式规则的机械兜底）。
 * 机械口径：若某节点的 detail 比它的某个祖先更新、而祖先 detail 没有跟着写（更旧或为空），
 * 说明「子任务更新了详情但父链没更新」——纯 mtime 比较，不评价内容。
 * @param {import("../core/store.js").Store} store
 * @param {any} tree
 */
async function staleChainHealth(store, tree) {
  /** @param {string} id */
  const detailMtime = async (id) => {
    try {
      const stat = await fsp.stat(store.detailPath(id));
      return stat.mtimeMs;
    } catch {
      return 0;
    }
  };
  /** @type {Array<{id: string, stale_ancestors: string[]}>} */
  const problems = [];
  /**
   * @param {any} node
   * @param {Array<{id: string, mtime: number}>} ancestors
   */
  const walk = async (node, ancestors) => {
    for (const child of node.children ?? []) {
      const ownMtime = await detailMtime(child.id);
      if (ownMtime > 0 && ancestors.length > 0) {
        const stale = ancestors.filter((ancestor) => ancestor.mtime === 0 || ancestor.mtime < ownMtime).map((ancestor) => ancestor.id);
        if (stale.length > 0) problems.push({ id: child.id, stale_ancestors: stale });
      }
      await walk(child, [...ancestors, { id: child.id, mtime: ownMtime }]);
    }
  };
  await walk(tree.root, []);
  return { count: problems.length, items: problems.slice(0, STALE_CHAIN_LIMIT) };
}

/**
 * 存量自检：已执行节点里详情为空的（任务 / 需求分开列）。
 * 只判断「空」这个机械事实，不评价内容质量；标准校验在写入路径上（B-58 / B-62）。
 * @param {import("../core/store.js").Store} store
 * @param {any} tree
 */
async function missingDetailHealth(store, tree) {
  const tasks = [];
  const requirements = [];
  /** @param {any} node */
  const walk = async (node) => {
    for (const child of node.children ?? []) {
      if (child.exec_state === "已执行") {
        let detail = "";
        try {
          detail = String(await store.readDetail(child.id));
        } catch {
          detail = "";
        }
        if (!detail.trim()) {
          if (child.kind === "requirement") requirements.push(child.id);
          else tasks.push(child.id);
        }
      }
      await walk(child);
    }
  };
  await walk(tree.root);
  return {
    tasks: tasks.slice(0, MISSING_DETAIL_LIMIT),
    tasks_total: tasks.length,
    requirements: requirements.slice(0, MISSING_DETAIL_LIMIT),
    requirements_total: requirements.length
  };
}

/**
 * @param {{store: import("../core/store.js").Store, turns: import("./turn.js").TurnTracker|null, sessionId: string|null}} input
 */
export async function computeBoardStatus(input) {
  const { store, turns, sessionId } = input;
  let mtimeMs = 0;
  try {
    mtimeMs = (await fsp.stat(store.treePath)).mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  const since = mtimeMs || Date.now();
  const activity = turns?.activitiesSince?.(sessionId ?? null, since) ?? { turns: 0, toolCalls: 0 };
  const currentTurn = turns?.current?.(sessionId ?? null) ?? turns?.last?.(sessionId ?? null) ?? null;
  // v1.29 / B-60：板面健康自检（机械查重，只提示不判断）；v1.31 / B-62 增「已执行无详情」
  let health = null;
  if (mtimeMs > 0) {
    try {
      // v1.33：健康自检只看板上可见节点（回收站里的不报陈旧链/缺详情/重复）
      const tree = pruneTrashed(await store.readTree());
      health = {
        ...boardDuplicateHealth(tree),
        missing_detail: await missingDetailHealth(store, tree),
        stale_chains: await staleChainHealth(store, tree)
      };
    } catch {
      health = null;
    }
  }
  return {
    board_updated_at: mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null,
    current_turn: currentTurn,
    turns_since_board_update: activity.turns,
    tool_calls_since_board_update: activity.toolCalls,
    suggest: activity.turns > 0 || activity.toolCalls > 0 ? "self_check" : "fresh",
    health,
    note: "只统计本插件实例启动后收到的会话事件；启动前的历史轮次不计入。仅机械计数，是否该落板由 AI 判断；health 为机械自检（查重 + 已执行缺详情，非语义判断）。"
  };
}
