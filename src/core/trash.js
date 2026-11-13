/**
 * 回收站（v1.33）：独立的「删除标记」语义，与执行态 / 裁决态完全解耦。
 * 契约：docs/schema-v2.md §4.9 / §8.23。
 *
 * 设计要点：
 * - 标记只落在「用户丢弃的那个节点」上（树字段 trashedAt）；整棵子树由祖先标记推导为隐藏
 *   （tree.pruneTrashed），所以还原不需要批量清子节点，也不会误伤此前单独丢弃过的子节点。
 * - 丢弃不写追溯链、不要求理由、不改动 exec_state / verdict_state —— 它是面板侧的清理动作。
 * - 彻底删除（purge）只允许任务/步骤：需求层带着基线原话与追溯链，是审计资产，只能长期躺在回收站。
 * - 删之前整包备份到 data/.trash（不在 schema 里，30 天后自动清理），可手工恢复。
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CODES, CompassError, fail } from "./errors.js";
import { assertId } from "./ids.js";
import { KIND_REQUIREMENT, collectSubtreeIds, findNode, findParent, isTrashed, syncRequirementExecStates, walk } from "./tree.js";

export const TRASH_BACKUP_FORMAT = "dsh-taskboard-trash";
export const TRASH_BACKUP_SCHEMA = 1;
/** 备份保留期：30 天 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 校验并去重 id 列表（入参来自面板）。
 * @param {unknown} input
 * @param {number} [max]
 * @returns {string[]}
 */
export function normalizeTrashIds(input, max = 500) {
  if (!Array.isArray(input) || input.length === 0) {
    fail(CODES.INVALID_ARG, "ids 必须是非空数组");
  }
  if (input.length > max) {
    fail(CODES.INVALID_ARG, `单次最多操作 ${max} 个节点`);
  }
  /** @type {string[]} */
  const ids = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !raw.trim()) fail(CODES.INVALID_ARG, "ids 的每一项必须是非空字符串");
    const id = assertId(raw.trim());
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * 祖先链里是否有回收站标记（含直接父级到需求层）。
 * @param {any} tree
 * @param {string} id
 * @returns {string|null} 命中的祖先 id；没有返回 null
 */
export function trashedAncestorOf(tree, id) {
  let found = null;
  const visit = (node, trail) => {
    for (const child of node.children ?? []) {
      if (child.id === id) {
        for (let i = trail.length - 1; i >= 0; i -= 1) {
          const ancestor = trail[i];
          if (isTrashed(ancestor)) {
            found = ancestor.id;
            return true;
          }
        }
        return true;
      }
      if (visit(child, [...trail, child])) return true;
    }
    return false;
  };
  visit(tree.root, []);
  return found;
}

/**
 * 丢弃（就地修改树）：给节点打删除标记。幂等：已在回收站里的跳过。
 * 不改 exec_state / verdict_state / pointers（与裁决态「已废弃」是两回事）。
 * @param {any} tree
 * @param {string[]} ids
 * @param {string} at ISO 时间戳
 * @returns {{discarded: string[], skipped: string[]}}
 */
export function discardNodes(tree, ids, at) {
  /** @type {string[]} */
  const discarded = [];
  /** @type {string[]} */
  const skipped = [];
  for (const id of ids) {
    const node = findNode(tree, id);
    if (!node) fail(CODES.TASK_NOT_FOUND, `节点不存在：${id}`, { missing: [id] });
    if (isTrashed(node) || trashedAncestorOf(tree, id)) {
      skipped.push(id);
      continue;
    }
    node.trashedAt = at;
    discarded.push(id);
  }
  syncRequirementExecStates(tree);
  return { discarded, skipped };
}

/**
 * 还原（就地修改树）：清掉删除标记，原状态原样回来。
 * 父节点仍在回收站时拒绝：子树是从祖先推导隐藏的，先还原祖先才有意义。
 * @param {any} tree
 * @param {string[]} ids
 * @returns {{restored: string[], skipped: string[]}}
 */
export function restoreNodes(tree, ids) {
  /** @type {string[]} */
  const restored = [];
  /** @type {string[]} */
  const skipped = [];
  for (const id of ids) {
    const node = findNode(tree, id);
    if (!node) fail(CODES.TASK_NOT_FOUND, `节点不存在：${id}`, { missing: [id] });
    if (!isTrashed(node)) {
      const ancestor = trashedAncestorOf(tree, id);
      if (ancestor) {
        fail(CODES.TRASH_NOT_FOUND, `节点 ${id} 随父节点 ${ancestor} 一起在回收站里；请先还原父节点`, {
          id,
          trashed_ancestor: ancestor
        });
      }
      skipped.push(id);
      continue;
    }
    delete node.trashedAt;
    restored.push(id);
  }
  syncRequirementExecStates(tree);
  return { restored, skipped };
}

