/**
 * 追溯轮次定位 + 高亮（B-50 / A33，v1.21；v1.32 修真实滚动）。
 * 平台事实（2026-11-12 CDP 实测，DSH 0.2.0-rc.2）：
 * - 聊天虚拟列表只渲染最近若干轮；顶部「加载更早 / Load earlier」按钮每点一次加载一段；
 * - 轮次尾巴节点带 `[data-turn-tail="<turn>"]`；右侧「轮次导航」轨道的按钮 aria-label 为
 *   「跳转到第 N 轮 / 加载并跳转到第 N 轮」（英文 Jump to turn N / Load and jump to turn N），
 *   点击走宿主自己的 ChatNavigation（会先加载历史再落位）。
 * - **scrollIntoView 在聊天滚动容器里是空操作**（外层 `overflow: visible clip` + 宿主的滚动保持/
 *   锚定逻辑会吞掉它）：曾经「提示已跳转、高亮，但画面没动」就是这个原因。改为直接计算目标在
 *   滚动容器内的偏移并设置 `scrollTop`，再校验目标真的进入视口；不成功就如实返回失败。
 * 纯前端导航：不写数据、不改 pointer；失败必须显式返回原因（不静默）。
 */

export const TURN_ATTR = "data-turn-tail";
export const FLASH_ATTR = "data-dsh-compass-flash";
export const FLASH_STYLE_ID = "dsh-compass-flash-style";
/** 聊天滚动容器的公开稳定属性（DSH ui-conversation 渲染）。 */
export const CHAT_SCROLL_SELECTOR = "[data-conversation-scroll]";

const LOAD_EARLIER_LABELS = ["加载更早", "Load earlier", "加载更早的消息", "Load earlier turns"];
const VISIBLE_TOLERANCE_PX = 6;
const SCROLL_SETTLE_MS = 260;

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

/** 轮次导航轨道按钮文案（中/英）：用于走宿主自己的跳转实现。 */
export function isTurnRailLabel(text, turn) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  const n = String(Number(turn));
  return (
    value === `跳转到第 ${n} 轮` ||
    value === `加载并跳转到第 ${n} 轮` ||
    new RegExp(`^(?:Load and )?jump to turn\\s*${n}$`, "i").test(value)
  );
}

/** 在 DOM 中找目标轮次的导航按钮（可能因虚拟化不在 DOM；找不到返回 null）。 */
export function findTurnRailButton(doc, turn) {
  const buttons = doc?.querySelectorAll?.("button") ?? [];
  for (const button of buttons) {
    const label = button.getAttribute?.("aria-label") ?? "";
    if (isTurnRailLabel(label, turn)) return button;
  }
  return null;
}

/** @param {any} node */
function isScrollable(node) {
  if (!node) return false;
  const view = node.ownerDocument?.defaultView ?? null;
  const style = typeof view?.getComputedStyle === "function" ? view.getComputedStyle(node) : null;
  const overflowY = style ? String(style.overflowY ?? "") : "auto";
  const scrollableStyle = /(auto|scroll|overlay)/.test(overflowY);
  return scrollableStyle && Number(node.scrollHeight) > Number(node.clientHeight);
}

/**
 * 找聊天滚动容器：优先宿主稳定属性 `[data-conversation-scroll]`，退化到轮次节点的可滚动祖先。
 * @param {any} doc
 */
export function findChatScroller(doc) {
  const direct = doc?.querySelector?.(CHAT_SCROLL_SELECTOR) ?? null;
  if (direct && isScrollable(direct)) return direct;
  const anchors = doc?.querySelectorAll?.(`[${TURN_ATTR}]`) ?? [];
  if (anchors.length === 0) return null;
  let node = anchors[0].parentElement ?? null;
  while (node) {
    if (isScrollable(node)) return node;
    node = node.parentElement ?? null;
  }
  return null;
}

/** 目标是否已进入滚动容器的可视区域（带容差）。 */
export function isVisibleInScroller(el, scroller, tolerance = VISIBLE_TOLERANCE_PX) {
  if (!el || !scroller) return false;
  const rect = el.getBoundingClientRect?.();
  const base = scroller.getBoundingClientRect?.();
  if (!rect || !base) return false;
  return rect.bottom >= base.top - tolerance && rect.top <= base.bottom + tolerance;
}

/**
 * 把目标滚进滚动容器（居中）。不依赖 scrollIntoView：直接算偏移并设 scrollTop。
 * @param {any} doc
 * @param {any} el
 * @param {{scroller?: any}} [options]
 * @returns {{ok: boolean, scroller: any, before: number, after: number, target: number}}
 */
