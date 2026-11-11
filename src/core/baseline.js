/**
 * 需求基线（baseline.md）的解析、序列化与版本追加。
 * 设计契约：docs/schema-v2.md §4.6。
 *
 * 文件格式（插件自产自销，解析器只保证读懂自己写出的格式）：
 *
 *   # 需求基线
 *   <!-- dsh-compass:baseline-schema 1 -->
 *
 *   ## R-001 需求标题
 *
 *   **明面**：AI 精简后的一句话
 *   **版本**：
 *   - v1（<at>｜原话已锁）：
 *     - 精简：...
 *     - 原话（会话 <session> · <at>）：「逐字原文」
 *
 * 关键设计：原话必须逐字（由插件从会话记录取回），AI 不接触原文；基线不存状态。
 */

import { CODES, fail } from "./errors.js";
import { isIsoTimestamp } from "./tree.js";

export const BASELINE_SCHEMA = 2;
export const BASELINE_TITLE = "# 需求基线";
export const BASELINE_SCHEMA_LINE = `<!-- dsh-compass:baseline-schema ${BASELINE_SCHEMA} -->`;

/**
 * 原话转义（schema 2，B-44）：原话必须逐字，但基线是行式格式；
 * 换行写成字面 `\n`、反斜杠写成 `\\`，解析时还原，保证逐字无损。
 * @param {unknown} text
 */
export function escapeOriginal(text) {
  const value = String(text ?? "").replace(/\r\n?/g, "\n");
  let out = "";
  for (const ch of value) {
    if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else out += ch;
  }
  return out;
}

/**
 * 原话反转义（schema 2）。逐字符扫描，避免 `\\n` 与 `\n` 的替换顺序歧义。
 * @param {unknown} text
 */
export function unescapeOriginal(text) {
  const value = String(text ?? "");
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[i + 1];
    if (next === "n") {
      out += "\n";
      i += 1;
    } else if (next === "\\") {
      out += "\\";
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** @returns {{schema: number, requirements: Array<any>}} */
export function emptyBaseline() {
  return { schema: BASELINE_SCHEMA, requirements: [] };
}

/**
 * 解析 baseline.md。空文件视为空基线；格式非法抛 E_STORE_CORRUPT 并指出行号。
 * @param {string} text
 */
export function parseBaseline(text) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const model = emptyBaseline();
  if (!raw.trim()) return model;

  let headerSeen = false;
  let schemaVersion = 1;
  /** @type {any|null} */
  let current = null;
  /** @type {any|null} */
  let currentVersion = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!headerSeen) {
      if (trimmed !== BASELINE_TITLE) {
        corrupt(lineNo, `文件必须以「${BASELINE_TITLE}」开头`);
      }
      headerSeen = true;
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      const schemaMatch = /dsh-compass:baseline-schema\s+(\d+)/.exec(trimmed);
      if (schemaMatch) schemaVersion = Number(schemaMatch[1]);
      continue;
    }

    const reqMatch = /^##\s+(R-\d{3})\s+(.+?)\s*$/.exec(trimmed);
    if (reqMatch) {
      current = { id: reqMatch[1], title: reqMatch[2], surface: "", versions: [] };
      currentVersion = null;
      model.requirements.push(current);
      continue;
    }

    if (!current) corrupt(lineNo, "需求条目之前出现了无法识别的内容");

    const surfaceMatch = /^\*\*明面\*\*[：:]\s*(.*)$/.exec(trimmed);
    if (surfaceMatch) {
      current.surface = surfaceMatch[1].trim();
      continue;
    }
    if (/^\*\*版本\*\*[：:]/.test(trimmed)) continue;

    const versionMatch = /^-\s+(v\d+)（(.+?)）：\s*$/.exec(trimmed);
    if (versionMatch) {
      const meta = versionMatch[2];
      const [atPart, ...rest] = meta.split("｜");
      const at = atPart.trim();
      if (!isIsoTimestamp(at)) corrupt(lineNo, `版本 ${versionMatch[1]} 的时间戳非法：${at}`);
      const lockLabel = rest.join("｜");
      currentVersion = {
        version: versionMatch[1],
        at,
        summary: "",
        original: "",
        originalLock: lockLabel.includes("已锁"),
        msg: null
      };
      current.versions.push(currentVersion);
      continue;
    }

    const summaryMatch = /^\s{2}-\s+精简[：:]\s*(.*)$/.exec(line);
    if (summaryMatch) {
      if (!currentVersion) corrupt(lineNo, "精简行出现在版本条目之外");
      currentVersion.summary = summaryMatch[1].trim();
      continue;
    }

    const reasonMatch = /^\s{2}-\s+原因[：:]\s*(.*)$/.exec(line);
    if (reasonMatch) {
      if (!currentVersion) corrupt(lineNo, "原因行出现在版本条目之外");
      currentVersion.reason = reasonMatch[1].trim();
      continue;
    }

    const originalMatch = /^\s{2}-\s+原话（(.*?)）[：:]\s*「(.*)」\s*$/.exec(line);
    if (originalMatch) {
      if (!currentVersion) corrupt(lineNo, "原话行出现在版本条目之外");
      const meta = originalMatch[1].trim();
      currentVersion.original = schemaVersion >= 2 ? unescapeOriginal(originalMatch[2]) : originalMatch[2];
      if (meta === "待锁") {
        currentVersion.originalLock = false;
        currentVersion.msg = null;
      } else {
        const payload = meta.replace(/^会话\s+/, "");
        const sep = payload.lastIndexOf(" · ");
        if (sep > 0) {
          const session = payload.slice(0, sep).trim();
          const at = payload.slice(sep + 3).trim();
          currentVersion.msg = { session, at };
        }
        currentVersion.originalLock = true;
      }
      continue;
    }
    // 未知行忽略（向前兼容）
  }

  if (!headerSeen) corrupt(1, `文件必须以「${BASELINE_TITLE}」开头`);
  validateModel(model);
  return model;
}

