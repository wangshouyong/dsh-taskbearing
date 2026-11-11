/**
 * 追溯指针视图逻辑（B-43 / A28）：会话可用性判定 / 降级文案 / 显示格式化。
 * 纯函数，不依赖 DOM 或宿主：entry.js 从 ctx 取快照后传入，CompassTab 只按结果渲染。
 *
 * 契约：v1.19 §8.5 / §11.2（SP-9）。
 */

export const SESSION_STATES = Object.freeze({
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  ARCHIVED: "archived",
  LOADING: "loading",
  UNSUPPORTED: "unsupported",
  FILE: "file"
});

/**
 * 会话 id 形态（v1.30 / B-61）：`session-<…>`（主会话）或裸 UUID（子代理会话，DSH 实测）。
 * 非会话指针（迁移的 file:<path>#Lx-Ly）走 FILE 分支。
 */
export function isValidSessionId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^(?:session-[A-Za-z0-9._-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(text);
}

/**
 * 判定一条 pointer 的跳转可用性。
 * @param {string} sessionId
 * @param {{
 *   canOpen?: boolean,
 *   sessions?: {ids?: string[], phase?: string} | null,
 *   workspaces?: {state?: string, archivedSessionIds?: string[]} | null
 * }} ctx
 * @returns {string} SESSION_STATES 之一
 */
export function sessionLinkState(sessionId, ctx = {}) {
  if (typeof sessionId !== "string" || !sessionId.trim()) return SESSION_STATES.UNAVAILABLE;
  // 迁移来源是文件段（file:<path>#Lx-Ly），不是会话
  if (/^file:/i.test(sessionId.trim())) return SESSION_STATES.FILE;
  if (!isValidSessionId(sessionId)) return SESSION_STATES.UNAVAILABLE;
  if (!ctx.canOpen) return SESSION_STATES.UNSUPPORTED;
  if (!ctx.sessions || !ctx.workspaces) return SESSION_STATES.UNSUPPORTED;
  if (ctx.workspaces.state === "error") return SESSION_STATES.UNAVAILABLE;
  if (ctx.sessions.phase === "pending" || ctx.workspaces.phase === "pending") return SESSION_STATES.LOADING;
  if (Array.isArray(ctx.workspaces.archivedSessionIds) && ctx.workspaces.archivedSessionIds.includes(sessionId)) {
    return SESSION_STATES.ARCHIVED;
  }
  if (Array.isArray(ctx.sessions.ids) && ctx.sessions.ids.includes(sessionId)) return SESSION_STATES.AVAILABLE;
  return SESSION_STATES.UNAVAILABLE;
}

/**
 * 会话可跳转性终判（v1.30 / B-61）：客户端会话快照只含「已加载」会话，
 * 历史会话会被误判成「会话不可用」（假阴性）。宿主按会话日志核验存在后，
 * 只把 UNAVAILABLE 覆盖成 AVAILABLE；归档/加载中/文件段/宿主不支持等状态保持原样。
 * @param {string} snapshotState sessionLinkState 的结果
 * @param {boolean|undefined} hostExists 宿主核验结果（undefined = 未核验/核验失败）
 * @returns {string} SESSION_STATES 之一
 */
export function resolveSessionLinkState(snapshotState, hostExists) {
  // 只覆盖「快照里没有，但宿主磁盘上明明有日志」这一种假阴性；
  // 归档/加载中/文件段/宿主不支持（canOpen=false）都保持原判，不越权承诺可跳转。
  if (snapshotState !== SESSION_STATES.UNAVAILABLE) {
    return snapshotState ?? SESSION_STATES.UNAVAILABLE;
  }
  if (hostExists === true) return SESSION_STATES.AVAILABLE;
  return SESSION_STATES.UNAVAILABLE;
}

/**
 * 降级文案（不可跳转时可见提示，不静默失败）。
 * @param {string} state
 */
export function describeSessionLink(state) {
  switch (state) {
    case SESSION_STATES.AVAILABLE:
      return "";
    case SESSION_STATES.ARCHIVED:
      return "会话已归档";
    case SESSION_STATES.LOADING:
      return "会话加载中…";
    case SESSION_STATES.UNSUPPORTED:
      return "宿主不支持会话跳转";
    case SESSION_STATES.FILE:
      return "文件段（不可跳转）";
    default:
      return "会话不可用";
  }
}

/**
 * 会话 id 缩略（完整 id 放 title）。
 * @param {string} sessionId
 */
export function shortSessionId(sessionId) {
  const value = String(sessionId ?? "");
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}…${value.slice(-4)}`;
}

/**
 * 追溯链时间显示（ISO → `YYYY-MM-DD HH:mm:ss`，无效输入返回空串，不编造）。
 * @param {unknown} at
 */
export function formatPointerAt(at) {
  if (typeof at !== "string") return "";
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(at) ? at : "";
  if (!iso) return "";
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/**
 * 追溯链展示行（只做格式化，不判断语义）。
 * @param {any} pointer
 * @param {number} index
 */
export function pointerRow(pointer, index) {
  const session = typeof pointer?.session === "string" ? pointer.session : "";
  return {
    key: `${session}#${pointer?.at ?? ""}#${index}`,
    at: formatPointerAt(pointer?.at),
    turn: Number.isInteger(pointer?.turn) && pointer.turn >= 0 ? pointer.turn : null,
    note: typeof pointer?.note === "string" ? pointer.note : "",
    session,
    shortSession: shortSessionId(session)
  };
}
