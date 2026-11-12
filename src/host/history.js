/**
 * 历史会话读取（compass_import 用）：只读 $DSH_HOME/sessions，不写、不删。
 * 契约：v1.8 §5.9、§6.8（B-29）。
 *
 * 会话日志格式：<sessions>/<workspace-key>/session-<id>/session.v4.jsonl.zstd
 * - 多帧 zstd（每个事件批次一帧），按 zstd magic 切分后逐帧解压再拼 JSONL；
 * - 真实用户消息 = `user/message` 且 `data.source.kind === "user"`（注入消息的 source 不同）。
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { CODES, fail } from "../core/errors.js";
import { stripSystemReminders } from "./session.js";

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const LOG_FILE = "session.v4.jsonl.zstd";

/**
 * 工作区路径 → 会话目录名（DSH 的编码规则，按实测样本反推并校验）：
 * - 盘符冒号去掉、路径分隔符与空格 → `-`；
 * - 非 ASCII 字符 → `~<UTF-16 码元大写 hex4>`（前缀式，不闭合）；
 * - 首尾各包 `--`。
 * @param {string} workspacePath
 */
export function workspaceSessionKey(workspacePath) {
  const raw = String(workspacePath ?? "").replace(/\\/g, "/");
  const noColon = raw.replace(/:/g, "");
  let encoded = "";
  for (const ch of noColon) {
    if (ch === "/" || ch === " ") encoded += "-";
    else if (ch.codePointAt(0) > 0x7e) encoded += `~${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    else encoded += ch;
  }
  return `--${encoded}--`;
}

/** @param {string} dshHome */
export function sessionsRootOf(dshHome) {
  return path.join(dshHome, "sessions");
}

/**
 * 解压多帧 zstd 会话日志为文本。
 * @param {Buffer} buf
 */
export function decodeSessionLog(buf) {
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1] && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) {
      offsets.push(i);
    }
  }
  if (offsets.length === 0) return "";
  if (offsets.length === 1) return zlib.zstdDecompressSync(buf).toString("utf8");
  let text = "";
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index];
    const end = index + 1 < offsets.length ? offsets[index + 1] : buf.length;
    try {
      text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString("utf8");
    } catch {
      // 个别帧损坏不应导致整份日志不可读
    }
  }
  return text;
}

/**
 * @param {string} text
 * @returns {Array<any>}
 */
export function parseSessionEvents(text) {
  const events = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // 半行/损坏行跳过
    }
  }
  return events;
}

/** @param {any} message */
function messageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("");
  }
  return "";
}

/**
 * 从事件流提取真实用户消息（逐字）。
 * @param {Array<any>} events
 * @returns {Array<{index: number, at: string|null, turn: number|null, text: string}>}
 */
export function extractUserMessages(events) {
  const out = [];
  let turnsSeen = 0;
  for (const event of events) {
    if (event?.type === "turn/start") {
      turnsSeen += 1;
      continue;
    }
    if (event?.type !== "user/message") continue;
    if (event?.data?.source?.kind !== "user") continue;
    const raw = messageText(event.data);
    const text = stripSystemReminders(raw).trim();
    if (!text) continue;
    out.push({
      index: out.length + 1,
      at: Number.isFinite(event.time) ? new Date(event.time).toISOString() : null,
      // 用户消息在其 turn/start 之后写入，故轮次 = 已见 turn/start 数；未见轮次记 null（不编造）
      turn: turnsSeen > 0 ? turnsSeen : null,
      text
    });
  }
  return out;
}

/**
 * 读取指定会话目录的日志事件。
 * @param {string} sessionDir
 */
async function readSessionEvents(sessionDir) {
  const file = path.join(sessionDir, LOG_FILE);
  const buf = await fsp.readFile(file);
  return parseSessionEvents(decodeSessionLog(buf));
}

/**
 * 列出某工作区的全部历史会话（从新到旧）。
 * @param {{sessionsRoot: string, workspacePath: string, maxSessions?: number}} input
 */
export async function listWorkspaceSessions(input) {
  const { sessionsRoot, workspacePath } = input;
  const maxSessions = input.maxSessions ?? 50;
  const key = workspaceSessionKey(workspacePath);
  const dir = path.join(sessionsRoot, key);
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path.join(dir, entry.name);
    const logFile = path.join(sessionDir, LOG_FILE);
    try {
      await fsp.access(logFile, fs.constants.R_OK);
    } catch {
      continue;
    }
    let stat;
    try {
      stat = await fsp.stat(logFile);
    } catch {
      continue;
    }
    sessions.push({ session: entry.name, dir: sessionDir, mtimeMs: stat.mtimeMs });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions.slice(0, maxSessions);
}

/**
 * 工作区历史会话摘要（B-63 / v1.32，只读）：面板在「暂无数据」空态用它判断
 * 「插件安装前就有的旧会话」还是「全新工作区」。
 * 只列会话目录 + stat（不解压会话日志、不写盘）；损坏/不可读的会话计入但跳过。
 * @param {{sessionsRoot: string, workspacePath: string, limit?: number}} input
 * @returns {Promise<{sessions: number, latestMs: number|null, truncated: boolean}>}
 */
export const SUMMARY_SESSION_LIMIT = 2000;

export async function summarizeWorkspaceSessions(input) {
  const { sessionsRoot, workspacePath } = input;
  const limit = Number.isInteger(input?.limit) && input.limit > 0 ? input.limit : SUMMARY_SESSION_LIMIT;
  const key = workspaceSessionKey(workspacePath);
  const dir = path.join(sessionsRoot, key);
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { sessions: 0, latestMs: null, truncated: false };
  }
  const dirs = entries.filter((entry) => entry.isDirectory());
  let sessions = 0;
  let latestMs = 0;
  let truncated = false;
  for (const entry of dirs) {
    if (sessions >= limit) {
      truncated = true;
      break;
    }
    const logFile = path.join(dir, entry.name, LOG_FILE);
    let stat;
    try {
      stat = await fsp.stat(logFile);
    } catch {
      continue;
    }
    sessions += 1;
    if (stat.mtimeMs > latestMs) latestMs = stat.mtimeMs;
  }
  return { sessions, latestMs: latestMs > 0 ? latestMs : null, truncated };
}

/**
 * 创建历史读取器（绑定工作区）。
 * @param {{sessionsRoot: string, workspacePath: string, maxSessions?: number, maxMessages?: number}} input
 */
export function createHistoryReader(input) {
  const { sessionsRoot, workspacePath } = input;
  const maxMessages = input.maxMessages ?? 500;
  /** @type {Map<string, Array<any>>} */
  const cache = new Map();

  /** @param {string} session */
  async function messagesOf(session) {
    if (cache.has(session)) return cache.get(session);
    const found = (await listWorkspaceSessions({ sessionsRoot, workspacePath, maxSessions: input.maxSessions })).find(
      (entry) => entry.session === session
    );
    if (!found) return null;
    const events = await readSessionEvents(found.dir);
    const messages = extractUserMessages(events);
    cache.set(session, messages);
    return messages;
  }

  return {
    /**
     * @param {{limit?: number}} [options]
     */
    async listMessages(options = {}) {
      const limit = Math.max(1, Math.min(Number.isInteger(options.limit) ? options.limit : 200, maxMessages));
      const sessions = await listWorkspaceSessions({ sessionsRoot, workspacePath, maxSessions: input.maxSessions });
      /** @type {Array<{session: string, cwd: string, messages: Array<{index: number, at: string|null, turn: number|null, text: string}>}>} */
      const out = [];
      let remaining = limit;
      for (const entry of sessions) {
        if (remaining <= 0) break;
        const messages = await messagesOf(entry.session);
        if (!messages || messages.length === 0) continue;
        const slice = messages.slice(0, remaining);
        remaining -= slice.length;
        out.push({ session: entry.session, cwd: workspacePath, messages: slice });
      }
      return out;
    },

    /**
     * @param {{session: string, index: number}} ref
     * @returns {Promise<{session: string, index: number, at: string|null, turn: number|null, text: string} | null>}
     */
    async readMessage(ref) {
      const session = String(ref?.session ?? "");
      const index = Number(ref?.index);
      if (!session || !Number.isInteger(index) || index < 1) return null;
      const messages = await messagesOf(session);
      if (!messages) return null;
      const found = messages.find((message) => message.index === index);
      return found ? { session, ...found } : null;
    }
  };
}

/**
 * 测试/诊断用：直接按会话目录读取用户消息。
 * @param {string} sessionDir
 */
export async function readSessionUserMessages(sessionDir) {
  const events = await readSessionEvents(sessionDir);
  return extractUserMessages(events);
}

// ---------------------------------------------------------------- 轮次解析（v1.30 / B-61）

const SESSION_ID_RE = /^(?:session-[A-Za-z0-9._-]{4,128}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const TURN_CACHE_LIMIT = 32;
const LOG_MISS_TTL_MS = 30_000;
const LOG_FILE_CACHE_LIMIT = 500;
const META_CACHE_LIMIT = 64;

/**
 * 会话 id 形态：`session-<...>`（主会话）或裸 UUID（子代理会话，DSH 实测）。
 * @param {unknown} value
 */
export function isSessionId(value) {
  return typeof value === "string" && SESSION_ID_RE.test(value.trim());
}

/**
 * @typedef {{turn: number, start: number|null, end: number|null}} SessionTurn
 * @typedef {{id: string, cwd: string|null, parent_session: string|null, origin: string|null}} SessionMeta
 */

/** @type {Map<string, {mtimeMs: number, size: number, turns: SessionTurn[]}>} */
const turnCache = new Map();
/** @type {Map<string, {file: string|null, at: number}>} */
const logFileCache = new Map();
/** @type {Map<string, {mtimeMs: number, size: number, meta: SessionMeta|null}>} */
const metaCache = new Map();

/** @param {string} file */
async function fileExists(file) {
  try {
    await fsp.access(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} sessionsRoot @param {string|null} workspacePath @param {string} sessionId */
async function candidateLogFile(sessionsRoot, workspacePath, sessionId) {
  if (workspacePath) {
    const file = path.join(sessionsRoot, workspaceSessionKey(workspacePath), sessionId, LOG_FILE);
    if (await fileExists(file)) return file;
  }
  // 跨工作区兜底：扫 sessions 根下一层工作区目录（历史指针可能来自其它工作区的会话）
  let entries = [];
  try {
    entries = await fsp.readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(sessionsRoot, entry.name, sessionId, LOG_FILE);
    if (await fileExists(file)) return file;
  }
  return null;
}

/**
 * 定位某会话的日志文件（只读）。优先当前工作区 key，找不到再跨工作区扫一层。
 * 命中缓存永久有效（日志文件一旦存在不会再消失）；未命中缓存 30s 后重试。
 * @param {{sessionsRoot: string, workspacePath?: string|null, sessionId: string}} input
 * @returns {Promise<string|null>}
 */
export async function findSessionLogFile(input) {
  const sessionsRoot = String(input?.sessionsRoot ?? "");
  const workspacePath = typeof input?.workspacePath === "string" ? input.workspacePath : null;
  const sessionId = String(input?.sessionId ?? "").trim();
  if (!sessionsRoot || !isSessionId(sessionId)) return null;
  const cacheKey = `${sessionsRoot}|${workspacePath ?? ""}|${sessionId}`;
  const cached = logFileCache.get(cacheKey);
  const now = Date.now();
  if (cached && (cached.file !== null || now - cached.at < LOG_MISS_TTL_MS)) return cached.file;
  const file = await candidateLogFile(sessionsRoot, workspacePath, sessionId);
  logFileCache.set(cacheKey, { file, at: now });
  if (logFileCache.size > LOG_FILE_CACHE_LIMIT) {
    logFileCache.delete(logFileCache.keys().next().value);
  }
  return file;
}

/**
 * 读取会话日志里的轮次区间（turn/start ↔ turn/end），按 turn 升序。
 * 缓存以 (mtime, size) 为版本：日志追加后自动重读。
 * @param {string} file
 * @returns {Promise<SessionTurn[]|null>} 读不到返回 null
 */
export async function readSessionTurns(file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return null;
  }
  const cached = turnCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.turns;
  let buf;
  try {
    buf = await fsp.readFile(file);
  } catch {
    return null;
  }
  const events = parseSessionEvents(decodeSessionLog(buf));
  /** @type {SessionTurn[]} */
  const turns = [];
  /** @type {Map<number, SessionTurn>} */
  const byTurn = new Map();
  for (const event of events) {
    const turn = event?.data?.turn;
    if (!Number.isInteger(turn) || turn < 1) continue;
    if (event?.type === "turn/start") {
      const existing = byTurn.get(turn);
      if (existing) {
        if (existing.start === null && Number.isFinite(event.time)) existing.start = event.time;
        continue;
      }
      const item = { turn, start: Number.isFinite(event.time) ? event.time : null, end: null };
      byTurn.set(turn, item);
      turns.push(item);
      continue;
    }
    if (event?.type === "turn/end") {
      const item = byTurn.get(turn);
      if (item && item.end === null && Number.isFinite(event.time)) item.end = event.time;
    }
  }
  turns.sort((a, b) => a.turn - b.turn);
  turnCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, turns });
  if (turnCache.size > TURN_CACHE_LIMIT) {
    turnCache.delete(turnCache.keys().next().value);
  }
  return turns;
}

/**
 * 时间点落在哪一轮（turn/start ≤ at ≤ turn/end；最后一轮 end 可能为 null）。
 * @param {SessionTurn[]|null} turns
 * @param {string|null} atIso
 * @returns {number|null}
 */
export function turnAtTime(turns, atIso) {
  if (!Array.isArray(turns) || turns.length === 0) return null;
  const at = typeof atIso === "string" ? Date.parse(atIso) : NaN;
  if (!Number.isFinite(at)) return null;
  for (const item of turns) {
    if (item.start === null) continue;
    if (item.start <= at && (item.end === null || at <= item.end)) return item.turn;
  }
  return null;
}

/**
 * 追溯跳转前的轮次核验（B-61，只读）：
 * - 日志不可读 ⇒ log_available=false（调用方必须显式降级，不猜测）；
 * - `at` 权威：能定位到轮次时按 at 还原（旧版插件写错的 turn 会被纠正，source="by-at"）；
 * - at 缺失/定位不到时，只有 turn 真实存在于日志才接受（source="exact-no-at"）；
 * - 都不成立 ⇒ turn=null（调用方提示「日志只有 N 轮」）。
 * @param {{sessionsRoot: string, workspacePath?: string|null, sessionId: string, turn?: number|null, at?: string|null}} input
 */
export async function resolveTurnForJump(input) {
  const sessionId = String(input?.sessionId ?? "").trim();
  const requestedTurn = Number.isInteger(input?.turn) && input.turn >= 1 ? input.turn : null;
  const at = typeof input?.at === "string" && input.at.trim() ? input.at.trim() : null;
  const base = {
    session: sessionId,
    exists: false,
    log_available: false,
    turn_count: null,
    requested_turn: requestedTurn,
    turn: null,
    source: null,
    origin: null,
    target_session: null
  };
  const sessionsRoot = input?.sessionsRoot;
  const workspacePath = input?.workspacePath ?? null;
  const file = await findSessionLogFile({ sessionsRoot, workspacePath, sessionId });
  if (!file) return base;
  const meta = await readSessionMeta(file);
  const isSubagent = meta?.origin === "subagent";
  // 子代理会话不能在主界面打开：跳到父会话里 `at` 所在的那一轮（用户在父会话里能看到上下文）
  if (isSubagent && meta?.parent_session) {
    const parentFile = await findSessionLogFile({ sessionsRoot, workspacePath, sessionId: meta.parent_session });
    const parentTurns = parentFile ? await readSessionTurns(parentFile) : null;
    const parentTurn = parentTurns ? turnAtTime(parentTurns, at) : null;
    return {
      ...base,
      exists: true,
      log_available: Boolean(parentTurns),
      turn_count: parentTurns ? parentTurns.length : null,
      turn: parentTurn,
      source: parentTurn !== null ? "parent-at" : null,
      origin: "subagent",
      target_session: meta.parent_session
    };
  }
  const turns = await readSessionTurns(file);
  if (!turns) return { ...base, exists: true };
  const turnCount = turns.length;
  const byAt = turnAtTime(turns, at);
  if (byAt !== null) {
    return {
      ...base,
      exists: true,
      log_available: true,
      turn_count: turnCount,
      turn: byAt,
      source: requestedTurn !== null && byAt === requestedTurn ? "exact" : "by-at"
    };
  }
  if (requestedTurn !== null && turns.some((item) => item.turn === requestedTurn)) {
    return { ...base, exists: true, log_available: true, turn_count: turnCount, turn: requestedTurn, source: "exact-no-at" };
  }
  return { ...base, exists: true, log_available: true, turn_count: turnCount };
}

/**
 * 读取会话元信息（日志首行的 `session` 事件）：id / cwd / parentSession / origin。
 * 子代理会话（origin="subagent"）不能在主界面直接打开，需要跳父会话。
 * @param {string} file
 * @returns {Promise<SessionMeta|null>}
 */
export async function readSessionMeta(file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return null;
  }
  const cached = metaCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.meta;
  let buf;
  try {
    buf = await fsp.readFile(file);
  } catch {
    return null;
  }
  const events = parseSessionEvents(decodeSessionLog(buf));
  const session = events.find((event) => event?.type === "session");
  const meta = session
    ? {
        id: String(session.id ?? session?.data?.id ?? ""),
        cwd: typeof (session.cwd ?? session?.data?.cwd) === "string" ? (session.cwd ?? session.data.cwd) : null,
        parent_session:
          typeof (session.parentSession ?? session?.data?.parentSession) === "string"
            ? session.parentSession ?? session.data.parentSession
            : null,
        origin: typeof (session.origin ?? session?.data?.origin) === "string" ? session.origin ?? session.data.origin : null
      }
    : null;
  metaCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
  if (metaCache.size > META_CACHE_LIMIT) {
    metaCache.delete(metaCache.keys().next().value);
  }
  return meta;
}

/**
 * 当前轮次（退化来源，B-61）：插件在轮次中途加载时 TurnTracker 没有 openTurn，
 * 用会话日志还原当前轮次（与 `turn/start` 同一权威编号）：
 * - 最后一轮未结束 ⇒ 它就是当前轮；
 * - 最后一轮已结束但会话在跑 ⇒ 当前轮 = 最后一轮 + 1（DSH invariant：nextTurn 从 1 递增）。
 * @param {{sessionsRoot: string, workspacePath?: string|null, sessionId: string}} input
 * @returns {Promise<{turn: number, source: "session-log"}|null>}
 */
export async function currentTurnFromLog(input) {
  const file = await findSessionLogFile(input);
  if (!file) return null;
  const turns = await readSessionTurns(file);
  if (!turns || turns.length === 0) return null;
  const last = turns[turns.length - 1];
  const turn = last.end === null ? last.turn : last.turn + 1;
  if (!Number.isInteger(turn) || turn < 1) return null;
  return { turn, source: "session-log" };
}

export { CODES, fail };
