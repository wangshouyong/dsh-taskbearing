/**
 * 追溯轮次定位 + 高亮（B-50 / A33，v1.21）。
 * 平台事实（2026-11-11 CDP 实测）：聊天虚拟列表只渲染最近若干轮；顶部「加载更早 / Load earlier」
 * 按钮每点一次加载约 5 轮；轮次节点带 `[data-turn-tail="<turn>"]`（以及 data-turn-process）。
 * 纯前端导航：不写数据、不改 pointer；失败必须显式返回原因（不静默）。
 */

export const TURN_ATTR = "data-turn-tail";
export const FLASH_ATTR = "data-dsh-compass-flash";
export const FLASH_STYLE_ID = "dsh-compass-flash-style";

const LOAD_EARLIER_LABELS = ["加载更早", "Load earlier", "加载更早的消息", "Load earlier turns"];

export function turnSelector(turn) {
  return `[${TURN_ATTR}="${Number(turn)}"]`;
}

export function isLoadEarlierLabel(text) {
  const value = String(text ?? "").trim();
  return LOAD_EARLIER_LABELS.some((label) => value === label || value.startsWith(label));
}

export function findLoadEarlier(doc) {
  const buttons = doc?.querySelectorAll?.("button") ?? [];
  for (const button of buttons) {
    if (isLoadEarlierLabel(button.textContent)) return button;
  }
  return null;
}

export function findChatScroller(doc) {
  const anchors = doc?.querySelectorAll?.(`[${TURN_ATTR}]`) ?? [];
  if (anchors.length === 0) return null;
  let node = anchors[0].parentElement ?? null;
  while (node) {
    const view = node.ownerDocument?.defaultView ?? null;
    const style = typeof view?.getComputedStyle === "function" ? view.getComputedStyle(node) : null;
    const scrollable = style ? /(auto|scroll)/.test(String(style.overflowY ?? "")) : true;
    if (scrollable && Number(node.scrollHeight) > Number(node.clientHeight)) return node;
    node = node.parentElement ?? null;
  }
  return null;
}

