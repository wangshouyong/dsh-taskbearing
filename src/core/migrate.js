/**
 * 旧 status.md 迁移（B-44 / A13）：preview 只读解析 + apply 逐字落板并归档。
 * 契约：docs/schema-v2.md §5.14 / §12.4。
 *
 * 原则：
 * - preview 只做机械解析（标题/列表/复选框/关键词提示），**不判断语义**；
 * - apply 的 human_line/归属由 AI 提供；原话由插件按行号段从源文件**逐字**取出；
 * - 整个 apply 在 Store.run（写锁）内；失败不留半套数据、不改名源文件；
 * - 成功后源文件改名为 status-archive-<date>.md（不覆盖）。
 */

import fs from "node:fs/promises";
import path from "node:path";

import { addRequirement } from "./baseline.js";
import { CODES, CompassError, fail } from "./errors.js";
import { assertId, nextRequirementId, nextTaskId } from "./ids.js";
import {
  assertExecState,
  assertVerdictInput,
  isTerminalVerdict,
  normalizeVerdictForStorage
} from "./state.js";
import { KIND_PROJECT, KIND_REQUIREMENT, KIND_TASK, findNode, syncRequirementExecStates } from "./tree.js";

export const MAX_SOURCE_BYTES = 1024 * 1024;
export const MAX_ITEMS = 200;
export const MAX_PREVIEW_TEXT = 500;

const ITEM_RE = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * 关键词机械分类（插件不判断语义，只给提示）。
 * @param {string} text
 * @param {boolean} checkboxDone
 */
export function classifyItem(text, checkboxDone = false) {
  const value = String(text ?? "");
  if (/废弃|取消|替代|不做|砍掉/i.test(value)) return "dead";
  if (checkboxDone || /已完成|完成|已做|✅|\[x\]/i.test(value)) return "done";
  if (/进行中|正在|推进中|处理中/i.test(value)) return "doing";
  if (/下一步|待办|TODO|计划|接下来/i.test(value)) return "next";
  return "other";
}

/**
 * 解析 Markdown 标题为「可作为基线最初说法」的候选（纯函数）。
 * 标题不是条目候选，但基线原话常来自标题/裁决句；单独返回供 AI 选用。
 * @param {string} text
 */
export function parseMigrationHeadings(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  /** @type {string[]} */
  const headingPath = [];
  /** @type {Array<any>} */
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const heading = HEADING_RE.exec(trimmed);
    if (!heading) continue;
    const level = heading[1].length;
    headingPath.splice(level - 1, headingPath.length, heading[2]);
    headings.push({
      ref: `L${index + 1}-L${index + 1}`,
      level,
      text: heading[2],
      kind_hint: classifyItem(heading[2], false),
      heading_path: [...headingPath]
    });
  }
  return headings;
}

/**
 * 解析 Markdown 文本为候选条目（纯函数，不读写文件）。
 * @param {string} text
 */
export function parseMigrationSource(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  /** @type {string[]} */
  let headingPath = [];
  /** @type {Array<any>} */
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      headingPath = [...headingPath.slice(0, level - 1), heading[2]];
      continue;
    }
    const item = ITEM_RE.exec(raw);
    if (!item) continue;
    let body = item[2];
    let checkboxDone = false;
    const checkbox = /^\[([ xX])\]\s*(.*)$/.exec(body);
    if (checkbox) {
      checkboxDone = checkbox[1].toLowerCase() === "x";
      body = checkbox[2];
    }
    const from = index + 1;
    let to = from;
    // 收集缩进续行（非新列表项/标题），保证段落整段可取
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next];
      if (!candidate.trim()) break;
      if (ITEM_RE.test(candidate)) break;
      if (HEADING_RE.test(candidate.trim())) break;
      if (!/^\s{2,}/.test(candidate)) break;
      to = next + 1;
    }
    const excerpt = lines.slice(from - 1, to).join("\n");
    const truncated = excerpt.length > MAX_PREVIEW_TEXT;
    items.push({
      ref: `L${from}-L${to}`,
      line_from: from,
      line_to: to,
      chars: excerpt.length,
      text: truncated ? `${excerpt.slice(0, MAX_PREVIEW_TEXT)}…` : excerpt,
      truncated,
      kind_hint: classifyItem(body, checkboxDone),
      heading_path: headingPath.slice()
    });
  }
  return items;
}

