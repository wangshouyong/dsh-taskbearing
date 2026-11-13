/**
 * 任务树结构、不变量校验与遍历。
 * 设计契约：docs/schema-v2.md §4.4。
 */

import { CODES, fail } from "./errors.js";
import { ID_RE, ROOT_ID } from "./ids.js";
import { EXEC_STATES, TERMINAL_VERDICTS, VERDICT_INPUTS } from "./state.js";

export const TREE_SCHEMA = 1;
export const KIND_PROJECT = "project";
export const KIND_REQUIREMENT = "requirement";
export const KIND_TASK = "task";
export const NODE_KINDS = [KIND_PROJECT, KIND_REQUIREMENT, KIND_TASK];

/**
 * 回收站标记（v1.33）：节点上的独立删除标记，与执行态/裁决态完全解耦。
 * 语义：标记只在「被丢弃的那个节点」上；其整棵子树由祖先标记推导为隐藏，
 * 因此还原时不需要批量清子节点，也不会误伤此前单独丢弃过的子节点。
 * @param {any} node
 * @returns {boolean}
 */
export function isTrashed(node) {
  return typeof node?.trashedAt === "string" && node.trashedAt.length > 0;
}

/**
 * 去掉回收站节点（自身或祖先被标记）后的新树（不修改入参）。
 * 所有「给人/AI 看」的读取路径都先过这一层：视图、计数、搜索、钉顶、聚合、健康自检。
 * @param {any} tree
 * @returns {any}
 */
export function pruneTrashed(tree) {
  if (!tree || !tree.root) return tree;
  /** @param {any} node */
  const prune = (node) => ({
    ...node,
    children: (node.children ?? []).filter((child) => !isTrashed(child)).map(prune)
  });
  return { ...tree, root: prune(tree.root) };
}

/**
 * 回收站条目（面板抽屉用）：只列「显式被丢弃」且祖先未被丢弃的节点，
 * 带父链 human_line 与后代数量；按丢弃时间倒序。
 * @param {any} tree
 * @returns {Array<{node: any, parent_id: string, path: string[], descendants: number}>}
 */
export function collectTrashed(tree) {
  /** @type {Array<{node: any, parent_id: string, path: string[], descendants: number}>} */
  const out = [];
  /** @param {any} node @param {string[]} path */
  const visit = (node, path) => {
    for (const child of node.children ?? []) {
      if (isTrashed(child)) {
        let descendants = 0;
        walk(child, (_n, _p, depth) => {
          if (depth > 0) descendants += 1;
        });
        out.push({ node: child, parent_id: node.id, path, descendants });
        continue; // 子树整体已在回收站，不再重复列出
      }
      // project 根没有 human_line，不进父链
      visit(child, node.id === ROOT_ID ? path : [...path, node.human_line]);
    }
  };
  visit(tree.root, []);
  out.sort((a, b) => String(b.node.trashedAt ?? "").localeCompare(String(a.node.trashedAt ?? "")));
  return out;
}

/** @returns {any} */
export function emptyTree() {
  return { schema: TREE_SCHEMA, root: { id: ROOT_ID, kind: KIND_PROJECT, children: [] } };
}

/**
 * 深度优先遍历（含根）。
 * @param {any} node
 * @param {(node: any, parent: any|null, depth: number) => void} fn
 * @param {any|null} [parent]
 * @param {number} [depth]
 */
export function walk(node, fn, parent = null, depth = 0) {
  fn(node, parent, depth);
  for (const child of node.children ?? []) walk(child, fn, node, depth + 1);
}

/**
 * @param {any} tree
 * @param {string} id
 * @returns {any|null}
 */
