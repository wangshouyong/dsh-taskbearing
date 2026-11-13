/**
 * 工具层：七个 compass_* 工具的纯实现（不依赖 DSH 宿主）。
 * 宿主接入层负责：定位工作区、构造 Store、注入会话上下文与原话读取器。
 * 设计契约：docs/schema-v2.md §5。
 */

import { appendVersion, addRequirement, findRequirement } from "./baseline.js";
import { CODES, CompassError, fail } from "./errors.js";
import { checkDetailPaths, detailPathErrorMessage } from "./detail-path-guard.js";
import { findSimilarOpenTasks } from "./duplicates.js";
import { assertId, nextRequirementId, nextTaskId } from "./ids.js";
import { applyMigration, previewMigration } from "./migrate.js";
import {
  assertExecState,
  assertVerdictInput,
  checkVerdictTransition,
  isTerminalVerdict,
  normalizeVerdictForStorage
} from "./state.js";
import {
  KIND_PROJECT,
  KIND_REQUIREMENT,
  KIND_TASK,
  ancestorIds,
  collectSubtreeIds,
  findNode,
  flattenLite,
  isIsoTimestamp,
  isTrashed,
  pruneTrashed,
  syncRequirementExecStates
} from "./tree.js";
import { trashedAncestorOf } from "./trash.js";

/**
 * @typedef {Object} CompassDeps
 * @property {import("./store.js").Store} store
 * @property {string|null} [sessionId] 当前会话 id（插件自动填；测试可注入）
 * @property {number|null} [turn] 当前轮次（平台给得出才填）
 * @property {() => Date} [now] 时钟（测试注入）
 * @property {null | ((refs: any, ctx: {sessionId: string|null, now: Date}) => Promise<{text: string, session?: string, at?: string} | null>)} [captureOriginal]
 *   原话读取器：由宿主层实现（SP-8），读取会话消息原文；失败返回 null
 * @property {null | {listMessages: (options?: {limit?: number}) => Promise<Array<{session: string, cwd: string|null, messages: Array<{index: number, at: string|null, turn: number|null, text: string}>}>>, readMessage: (ref: {session: string, index: number}) => Promise<{session: string, index: number, at: string|null, turn: number|null, text: string} | null>}} [history]
 *   历史会话读取器（compass_import 用）：由宿主层实现（B-29）；只读，取不到返回空
 * @property {string} [pluginVersion]
 */

/**
 * 创建工具集。
 * @param {CompassDeps} deps
 */