/**
 * 彻底删除前的校验（只校验、不修改树）：
 * - 节点必须在回收站里（避免面板误删活跃节点）；
 * - 需求层禁止物理删除（基线原话/追溯链是审计资产）；
 * - 被其它节点的 merged_into 引用时禁止删除（防断链）。
 * @param {any} tree
 * @param {string} id
 * @returns {{node: any, ids: string[], parent_id: string}}
 */
export function inspectPurge(tree, id) {
  const targetId = assertId(id);
  const node = findNode(tree, targetId);
  if (!node) fail(CODES.TASK_NOT_FOUND, `节点不存在：${targetId}`, { missing: [targetId] });
  if (!isTrashed(node)) {
    fail(CODES.TRASH_NOT_FOUND, `节点 ${targetId} 不在回收站里；只有已丢弃的节点才能彻底删除`, { id: targetId });
  }
  if (node.kind === KIND_REQUIREMENT) {
    fail(
      CODES.PURGE_FORBIDDEN,
      `需求 ${targetId} 不能彻底删除：基线原话与追溯链是审计资产，只能长期保留在回收站`,
      { id: targetId, kind: node.kind }
    );
  }
  const ids = collectSubtreeIds(node);
  const idSet = new Set(ids);
  /** @type {Array<{id: string, merged_into: string}>} */
  const refs = [];
  walk(tree.root, (candidate) => {
    if (idSet.has(candidate.id)) return;
    const mergedInto = candidate.merged_into ?? null;
    if (typeof mergedInto === "string" && idSet.has(mergedInto)) {
      refs.push({ id: candidate.id, merged_into: mergedInto });
    }
  });
  if (refs.length > 0) {
    fail(
      CODES.PURGE_FORBIDDEN,
      `节点 ${targetId} 被其它节点引用（merged_into），删除会断链；请先处理引用`, 
      { id: targetId, refs }
    );
  }
  const parent = findParent(tree, targetId);
  if (!parent) fail(CODES.PATH_INVALID, `找不到 ${targetId} 的父节点，无法删除`);
  return { node, ids, parent_id: parent.id };
}

/**
 * 从树里摘掉节点（就地修改）。调用前必须先 inspectPurge。
 * @param {any} tree
 * @param {string} id
 * @returns {{node: any, ids: string[]}}
 */
export function removeNode(tree, id) {
  const info = inspectPurge(tree, id);
  const parent = findParent(tree, id);
  parent.children = parent.children.filter((child) => child.id !== id);
  syncRequirementExecStates(tree);
  return { node: info.node, ids: info.ids };
}

/** @param {import("./store.js").Store} store */
export function trashDirOf(store) {
  return path.join(store.dataDir, "trash");
}

/**
 * 组装备份对象（纯函数，便于测试）。
 * @param {{node: any, ids: string[], tree: any, workspaceId: string, pluginVersion?: string, details: Record<string, {md: string, note: string}>, now: string}} input
 */
export function buildTrashBackup(input) {
  return {
    format: TRASH_BACKUP_FORMAT,
    schema: TRASH_BACKUP_SCHEMA,
    purged_at: input.now,
    workspace_id: input.workspaceId,
    plugin_version: input.pluginVersion ?? null,
    root_id: input.node.id,
    root_kind: input.node.kind,
    node: input.node,
    ids: input.ids,
    details: input.details
  };
}

/**
 * 写备份文件（data/.trash/<时间>-<id>.json，原子写）。
 * @param {import("./store.js").Store} store
 * @param {any} backup
 * @returns {Promise<string>} 备份文件绝对路径
 */
export async function writeTrashBackup(store, backup) {
  const dir = trashDirOf(store);
  await fs.mkdir(dir, { recursive: true });
  const stamp = String(backup.purged_at ?? "").replace(/[^0-9]/g, "").slice(0, 14) || String(Date.now());
  const file = path.join(dir, `${stamp}-${backup.root_id}.json`);
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new CompassError(CODES.WRITE_FAILED, `回收站备份写入失败，已中止删除：${err?.message ?? err}`);
  }
  return file;
}

/**
 * 清理过期备份（默认 30 天）。失败不阻断主流程（只是磁盘清理）。
 * @param {import("./store.js").Store} store
 * @param {{now?: number, retentionMs?: number}} [options]
 * @returns {Promise<number>} 删除的文件数
 */
export async function cleanupTrashBackups(store, options = {}) {
  const dir = trashDirOf(store);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const retention = Number.isFinite(options.retentionMs) ? options.retentionMs : TRASH_RETENTION_MS;
  let removed = 0;
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      const stat = await fs.stat(file);
      if (now - stat.mtimeMs > retention) {
        await fs.rm(file, { force: true });
        removed += 1;
      }
    } catch {
      // 单个文件失败不影响其它
    }
  }
  return removed;
}

/**
 * 读回一个备份（手工恢复/测试用）。
 * @param {string} file
 */
export async function readTrashBackup(file) {
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}
