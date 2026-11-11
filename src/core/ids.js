/**
 * 节点 id 规则与生成。
 * 设计契约：docs/schema-v2.md §4.4「ID 规则」。
 *   ROOT（项目根，隐式）
 *   R-001（需求层，只能在 root 下）
 *   R-001-T-1（需求下的任务）
 *   R-001-T-1-T-1（任务下的步骤）
 */

import { CODES, fail } from "./errors.js";

export const ROOT_ID = "ROOT";
export const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** @param {number} n @param {number} [width] */
export function pad(n, width = 3) {
  return String(n).padStart(width, "0");
}

/** @param {string} id @returns {string} */
export function assertId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    fail(CODES.PATH_INVALID, `非法 id：${String(id)}（只允许字母、数字、连字符，长度 1~64）`);
  }
  return id;
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 下一个需求 id：按 root 下已有 R-<n> 的最大序号 +1。
 * @param {{children: Array<{id: string}>}} root
 * @returns {string}
 */
export function nextRequirementId(root) {
  let max = 0;
  for (const child of root.children ?? []) {
    const m = /^R-(\d+)$/.exec(child?.id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R-${pad(max + 1)}`;
}

/**
 * 下一个任务 id：<parentId>-T-<n>，n 为该父节点下已有任务序号的最大值 +1。
 * 嵌套受 §4.4 的 id 长度约束（≤64）：超限时给出明确错误，而不是生成非法 id。
 * 节点可被移动（B-34）且 ID 不变，旧 id 可能被其它父的序号"复用"；传 `taken`（全树已有 id）
 * 做全局去重，跳过已存在 id。
 * @param {{id: string, children: Array<{id: string}>}} parent
 * @param {Set<string>|string[]} [taken]
 * @returns {string}
 */
export function nextTaskId(parent, taken) {
  const re = new RegExp(`^${escapeRegExp(parent.id)}-T-(\\d+)$`);
  const used = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : []);
  let max = 0;
  for (const child of parent.children ?? []) {
    const m = re.exec(child?.id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  let next = max + 1;
  while (used.has(`${parent.id}-T-${next}`)) next += 1;
  const id = `${parent.id}-T-${next}`;
  if (id.length > 64) {
    fail(
      CODES.INVALID_ARG,
      `嵌套过深：新任务 id 将超过 64 字符上限（父节点 ${parent.id}，新 id 长度 ${id.length}）；请在更浅层级建节点或精简层级`
    );
  }
  return id;
}

/**
 * 解析 <parentId>-T-<n> 中的 n（用于校验与诊断）。
 * @param {string} parentId
 * @param {string} childId
 * @returns {number|null}
 */
export function taskIndex(parentId, childId) {
  const re = new RegExp(`^${escapeRegExp(parentId)}-T-(\\d+)$`);
  const m = re.exec(childId ?? "");
  return m ? Number(m[1]) : null;
}