/**
 * 序列化 baseline.md（顶层模型 → 文件文本）。
 * @param {{requirements: Array<any>}} model
 */
export function serializeBaseline(model) {
  validateModel(model);
  const lines = [BASELINE_TITLE, BASELINE_SCHEMA_LINE, ""];
  for (const req of [...model.requirements].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`## ${req.id} ${req.title}`, "");
    lines.push(`**明面**：${req.surface}`);
    lines.push("**版本**：");
    for (const version of req.versions) {
      const lockLabel = version.originalLock ? "原话已锁" : "原话待锁";
      lines.push(`- ${version.version}（${version.at}｜${lockLabel}）：`);
      lines.push(`  - 精简：${version.summary}`);
      if (version.reason) lines.push(`  - 原因：${version.reason}`);
      if (version.originalLock && version.msg) {
        lines.push(`  - 原话（会话 ${version.msg.session} · ${version.msg.at}）：「${escapeOriginal(version.original)}」`);
      } else {
        lines.push(`  - 原话（待锁）：「${escapeOriginal(version.original ?? "")}」`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

/** @param {{requirements: Array<any>}} model @param {string} id */
export function findRequirement(model, id) {
  return model.requirements.find((req) => req.id === id) ?? null;
}

/**
 * 追加一条需求（首次写入 v1）。
 * @param {{requirements: Array<any>}} model
 * @param {{id: string, title: string, surface: string, version: any}} input
 */
export function addRequirement(model, input) {
  if (findRequirement(model, input.id)) {
    fail(CODES.INVALID_ARG, `需求 ${input.id} 已存在`);
  }
  model.requirements.push({
    id: input.id,
    title: input.title,
    surface: input.surface,
    versions: [input.version]
  });
}

/**
 * 追加一个版本，返回版本号（vN）。
 * @param {{requirements: Array<any>}} model
 * @param {string} requirementId
 * @param {any} version 不含 version 字段
 */
export function appendVersion(model, requirementId, version) {
  const req = findRequirement(model, requirementId);
  if (!req) fail(CODES.REQUIREMENT_NOT_FOUND, `需求 ${requirementId} 不存在（新建需求请用 compass_require）`);
  const next = `v${req.versions.length + 1}`;
  req.versions.push({ version: next, ...version });
  req.surface = version.summary;
  return next;
}

/** @param {number} lineNo @param {string} message */
function corrupt(lineNo, message) {
  fail(CODES.STORE_CORRUPT, `baseline.md 第 ${lineNo} 行：${message}`);
}

/** @param {{requirements: Array<any>}} model */
export function validateModel(model) {
  if (!model || typeof model !== "object" || !Array.isArray(model.requirements)) {
    fail(CODES.STORE_CORRUPT, "baseline 模型非法");
  }
  const ids = new Set();
  for (const req of model.requirements) {
    if (!/^R-\d{3,4}$/.test(req.id ?? "")) fail(CODES.STORE_CORRUPT, `baseline 需求 id 非法：${req.id}`);
    if (ids.has(req.id)) fail(CODES.STORE_CORRUPT, `baseline 需求 id 重复：${req.id}`);
    ids.add(req.id);
    if (typeof req.title !== "string" || !req.title.trim()) fail(CODES.STORE_CORRUPT, `${req.id} 缺少标题`);
    if (!Array.isArray(req.versions) || req.versions.length === 0) fail(CODES.STORE_CORRUPT, `${req.id} 缺少版本`);
    let last = 0;
    for (const version of req.versions) {
      const num = Number(String(version.version).replace(/^v/, ""));
      if (!Number.isInteger(num) || num <= last) fail(CODES.STORE_CORRUPT, `${req.id} 版本号乱序：${version.version}`);
      last = num;
      if (!isIsoTimestamp(version.at)) fail(CODES.STORE_CORRUPT, `${req.id} ${version.version} 时间戳非法`);
      if (typeof version.summary !== "string" || !version.summary.trim()) {
        fail(CODES.STORE_CORRUPT, `${req.id} ${version.version} 缺少精简`);
      }
      if (version.originalLock && !version.original) {
        fail(CODES.STORE_CORRUPT, `${req.id} ${version.version} 标记已锁但原话为空`);
      }
    }
  }
  return model;
}