/**
 * 读取迁移源（上限 1MB）。
 * @param {unknown} filePath
 * @returns {Promise<{path: string, text: string, mtime: Date, size: number}>}
 */
export async function readMigrationSource(filePath) {
  const raw = String(filePath ?? "").trim();
  if (!raw) fail(CODES.MIGRATE_SOURCE, "迁移必须给 path（旧 status.md 的绝对路径）");
  const absolute = path.resolve(raw);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    fail(CODES.MIGRATE_SOURCE, `迁移源文件不存在或不可读：${absolute}（${err?.message ?? err}）`);
  }
  if (!stat.isFile()) fail(CODES.MIGRATE_SOURCE, `迁移源不是文件：${absolute}`);
  if (stat.size > MAX_SOURCE_BYTES) {
    fail(CODES.MIGRATE_SOURCE, `迁移源超过 1MB 上限：${absolute}（${stat.size} bytes，上限 ${MAX_SOURCE_BYTES}）`);
  }
  let text;
  try {
    text = await fs.readFile(absolute, "utf8");
  } catch (err) {
    fail(CODES.MIGRATE_SOURCE, `读取迁移源失败：${absolute}（${err?.message ?? err}）`);
  }
  return { path: absolute, text: text.replace(/\r\n?/g, "\n"), mtime: stat.mtime, size: stat.size };
}

/**
 * preview：只读解析，返回候选条目（含行号段/关键词提示/标题路径）。
 * @param {unknown} filePath
 */
export async function previewMigration(filePath) {
  const source = await readMigrationSource(filePath);
  const items = parseMigrationSource(source.text);
  const headings = parseMigrationHeadings(source.text);
  return {
    mode: "preview",
    source: { path: source.path, size: source.size },
    file_mtime: source.mtime.toISOString(),
    count: items.length,
    items,
    headings,
    hint:
      "AI 据此翻译 human_line / 归属后调 apply：ref 必须来自本结果的 items 或 headings 行号段；需求项写 surface；原话由插件按行段逐字取出（AI 不传正文）"
  };
}

/** @param {unknown} value @param {string} field */
function line(value, field) {
  if (typeof value !== "string") fail(CODES.MIGRATE_ITEM_INVALID, `${field} 必须是字符串`);
  const text = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (!text) fail(CODES.MIGRATE_ITEM_INVALID, `${field} 不能为空`);
  return text;
}

/** @param {unknown} value */
function optionalText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(CODES.MIGRATE_ITEM_INVALID, "可选文本字段必须是字符串");
  const text = value.trim();
  return text ? text : null;
}

/**
 * 按 ref（Lx-Ly）从源文件逐字取行段（含起止行，换行保留）。
 * @param {string[]} lines
 * @param {unknown} ref
 * @param {string} filePath
 */
export function excerptByRef(lines, ref, filePath = "") {
  const raw = String(ref ?? "").trim();
  const matched = /^L(\d+)(?:-L(\d+))?$/.exec(raw);
  if (!matched) fail(CODES.MIGRATE_REF, `ref 非法：${raw}（形如 L12-L15）`);
  const from = Number(matched[1]);
  const to = matched[2] ? Number(matched[2]) : from;
  if (!Number.isInteger(from) || from < 1 || to < from || to > lines.length) {
    fail(CODES.MIGRATE_REF, `ref 越界：${raw}（文件共 ${lines.length} 行）`, {
      ref: raw,
      lines: lines.length
    });
  }
  return { text: lines.slice(from - 1, to).join("\n"), from, to };
}

/**
 * @param {any} parent
 * @param {unknown} after
 * @param {unknown} before
 */
function positionIndex(parent, after, before) {
  const hasAfter = after !== undefined && after !== null && String(after).trim() !== "";
  const hasBefore = before !== undefined && before !== null && String(before).trim() !== "";
  if (hasAfter && hasBefore) fail(CODES.POSITION_CONFLICT, "after 与 before 互斥，只能传一个");
  if (!hasAfter && !hasBefore) return parent.children.length;
  const siblingId = String(hasAfter ? after : before).trim();
  const index = parent.children.findIndex((child) => child.id === siblingId);
  if (index < 0) {
    fail(CODES.SIBLING_NOT_FOUND, `兄弟节点不存在或不在同一父节点下：${siblingId}`, {
      sibling_id: siblingId,
      parent_id: parent.id
    });
  }
  return hasAfter ? index + 1 : index;
}

