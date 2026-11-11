/**
 * 宿主会话访问层（SP-8 实测后的实现）：从 tool execute 的 exec 里取会话与用户原文。
 * 实测依据见 开发实现说明：
 *   exec.agent.session.header = { version, id, createdAt, cwd, isSeeded }
 *   exec.agent.session.deriveMessages() 可读整段会话（含 user/assistant/tool 消息）
 * 注意：DSH 会把系统提醒（如 <system-reminder>…</system-reminder>、技能清单）以 user 角色注入，
 * 取「原话」时必须剥掉这些机器注入块，只保留用户真正打出的文字。
 */

const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;

/**
 * 去掉机器注入的 system-reminder 块；其余内容逐字保留（含标点与空白结构）。
 * @param {string} text
 * @returns {string}
 */
export function stripSystemReminders(text) {
  return String(text ?? "").replace(REMINDER_RE, "").trim();
}

/**
 * 取一条消息的纯文本（content 可能是字符串或分段数组）。
 * @param {any} message
 * @returns {string}
 */
export function messageText(message) {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

/**
 * 机器注入的「伪 user 消息」特征。
 * DSH 会把 runtime-context 快照、技能清单、指令基线等以 user 角色注入；
 * `deriveMessages()` 丢掉了事件的 `source`，所以退化路径只能按内容特征排除。
 */
const INJECTED_TEXT_MARKERS = [
  "Current runtime context.",
  "This snapshot supersedes earlier runtime-context snapshots.",
  "Current DSH file policy:",
  "Approval policy:",
  "A skill is a reusable set of task-specific instructions.",
  // v1.24：运行时时间快照块（曾导致原话误抓，见 R-002 基线修复）
  "Time sampled while preparing",
  "Browser time zone for this request:",
  "Elapsed since the preceding",
  "Elapsed since the preceding model-visible message"
];

const MAX_FALLBACK_ORIGINAL_LENGTH = 2000;

/**
 * @param {string} text
 * @returns {boolean} 是否像机器注入内容（退化路径用）
 */
export function isInjectedUserText(text) {
  const value = stripSystemReminders(text);
  if (!value) return true;
  return INJECTED_TEXT_MARKERS.some((marker) => value.includes(marker));
}

/**
 * 退化路径：从 deriveMessages() 里挑出「像用户原话」的候选。
 * 过滤：空文本、机器注入特征、超长（>2000 字符，多半是指令文件基线）。
 * @param {Array<any>} messages
 * @returns {Array<{index: number, turn: number, text: string, at: string|null}>}
 */
export function genuineUserMessages(messages) {
  return userMessages(messages).filter(
    (entry) => entry.text.length > 0 && entry.text.length <= MAX_FALLBACK_ORIGINAL_LENGTH && !isInjectedUserText(entry.text)
  );
}

/**
 * 从消息列表里挑出「用户原话」候选（user 角色 + 去掉注入块后非空）。
 * @param {Array<any>} messages
 * @returns {Array<{index: number, turn: number, text: string, at: string|null}>}
 */
export function userMessages(messages) {
  const out = [];
  let turn = 0;
  for (let index = 0; index < (messages?.length ?? 0); index += 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    turn += 1;
    const text = stripSystemReminders(messageText(message));
    out.push({
      index,
      turn,
      text,
      at: Number.isFinite(message?.at) ? new Date(message.at).toISOString() : null
    });
  }
  return out;
}

/**
 * 从 exec 的宿主上下文提取基本信息（SP-1 实测字段）。
 * @param {any} exec tool execute 的第二个参数
 * @returns {{sessionId: string|null, cwd: string|null, session: any|null}}
 */
export function hostSessionInfo(exec) {
  const session = exec?.agent?.session ?? null;
  const header = session?.header ?? null;
  return {
    sessionId: header?.id ?? null,
    cwd: header?.cwd ?? null,
    session
  };
}

/**
 * 原话读取器：按 refs 逐字取回用户原文（去掉机器注入块），并给出消息定位。
 * refs 支持：
 *   "current"            当前会话最后一条用户消息
 *   [3]                  第 3 条用户消息（按用户消息计数，从 1 开始）
 *   [{turn: 3}]          同上
 *   [{index: 7}]         直接按消息下标
 * @param {any} refs
 * @param {{exec: any, now?: () => Date}} ctx
 * @returns {{text: string, session: string, at: string, index: number, turn: number} | null}
 */
export function readOriginal(refs, ctx) {
  const { session, sessionId } = hostSessionInfo(ctx?.exec);
  if (!session || typeof session.deriveMessages !== "function") return null;
  const messages = session.deriveMessages();
  const isCurrent = refs === undefined || refs === null || refs === "current";
  // 退化路径：current 只接受「像用户原话」的候选（排除 runtime-context / 技能清单 / 指令基线）；
  // 显式 refs 按用户指定下标取（调用方明确要哪条消息）。
  const users = isCurrent ? genuineUserMessages(messages) : userMessages(messages).filter((entry) => entry.text.length > 0);
  if (users.length === 0) return null;

  const now = ctx?.now ?? (() => new Date());
  /** @type {any} */
  let picked = null;

  if (isCurrent) {
    picked = users.at(-1);
  } else if (Array.isArray(refs)) {
    const first = refs[0];
    if (typeof first === "number") picked = users[first - 1] ?? null;
    else if (first && typeof first.turn === "number") picked = users[first.turn - 1] ?? null;
    else if (first && typeof first.index === "number") picked = users.find((entry) => entry.index === first.index) ?? null;
  } else if (typeof refs === "object") {
    if (typeof refs.turn === "number") picked = users[refs.turn - 1] ?? null;
    else if (typeof refs.index === "number") picked = users.find((entry) => entry.index === refs.index) ?? null;
  }
  if (!picked) return null;

  return {
    text: picked.text,
    session: sessionId ?? "unknown-session",
    at: now().toISOString(),
    index: picked.index,
    turn: picked.turn
  };
}

/**
 * 原话写入校验（B-53，v1.24）：AI 传入的 `original_text` 必须与**当前会话**某条真实用户消息逐字一致。
 * 只读 deriveMessages（当前会话），不做跨会话扫描（history 边界 B-54）。
 * @param {string} text AI 传入的原话
 * @param {{exec: any}} ctx
 * @returns {{ok: true, at: string, index: number, turn: number} | {ok: false}}
 */
export function verifyOriginalText(text, ctx) {
  const wanted = String(text ?? "");
  if (!wanted) return { ok: false };
  const { session } = hostSessionInfo(ctx?.exec);
  if (!session || typeof session.deriveMessages !== "function") return { ok: false };
  const messages = session.deriveMessages();
  // 校验用全部非注入用户消息（不设 2000 字上限：逐字相等本身就是强信号，长原话也应可校验）
  const candidates = userMessages(messages).filter((entry) => entry.text.length > 0 && !isInjectedUserText(entry.text));
  for (const entry of candidates) {
    if (entry.text === wanted) {
      return {
        ok: true,
        at: entry.at ?? new Date().toISOString(),
        index: entry.index,
        turn: entry.turn
      };
    }
  }
  return { ok: false };
}