export function createCompass(deps) {
  const store = deps.store;
  const sessionId = deps.sessionId ?? "unknown-session";
  const turn = Number.isInteger(deps.turn) ? deps.turn : null;
  const now = deps.now ?? (() => new Date());
  const captureOriginal = deps.captureOriginal ?? null;
  const verifyOriginal = deps.verifyOriginal ?? null;
  const history = deps.history ?? null;

  /** @returns {string} */
  const isoNow = () => now().toISOString();

  /** @param {number} ms */
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * 变更类工具的原子执行（B-39）：整段放进 Store.run（进程内队列 + 跨进程写锁）；
   * 写回冲突（E_CONFLICT：其它窗口在本次读-改-写期间写了同一文件）整段重做，最多 3 次。
   * @template T
   * @param {(args: any) => Promise<T>} fn
   */
  const mutate = (fn) => async (args) => {
    const MAX_ATTEMPTS = 3;
    let lastError = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await store.run(() => fn(args));
      } catch (err) {
        if (!(err && err.code === CODES.CONFLICT)) throw err;
        lastError = err;
        await delay(15 * (attempt + 1));
      }
    }
    throw lastError;
  };

  /** 全树已有 id（ID 生成全局去重，B-30/B-34）。 */
  function treeIds(tree) {
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

  /**
   * v1.33 回收站：被丢弃的节点（或随父节点一起被丢弃）对 AI 不可写。
   * 丢弃是面板侧的用户动作；AI 若拿到旧 id 写进来，给可读指引而不是静默改脏数据。
   * @param {any} tree
   * @param {string} id
   * @returns {any} 节点
   */
  function assertWritable(tree, id, options = {}) {
    const isParent = options.role === "parent";
    const node = findNode(tree, id);
    if (!node) {
      if (isParent) fail(CODES.PARENT_NOT_FOUND, `父节点不存在：${id}（先 compass_read(scope=tree) 确认父 id）`, { parent_id: id, missing: [id] });
      fail(CODES.TASK_NOT_FOUND, `节点不存在：${id}（先 compass_read(scope=tree) 核对真实 id）`, { missing: [id] });
    }
    if (isTrashed(node) || trashedAncestorOf(tree, id)) {
      fail(
        CODES.TRASH_NOT_FOUND,
        `节点 ${id} 在回收站里（面板已丢弃），AI 不可写入；请让用户在任务板「回收站」里还原后再操作`,
        { id }
      );
    }
    return node;
  }

  /**
   * @param {string} note
   * @returns {{session: string, at: string, note: string, turn?: number}}
   */
  function pointer(note) {
    /** @type {{session: string, at: string, note: string, turn?: number}} */
    const out = { session: sessionId, at: isoNow(), note };
    if (turn !== null) out.turn = turn;
    return out;
  }

  /**
   * 历史回填专用指针：session/at 指向历史消息，不带 turn（历史轮次不可靠，不编造）。
   * @param {string} note
   * @param {string} at
   * @param {string} session
   */
  function historyPointer(note, at, session) {
    return { session, at, note };
  }

  /**
   * 构造新节点（需求/任务共用）。
   * @param {string} kind
   * @param {string} id
   * @param {string} title
   * @param {string} humanLine
   * @param {any} nodePointer
   */
  function newNode(kind, id, title, humanLine, nodePointer) {
    return {
      id,
      kind,
      title,
      human_line: humanLine,
      exec_state: "未开始",
      verdict_state: null,
      dead_reason: null,
      merged_into: null,
      pointers: [nodePointer],
      children: []
    };
  }

  /**
   * 规范化单行文本：去首尾空白、换行折叠为空格；空则报错。
   * @param {unknown} value
   * @param {string} field
   */
  function line(value, field) {
    if (typeof value !== "string") fail(CODES.INVALID_ARG, `${field} 必须是字符串`);
    const text = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
    if (!text) fail(CODES.INVALID_ARG, `${field} 不能为空`);
    return text;
  }

  /**
   * @param {unknown} value
   * @param {string} field
   */
  function optionalNote(value, field) {
    if (value === undefined) return null;
    if (typeof value !== "string") fail(CODES.INVALID_ARG, `${field} 必须是字符串`);
    const text = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
    if (!text) fail(CODES.INVALID_ARG, `${field} 不能为空字符串`);
    return text;
  }

  /**
   * 原话取回：由宿主注入的 captureOriginal 实现（SP-8）；失败记 warning，不阻断。
   * @param {unknown} refs
   * @param {Array<{code: string, message: string}>} warnings
   * @returns {Promise<{text: string, session: string, at: string} | null>}
   */
  async function resolveOriginal(refs, warnings) {
    if (!captureOriginal) {
      warnings.push({
        code: CODES.ORIGINAL_UNRESOLVED,
        message: "当前宿主未接入原话读取器（SP-8 未完成），已记「原话待锁」；请在 UI 粘贴原话后锁定"
      });
      return null;
    }
    try {
      const got = await captureOriginal(refs ?? "current", { sessionId, now: now() });
      if (got && typeof got.text === "string" && got.text.trim().length > 0) {
        return {
          text: got.text,
          session: String(got.session ?? sessionId),
          at: isIsoTimestamp(got.at) ? String(got.at) : isoNow()
        };
      }
    } catch (err) {
      warnings.push({ code: CODES.ORIGINAL_UNRESOLVED, message: err instanceof Error ? err.message : String(err) });
      return null;
    }
    warnings.push({
      code: CODES.ORIGINAL_UNRESOLVED,
      message: "原话取回失败，已记「原话待锁」；请在 UI 粘贴原话后锁定"
    });
    return null;
  }

  /**
   * 原话解析（v1.24 / B-53）：优先 AI 传入的 `original_text`（当前会话逐字校验），
   * 否则走 captureOriginal（refs 取回）。两者互斥；校验失败抛 E_ORIGINAL_MISMATCH，不写数据。
   * @param {{original_text?: unknown, original_refs?: unknown}} args
   * @param {Array<{code: string, message: string}>} warnings
   * @returns {Promise<{text: string, session: string, at: string} | null>}
   */
  async function resolveOriginalInput(args, warnings) {
    const hasText = args.original_text !== undefined && args.original_text !== null && String(args.original_text) !== "";
    const hasRefs = args.original_refs !== undefined && args.original_refs !== null;
    if (hasText && hasRefs) {
      fail(CODES.INVALID_ARG, "original_text 与 original_refs 互斥：当前会话原话传 original_text，跨会话取回传 original_refs");
    }
    if (!hasText) return resolveOriginal(args.original_refs, warnings);
    if (typeof args.original_text !== "string") {
      fail(CODES.INVALID_ARG, "original_text 必须是字符串");
    }
    if (!verifyOriginal) {
      fail(
        CODES.ORIGINAL_MISMATCH,
        "当前宿主未接入原话校验器，无法验证 original_text；请改用 original_refs 由插件取回（或省略两者走 current）"
      );
    }
    let matched = null;
    try {
      matched = await verifyOriginal(args.original_text, { sessionId, now: now() });
    } catch (err) {
      fail(
        CODES.ORIGINAL_MISMATCH,
        `原话校验失败：${err instanceof Error ? err.message : String(err)}（改用 original_refs 让插件逐字取回，或逐字复制当前会话原话）`
      );
    }
    if (!matched || matched.ok !== true) {
      fail(
        CODES.ORIGINAL_MISMATCH,
        "original_text 与当前会话的用户消息不逐字一致：请原文照抄（不要转述/改写），或改用 original_refs 让插件取回"
      );
    }
    return {
      text: args.original_text,
      session: String(matched.session ?? sessionId),
      at: isIsoTimestamp(matched.at) ? String(matched.at) : isoNow()
    };
  }

  /**
   * 计算插入下标（B-30）：after/before 互斥，兄弟必须存在且是 parent 的直接子节点。
   * 都不传 → 末尾追加（返回 children.length）。
   * @param {any} parent
   * @param {unknown} after
   * @param {unknown} before
   * @returns {number}
   */
  function positionIndex(parent, after, before) {
    const hasAfter = after !== undefined && after !== null && String(after).trim() !== "";
    const hasBefore = before !== undefined && before !== null && String(before).trim() !== "";
    if (hasAfter && hasBefore) {
      fail(CODES.POSITION_CONFLICT, "after 与 before 互斥，只能传一个");
    }
    if (!hasAfter && !hasBefore) return parent.children.length;
    const siblingId = String(hasAfter ? after : before).trim();
    const index = parent.children.findIndex((child) => child.id === siblingId);
    if (index < 0) {
      fail(CODES.SIBLING_NOT_FOUND, `兄弟节点不存在或不在同一父节点下：${siblingId}（先 compass_read(scope=tree) 核对；不确定就别传 after/before）`, {
        sibling_id: siblingId,
        parent_id: parent.id
      });
    }
    return hasAfter ? index + 1 : index;
  }

  /**
   * detail 路径强校验（v1.26 / B-57）：写 detail 前用 fs.existsSync 机械检查；
   * 任一缺失 ⇒ E_DETAIL_PATH_NOT_FOUND，整次写入拒绝（错误消息含结论/清单/整改指引）。
   * @param {string} detailText
   */
  function assertDetailPaths(detailText) {
    const { missing } = checkDetailPaths(detailText, store.workspacePath);
    if (missing.length === 0) return;
    fail(CODES.DETAIL_PATH_NOT_FOUND, detailPathErrorMessage(missing), {
      missing_paths: missing.map((entry) => entry.path),
      workspace: store.workspacePath
    });
  }

  /** 写树前同步需求层执行状态（v1.28 / B-59：需求状态由子任务机械聚合）。 */
  const writeSyncedTree = async (tree, options = {}) => {
    const flipped = syncRequirementExecStates(tree).filter((id) => findNode(tree, id)?.exec_state === "已执行");
    if (flipped.length > 0 && options?.skipRequirementSummaryGate !== true) {
      await assertRequirementSummaries(flipped);
    }
    await store.writeTree(tree);
  };

  // ---------------------------------------------------------------- init

  /**
   * 初始化工作区任务板（幂等）。
   * @param {{root_path?: string}} [args]
   */
  async function init(args = {}) {
    if (args.root_path !== undefined) {
      const { resolveWorkspacePath } = await import("./paths.js");
      const requested = resolveWorkspacePath(args.root_path);
      if (requested !== store.workspacePath) {
        fail(CODES.WORKSPACE_MISMATCH, "root_path 与当前工作区不一致", {
          requested,
          current: store.workspacePath
        });
      }
    }
    const { created } = await store.init();
    return {
      workspace_id: store.workspaceId,
      data_dir: store.dataDir,
      created,
      rule_block: "unchanged"
    };
  }

  // ---------------------------------------------------------------- require

  /**
   * 新建需求（需求层节点）+ 基线 v1；原话支持 AI 传入（当前会话逐字校验）或由插件按 refs 取回。
   * @param {{title?: string, human_line?: string, surface?: string, original_text?: string, original_refs?: any, pointer_note?: string}} [args]
   */
  async function requireRequirement(args = {}) {
    const title = line(args.title, "title");
    const humanLine = line(args.human_line, "human_line");
    const surface = line(args.surface, "surface");
    const note = optionalNote(args.pointer_note, "pointer_note") ?? "建需求";
    const warnings = [];

    const tree = await store.readTree();
    const id = nextRequirementId(tree.root);
    const { model } = await store.readBaseline();
    if (findRequirement(model, id)) {
      fail(CODES.STORE_CORRUPT, `基线中已存在 ${id}，但任务树中没有；请先修复数据（不一致）`);
    }

    const original = await resolveOriginalInput(args, warnings);
    tree.root.children.push(newNode(KIND_REQUIREMENT, id, title, humanLine, pointer(note)));
    addRequirement(model, {
      id,
      title,
      surface,
      version: {
        version: "v1",
        at: isoNow(),
        summary: surface,
        original: original?.text ?? "",
        originalLock: Boolean(original?.text),
        msg: original ? { session: original.session, at: original.at } : null
      }
    });

    await store.assertUnchanged();
    await writeSyncedTree(tree);
    await store.writeBaseline(model);

    // v1.29 / B-60：建需求时机械查重（跨层级：可能与旧任务/旧需求同题）
    const similar = findSimilarOpenTasks(tree, { text: `${title} ${humanLine} ${surface}`, excludeIds: [id], threshold: 0.4 });
    if (similar.length > 0) {
      warnings.push({
        code: "POSSIBLE_DUPLICATE",
        message: "板上已有疑似同题节点，请确认是否应改用合并/替代，不要留下重复任务",
        candidates: similar
      });
    }

    return {
      requirement_id: id,
      version: "v1",
      original_locked: Boolean(original?.text),
      warnings
    };
  }

  // ---------------------------------------------------------------- plan

  /**
   * 建任务节点（需求下或任务下）。
   * @param {{parent_id?: string, title?: string, human_line?: string, detail?: string, pointer_note?: string}} [args]
   */
  async function plan(args = {}) {
    const parentId = args.parent_id;
    if (parentId === undefined || parentId === null || String(parentId).trim() === "") {
      fail(
        CODES.PARENT_REQUIRED,
        "compass_plan 必须给 parent_id（需求层请用 compass_require 建，任务挂在需求或任务下）"
      );
    }
    const title = line(args.title, "title");
    const humanLine = line(args.human_line, "human_line");
    const note = optionalNote(args.pointer_note, "pointer_note") ?? "建任务";
    if (args.detail !== undefined) assertDetailPaths(String(args.detail));

    const tree = await store.readTree();
    const parent = assertWritable(tree, String(parentId).trim(), { role: "parent" });
    if (parent.kind === KIND_PROJECT) {
      fail(CODES.INVALID_ARG, "project 根下不能直接建任务：请先用 compass_require 建需求");
    }

    const id = nextTaskId(parent, treeIds(tree));
    parent.children.splice(positionIndex(parent, args.after, args.before), 0, newNode(KIND_TASK, id, title, humanLine, pointer(note)));

    if (args.detail !== undefined) {
      await store.writeDetail(id, String(args.detail));
    }
    await writeSyncedTree(tree);
    // v1.29 / B-60：建任务时机械查重（只提示，不阻断语义判断）
    const similar = findSimilarOpenTasks(tree, { text: `${title} ${humanLine}`, excludeIds: [id], threshold: 0.4 });
    return {
      task_id: id,
      warnings: similar.length
        ? [
            {
              code: "POSSIBLE_DUPLICATE",
              message: "板上已有疑似同题任务，请确认是否应改用合并/替代，不要留下重复任务",
              candidates: similar
            }
          ]
        : []
    };
  }

  // ---------------------------------------------------------------- update

  /**
   * 完成说明的内容标准（v1.27 / B-58；v1.31 / B-62 结构化）：
   * - build（修改/构建型）：核心文件 / 契约（或 契约/文档）/ 避坑指南，且路径必须真实存在；
   * - research（查询/调研型）：查询结论 / 数据来源 / 后续建议，允许没有路径（跳过存在性校验）；
   * - summary（需求层完成汇总，v1.31 / B-62）：验收范围 / 完成结论 / 遗留风险。
   *
   * B-62 补漏：旧实现是「子串包含」判定（"核心文件"出现在任何句子里都算），
   * 现在要求**每段单起一行、标签在行首、段内容非空**——避免用一句话把三段标签糊过去。
   */
  const COMPLETION_SECTIONS = Object.freeze({
    build: ["核心文件", "契约", "避坑指南"],
    research: ["查询结论", "数据来源", "后续建议"],
    summary: ["验收范围", "完成结论", "遗留风险"]
  });

  /** 标签的机械匹配式（行首标签 + 冒号/括号；契约允许「契约/文档」「契约文档」）。 */
  const SECTION_LABEL_PATTERNS = Object.freeze({
    核心文件: "核心文件",
    契约: "契约(?:[/／]文档|文档)?",
    避坑指南: "避坑指南",
    查询结论: "查询结论",
    数据来源: "数据来源",
    后续建议: "后续建议",
    验收范围: "验收范围",
    完成结论: "完成结论",
    遗留风险: "遗留风险"
  });

  const ALL_SECTION_LABELS = Object.values(COMPLETION_SECTIONS).flat();

  /**
   * 段落是否成立：行首标签 + 段内容非空（「无」也算内容）。
   * @param {string} text
   * @param {string} label
   */
  function sectionMissing(text, label) {
    const body = String(text ?? "");
    const labelPattern = SECTION_LABEL_PATTERNS[label] ?? label;
    const headRe = new RegExp(
      `(?:^|\\n)[\\s>]*?(?:[-*+]\\s+|#{1,6}\\s+|\\*\\*)?(?:${labelPattern})(?:\\*\\*)?\\s*(?:[:：(（]|$)`
    );
    const matched = headRe.exec(body);
    if (!matched) return true;
    const rest = body.slice(matched.index + matched[0].length);
    const nextLabel = ALL_SECTION_LABELS.map((item) => SECTION_LABEL_PATTERNS[item] ?? item).join("|");
    const stopRe = new RegExp(
      `\\n[\\s>]*?(?:[-*+]\\s+|#{1,6}\\s+|\\*\\*)?(?:${nextLabel})(?:\\*\\*)?\\s*(?:[:：(（]|$)`
    );
    const stop = stopRe.exec(rest);
    const content = (stop ? rest.slice(0, stop.index) : rest).replace(/\s+/g, " ").trim();
    return !content;
  }

  /** @param {string} text @param {"build"|"research"|"summary"} kind */
  function missingCompletionSections(text, kind) {
    return COMPLETION_SECTIONS[kind].filter((label) => sectionMissing(text, label));
  }

  // ---------------------------------------------------------------- 报错兜底文案（v1.34）
  //
  // 目标：报错本身就是「可执行的下一步」，而不是只报「缺什么」。
  // 每条硬校验错误统一给四要素：
  //   ① 缺什么（缺段名 / 缺哪个 id）
  //   ② 正确格式（每段单独一行、标签在行首、标签后用「：」、段内容非空）
  //   ③ 可直接照抄的示例（含真实 id）
  //   ④ 下一步动作（哪个工具、哪个参数、是否必须同批）
  // 这样规则区块里就不必重复格式细则，AI 第一次写错也能靠报错一次修好。

  const SECTION_KIND_TITLE = Object.freeze({
    build: "修改/构建型",
    research: "查询/调研型",
    summary: "需求/父任务汇总"
  });

  /**
   * 标签是否在全文任意位置出现过（用于区分「完全没写」和「写了但格式不对」）。
   * 后者如果只报「缺少」，AI 会去重复加内容、永远过不了——这是必须区分的场景。
   * @param {string} text
   * @param {string} label
   */
  function labelAppearsAnywhere(text, label) {
    const pattern = SECTION_LABEL_PATTERNS[label] ?? label;
    return new RegExp(`(?:${pattern})\\s*(?:[:：(（])`).test(String(text ?? ""));
  }

  /**
   * 缺失分类：missing=完全没写；misplaced=写了但不在行首/段内容为空。
   * @param {string} text
   * @param {"build"|"research"|"summary"} kind
   */
  function classifyMissingSections(text, kind) {
    /** @type {string[]} */
    const missing = [];
    /** @type {string[]} */
    const misplaced = [];
    for (const label of COMPLETION_SECTIONS[kind]) {
      if (!sectionMissing(text, label)) continue;
      (labelAppearsAnywhere(text, label) ? misplaced : missing).push(label);
    }
    return { missing, misplaced };
  }

  /**
   * 正确格式的「标准 + 示例」（压缩版：一行标准 + 三行示例，控制在 ~80 字符内）。
   * @param {"build"|"research"|"summary"} kind
   */
  function sectionFormatBlock(kind) {
    const labels = COMPLETION_SECTIONS[kind];
    const example = labels.map((label) => `${label}：…`).join("\n");
    return `正确格式：${labels.join(" / ")} 每段单独占一行、标签在行首、内容非空；例如：\n${example}`;
  }

  /**
   * 缺失说明（把「没写」和「写了但格式不对」分开讲，避免 AI 反复加内容）。
   * @param {{missing: string[], misplaced: string[]}} classified
   */
  function describeMissingSections(classified) {
    const parts = [];
    if (classified.missing.length > 0) parts.push(`缺少「${classified.missing.join("、")}」`);
    if (classified.misplaced.length > 0) {
      parts.push(
        `「${classified.misplaced.join("、")}」写了但格式不对：标签必须单独位于行首、每段各占一行（常见原因是和上一段挤在同一行，或标签不在行首）`
      );
    }
    return parts.join("；");
  }

  /**
   * 需求汇总缺失的可执行报错文案（两处预检共用，保证文案一致）。
   * @param {string} id
   * @param {{missing: string[], misplaced: string[]}} classified
   */
  function requirementSummaryError(id, classified) {
    return (
      `需求 ${id} 的子任务即将全部完成、需求行会聚合为「已执行」，但需求详情${describeMissingSections(classified)}。\n` +
      `${sectionFormatBlock("summary")}\n` +
      `下一步：先 compass_update({task_ids:["${id}"], detail:"验收范围：…\\n完成结论：…\\n遗留风险：…"}) 写需求汇总，再标记最后一个子任务。`
    );
  }

  /**
   * 需求层完成汇总硬校验（v1.31 / B-62）：需求行的「已执行」由子任务机械聚合产生，
   * 但聚合发生时必须已有需求详情（验收范围 / 完成结论 / 遗留风险），否则父节点
   * 会「已执行且没有交接文档」——这正是旧校验的结构性漏洞（只查任务、不查需求）。
   * 校验在写树之前，失败整次操作不落盘。
   * @param {string[]} requirementIds
   */
  async function assertRequirementSummaries(requirementIds) {
    for (const id of requirementIds) {
      const detail = String(await store.readDetail(id));
      const classified = classifyMissingSections(detail, "summary");
      if (classified.missing.length > 0 || classified.misplaced.length > 0) {
        fail(CODES.REQUIREMENT_DETAIL_REQUIRED, requirementSummaryError(id, classified), {
          requirement_ids: [id],
          missing: classified.missing,
          misplaced: classified.misplaced
        });
      }
    }
  }

  /**
   * 需求汇总预检（B-62）：本次 update 会把任务改成「已执行」时，先在内存副本上模拟聚合，
   * 提前拦截缺汇总详情的需求 —— 保证「校验失败整批不写」（不留下半套详情）。
   * @param {any} tree
   * @param {string[]} ids
   * @param {string|null} nextExecState
   * @param {Record<string, {text: string}>} [provided] 本次一并提交的祖先汇总（写入前先视为已具备）
   */
  async function preflightRequirementSummaries(tree, ids, nextExecState, provided = {}) {
    if (nextExecState !== "已执行") return;
    const simulated = JSON.parse(JSON.stringify(tree));
    for (const id of ids) {
      const node = findNode(simulated, id);
      if (node && node.kind === KIND_TASK) node.exec_state = "已执行";
    }
    const flipped = syncRequirementExecStates(simulated).filter((id) => findNode(simulated, id)?.exec_state === "已执行");
    if (flipped.length === 0) return;
    for (const id of flipped) {
      const providedText = provided?.[id]?.text;
      const classified = classifyMissingSections(providedText ?? (await store.readDetail(id)), "summary");
      if (classified.missing.length > 0 || classified.misplaced.length > 0) {
        fail(CODES.REQUIREMENT_DETAIL_REQUIRED, requirementSummaryError(id, classified), {
          requirement_ids: [id],
          missing: classified.missing,
          misplaced: classified.misplaced
        });
      }
    }
  }

  /**
   * 完成说明识别：显式 kind 严格校验；未显式声明时按两套标准自动识别（必须完整命中其中一套）。
   * @param {string} id
   * @param {string|{kind?: string, text?: string}} entry
   * @param {{validatePaths?: boolean}} [options] validatePaths=false 用于跨工作区回填（不做路径存在性校验）
   * @returns {{kind: "build"|"research", text: string}}
   */
  function validateCompletionDetail(id, entry, options = {}) {
    let text;
    let declared = null;
    if (typeof entry === "string") {
      text = entry;
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      declared = entry.kind ?? null;
      if (declared !== null && declared !== "build" && declared !== "research") {
        fail(CODES.INVALID_ARG, `任务 ${id} 的 details.kind 非法：${declared}（只能是 build / research）`);
      }
      if (typeof entry.text !== "string" || !entry.text.trim()) {
        fail(CODES.INVALID_ARG, `任务 ${id} 的 details.text 必须是非空字符串`);
      }
      text = entry.text;
    } else {
      fail(CODES.INVALID_ARG, `任务 ${id} 的 details 值必须是字符串或 { kind, text } 对象`);
    }
    if (!String(text).trim()) {
      fail(CODES.INVALID_ARG, `任务 ${id} 的完成说明不能为空`);
    }

    let kind = declared;
    if (kind) {
      const classified = classifyMissingSections(text, kind);
      if (classified.missing.length > 0 || classified.misplaced.length > 0) {
        fail(
          CODES.DETAIL_CONTENT_INVALID,
          `任务 ${id} 的完成说明${describeMissingSections(classified)}。\n${sectionFormatBlock(kind)}\n` +
            `下一步：compass_update 重提（单节点 detail，批量 details.${id}）。`,
          {
            task_id: id,
            kind,
            missing: classified.missing,
            misplaced: classified.misplaced,
            expected_sections: COMPLETION_SECTIONS[kind]
          }
        );
      }
    } else {
      const buildClassified = classifyMissingSections(text, "build");
      const researchClassified = classifyMissingSections(text, "research");
      const buildOk = buildClassified.missing.length === 0 && buildClassified.misplaced.length === 0;
      const researchOk = researchClassified.missing.length === 0 && researchClassified.misplaced.length === 0;
      if (buildOk) kind = "build";
      else if (researchOk) kind = "research";
      else {
        fail(
          CODES.DETAIL_CONTENT_INVALID,
          `任务 ${id} 的完成说明既不符合「${SECTION_KIND_TITLE.build}」（${describeMissingSections(buildClassified)}），` +
            `也不符合「${SECTION_KIND_TITLE.research}」（${describeMissingSections(researchClassified)}）。\n` +
            `${sectionFormatBlock("build")}\n或者：\n${sectionFormatBlock("research")}\n` +
            `下一步：任选一套补齐后用 compass_update 重提；或显式声明 kind:"build"|"research"。`,
          {
            task_id: id,
            build_missing: buildClassified.missing,
            research_missing: researchClassified.missing,
            expected_sections: { build: COMPLETION_SECTIONS.build, research: COMPLETION_SECTIONS.research }
          }
        );
      }
    }

    // 路径强校验只作用于修改/构建型；查询/调研型允许写不存在/未找到的路径
    if (kind === "build" && options.validatePaths !== false) assertDetailPaths(text);
    return { kind, text };
  }

  /**
   * 祖先链汇总说明校验（v1.31 / B-62）：父级、父级的父级…的 detail 必须含
   * 「验收范围 / 完成结论 / 遗留风险」三段（各起一行），否则不算「整条链路都更新」。
   * @param {string} id
   * @param {string|{kind?: string, text?: string}} entry
   * @returns {{kind: "summary", text: string}}
   */
  function validateSummaryDetail(id, entry) {
    let text;
    if (typeof entry === "string") text = entry;
    else if (entry && typeof entry === "object" && typeof entry.text === "string") text = entry.text;
    else fail(CODES.INVALID_ARG, `祖先 ${id} 的汇总详情必须是字符串或 { text }`);
    if (!String(text).trim()) fail(CODES.INVALID_ARG, `祖先 ${id} 的汇总详情不能为空`);
    const classified = classifyMissingSections(text, "summary");
    if (classified.missing.length > 0 || classified.misplaced.length > 0) {
      fail(
        CODES.ANCESTOR_DETAIL_REQUIRED,
        `祖先 ${id} 的汇总详情${describeMissingSections(classified)}。\n${sectionFormatBlock("summary")}\n` +
          `下一步：同批 compass_update.details 补 {"${id}":"验收范围：…\\n完成结论：…\\n遗留风险：…"}。`,
        { ancestor_id: id, missing: classified.missing, misplaced: classified.misplaced }
      );
    }
    return { kind: "summary", text };
  }

  /** @param {unknown} value */
  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * 聚合预检（v1.36）：一次收集「详情路径 / 完成说明 / 缺失完成说明 / 祖先汇总 / 需求汇总」的问题。
   * 返回 problems 数组（每项含原始错误与一行摘要），由调用方决定：
   * - ≥2 项 ⇒ 把全部问题附加到「第一个原始错误」的消息后面一次报全（错误码不变，单问题行为不变）；
   * - 1 项 ⇒ 不处理，交给下面原有闸门抛原始错误（code/文案与旧版完全一致）。
   * 依据：顺序闸门会让 AI 逐轮试错；一次报全可把典型 3 轮失败压到 1 轮。
   * @returns {Promise<Array<{err: CompassError, line: string}>>}
   */
  async function collectUpdateProblems(input) {
    const { tree, ids, args, hasDetail, providedDetails, markingDone, isBatch, doneTargets, ancestorSet } = input;
    /** @type {Array<{err: CompassError, line: string}>} */
    const problems = [];
    const push = (err, line) => problems.push({ err, line });

    /** 已提交过（无论合格与否）的完成说明 / 祖先，用于避免同一问题重复报 */
    const attemptedCompletion = new Set();
    const attemptedAncestors = new Set();
    /** @type {Record<string, boolean>} */
    const completionOk = {};

    // 1) 单节点 detail：先路径（与原实现同序），再（标记完成时）内容
    if (hasDetail) {
      const id = ids[0];
      const text = String(args.detail);
      try {
        assertDetailPaths(text);
      } catch (err) {
        if (!(err instanceof CompassError)) throw err;
        push(err, `${id} 详情路径不存在：${err.details?.missing_paths?.join("、") ?? ""}（换真实路径或写「无」）`);
      }
      if (markingDone && doneTargets.length > 0) {
        attemptedCompletion.add(id);
        try {
          validateCompletionDetail(id, text);
          completionOk[id] = true;
        } catch (err) {
          if (!(err instanceof CompassError)) throw err;
          if (!err.details?.missing_paths) {
            const labels = err.details?.missing?.length ? err.details.missing : err.details?.misplaced ?? [];
            push(err, `${id} 完成说明格式问题：${labels.join("、") || "内容不合格"}（各占一行、标签在行首）`);
          }
        }
      }
    }

    // 2) details 各项：完成说明按两套标准识别、祖先按 summary（与原实现同序：格式先、路径后）
    for (const [key, entry] of Object.entries(providedDetails)) {
      if (!ids.includes(key) && !ancestorSet.has(key)) {
        push(new CompassError(CODES.INVALID_ARG, `details 含未知 id：${key}（只能是本次更新的节点，或其祖先）`, { unknown: [key] }), `details 含未知 id：${key}`);
        continue;
      }
      const isCompletion = markingDone && ids.includes(key);
      if (isCompletion) {
        attemptedCompletion.add(key);
        try {
          validateCompletionDetail(key, entry);
          completionOk[key] = true;
        } catch (err) {
          if (!(err instanceof CompassError)) throw err;
          const labels = err.details?.missing?.length ? err.details.missing : err.details?.misplaced ?? [];
          const where = err.details?.missing_paths ? "详情路径不存在" : "完成说明格式问题";
          push(err, err.details?.missing_paths
            ? `${key} ${where}：${err.details.missing_paths.join("、")}（换真实路径或写「无」）`
            : `${key} ${where}：${labels.join("、") || "内容不合格"}（每段单独占一行、标签在行首）`);
        }
      } else if (ancestorSet.has(key)) {
        attemptedAncestors.add(key);
        try {
          validateSummaryDetail(key, entry);
        } catch (err) {
          if (!(err instanceof CompassError)) throw err;
          const labels = err.details?.missing?.length ? err.details.missing : err.details?.misplaced ?? [];
          push(err, `${key} 祖先汇总格式问题：${labels.join("、") || "内容不合格"}（每段单独占一行、标签在行首）`);
        }
      } else {
        // 与既有闸门同义：既不是本次标记完成的节点，也不是祖先
        push(
          new CompassError(CODES.INVALID_ARG, `details 里的 ${key} 既不是本次要标记完成的节点，也不是其祖先`),
          `details 里的 ${key} 既不是本次要标记完成的节点，也不是其祖先`
        );
      }
    }

    // 3) 缺少完成说明（批量/单节点；本次已提交但格式错的已在上面报过，不重复报）
    if (markingDone && doneTargets.length > 0) {
      /** @type {string[]} */
      const missingCompletion = [];
      for (const id of doneTargets) {
        if (completionOk[id] || attemptedCompletion.has(id)) continue;
        const existing = String(await store.readDetail(id)).trim();
        if (!existing) {
          missingCompletion.push(id);
          continue;
        }
        const buildMissing = missingCompletionSections(existing, "build");
        const researchMissing = missingCompletionSections(existing, "research");
        if (buildMissing.length > 0 && researchMissing.length > 0) missingCompletion.push(id);
      }
      if (missingCompletion.length > 0) {
        const err = isBatch ? batchDetailError(missingCompletion) : singleDetailError(doneTargets[0]);
        push(err, isBatch ? `缺少完成说明：${missingCompletion.join("、")}（details 里逐 id 补三段）` : `缺少完成说明：${doneTargets[0]}`);
      }
    }

    // 4) 祖先汇总缺失（已提交但格式错的已单列；未提交过的祖先才算缺失）
    const detailTargets = [];
    if (hasDetail) detailTargets.push(ids[0]);
    if (markingDone) {
      for (const id of Object.keys(providedDetails)) {
        if (ids.includes(id)) detailTargets.push(id);
      }
      for (const id of doneTargets) detailTargets.push(id);
    }
    for (const id of [...new Set(detailTargets)]) {
      const missingAncestors = ancestorIds(tree, id).filter((ancestor) => {
        const node = findNode(tree, ancestor);
        return node && node.kind !== KIND_PROJECT && !attemptedAncestors.has(ancestor);
      });
      if (missingAncestors.length > 0) {
        push(ancestorDetailError(id, missingAncestors), `祖先汇总缺失：${id} 的 ${missingAncestors.join("、")}（同批 details 补三段）`);
      }
    }

    // 5) 需求汇总：本次会把需求聚合为「已执行」但缺汇总
    if (markingDone) {
      const simulated = JSON.parse(JSON.stringify(tree));
      for (const id of ids) {
        const node = findNode(simulated, id);
        if (node && node.kind === KIND_TASK) node.exec_state = "已执行";
      }
      const flipped = syncRequirementExecStates(simulated).filter((id) => findNode(simulated, id)?.exec_state === "已执行");
      for (const id of flipped) {
        const entry = providedDetails[id];
        const providedText = typeof entry === "string" ? entry : entry?.text;
        const text = providedText ?? (await store.readDetail(id));
        const classified = classifyMissingSections(text, "summary");
        if (classified.missing.length > 0 || classified.misplaced.length > 0) {
          const labels = [...classified.missing, ...classified.misplaced];
          push(requirementSummaryCompError(id, classified), `需求汇总缺失：${id}（${labels.join("、")}；先写三段再标最后一个子任务）`);
        }
      }
    }

    return problems;
  }

  /** @param {string[]} missingCompletion */
  function batchDetailError(missingCompletion) {
    return new CompassError(
      CODES.BATCH_DETAIL_REQUIRED,
      `批量标记已执行：以下任务缺少可继承的合格完成说明 —— ${missingCompletion.join("、")}。\n` +
        `${sectionFormatBlock("build")}\n或者：\n${sectionFormatBlock("research")}\n` +
        `下一步：compass_update 的 details 里逐 id 补三段，例：{"${missingCompletion[0]}":"核心文件：…\\n契约：…\\n避坑指南：…"}。`,
      { missing: missingCompletion, expected_sections: { build: COMPLETION_SECTIONS.build, research: COMPLETION_SECTIONS.research } }
    );
  }

  /** @param {string} id */
  function singleDetailError(id) {
    return new CompassError(
      CODES.DETAIL_REQUIRED,
      `标记已执行必须带完成说明：${id} 既没有本次 detail，也没有可继承的合格旧详情。\n` +
        `${sectionFormatBlock("build")}\n或者：\n${sectionFormatBlock("research")}\n` +
        `下一步：本次 compass_update 传 detail:"核心文件：…\\n契约：…\\n避坑指南：…"（查询型换三段）。`,
      { task_id: id, expected_sections: { build: COMPLETION_SECTIONS.build, research: COMPLETION_SECTIONS.research } }
    );
  }

  /** @param {string} id @param {string[]} missingAncestors */
  function ancestorDetailError(id, missingAncestors) {
    return new CompassError(
      CODES.ANCESTOR_DETAIL_REQUIRED,
      `更新 ${id} 的详情时，必须同步更新其祖先链的汇总（父任务、父级的父级、需求整条链路，父链不能停在旧内容）。` +
        `缺少：${missingAncestors.join("、")}。\n${sectionFormatBlock("summary")}\n` +
        `下一步：同一次 compass_update 的 details 补 ${missingAncestors
          .map((ancestor) => `{"${ancestor}":"验收范围：…\\n完成结论：…\\n遗留风险：…"}`)
          .join("、")}（必须同批）。`,
      { node: id, missing_ancestors: missingAncestors }
    );
  }

  /** @param {string} id @param {{missing: string[], misplaced: string[]}} classified */
  function requirementSummaryCompError(id, classified) {
    return new CompassError(CODES.REQUIREMENT_DETAIL_REQUIRED, requirementSummaryError(id, classified), {
      requirement_ids: [id],
      missing: classified.missing,
      misplaced: classified.misplaced
    });
  }

  /**
   * 多项问题时，把其余问题附加到第一个原始错误的消息后（一次报全；错误码仍是第一个问题的码）。
   * @param {Array<{err: CompassError, line: string}>} problems
   * @returns {CompassError}
   */
  function aggregateProblemsError(problems) {
    const [primary, ...rest] = problems;
    const lines = rest.map((problem, index) => `${index + 2}. ${problem.line}`).join("\n");
    return new CompassError(
      primary.err.code,
      `${primary.err.message}\n另有 ${rest.length} 项问题（建议一次改完，避免逐轮报错）：\n${lines}\n下一步：改完后重新调用 compass_update；本次未写入任何数据，可直接重试。`,
      { ...(primary.err.details ?? {}), violations: problems.map((problem) => ({ code: problem.err.code, message: problem.line })) }
    );
  }

  /**
   * patch 语义更新（批量共享 payload；整批原子）。
   * @param {{task_ids?: string[], exec_state?: string, verdict_state?: string|null, dead_reason?: string, detail?: string, details?: Record<string, string|{kind?: string, text?: string}>, pointer_note?: string}} [args]
   */
  async function update(args = {}) {
    const idsInput = args.task_ids;
    if (!Array.isArray(idsInput) || idsInput.length === 0) {
      fail(CODES.INVALID_ARG, "task_ids 必须是非空数组");
    }
    /** @type {string[]} */
    const ids = [];
    for (const raw of idsInput) {
      if (typeof raw !== "string" || !raw.trim()) fail(CODES.INVALID_ARG, "task_ids 的每一项必须是非空字符串");
      const id = raw.trim();
      assertId(id);
      if (!ids.includes(id)) ids.push(id);
    }

    const hasExec = args.exec_state !== undefined;
    const hasVerdict = args.verdict_state !== undefined;
    const hasDead = args.dead_reason !== undefined;
    const hasDetail = args.detail !== undefined;
    const hasDetails = args.details !== undefined;
    if (!hasExec && !hasVerdict && !hasDead && !hasDetail && !hasDetails) {
      fail(CODES.INVALID_ARG, "至少要提供一个可写字段（exec_state / verdict_state / dead_reason / detail / details）");
    }
    if (hasDetail && ids.length !== 1) fail(CODES.INVALID_ARG, "detail 只作用于单个节点（批量请用 details）");
    // 路径校验移到聚合预检之后（v1.36）：多项问题时一次报全，单项时仍由原闸门抛原错误
    if (hasExec) assertExecState(args.exec_state);
    if (hasVerdict) assertVerdictInput(args.verdict_state);
    const note = optionalNote(args.pointer_note, "pointer_note");
    const stateChange = hasExec || hasVerdict;
    if (stateChange && !note) {
      fail(
        CODES.POINTER_NOTE_REQUIRED,
        '状态/裁决变更必须带 pointer_note（追溯链要能回答「为什么改」）。下一步：在 compass_update 里加 pointer_note，例如 pointer_note:"按用户裁决改为进行中"。'
      );
    }
    if (hasDead && !hasVerdict) {
      fail(CODES.INVALID_ARG, "dead_reason 只能随「已废弃 / 已替代」一起写（复活时由插件自动清空）");
    }

    /** 本次提交的 details 原始表（分类在读到树之后做：完成说明 vs 祖先链汇总，B-62） */
    /** @type {Record<string, any>} */
    const providedDetails = {};
    if (hasDetails) {
      if (!isPlainObject(args.details)) {
        fail(CODES.INVALID_ARG, "details 必须是对象：{ \"<id>\": \"说明\" | { kind, text } }");
      }
      Object.assign(providedDetails, args.details);
    }

    const markingDone = hasExec && String(args.exec_state) === "已执行";
    const isBatch = ids.length > 1;

    // 先读树并确认节点存在，再判断哪些节点真的会「变成已执行」（幂等重标不强制重复写说明）
    const tree = await store.readTree();
    for (const id of ids) {
      assertWritable(tree, id);
    }
    // v1.28 / B-59：需求层执行状态由插件按子任务机械聚合，AI 不可手写
    if (hasExec) {
      const requirementIds = ids.filter((id) => findNode(tree, id)?.kind === KIND_REQUIREMENT);
      if (requirementIds.length > 0) {
        fail(
          CODES.INVALID_ARG,
          "需求层执行状态由插件按子任务机械聚合，不可手写；请更新子任务的 exec_state，需求行会自动重算",
          { requirement_ids: requirementIds }
        );
      }
    }
    const doneTargets = markingDone
      ? ids.filter((id) => {
          const node = findNode(tree, id);
          return node && node.exec_state !== "已执行";
        })
      : [];

    /** 受影响节点的祖先链（去掉 project 根）：更新详情时必须整条链路一起更新（B-62） */
    const ancestorSet = new Set();
    for (const id of ids) {
      for (const ancestor of ancestorIds(tree, id)) {
        const node = findNode(tree, ancestor);
        if (node && node.kind !== KIND_PROJECT) ancestorSet.add(ancestor);
      }
    }

    // v1.36：多项问题时把其余问题附加到第一个错误后一次报全（错误码与单问题文案不变）
    const updateProblems = await collectUpdateProblems({
      tree,
      ids,
      args,
      hasDetail,
      providedDetails,
      markingDone,
      isBatch,
      doneTargets,
      ancestorSet
    });
    if (updateProblems.length >= 2) throw aggregateProblemsError(updateProblems);
    if (hasDetail) assertDetailPaths(String(args.detail));

    /** 完成说明（本次标记完成的节点）：id → {kind, text} */
    const completionById = {};
    /** 祖先链汇总（父级、父级的父级…）：id → {kind:"summary", text} */
    const rollupById = {};
    for (const [key, entry] of Object.entries(providedDetails)) {
      if (!ids.includes(key) && !ancestorSet.has(key)) {
        fail(CODES.INVALID_ARG, `details 含未知 id：${key}（只能是本次更新的节点，或其祖先）`, { unknown: [key] });
      }
      if (markingDone && ids.includes(key)) completionById[key] = validateCompletionDetail(key, entry);
      else if (ancestorSet.has(key)) rollupById[key] = validateSummaryDetail(key, entry);
      else fail(CODES.INVALID_ARG, `details 里的 ${key} 既不是本次要标记完成的节点，也不是其祖先`);
    }

    // 完成说明兜底（v1.27）：单节点/批量标「已执行」必须有合格详情（新写或继承合格旧详情）
    if (markingDone && doneTargets.length > 0) {
      /** @type {string[]} */
      const missingCompletion = [];
      if (isBatch) {
        for (const id of doneTargets) {
          if (completionById[id]) continue;
          const existing = String(await store.readDetail(id)).trim();
          if (!existing) {
            missingCompletion.push(id);
            continue;
          }
          const buildMissing = missingCompletionSections(existing, "build");
          const researchMissing = missingCompletionSections(existing, "research");
          if (buildMissing.length > 0 && researchMissing.length > 0) missingCompletion.push(id);
        }
        if (missingCompletion.length > 0) {
          throw batchDetailError(missingCompletion);
        }
      } else {
        const id = doneTargets[0];
        if (!hasDetail) {
          const existing = String(await store.readDetail(id)).trim();
          const buildMissing = existing ? missingCompletionSections(existing, "build") : ["core"];
          const researchMissing = existing ? missingCompletionSections(existing, "research") : ["core"];
          const inheritOk = Boolean(existing) && (buildMissing.length === 0 || researchMissing.length === 0);
          if (!inheritOk) {
            throw singleDetailError(id);
          }
        } else {
          validateCompletionDetail(id, String(args.detail));
        }
      }
    }

    /** 本次会写详情的节点（单节点 detail / 完成说明）⇒ 其整条祖先链必须有汇总（B-62） */
    const detailTargets = [];
    if (hasDetail) detailTargets.push(ids[0]);
    for (const id of Object.keys(completionById)) {
      if (!detailTargets.includes(id)) detailTargets.push(id);
    }
    // B-62 补：标记「已执行」即使继承旧详情（本次不写详情）也必须同批更新整条祖先链，
    // 否则「继承」会成为绕过父链汇总的后门。
    if (markingDone) {
      for (const id of doneTargets) {
        if (!detailTargets.includes(id)) detailTargets.push(id);
      }
    }
    for (const id of detailTargets) {
      const missingAncestors = [];
      for (const ancestor of ancestorIds(tree, id)) {
        const node = findNode(tree, ancestor);
        if (!node || node.kind === KIND_PROJECT) continue;
        if (rollupById[ancestor] || completionById[ancestor]) continue;
        missingAncestors.push(ancestor);
      }
      if (missingAncestors.length > 0) {
        throw ancestorDetailError(id, missingAncestors);
      }
    }

    // B-62：先把「需求将因本批完成而聚合为已执行」的情况预检掉（失败不写任何东西）
    if (markingDone) await preflightRequirementSummaries(tree, ids, args.exec_state, { ...completionById, ...rollupById });

    /** @type {Array<{id: string, node: any, nextVerdict: string|null}>} */
    const plans = [];
    const targetVerdict = hasVerdict ? normalizeVerdictForStorage(args.verdict_state) ?? null : null;
    /** 同一批里被废弃/替代的节点集合：其子树节点允许「随父废弃」（null → 已废弃/已替代，豁免单节点转移约束） */
    const batchTerminal = new Set();
    for (const id of ids) {
      if (findNode(tree, id)) batchTerminal.add(id);
    }
    for (const id of ids) {
      const node = findNode(tree, id);
      if (!node) fail(CODES.TASK_NOT_FOUND, `节点不存在：${id}`, { missing: [id] });
      if (node.kind === KIND_PROJECT) fail(CODES.INVALID_ARG, "project 根节点不可更新（它只是隐式容器）");
      const currentVerdict = node.verdict_state ?? null;
      let nextVerdict = currentVerdict;
      /** 同值视为幂等（不校验转移、不追加 pointer） */
      let willTransition = false;
      if (hasVerdict) {
        const raw = args.verdict_state ?? null;
        willTransition = raw === "已确认继续" ? true : raw !== currentVerdict;
        if (willTransition) {
          const check = checkVerdictTransition(currentVerdict, raw);
          if (!check.legal) {
            const inherits =
              isTerminalVerdict(targetVerdict) && ancestorIds(tree, id).some((ancestor) => batchTerminal.has(ancestor));
            if (!inherits) {
              fail(CODES.INVALID_TRANSITION, check.reason ?? "不允许的裁决转移", { from: currentVerdict, to: raw });
            }
          }
        }
        nextVerdict = willTransition ? normalizeVerdictForStorage(raw) ?? null : currentVerdict;
        if (isTerminalVerdict(nextVerdict)) {
          const dead = hasDead ? String(args.dead_reason ?? "").trim() : (node.dead_reason ?? "").trim();
          if (!dead) {
            fail(
              CODES.DEAD_REASON_REQUIRED,
              `落「${nextVerdict}」必须给 dead_reason（一句话，引用用户裁决原话要点，供后续追溯）。` +
                `下一步：在 compass_update 里同时传 dead_reason，例如 dead_reason:"用户裁决：这条不做了，与 R-002 重复"。`,
              { task_id: id }
            );
          }
          if (willTransition) {
            const subtree = collectSubtreeIds(node);
            const missing = subtree.filter((childId) => !ids.includes(childId));
            if (missing.length > 0) {
              fail(
                CODES.SUBTREE_INCOMPLETE,
                `废弃/替代必须覆盖整棵子树（父节点废弃而子节点仍活跃会让数据自相矛盾）。缺少：${missing.join("、")}。` +
                  `下一步：把这些 id 一起放进同一次 compass_update 的 task_ids；如需保留某个子节点，先把它移到其它父节点下再废弃父节点。`,
                { missing }
              );
            }
          }
        }
      }
      plans.push({ id, node, nextVerdict });
    }

    /** @type {string[]} */
    const updated = [];
    /** @type {string[]} */
    const verdictNormalized = [];
    let dirty = false;

    for (const plan of plans) {
      const node = plan.node;
      let changed = false;

      if (hasExec && node.exec_state !== args.exec_state) {
        node.exec_state = args.exec_state;
        changed = true;
      }
      if (hasVerdict) {
        const current = node.verdict_state ?? null;
        if (current !== plan.nextVerdict) {
          node.verdict_state = plan.nextVerdict;
          changed = true;
          if (args.verdict_state === "已确认继续") verdictNormalized.push(node.id);
        }
        if (isTerminalVerdict(plan.nextVerdict)) {
          const dead = hasDead ? String(args.dead_reason ?? "").trim() : node.dead_reason;
          if (node.dead_reason !== dead) {
            node.dead_reason = dead;
            changed = true;
          }
        } else if (node.dead_reason !== null) {
          node.dead_reason = null;
          changed = true;
        }
      }

      if (changed && note) {
        node.pointers.push(pointer(note));
        updated.push(node.id);
        dirty = true;
      } else if (changed) {
        // 理论上不可达：状态变更必带 note（前面已校验）
        updated.push(node.id);
        dirty = true;
      }
    }

    if (hasDetail) {
      await store.writeDetail(ids[0], String(args.detail));
      dirty = true;
      const target = findNode(tree, ids[0]);
      if (!updated.includes(ids[0])) updated.push(ids[0]);
      if (note && target && !target.pointers.some((pointerItem) => pointerItem.note === note)) {
        target.pointers.push(pointer(note));
      }
    }

    // 批量完成说明（v1.27）：逐任务整段替换详情；校验已在前置阶段完成（整批原子）
    for (const [id, completion] of Object.entries(completionById)) {
      await store.writeDetail(id, completion.text);
      dirty = true;
      if (!updated.includes(id)) updated.push(id);
      const target = findNode(tree, id);
      if (note && target && !target.pointers.some((pointerItem) => pointerItem.note === note)) {
        target.pointers.push(pointer(note));
      }
    }

    // 祖先链汇总（B-62）：父级、父级的父级…的 detail 随本次操作一起写；追溯链同一句 note
    for (const [id, rollup] of Object.entries(rollupById)) {
      await store.writeDetail(id, rollup.text);
      dirty = true;
      if (!updated.includes(id)) updated.push(id);
      const target = findNode(tree, id);
      if (note && target && !target.pointers.some((pointerItem) => pointerItem.note === note)) {
        target.pointers.push(pointer(note));
      }
    }

    const unchanged = ids.filter((id) => !updated.includes(id));
    if (dirty) await writeSyncedTree(tree);
    // v1.29 / B-60：标记完成/废弃时机械查重，暴露「同题旧任务仍在」的情况
    /** @type {Array<{code: string, message: string, candidates: any[]}>} */
    const warnings = [];
    const scanned = new Set();
    for (const id of updated) {
      const node = findNode(tree, id);
      if (!node || node.kind !== KIND_TASK || scanned.has(node.id)) continue;
      scanned.add(node.id);
      const similar = findSimilarOpenTasks(tree, { text: `${node.title} ${node.human_line}`, excludeIds: ids, threshold: 0.4 });
      if (similar.length > 0) {
        warnings.push({
          code: "POSSIBLE_DUPLICATE",
          message: `${node.id} 与板上疑似同题任务重叠，请确认是否应把旧任务标「已替代」并写清被谁取代`,
          candidates: similar
        });
      }
    }
    // B-62：祖先链汇总单独列出，便于调用方确认「整条链路」都更新了
    return { updated, verdict_normalized: verdictNormalized, unchanged, warnings, rollups: Object.keys(rollupById) };
  }

  // ---------------------------------------------------------------- import（历史回填，B-29）

  const PREVIEW_TEXT_MAX = 800;
  const PREVIEW_LIMIT = 200;
  const PREVIEW_LIMIT_MAX = 500;
  const APPLY_MAX = 50;

  /**
   * @param {unknown} refs
   * @returns {Array<{session: string, index: number}>}
   */
  function normalizeRefs(refs) {
    if (!Array.isArray(refs) || refs.length === 0) {
      fail(CODES.IMPORT_ITEM_INVALID, "refs 必须是非空数组，形如 [{session, index}]");
    }
    return refs.map((ref) => {
      const session = String(ref?.session ?? "").trim();
      const index = Number(ref?.index);
      if (!session || !Number.isInteger(index) || index < 1) {
        fail(CODES.IMPORT_ITEM_INVALID, "refs 每项必须是 {session: 字符串, index: 正整数}", { ref });
      }
      return { session, index };
    });
  }

  /**
   * 历史回填：preview 只读列出历史会话逐字消息；apply 按 refs 回填需求/任务。
   * 原话由插件从历史会话日志读取，AI 不传正文（§5.9 / B-29）。
   * @param {{mode?: string, limit?: number, items?: Array<any>}} [args]
   */
  async function importBoard(args = {}) {
    if (!history) fail(CODES.INVALID_ARG, "宿主未接入历史会话读取器，compass_import 不可用");
    const mode = String(args.mode ?? "").trim();

    if (mode === "preview") {
      const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), PREVIEW_LIMIT_MAX) : PREVIEW_LIMIT;
      const sessions = await history.listMessages({ limit });
      if (!Array.isArray(sessions) || sessions.length === 0) {
        fail(CODES.HISTORY_NOT_FOUND, "当前工作区没有可读的历史会话（或会话日志不可读）");
      }
      return {
        mode: "preview",
        sessions: sessions.map((session) => ({
          session: session.session,
          cwd: session.cwd ?? null,
          messages: (session.messages ?? []).map((message) => {
            const text = String(message.text ?? "");
            const truncated = text.length > PREVIEW_TEXT_MAX;
            return {
              index: message.index,
              at: message.at ?? null,
              turn: message.turn ?? null,
              chars: text.length,
              truncated,
              text: truncated ? `${text.slice(0, PREVIEW_TEXT_MAX)}…` : text
            };
          })
        })),
        hint: "用 refs:[{session,index}] 引用；apply 时插件按 ref 读取完整原文（预览文本超长会截断）"
      };
    }

    if (mode !== "apply") {
      fail(CODES.INVALID_ARG, "mode 必须是 preview 或 apply");
    }
    const items = args.items;
    if (!Array.isArray(items) || items.length === 0) {
      fail(CODES.IMPORT_ITEM_INVALID, "items 必须是非空数组");
    }
    if (items.length > APPLY_MAX) {
      fail(CODES.IMPORT_LIMIT, `单次回填最多 ${APPLY_MAX} 项（当前 ${items.length} 项）`, { max: APPLY_MAX });
    }

    /** @type {Array<{item: any, refs: Array<{session: string, index: number}>, refMessages: Array<any>}>} */
    const ops = [];
    for (const item of items) {
      const type = String(item?.type ?? "").trim();
      if (type !== "requirement" && type !== "task") {
        fail(CODES.IMPORT_ITEM_INVALID, `item.type 必须是 requirement 或 task（当前：${type || "(空)"}）`);
      }
      const title = line(item?.title, "title");
      const humanLine = line(item?.human_line, "human_line");
      const refs = normalizeRefs(item?.refs);
      const refMessages = [];
      for (const ref of refs) {
        const message = await history.readMessage(ref);
        if (!message) {
          fail(CODES.HISTORY_REF_INVALID, `ref 不存在：${ref.session} #${ref.index}（须来自 preview 结果）`, { ref });
        }
        refMessages.push(message);
      }
      if (item?.exec_state !== undefined) assertExecState(item.exec_state);
      if (item?.verdict_state !== undefined) assertVerdictInput(item.verdict_state);
      const verdict = item?.verdict_state !== undefined ? normalizeVerdictForStorage(item.verdict_state) ?? null : null;
      if (isTerminalVerdict(verdict) && !String(item?.dead_reason ?? "").trim()) {
        fail(CODES.IMPORT_ITEM_INVALID, `落「${verdict}」必须给 dead_reason`, { title });
      }
      if (item?.dead_reason !== undefined && !isTerminalVerdict(verdict)) {
        fail(CODES.IMPORT_ITEM_INVALID, "dead_reason 只能随「已废弃 / 已替代」一起写", { title });
      }
      const hasAfter = item?.after !== undefined && item?.after !== null && String(item.after).trim() !== "";
      const hasBefore = item?.before !== undefined && item?.before !== null && String(item.before).trim() !== "";
      if (type === "requirement" && (hasAfter || hasBefore)) {
        fail(CODES.IMPORT_ITEM_INVALID, "after/before 仅 type=task 允许（需求按创建顺序排）", { title });
      }
      ops.push({ item: { ...item, title, human_line: humanLine }, refs, refMessages });
    }

    // 回填的读-改-写整段原子化（B-39）：锁内只做板面写入，历史会话读取已在锁外完成
    return mutate(async () => {
      const tree = await store.readTree();
      const { model } = await store.readBaseline();

      /** @type {Array<{id: string, type: string, session: string, at: string|null}>} */
      const created = [];
    /** @type {Array<{id: string, title: string}>} */
    const existed = [];
    /** @type {Array<{id: string, detail: string}>} */
    const details = [];
    let baselineDirty = false;

    for (const op of ops) {
      const { item, refMessages } = op;
      const type = item.type;
      let parent = null;
      if (type === "task") {
        const parentId = String(item.parent_id ?? "").trim();
        if (!parentId) fail(CODES.PARENT_REQUIRED, "回填任务必须给 parent_id（挂在需求或任务下）");
        parent = findNode(tree, parentId);
        if (!parent) fail(CODES.PARENT_NOT_FOUND, `父节点不存在：${parentId}`, { parent_id: parentId });
        if (parent.kind === KIND_PROJECT) {
          fail(CODES.INVALID_ARG, "project 根下不能直接挂任务：请回填到需求下");
        }
      }

      const siblings = type === "requirement" ? tree.root.children : parent.children;
      const sameTitle = siblings.find((node) => node.title === item.title);
      if (sameTitle) {
        existed.push({ id: sameTitle.id, title: item.title });
        continue;
      }

      const first = refMessages[0];
      const pointerNote = `历史回填：${optionalNote(item.note, "note") ?? item.title}`;
      const nodePointer = historyPointer(pointerNote, first.at ?? isoNow(), first.session);

      if (type === "requirement") {
        const id = nextRequirementId(tree.root);
        const surface = item.surface !== undefined ? line(item.surface, "surface") : item.human_line;
        tree.root.children.push(newNode(KIND_REQUIREMENT, id, item.title, item.human_line, nodePointer));
        addRequirement(model, {
          id,
          title: item.title,
          surface,
          version: {
            version: "v1",
            at: first.at ?? isoNow(),
            summary: surface,
            original: first.text,
            originalLock: true,
            msg: { session: first.session, at: first.at ?? isoNow() }
          }
        });
        baselineDirty = true;
        if (item.detail !== undefined) details.push({ id, detail: String(item.detail) });
        created.push({ id, type, session: first.session, at: first.at ?? null });
      } else {
        // B-62：回填「已执行」节点同样必须带完成说明（旧实现可直接造出「已执行但无详情」）
        if (item.exec_state === "已执行") {
          const text = item.detail !== undefined ? String(item.detail) : "";
          if (!text.trim()) {
            fail(
              CODES.BATCH_DETAIL_REQUIRED,
              `回填任务「${item.title}」标「已执行」时必须在 items[].detail 提供完成说明。\n` +
                `${sectionFormatBlock("build")}\n或者：\n${sectionFormatBlock("research")}\n` +
                `下一步：在对应 item 上加 detail:"核心文件：…\\n契约：…\\n避坑指南：…"（查询/调研型改成「查询结论/数据来源/后续建议」）后重试 compass_import。`,
              { title: item.title }
            );
          }
          validateCompletionDetail(String(item.title ?? "import-item"), text, { validatePaths: false });
        }
        const id = nextTaskId(parent, treeIds(tree));
        const node = newNode(KIND_TASK, id, item.title, item.human_line, nodePointer);
        if (item.verdict_state !== undefined) {
          node.verdict_state = normalizeVerdictForStorage(item.verdict_state) ?? null;
          node.dead_reason = isTerminalVerdict(node.verdict_state) ? String(item.dead_reason).trim() : null;
        }
        if (item.exec_state !== undefined) node.exec_state = item.exec_state;
        parent.children.splice(positionIndex(parent, item.after, item.before), 0, node);
        if (item.detail !== undefined) details.push({ id, detail: String(item.detail) });
        created.push({ id, type, session: first.session, at: first.at ?? null });
      }
    }

    if (created.length > 0 || baselineDirty) {
      await store.assertUnchanged();
      // B-62：回填把需求聚合为「已执行」时，需求 item 的 detail 必须已含完成汇总
      const detailMap = Object.fromEntries(details.map((entry) => [entry.id, entry.detail]));
      const simulated = JSON.parse(JSON.stringify(tree));
      const flipped = syncRequirementExecStates(simulated).filter((id) => findNode(simulated, id)?.exec_state === "已执行");
      for (const id of flipped) {
        const text = detailMap[id] ?? (await store.readDetail(id));
        const classified = classifyMissingSections(text, "summary");
        if (classified.missing.length > 0 || classified.misplaced.length > 0) {
          fail(
            CODES.REQUIREMENT_DETAIL_REQUIRED,
            `回填会把需求 ${id} 聚合为「已执行」，但需求 item 的 detail${describeMissingSections(classified)}。\n` +
              `${sectionFormatBlock("summary")}\n` +
              `下一步：在该需求 item 上加 detail:"验收范围：…\\n完成结论：…\\n遗留风险：…" 后重试 compass_import（本次未写入任何数据，可直接重试）。`,
            { requirement_ids: [id], missing: classified.missing, misplaced: classified.misplaced }
          );
        }
      }
      await writeSyncedTree(tree, { skipRequirementSummaryGate: true });
      if (baselineDirty) await store.writeBaseline(model);
      for (const entry of details) {
        await store.writeDetail(entry.id, entry.detail);
      }
    }
    return { mode: "apply", created, existed };
    })(args);
  }

  // ---------------------------------------------------------------- move（B-34）

  /**
   * 找到节点的父节点（数据校验用）。
   * @param {any} tree
   * @param {string} id
   */
  function findParentOf(tree, id) {
    let found = null;
    const walk = (node) => {
      for (const child of node.children ?? []) {
        if (child.id === id) {
          found = node;
          return true;
        }
        if (walk(child)) return true;
      }
      return false;
    };
    walk(tree.root);
    return found;
  }

  /**
   * 移动节点到新父节点（可选 after/before 定位）；ID 不变、追溯链追加（B-34）。
   * @param {{source_id?: string, parent_id?: string, after?: string, before?: string, pointer_note?: string}} [args]
   */
  async function moveNode(args = {}) {
    const sourceId = String(args.source_id ?? "").trim();
    const parentId = String(args.parent_id ?? "").trim();
    if (!sourceId || !parentId) fail(CODES.INVALID_ARG, "source_id 与 parent_id 必填");
    const note = optionalNote(args.pointer_note, "pointer_note") ?? "移动节点";

    const tree = await store.readTree();
    const source = assertWritable(tree, sourceId);
    const parent = assertWritable(tree, parentId, { role: "parent" });
    if (source.kind === KIND_PROJECT) fail(CODES.INVALID_ARG, "project 根节点不可移动");
    if (source.kind === KIND_REQUIREMENT) fail(CODES.INVALID_ARG, "需求只能挂在项目根下，不可移动");
    if (parent.kind === KIND_PROJECT) fail(CODES.INVALID_ARG, "任务不能挂到项目根下（请挂到需求或任务下）");
    if (parentId === sourceId) fail(CODES.INVALID_ARG, "不能移动到自身");
    if (collectSubtreeIds(source).includes(parentId)) {
      fail(CODES.INVALID_ARG, `不能移动到自己子树里（会成环）：${parentId}`, { source_id: sourceId, parent_id: parentId });
    }

    const oldParent = findParentOf(tree, sourceId);
    if (!oldParent) fail(CODES.STORE_CORRUPT, `任务树中找不到 ${sourceId} 的父节点（数据不一致）`);
    const oldIndex = oldParent.children.findIndex((child) => child.id === sourceId);
    oldParent.children.splice(oldIndex, 1);

    const index = positionIndex(parent, args.after, args.before);
    parent.children.splice(index, 0, source);
    source.pointers.push(pointer(note));
    await writeSyncedTree(tree);
    return { moved: sourceId, from: oldParent.id, to: parentId };
  }

  // ---------------------------------------------------------------- read

  /**
   * @param {{scope?: string}} [args]
   */
  async function read(args = {}) {
    const scope = String(args.scope ?? "").trim();
    // v1.33：回收站节点不进 AI 上下文（视图/计数/搜索同理）；导入导出仍完整保留
    if (scope === "tree") return pruneTrashed(await store.readTree());
    if (scope === "tree-lite") return flattenLite(await store.readTree());
    if (scope.startsWith("detail:")) {
      const id = scope.slice("detail:".length).trim();
      assertId(id);
      const tree = await store.readTree();
      const node = findNode(tree, id);
      if (!node) fail(CODES.TASK_NOT_FOUND, `节点不存在：${id}`, { missing: [id] });
      if (node.kind === KIND_PROJECT) fail(CODES.INVALID_ARG, "project 根节点没有详情");
      return { id, detail: await store.readDetail(id), note: await store.readNote(id) };
    }
    if (scope === "baseline") {
      const { raw, model } = await store.readBaseline();
      return { raw, requirements: model.requirements };
    }
    fail(CODES.INVALID_ARG, `scope 非法：${scope}（允许 tree / tree-lite / detail:<id> / baseline）`);
  }

  // ---------------------------------------------------------------- change

  /**
   * 需求变更：追加基线版本（原话写入/校验规则同 require）。
   * @param {{requirement_id?: string, new_text?: string, reason?: string, original_text?: string, original_refs?: any}} [args]
   */
  async function change(args = {}) {
    const requirementId = String(args.requirement_id ?? "").trim();
    if (!/^R-\d{3,4}$/.test(requirementId)) {
      fail(CODES.INVALID_ARG, `requirement_id 非法：${requirementId}（形如 R-001）`);
    }
    const newText = line(args.new_text, "new_text");
    const reason = line(args.reason, "reason");
    const warnings = [];

    const tree = await store.readTree();
    const { model } = await store.readBaseline();
    if (!findRequirement(model, requirementId)) {
      fail(CODES.REQUIREMENT_NOT_FOUND, `需求 ${requirementId} 不存在（新建需求请用 compass_require）`);
    }
    if (!findNode(tree, requirementId)) {
      fail(CODES.STORE_CORRUPT, `任务树中不存在需求 ${requirementId}，但基线要求它在（数据不一致）`);
    }
    assertWritable(tree, requirementId);

    const original = await resolveOriginalInput(args, warnings);
    const label = appendVersion(model, requirementId, {
      at: isoNow(),
      summary: newText,
      reason,
      original: original?.text ?? "",
      originalLock: Boolean(original?.text),
      msg: original ? { session: original.session, at: original.at } : null
    });
    await store.writeBaseline(model);

    return {
      appended: label,
      original_locked: Boolean(original?.text),
      warnings
    };
  }

  // ---------------------------------------------------------------- merge

  /**
   * 标记合并关系（只写 merged_into + 追溯链）。
   * @param {{source_id?: string, target_id?: string, pointer_note?: string}} [args]
   */
  async function merge(args = {}) {
    const sourceId = String(args.source_id ?? "").trim();
    const targetId = String(args.target_id ?? "").trim();
    if (!sourceId || !targetId) fail(CODES.INVALID_ARG, "source_id 与 target_id 必填");
    const note = optionalNote(args.pointer_note, "pointer_note");
    if (!note) {
      fail(
        CODES.POINTER_NOTE_REQUIRED,
        '合并必须带 pointer_note（说明为什么合并到目标节点）。下一步：加 pointer_note，例如 pointer_note:"与 R-002 重复，合并到 R-002"。'
      );
    }

    const tree = await store.readTree();
    const source = findNode(tree, sourceId);
    const target = findNode(tree, targetId);
    const missing = [];
    if (!source) missing.push(sourceId);
    if (!target) missing.push(targetId);
    if (missing.length > 0) fail(CODES.TASK_NOT_FOUND, `节点不存在：${missing.join("、")}`, { missing });
    if (sourceId === targetId) fail(CODES.SELF_MERGE, "source_id 不能等于 target_id");
    if (source.kind === KIND_PROJECT || target.kind === KIND_PROJECT) {
      fail(CODES.INVALID_ARG, "project 根节点不参与合并");
    }
    assertWritable(tree, sourceId);
    assertWritable(tree, targetId);

    source.merged_into = targetId;
    source.pointers.push(pointer(note));
    await writeSyncedTree(tree);
    return { merged_into: targetId };
  }

  // ---------------------------------------------------------------- migrate（V3，B-44）

  /**
   * 旧 status.md 迁移：preview 只读解析 / apply 逐字落板并按需归档。
   * @param {{mode?: string, path?: string, file_mtime?: string, items?: Array<any>, archive?: boolean}} [args]
   */
  async function migrate(args = {}) {
    const mode = String(args.mode ?? "").trim();
    if (mode === "preview") return previewMigration(args.path);
    if (mode !== "apply") fail(CODES.INVALID_ARG, "mode 必须是 preview 或 apply");
    return applyMigration(store, args, { now });
  }

  return {
    init,
    require: mutate(requireRequirement),
    plan: mutate(plan),
    update: mutate(update),
    read,
    change: mutate(change),
    merge: mutate(merge),
    import: importBoard,
    move: mutate(moveNode),
    migrate
  };
}