/**
 * 归档源文件（不覆盖：重名追加 -2、-3…）。
 * @param {string} filePath
 * @param {() => Date} now
 */
async function archiveSource(filePath, now) {
  const dir = path.dirname(filePath);
  const date = now().toISOString().slice(0, 10);
  const base = `status-archive-${date}`;
  let target = path.join(dir, `${base}.md`);
  for (let index = 2; ; index += 1) {
    try {
      await fs.access(target);
      target = path.join(dir, `${base}-${index}.md`);
    } catch {
      break;
    }
  }
  try {
    await fs.rename(filePath, target);
  } catch (err) {
    fail(CODES.MIGRATE_ARCHIVE, `数据已导入，但源文件归档改名失败：${filePath} → ${target}（${err?.message ?? err}）`, {
      source: filePath,
      target
    });
  }
  return target;
}

/**
 * apply：把 items 落成任务树 + 详情 + 基线，并按需归档源文件。
 * @param {import("./store.js").Store} store
 * @param {any} args
 * @param {{now?: () => Date}} [deps]
 */
export async function applyMigration(store, args = {}, deps = {}) {
  const now = deps.now ?? (() => new Date());
  const source = await readMigrationSource(args.path);
  if (typeof args.file_mtime === "string" && args.file_mtime !== source.mtime.toISOString()) {
    fail(CODES.MIGRATE_REF, "源文件在 preview 之后被修改，请重新 preview 后再 apply", {
      expected: args.file_mtime,
      actual: source.mtime.toISOString()
    });
  }
  const items = args.items;
  if (!Array.isArray(items) || items.length === 0) {
    fail(CODES.MIGRATE_ITEM_INVALID, "items 必须是非空数组");
  }
  if (items.length > MAX_ITEMS) {
    fail(CODES.MIGRATE_ITEM_INVALID, `单次迁移最多 ${MAX_ITEMS} 项（当前 ${items.length}）`);
  }

  const sourceLines = source.text.split("\n");
  const pointerSessionOf = (ref) => `file:${source.path}#${ref}`;
  const pointerAt = source.mtime.toISOString();

  /** 先做全部参数校验（不写数据） */
  const normalizedItems = items.map((item) => {
    const type = String(item?.type ?? "").trim();
    if (type !== "requirement" && type !== "task") {
      fail(CODES.MIGRATE_ITEM_INVALID, `item.type 必须是 requirement 或 task（当前：${type || "(空)"}）`);
    }
    const title = line(item?.title, "title");
    const humanLine = line(item?.human_line, "human_line");
    const ref = String(item?.ref ?? "").trim();
    const excerpt = excerptByRef(sourceLines, ref, source.path);
    const note = optionalText(item?.note);
    const detail = item?.detail === undefined ? undefined : String(item.detail);
    let surface = null;
    if (type === "requirement") {
      surface = item?.surface !== undefined ? line(item.surface, "surface") : humanLine;
    }
    const parentId = type === "task" ? String(item?.parent_id ?? "").trim() : "";
    if (type === "task" && !parentId) {
      fail(CODES.MIGRATE_ITEM_INVALID, "迁移任务必须给 parent_id（挂在需求或任务下）", { title });
    }
    if (type === "requirement" && (item?.after || item?.before)) {
      fail(CODES.MIGRATE_ITEM_INVALID, "after/before 仅 type=task 允许（需求按创建顺序排）", { title });
    }
    let execState = null;
    if (item?.exec_state !== undefined) {
      assertExecState(item.exec_state);
      execState = item.exec_state;
    }
    let verdict = null;
    if (item?.verdict_state !== undefined) {
      assertVerdictInput(item.verdict_state);
      verdict = normalizeVerdictForStorage(item.verdict_state) ?? null;
    }
    if (isTerminalVerdict(verdict) && !String(item?.dead_reason ?? "").trim()) {
      fail(CODES.MIGRATE_ITEM_INVALID, `落「${verdict}」必须给 dead_reason`, { title });
    }
    if (item?.dead_reason !== undefined && !isTerminalVerdict(verdict)) {
      fail(CODES.MIGRATE_ITEM_INVALID, "dead_reason 只能随「已废弃 / 已替代」一起写", { title });
    }
    return {
      type,
      title,
      humanLine,
      surface,
      ref,
      excerpt: excerpt.text,
      note: note ?? title,
      detail,
      parentId,
      execState,
      verdict,
      deadReason: isTerminalVerdict(verdict) ? String(item.dead_reason).trim() : null,
      after: item?.after,
      before: item?.before
    };
  });

  return store.run(async () => {
    const tree = await store.readTree();
    const { model } = await store.readBaseline();
    /** @type {Array<{id: string, type: string}>} */
    const created = [];
    /** @type {Array<{id: string, title: string}>} */
    const existed = [];
    /** @type {Array<{id: string, detail: string}>} */
    const details = [];
    let baselineDirty = false;

    for (const item of normalizedItems) {
      const pointer = {
        session: pointerSessionOf(item.ref),
        at: pointerAt,
        note: `迁移：${item.note}`
      };
      if (item.type === "requirement") {
        const sameTitle = tree.root.children.find((node) => node.title === item.title);
        if (sameTitle) {
          existed.push({ id: sameTitle.id, title: item.title });
          continue;
        }
        const id = nextRequirementId(tree.root);
        tree.root.children.push({
          id,
          kind: KIND_REQUIREMENT,
          title: item.title,
          human_line: item.humanLine,
          exec_state: item.execState ?? "未开始",
          verdict_state: item.verdict,
          dead_reason: item.deadReason,
          merged_into: null,
          pointers: [pointer],
          children: []
        });
        addRequirement(model, {
          id,
          title: item.title,
          surface: item.surface,
          version: {
            version: "v1",
            at: pointerAt,
            summary: item.surface,
            original: item.excerpt,
            originalLock: true,
            msg: { session: pointer.session, at: pointerAt }
          }
        });
        baselineDirty = true;
        if (item.detail !== undefined) details.push({ id, detail: item.detail });
        created.push({ id, type: "requirement" });
        continue;
      }

      const parent = findNode(tree, item.parentId);
      if (!parent) fail(CODES.PARENT_NOT_FOUND, `父节点不存在：${item.parentId}`, { parent_id: item.parentId });
      if (parent.kind === KIND_PROJECT) {
        fail(CODES.MIGRATE_ITEM_INVALID, "project 根下不能直接挂任务：请挂到需求下");
      }
      const sameTitle = parent.children.find((node) => node.title === item.title);
      if (sameTitle) {
        existed.push({ id: sameTitle.id, title: item.title });
        continue;
      }
      const id = nextTaskId(parent, collectIds(tree));
      const node = {
        id,
        kind: KIND_TASK,
        title: item.title,
        human_line: item.humanLine,
        exec_state: item.execState ?? "未开始",
        verdict_state: item.verdict,
        dead_reason: item.deadReason,
        merged_into: null,
        pointers: [pointer],
        children: []
      };
      parent.children.splice(positionIndex(parent, item.after, item.before), 0, node);
      if (item.detail !== undefined) details.push({ id, detail: item.detail });
      created.push({ id, type: "task" });
    }

    if (created.length > 0) {
      await store.assertUnchanged();
      syncRequirementExecStates(tree);
      await store.writeTree(tree);
      if (baselineDirty) await store.writeBaseline(model);
      for (const entry of details) {
        await store.writeDetail(entry.id, entry.detail);
      }
    }

    const archivedTo = created.length > 0 && args.archive !== false ? await archiveSource(source.path, now) : null;
    return {
      mode: "apply",
      file: source.path,
      created,
      existed,
      archived_to: archivedTo,
      baseline_requirements: model.requirements.length
    };
  });
}

/**
 * 全树已有 id（ID 生成全局去重，与 tools.js 一致）。
 * @param {any} tree
 */
function collectIds(tree) {
  const ids = new Set();
  const walk = (node) => {
    for (const child of node.children ?? []) {
      ids.add(child.id);
      walk(child);
    }
  };
  walk(tree.root);
  return ids;
}

export { CODES, CompassError };
