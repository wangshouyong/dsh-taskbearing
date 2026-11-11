/**
 * 刷新调度（纯逻辑）：2s mtime 轮询 + 可见暂停 + 编辑期跳过 + 待刷新。
 * 契约：v1.7 §8.7。
 */

export const POLL_INTERVAL_MS = 2000;

/**
 * @param {{tabVisible: boolean, docVisible: boolean, editing: boolean}} input
 * @returns {boolean} 是否该拉取
 */
export function shouldPoll({ tabVisible, docVisible, editing }) {
  return Boolean(tabVisible && docVisible && !editing);
}

/**
 * 计算一次轮询后的 dirty 状态（编辑中发生变更 → 标记待刷新）。
 * @param {{changed: boolean, editing: boolean}} input
 * @returns {{dirty: boolean}}
 */
export function nextDirty({ changed, editing }) {
  return { dirty: Boolean(changed && editing) };
}

/**
 * 是否需要立即拉取（编辑结束 / 手动刷新 / 可见性从隐藏到可见）。
 * @param {{justBecameVisible: boolean, justFinishedEditing: boolean, manual: boolean}} input
 */
export function shouldFetchNow({ justBecameVisible, justFinishedEditing, manual }) {
  return Boolean(justBecameVisible || justFinishedEditing || manual);
}