export function scrollIntoScroller(doc, el, options = {}) {
  const scroller = options.scroller ?? findChatScroller(doc);
  const before = Number(scroller?.scrollTop ?? 0);
  if (!el || !scroller) {
    el?.scrollIntoView?.({ block: "center" });
    return { ok: false, scroller: scroller ?? null, before, after: before, target: before };
  }
  const rect = el.getBoundingClientRect?.();
  const base = scroller.getBoundingClientRect?.();
  if (!rect || !base) return { ok: false, scroller, before, after: before, target: before };
  const offset = rect.top - base.top + before;
  const max = Math.max(0, Number(scroller.scrollHeight) - Number(scroller.clientHeight));
  const target = Math.max(0, Math.min(max, offset - Math.max(0, (Number(scroller.clientHeight) - rect.height) / 2)));
  try {
    scroller.scrollTo?.({ top: target, behavior: "instant" });
  } catch {
    // 老浏览器不认 options 对象时退化为直接赋值
  }
  if (Math.abs(Number(scroller.scrollTop) - target) > 2) {
    try {
      scroller.scrollTop = target;
    } catch {
      // 忽略；下面统一读实际值
    }
  }
  return { ok: true, scroller, before, after: Number(scroller.scrollTop), target };
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

/**
 * 定位并高亮轮次；返回真实结果（滚动失败不谎报成功）。
 * @param {number} turn
 * @param {{document?: any, sleep?: (ms:number)=>Promise<void>, now?: ()=>number, timeoutMs?: number,
 *   pageWaitMs?: number, highlightMs?: number}} [options]
 */
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
      const scroller = findChatScroller(doc);
      // 1) 直接设置 scrollTop（scrollIntoView 在 DSH 聊天容器里会被吞掉）
      const moved = scrollIntoScroller(doc, target, { scroller });
      highlight(target, doc, options.highlightMs ?? 3000);
      await sleep(SCROLL_SETTLE_MS);
      const visible = scroller ? isVisibleInScroller(target, scroller) : true;
      if (!scroller || visible) return { ok: true, reason: "located", pages, turn: Number(turn), via: "scroll" };
      // 2) 宿主自己的轮次导航（走 ChatNavigation，处理锚定/加载），再校正到轮次尾巴
      const rail = findTurnRailButton(doc, turn);
      if (rail) {
        rail.click();
        await sleep(Math.max(pageWaitMs, 900));
        scrollIntoScroller(doc, target, { scroller: findChatScroller(doc) });
        highlight(target, doc, options.highlightMs ?? 3000);
        await sleep(SCROLL_SETTLE_MS);
        const again = isVisibleInScroller(target, findChatScroller(doc));
        if (again) return { ok: true, reason: "located", pages, turn: Number(turn), via: "rail" };
      }
      return { ok: false, reason: "scroll-failed", pages, turn: Number(turn) };
    }
    // 目标未渲染：优先点宿主轮次导轨（它会自动加载历史），再退化到「加载更早」
    const rail = findTurnRailButton(doc, turn);
    if (rail) {
      rail.click();
      pages += 1;
      await sleep(Math.max(pageWaitMs, 900));
      continue;
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
 * 跳转结果文案（B-61）：区分「按时间还原」「日志缺失」「轮次不存在」「未渲染」「滚动失败」，
 * 失败不静默、不说谎（不把没滚动到说成已定位）。
 * @param {{ok?: boolean, reason?: string, turn?: number, via?: string}|null} result
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
  if (result?.reason === "scroll-failed") {
    const where = inParent ? "父会话" : "会话";
    return `已高亮第 ${target ?? requested ?? "?"} 轮，但未能滚动到该轮（宿主滚动容器的锚定拦截了滚动）；请在${where}内手动向上翻找，或再点一次`;
  }
  if (result?.reason === "turn-not-rendered" || result?.reason === "timeout-after-pages") {
    const total = Number.isInteger(meta?.turn_count) ? `（会话日志共 ${meta.turn_count} 轮）` : "";
    const where = inParent ? "父会话" : "会话";
    return `已打开${where}，但未能定位第 ${target ?? requested ?? "?"} 轮${total}`;
  }
  if (result?.reason === "unsupported") return "宿主不支持会话跳转";
  return `已打开会话，但未能定位第 ${target ?? requested ?? "?"} 轮`;
}
