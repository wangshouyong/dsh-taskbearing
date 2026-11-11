/**
 * 疑似重复任务检测（v1.29 / B-60）：机械文本相似度，只提示、不判断语义。
 * 目的：把「同一问题存在多条任务、一条完成一条仍挂着」的情况暴露给 AI/用户，强制闭环。
 */

import { KIND_REQUIREMENT, KIND_TASK, walk } from "./tree.js";

const TERMINAL_VERDICTS = new Set(["已废弃", "已替代"]);
const ACTIVE_VERDICTS = new Set([null, undefined, "待裁决", "冲突"]);

/** 归一化：去空白/标点/符号，小写；用于机械比较。 @param {unknown} text */
export function normalizeForCompare(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 字符二元组集合。 @param {string} text */
export function charBigrams(text) {
  const value = normalizeForCompare(text);
  if (value.length <= 1) return new Set(value ? [value] : []);
  const grams = new Set();
  for (let index = 0; index < value.length - 1; index += 1) grams.add(value.slice(index, index + 2));
  return grams;
}

/** 集合包含度：交集 / 较小集合大小（短标题是长标题子集时得分高）。 */
function containment(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

/** 长 ASCII 标识（compass_update / warning 等）是否有交集。 */
function hasSharedIdentifier(a, b) {
  const tokensOf = (text) => new Set(String(text ?? "").toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
  const left = tokensOf(a);
  const right = tokensOf(b);
  for (const token of left) if (token.length >= 6 && right.has(token)) return true;
  return false;
}

/**
 * 机械相似度（0~1）：二元组包含度 + 单字包含度 + 长标识命中加成。
 * 仅用于「疑似重复」提示，不承担语义判断。
 * @param {string} a @param {string} b
 */
export function similarity(a, b) {
  const valueA = normalizeForCompare(a);
  const valueB = normalizeForCompare(b);
  if (!valueA || !valueB) return 0;
  const bigramScore = containment(charBigrams(valueA), charBigrams(valueB));
  const unigramScore = containment(new Set(valueA), new Set(valueB));
  const bonus = hasSharedIdentifier(a, b) ? 0.1 : 0;
  return Math.min(1, 0.45 * bigramScore + 0.45 * unigramScore + bonus);
}

/**
 * 板面「活跃节点」：未终态裁决 + 未执行完成。
 * 同时纳入任务与需求节点（跨层级重复：一条旧任务可能已被新需求整体取代）。
 * @param {any} node
 */
function isOpenNode(node) {
  if (node.kind !== KIND_TASK && node.kind !== KIND_REQUIREMENT) return false;
  if (TERMINAL_VERDICTS.has(node.verdict_state)) return false;
  if (!ACTIVE_VERDICTS.has(node.verdict_state)) return false;
  return node.exec_state !== "已执行";
}

/**
 * 在树中查找与给定文本相似、且仍活跃（未完成、未废弃/替代）的节点（任务或需求）。
 * @param {any} tree
 * @param {{text?: string, excludeIds?: string[], threshold?: number, limit?: number}} options
 * @returns {Array<{id: string, title: string, exec_state: string, score: number}>}
 */
export function findSimilarOpenTasks(tree, options = {}) {
  const text = String(options.text ?? "");
  if (!text.trim()) return [];
  const exclude = new Set(options.excludeIds ?? []);
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.4;
  const limit = Number.isInteger(options.limit) ? options.limit : 5;
  /** @type {Array<{id: string, title: string, exec_state: string, score: number}>} */
  const hits = [];
  walk(tree.root, (node) => {
    if (!isOpenNode(node) || exclude.has(node.id)) return;
    const candidate = `${node.title ?? ""} ${node.human_line ?? ""}`;
    const score = similarity(text, candidate);
    if (score >= threshold) hits.push({ id: node.id, title: node.title ?? "", exec_state: node.exec_state, score: Number(score.toFixed(2)) });
  });
  hits.sort((left, right) => right.score - left.score);
  return hits.slice(0, limit);
}

/**
 * 板面健康自检：列出活跃任务之间的疑似重复对（供 compass_status 使用）。
 * @param {any} tree
 * @param {{threshold?: number, limit?: number}} [options]
 * @returns {{duplicate_pairs: Array<{a: string, b: string, score: number}>, open_task_count: number, threshold: number}}
 */
export function boardDuplicateHealth(tree, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.45;
  const limit = Number.isInteger(options.limit) ? options.limit : 5;
  /** @type {Array<{id: string, text: string}>} */
  const open = [];
  walk(tree.root, (node) => {
    if (isOpenNode(node)) open.push({ id: node.id, text: `${node.title ?? ""} ${node.human_line ?? ""}` });
  });
  /** @type {Array<{a: string, b: string, score: number}>} */
  const pairs = [];
  for (let leftIndex = 0; leftIndex < open.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < open.length; rightIndex += 1) {
      const score = similarity(open[leftIndex].text, open[rightIndex].text);
      if (score >= threshold) pairs.push({ a: open[leftIndex].id, b: open[rightIndex].id, score: Number(score.toFixed(2)) });
    }
  }
  pairs.sort((left, right) => right.score - left.score);
  return { duplicate_pairs: pairs.slice(0, limit), open_task_count: open.length, threshold };
}
