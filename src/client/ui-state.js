/**
 * 视图偏好（全局一份）与展开路径（按工作区）状态。纯逻辑。
 * 契约：v1.7 §4.9、§8.4、O-3 定稿。
 */

export const DEFAULT_PREFS = Object.freeze({ view: "current", rememberExpand: false });

/** @param {any} prefs @returns {{view: string, rememberExpand: boolean}} */
export function normalizePrefs(prefs) {
  const view = ["current", "active", "all"].includes(prefs?.view) ? prefs.view : "current";
  return { view, rememberExpand: prefs?.rememberExpand === true };
}

/** @param {Record<string, boolean>} expanded @param {string} id */
export function toggleExpanded(expanded, id) {
  const next = { ...(expanded ?? {}) };
  next[id] = !next[id];
  return next;
}

/**
 * rememberExpand=false 时展开状态只在内存；true 时按工作区持久化。
 * @param {{rememberExpand: boolean}} prefs
 * @param {Record<string, boolean>} expanded
 */
export function persistableExpanded(prefs, expanded) {
  return prefs?.rememberExpand === true ? expanded ?? {} : {};
}

/** @param {any} uiState */
export function normalizeUiState(uiState) {
  return {
    expanded: uiState && typeof uiState.expanded === "object" && uiState.expanded !== null && !Array.isArray(uiState.expanded) ? uiState.expanded : {},
    rememberExpand: uiState?.rememberExpand === true
  };
}
