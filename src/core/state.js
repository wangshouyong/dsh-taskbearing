/**
 * 双线状态与状态转移矩阵。
 * 设计契约：docs/schema-v2.md §6.1 / §6.2。
 *
 * 执行线 exec_state：未开始 / 进行中 / 已阻塞 / 已执行（可任意互转，必须带 note）
 * 裁决线 verdict_state：null / 待裁决 / 已废弃 / 已替代 / 已确认继续（瞬时值，落板回 null）
 *
 * 「已阻塞」= AI 卡在等第三方/等确认/被别的 bug 挡住，需要人工介入；非终端，不夺裁决主导权。
 */

import { CODES, fail } from "./errors.js";

export const EXEC_STATES = Object.freeze(["未开始", "进行中", "已阻塞", "已执行"]);
export const BLOCKED_STATE = "已阻塞";
export const VERDICT_INPUTS = Object.freeze(["待裁决", "冲突", "已废弃", "已替代", "已确认继续"]);
export const TERMINAL_VERDICTS = Object.freeze(["已废弃", "已替代"]);
export const INSTANT_VERDICT = "已确认继续";

/**
 * 合法裁决转移集合，键为 `${from ?? "null"}>${to ?? "null"}`。
 * 注意：已确认继续 只作为目标出现，绝不落板。
 */
const ALLOWED_VERDICT_TRANSITIONS = new Set([
  "null>待裁决",
  "null>冲突",
  "冲突>待裁决",
  "待裁决>冲突",
  "冲突>已废弃",
  "冲突>已替代",
  "冲突>已确认继续",
  "冲突>null",
  "冲突>冲突",
  "待裁决>已废弃",
  "待裁决>已替代",
  "待裁决>已确认继续",
  "待裁决>null",
  "待裁决>待裁决",
  "已废弃>待裁决",
  "已替代>待裁决",
  "已废弃>已替代",
  "已替代>已废弃"
]);

/** @param {string} value */
export function assertExecState(value) {
  if (!EXEC_STATES.includes(value)) {
    fail(CODES.INVALID_ARG, `exec_state 非法：${String(value)}（允许：${EXEC_STATES.join(" / ")}）`);
  }
  return value;
}

/** @param {unknown} value */
export function assertVerdictInput(value) {
  if (value === null) return value;
  if (!VERDICT_INPUTS.includes(/** @type {string} */ (value))) {
    fail(CODES.INVALID_ARG, `verdict_state 非法：${String(value)}（允许：null / ${VERDICT_INPUTS.join(" / ")}）`);
  }
  return value;
}

/**
 * 落板规范化：已确认继续 不持久化，写回 null。
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
export function normalizeVerdictForStorage(value) {
  if (value === undefined) return undefined;
  if (value === INSTANT_VERDICT) return null;
  return value;
}

/**
 * 查询转移是否合法。
 * @param {string|null} from 当前落板值（null = 无）
 * @param {string|null} to 目标值（可含瞬时值 已确认继续）
 * @returns {{legal: boolean, reason?: string}}
 */
export function checkVerdictTransition(from, to) {
  const key = `${from ?? "null"}>${to ?? "null"}`;
  if (ALLOWED_VERDICT_TRANSITIONS.has(key)) return { legal: true };
  const reason = describeIllegal(from, to);
  return { legal: false, reason };
}

/**
 * 当前状态下合法可达的裁决目标（用于非法转移报错给出「下一步」）。
 * @param {string|null} from
 * @returns {string[]}
 */
export function allowedVerdictTargets(from) {
  const prefix = `${from ?? "null"}>`;
  const targets = [];
  for (const key of ALLOWED_VERDICT_TRANSITIONS) {
    if (!key.startsWith(prefix)) continue;
    const target = key.slice(prefix.length);
    if (target !== INSTANT_VERDICT && !targets.includes(target)) targets.push(target);
  }
  return targets.map((target) => (target === "null" ? "null（清空）" : target));
}

/**
 * @param {string|null} from
 * @param {string|null} to
 * @returns {string}
 */
export function describeIllegal(from, to) {
  const f = from ?? "null";
  const t = to ?? "null";
  if (f === "null" && (t === "已废弃" || t === "已替代")) {
    return "不能从 null 直接废弃/替代：先标「待裁决」再拍板（如需直接废弃见方案 O-6，目前未开放）";
  }
  if (f === "null" && t === INSTANT_VERDICT) return "「已确认继续」是瞬时值，只能作为「待裁决」的结果";
  if (f === INSTANT_VERDICT) return "「已确认继续」不落板，不能作为起点";
  if ((f === "已废弃" || f === "已替代") && t === "null") return "复活必须先到「待裁决」，不能直接回 null";
  if ((f === "已废弃" || f === "已替代") && t === INSTANT_VERDICT) return "复活必须先到「待裁决」，再确认继续";
  const targets = allowedVerdictTargets(from);
  return `不允许的裁决转移：${f} → ${t}。当前状态允许：${targets.length > 0 ? targets.join(" / ") : "（无合法目标）"}`;
}

/**
 * 断言转移合法，非法时抛 E_INVALID_TRANSITION。
 * @param {string|null} from
 * @param {string|null} to
 */
export function assertVerdictTransition(from, to) {
  const result = checkVerdictTransition(from, to);
  if (!result.legal) {
    fail(CODES.INVALID_TRANSITION, result.reason ?? "不允许的裁决转移", { from, to });
  }
}

/** @param {unknown} v */
export function isTerminalVerdict(v) {
  return v === "已废弃" || v === "已替代";
}

/** @param {string|null} from @param {string|null} to */
export function isSameVerdict(from, to) {
  return (from ?? null) === (to ?? null);
}