export function ensureFlashStyle(doc) {
  if (!doc || typeof doc.createElement !== "function") return;
  if (typeof doc.getElementById === "function" && doc.getElementById(FLASH_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = FLASH_STYLE_ID;
  style.textContent =
    "@keyframes dsh-compass-flash-pulse{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0);background-color:rgba(59,130,246,0)}" +
    "25%,75%{box-shadow:0 0 0 3px rgba(59,130,246,.85);background-color:rgba(59,130,246,.12)}}" +
    `[${FLASH_ATTR}]{animation:dsh-compass-flash-pulse 1s ease-in-out 2;border-radius:8px}`;
  (doc.head ?? doc.documentElement)?.appendChild?.(style);
}

export function highlight(el, doc = el?.ownerDocument, ms = 3000) {
  if (!el || typeof el.setAttribute !== "function") return false;
  ensureFlashStyle(doc);
  el.setAttribute(FLASH_ATTR, "1");
  const view = doc?.defaultView ?? null;
  const timer = (typeof view?.setTimeout === "function" ? view.setTimeout : setTimeout)(() => {
    el.removeAttribute?.(FLASH_ATTR);
  }, ms);
  if (timer && typeof timer.unref === "function") timer.unref();
  return true;
}

export async function locateTurn(turn, options = {}) {
  const doc = options.document ?? (typeof document === "undefined" ? null : document);
  if (!doc) return { ok: false, reason: "no-document", pages: 0 };
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
  const pageWaitMs = Number.isFinite(options.pageWaitMs) ? options.pageWaitMs : 700;
  const deadline = now() + timeoutMs;
  let pages = 0;
  while (now() <= deadline) {
    const target = doc.querySelector?.(turnSelector(turn));
    if (target) {
      target.scrollIntoView?.({ block: "center", behavior: "smooth" });
      highlight(target, doc, options.highlightMs ?? 3000);
      return { ok: true, reason: "located", pages, turn: Number(turn) };
    }
    const button = findLoadEarlier(doc);
    if (button) {
      button.click();
      pages += 1;
      await sleep(pageWaitMs);
      continue;
    }
    await sleep(300);
  }
  return { ok: false, reason: pages > 0 ? "timeout-after-pages" : "turn-not-rendered", pages };
}

export async function jumpToTurn(target = {}, options = {}) {
  const turn = Number(target.turn);
  if (!Number.isInteger(turn) || turn < 1) return { ok: false, reason: "no-turn", pages: 0 };
  const pointerSessionId = typeof target.sessionId === "string" ? target.sessionId : "";
  const currentSessionId = typeof target.currentSessionId === "string" ? target.currentSessionId : null;
  if (pointerSessionId && pointerSessionId !== currentSessionId) {
    if (typeof target.openSession !== "function") return { ok: false, reason: "unsupported", pages: 0 };
    let opened = true;
    try {
      opened = target.openSession(pointerSessionId);
    } catch {
      opened = false;
    }
    if (opened === false) return { ok: false, reason: "open-failed", pages: 0 };
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    await sleep(Number.isFinite(options.openWaitMs) ? options.openWaitMs : 1200);
  }
  return locateTurn(turn, options);
}

/**
 * 跳转前的轮次核验（v1.30 / B-61）：把宿主按会话日志还原的真实轮次作为目标。
 * 旧版插件写过错误 turn 的历史指针，用 `at`（权威时间）还原后仍能跳对；
 * 日志缺失 / 轮次不存在必须如实说明（不猜测、不静默）。
 *
 * @param {{sessionId: string, turn: number|null, at: string|null,
 *   request?: ((params: {session: string, turn: number|null, at: string|null}) => Promise<any>)|null}} input
 * @returns {Promise<{targetTurn: number|null, meta: any|null, reason: string|null, error?: string}>}
 *   reason: null（可跳）/ log-unavailable / turn-missing / no-turn / lookup-failed
 */
export async function resolveJumpTarget(input) {
  const requestedTurn = Number.isInteger(input?.turn) && input.turn >= 1 ? input.turn : null;
  const at = typeof input?.at === "string" && input.at.trim() ? input.at.trim() : null;
  if (typeof input?.request !== "function") {
    return { targetTurn: requestedTurn, meta: null, reason: requestedTurn === null ? "no-turn" : null };
  }
  let meta;
  try {
    meta = await input.request({
      session: typeof input?.sessionId === "string" ? input.sessionId : "",
      turn: requestedTurn,
      at
    });
  } catch (err) {
    // 旧宿主缺接口 / 网络失败：退回按原 turn 尝试跳转（保持旧行为），并把原因带出去
    return {
      targetTurn: requestedTurn,
      meta: null,
      reason: "lookup-failed",
      error: err instanceof Error ? err.message : String(err)
    };
  }
  if (!meta || typeof meta !== "object") {
    return { targetTurn: requestedTurn, meta: null, reason: "lookup-failed", error: "宿主返回为空" };
  }
  if (meta.log_available !== true) {
    return { targetTurn: null, meta, reason: requestedTurn === null ? "no-turn" : "log-unavailable" };
  }
  const resolved = Number.isInteger(meta.turn) && meta.turn >= 1 ? meta.turn : null;
  if (resolved === null) {
    return { targetTurn: null, meta, reason: requestedTurn === null ? "no-turn" : "turn-missing" };
  }
  return { targetTurn: resolved, meta, reason: null };
}

/**
 * 跳转结果文案（B-61）：区分「按时间还原」「日志缺失」「轮次不存在」「未渲染」，
 * 失败不静默、不说谎（不把没定位到说成已定位）。
 * @param {{ok?: boolean, reason?: string, turn?: number}|null} result
 * @param {{targetTurn?: number|null, meta?: any|null, reason?: string|null}|null} plan
 */
export function describeJumpStatus(result, plan) {
  const meta = plan?.meta ?? null;
  const target = Number.isInteger(plan?.targetTurn) ? plan.targetTurn : null;
  const requested = Number.isInteger(meta?.requested_turn) ? meta.requested_turn : null;
  if (plan?.reason === "lookup-failed") {
    if (result?.ok) return `已定位第 ${target ?? result?.turn ?? "?"} 轮（宿主未提供轮次核验，高亮约 3 秒）`;
    return `已打开会话，但未能定位第 ${target ?? requested ?? "?"} 轮`;
  }
  if (plan?.reason === "log-unavailable") return "该会话没有可读的日志，已打开会话（无法核验轮次）";
  if (plan?.reason === "turn-missing") {
    return `该会话日志只有 ${meta?.turn_count ?? 0} 轮，戳记第 ${requested ?? "?"} 轮不存在；已打开会话`;
  }
  if (plan?.reason === "no-turn") return "该记录无轮次信息，仅打开会话";
  if (result?.reason === "open-failed") return "打开会话失败：宿主未提供会话跳转";
  const inParent = meta?.origin === "subagent" && typeof meta?.target_session === "string" && meta.target_session;
  if (result?.ok) {
    const corrected = meta?.source === "by-at" && requested !== null && requested !== target;
    if (inParent) {
      return corrected
        ? `子代理会话不可直接打开；已按时间在父会话定位第 ${target} 轮（戳记第 ${requested} 轮，高亮约 3 秒）`
        : `子代理会话不可直接打开；已在父会话定位第 ${target ?? "?"} 轮（高亮约 3 秒）`;
    }
    return corrected
      ? `戳记第 ${requested} 轮与日志不符，已按时间还原为第 ${target} 轮（高亮约 3 秒）`
      : `已定位第 ${target ?? result?.turn ?? "?"} 轮（高亮约 3 秒）`;
  }
  if (result?.reason === "turn-not-rendered" || result?.reason === "timeout-after-pages") {
    const total = Number.isInteger(meta?.turn_count) ? `（会话日志共 ${meta.turn_count} 轮）` : "";
    const where = inParent ? "父会话" : "会话";
    return `已打开${where}，但未能定位第 ${target ?? requested ?? "?"} 轮${total}`;
  }
  if (result?.reason === "unsupported") return "宿主不支持会话跳转";
  return `已打开会话，但未能定位第 ${target ?? requested ?? "?"} 轮`;
}