export function findNode(tree, id) {
  let found = null;
  walk(tree.root, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

/**
 * @param {any} tree
 * @param {string} id
 * @returns {any|null}
 */
export function findParent(tree, id) {
  let found = null;
  walk(tree.root, (node) => {
    if ((node.children ?? []).some((child) => child.id === id)) found = node;
  });
  return found;
}

/**
 * 节点自身 + 全部后代的 id（顺序：自身、深度优先）。
 * @param {any} node
 * @returns {string[]}
 */
export function collectSubtreeIds(node) {
  const ids = [];
  walk(node, (n) => ids.push(n.id));
  return ids;
}

/**
 * 从根到目标的祖先前驱 id 链（不含自身）。
 * @param {any} tree
 * @param {string} id
 * @returns {string[]}
 */
export function ancestorIds(tree, id) {
  /** @type {string[]} */
  const found = [];
  const visit = (node, trail) => {
    if (node.id === id) {
      found.push(...trail);
      return true;
    }
    for (const child of node.children ?? []) {
      if (visit(child, [...trail, node.id])) return true;
    }
    return false;
  };
  visit(tree.root, []);
  return found;
}

/**
 * tree-lite：省上下文的扁平节点列表（不含 project 根，不带 pointers / 详情）。
 * @param {any} tree
 */
export function flattenLite(tree) {
  const out = [];
  walk(pruneTrashed(tree).root, (node) => {
    if (node.kind === KIND_PROJECT) return;
    out.push({
      id: node.id,
      kind: node.kind,
      title: node.title,
      human_line: node.human_line,
      exec_state: node.exec_state,
      verdict_state: node.verdict_state
    });
  });
  return out;
}

/**
 * 机械计数（纯展示，不参与任何语义判断）：需求行/任务行显示用。
 * @param {any} node
 * @returns {{total: number, byExec: Record<string, number>, byVerdict: Record<string, number>}}
 */
export function countDescendants(node) {
  const byExec = { 未开始: 0, 进行中: 0, 已阻塞: 0, 已执行: 0 };
  const byVerdict = { 待裁决: 0, 冲突: 0, 已废弃: 0, 已替代: 0 };
  let total = 0;
  for (const child of node.children ?? []) {
    if (isTrashed(child)) continue; // 回收站里的子树不计入机械计数（v1.33）
    walk(child, (n) => {
      total += 1;
      if (byExec[n.exec_state] !== undefined) byExec[n.exec_state] += 1;
      if (n.verdict_state && byVerdict[n.verdict_state] !== undefined) byVerdict[n.verdict_state] += 1;
    });
  }
  return { total, byExec, byVerdict };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/** @param {string} path @param {string} message @param {unknown} [details] */
function corrupt(message, details) {
  fail(CODES.STORE_CORRUPT, `tree.json 结构非法：${message}`, details);
}

/**
 * 校验整棵树的不变量（§4.4「不变量」1-8）。返回 tree 本身，非法则抛错。
 * @param {any} tree
 * @returns {any}
 */
export function validateTree(tree) {
  if (!tree || typeof tree !== "object") corrupt("根对象缺失");
  if (tree.schema !== TREE_SCHEMA) {
    if (typeof tree.schema === "number" && tree.schema > TREE_SCHEMA) {
      fail(CODES.SCHEMA_VERSION, `tree.json schema=${tree.schema} 高于当前插件支持的 ${TREE_SCHEMA}，请升级插件`);
    }
    corrupt(`schema 非法：${String(tree.schema)}`);
  }
  const root = tree.root;
  if (!root || typeof root !== "object") corrupt("root 缺失");
  if (root.id !== ROOT_ID || root.kind !== KIND_PROJECT) corrupt(`root 必须是 {id:"${ROOT_ID}", kind:"project"}`);
  if (!Array.isArray(root.children)) corrupt("root.children 必须是数组");
  for (const key of ["title", "human_line", "exec_state", "verdict_state", "dead_reason", "merged_into", "pointers", "trashedAt"]) {
    if (root[key] !== undefined) corrupt(`project 节点不应包含字段 ${key}`);
  }

  const seen = new Map();
  const ids = new Set();
  /** @type {Array<{id: string, merged_into: string|null}>} */
  const mergeRefs = [];

  walk(
    root,
    (node, parent, depth) => {
      if (depth === 0) return; // 根节点已在上面单独校验
      if (!node || typeof node !== "object") corrupt("节点不是对象");
      const where = `节点 ${String(node.id)}`;
      if (typeof node.id !== "string" || !ID_RE.test(node.id)) corrupt(`${where} 的 id 非法`);
      if (ids.has(node.id)) corrupt(`id 重复：${node.id}`);
      ids.add(node.id);
      if (!NODE_KINDS.includes(node.kind)) corrupt(`${where} 的 kind 非法：${String(node.kind)}`);
      if (node.kind === KIND_PROJECT) corrupt("只有根节点可以是 project");
      if (node.kind === KIND_REQUIREMENT && parent?.kind !== KIND_PROJECT) corrupt(`${where}：requirement 只能挂在 root 下`);
      if (node.kind === KIND_TASK && !(parent?.kind === KIND_REQUIREMENT || parent?.kind === KIND_TASK)) {
        corrupt(`${where}：task 的父节点必须是 requirement 或 task`);
      }
      if (!Array.isArray(node.children)) corrupt(`${where}.children 必须是数组`);

      if (typeof node.title !== "string" || !node.title.trim()) corrupt(`${where} 缺少 title`);
      if (typeof node.human_line !== "string" || !node.human_line.trim()) corrupt(`${where} 缺少 human_line`);
      if (!EXEC_STATES.includes(node.exec_state)) corrupt(`${where} 的 exec_state 非法：${String(node.exec_state)}`);

      const verdict = node.verdict_state ?? null;
      if (verdict !== null && !VERDICT_INPUTS.includes(verdict)) corrupt(`${where} 的 verdict_state 非法：${String(verdict)}`);
      if (verdict === "已确认继续") corrupt(`${where} 落了瞬时值「已确认继续」`);

      const deadReason = node.dead_reason ?? null;
      if (TERMINAL_VERDICTS.includes(verdict)) {
        if (typeof deadReason !== "string" || !deadReason.trim()) corrupt(`${where} 缺少 dead_reason`);
      } else if (deadReason !== null) {
        corrupt(`${where} 的 dead_reason 应为 null（当前裁决态为 ${verdict}）`);
      }

      const mergedInto = node.merged_into ?? null;
      if (mergedInto !== null && typeof mergedInto !== "string") corrupt(`${where}.merged_into 非法`);
      if (mergedInto !== null) mergeRefs.push({ id: node.id, merged_into: mergedInto });

      // v1.33 回收站：可选独立删除标记（ISO 时间戳）；老数据没有该字段视为未删除
      if (node.trashedAt !== undefined && node.trashedAt !== null && !isIsoTimestamp(node.trashedAt)) {
        corrupt(`${where}.trashedAt 必须是 ISO-8601 时间戳或缺失`);
      }

      if (!Array.isArray(node.pointers)) corrupt(`${where}.pointers 必须是数组`);
      for (const [index, ptr] of node.pointers.entries()) {
        if (!ptr || typeof ptr !== "object") corrupt(`${where}.pointers[${index}] 非法`);
        if (typeof ptr.session !== "string" || !ptr.session.trim()) corrupt(`${where}.pointers[${index}] 缺少 session`);
        if (!isIsoTimestamp(ptr.at)) corrupt(`${where}.pointers[${index}] 的 at 不是 ISO-8601 时间戳`);
        if (typeof ptr.note !== "string" || !ptr.note.trim()) corrupt(`${where}.pointers[${index}] 缺少 note`);
        if (ptr.turn !== undefined && !(Number.isInteger(ptr.turn) && ptr.turn >= 0)) {
          corrupt(`${where}.pointers[${index}] 的 turn 必须是非负整数或缺失`);
        }
      }
      seen.set(node.id, depth);
    },
    root,
    0
  );

  for (const ref of mergeRefs) {
    if (ref.merged_into === ref.id) corrupt(`${ref.id} 的 merged_into 指向自身`);
    if (!ids.has(ref.merged_into)) corrupt(`${ref.id} 的 merged_into 指向不存在的节点 ${ref.merged_into}`);
  }

  return tree;
}

/** @param {any} tree @returns {any} */
export function assertInitialized(tree) {
  if (!tree || !tree.root) fail(CODES.NOT_INITIALIZED, "任务板尚未初始化，请先调用 compass_init");
  return tree;
}

/**
 * 需求层执行状态聚合（v1.28 / B-59）：由子任务机械推导，AI 不可手写。
 * 规则（忽略已废弃/已替代的子树）：
 * - 无活跃任务 ⇒ 未开始；
 * - 任一「已阻塞」⇒ 已阻塞；
 * - 任一「进行中」⇒ 进行中；
 * - 全部「已执行」⇒ 已执行；
 * - 全部「未开始」⇒ 未开始；
 * - 其余混合（有已完成也有未开始）⇒ 进行中。
 * @param {any} requirement
 * @returns {"未开始"|"进行中"|"已阻塞"|"已执行"}
 */
export function aggregateRequirementExecState(requirement) {
  /** @type {string[]} */
  const states = [];
  /** @param {any} node */
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (child.verdict_state === "已废弃" || child.verdict_state === "已替代") continue;
      if (isTrashed(child)) continue; // 回收站里的子树不参与聚合（v1.33）
      if (child.kind === "task") states.push(child.exec_state);
      visit(child);
    }
  };
  visit(requirement);
  if (states.length === 0) return "未开始";
  if (states.includes("已阻塞")) return "已阻塞";
  if (states.includes("进行中")) return "进行中";
  if (states.every((state) => state === "已执行")) return "已执行";
  if (states.every((state) => state === "未开始")) return "未开始";
  return "进行中";
}

/**
 * 按子任务重算所有需求层执行状态（就地修改）。
 * @param {any} tree
 * @returns {string[]} 被修正的需求 id 列表
 */
export function syncRequirementExecStates(tree) {
  /** @type {string[]} */
  const changed = [];
  for (const requirement of tree?.root?.children ?? []) {
    if (requirement.kind !== KIND_REQUIREMENT) continue;
    const next = aggregateRequirementExecState(requirement);
    if (requirement.exec_state !== next) {
      requirement.exec_state = next;
      changed.push(requirement.id);
    }
  }
  return changed;
}
