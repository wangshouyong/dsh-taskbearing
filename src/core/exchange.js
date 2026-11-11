/**
 * 导出 / 导入（B-41 / A15）：任务板打包为单文件 bundle，可跨工作区/新环境还原。
 * 契约：docs/schema-v2.md §12.5。
 *
 * 约束：
 * - 导出只读、不修改任何数据；包含 tree + baseline 原文 + 全部存在的详情/备注。
 * - 导入只允许目标板为空（未初始化或空板），不做合并；整段在 Store.run（写锁）内，
 *   失败回滚到导入前状态（未初始化目标删除新建目录；空板目标重写空树/空基线）。
 * - bundle 里的原路径只作展示，不用于定位（§4.1）。
 */

import fs from "node:fs/promises";
import path from "node:path";

import { emptyBaseline, parseBaseline } from "./baseline.js";
import { CODES, CompassError, fail } from "./errors.js";
import { assertId } from "./ids.js";
import { Store } from "./store.js";
import { emptyTree, syncRequirementExecStates, validateTree } from "./tree.js";

export const BUNDLE_FORMAT = "dsh-taskboard-bundle";
export const BUNDLE_SCHEMA = 1;
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
export const MAX_DETAIL_BYTES = 2 * 1024 * 1024;

/**
 * 遍历树节点（不含 project 根）。
 * @param {any} tree
 * @param {(node: any) => void} visit
 */
function walkNodes(tree, visit) {
  const walk = (node) => {
    for (const child of node.children ?? []) {
      visit(child);
      walk(child);
    }
  };
  walk(tree?.root ?? { children: [] });
}

/**
 * @param {any} tree
 * @returns {string[]}
 */
function nodeIdsOf(tree) {
  const ids = [];
  walkNodes(tree, (node) => ids.push(node.id));
  return ids;
}

/**
 * @param {any} tree
 * @returns {number}
 */
function countNodes(tree) {
  return nodeIdsOf(tree).length;
}

/**
 * 组装导出包（只读）。
 * @param {import("./store.js").Store} store
 * @param {{now?: () => Date, pluginVersion?: string}} [options]
 */
export async function buildBundle(store, options = {}) {
  const now = options.now ?? (() => new Date());
  return store.run(async () => {
    const meta = await store.readMeta();
    const tree = await store.readTree();
    const { raw } = await store.readBaseline();
    /** 只包含存在的详情/备注文件（缺省视为空，减小包体） */
    /** @type {Record<string, {md: string, note: string}>} */
    const details = {};
    for (const id of nodeIdsOf(tree)) {
      const [md, note] = await Promise.all([store.readDetail(id), store.readNote(id)]);
      if (md !== "" || note !== "") details[id] = { md, note };
    }
    return {
      format: BUNDLE_FORMAT,
      schema: BUNDLE_SCHEMA,
      exported_at: now().toISOString(),
      plugin_version: options.pluginVersion ?? store.pluginVersion,
      workspace: {
        workspace_id: store.workspaceId,
        name: meta.workspace_name ?? store.workspaceName,
        original_path: meta.original_path ?? store.workspacePath
      },
      meta,
      tree,
      baseline: { raw },
      details
    };
  });
}

/**
 * 校验 bundle（不写任何数据）；返回规范化后的中间形态。
 * @param {any} bundle
 * @param {{maxBytes?: number}} [options]
 */
export function validateBundle(bundle, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_BUNDLE_BYTES;
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    fail(CODES.INVALID_ARG, "导入包必须是 JSON 对象");
  }
  if (bundle.format !== BUNDLE_FORMAT) {
    fail(CODES.INVALID_ARG, `导入包格式不匹配：期望 ${BUNDLE_FORMAT}，实际 ${String(bundle.format ?? "(空)")}`);
  }
  const schema = Number(bundle.schema);
  if (!Number.isInteger(schema) || schema < 1) {
    fail(CODES.INVALID_ARG, `导入包 schema 非法：${String(bundle.schema ?? "(空)")}`);
  }
  if (schema > BUNDLE_SCHEMA) {
    fail(CODES.SCHEMA_VERSION, `导入包 schema=${schema} 高于当前插件支持的 ${BUNDLE_SCHEMA}，请升级插件`);
  }

  let tree;
  try {
    tree = validateTree(bundle.tree);
  } catch (err) {
    if (err instanceof CompassError) throw err;
    fail(CODES.STORE_CORRUPT, `导入包中的任务树不合法：${err instanceof Error ? err.message : String(err)}`);
  }

  const treeIds = new Set(nodeIdsOf(tree));
  const requirementIds = new Set(
    (tree.root.children ?? []).filter((node) => node.kind === "requirement").map((node) => node.id)
  );

  let baselineRaw = "";
  if (bundle.baseline !== undefined) {
    if (!bundle.baseline || typeof bundle.baseline !== "object" || typeof bundle.baseline.raw !== "string") {
      fail(CODES.INVALID_ARG, "导入包 baseline 必须是 {raw: string}");
    }
    baselineRaw = bundle.baseline.raw;
  }
  const model = parseBaseline(baselineRaw);
  const baselineIds = new Set(model.requirements.map((req) => req.id));
  const missingInTree = [...baselineIds].filter((id) => !requirementIds.has(id));
  const missingInBaseline = [...requirementIds].filter((id) => !baselineIds.has(id));
  if (missingInTree.length > 0 || missingInBaseline.length > 0) {
    fail(
      CODES.STORE_CORRUPT,
      "导入包不一致：任务树需求集合与基线需求集合必须完全相同",
      { missing_in_tree: missingInTree, missing_in_baseline: missingInBaseline }
    );
  }

  /** @type {Record<string, {md: string, note: string}>} */
  const details = {};
  let detailBytes = 0;
  const rawDetails = bundle.details ?? {};
  if (typeof rawDetails !== "object" || Array.isArray(rawDetails)) {
    fail(CODES.INVALID_ARG, "导入包 details 必须是对象");
  }
  for (const [id, entry] of Object.entries(rawDetails)) {
    assertId(id);
    if (!treeIds.has(id)) {
      fail(CODES.STORE_CORRUPT, `导入包 details 中的 id 不在任务树中：${id}`);
    }
    const md = entry?.md ?? "";
    const note = entry?.note ?? "";
    if (typeof md !== "string" || typeof note !== "string") {
      fail(CODES.INVALID_ARG, `导入包 details.${id} 的 md/note 必须是字符串`);
    }
    const bytes = Buffer.byteLength(md, "utf8") + Buffer.byteLength(note, "utf8");
    if (bytes > MAX_DETAIL_BYTES) {
      fail(CODES.INVALID_ARG, `导入包 details.${id} 超过单文件上限（${MAX_DETAIL_BYTES} 字节）`);
    }
    detailBytes += bytes;
    details[id] = { md, note };
  }
  if (detailBytes > maxBytes) {
    fail(CODES.INVALID_ARG, `导入包内容超过上限（${maxBytes} 字节）`);
  }

  const meta = bundle.meta && typeof bundle.meta === "object" ? bundle.meta : {};
  const workspace = bundle.workspace && typeof bundle.workspace === "object" ? bundle.workspace : {};
  return {
    schema,
    exported_at: typeof bundle.exported_at === "string" ? bundle.exported_at : null,
    plugin_version: typeof bundle.plugin_version === "string" ? bundle.plugin_version : null,
    workspace: {
      workspace_id: typeof workspace.workspace_id === "string" ? workspace.workspace_id : null,
      name: typeof workspace.name === "string" ? workspace.name : null,
      original_path: typeof workspace.original_path === "string" ? workspace.original_path : null
    },
    source_created_at: typeof meta.created_at === "string" ? meta.created_at : null,
    tree,
    baseline: { raw: baselineRaw, model },
    details
  };
}

/**
 * @param {string[]} ids
 */
function safeDetailIds(ids) {
  return ids.filter((id) => {
    try {
      assertId(id);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * 目标板是否为空：未初始化，或树无节点且基线无需求。
 * @param {Store} store
 * @returns {Promise<{exists: boolean, initialized: boolean, empty: boolean}>}
 */
async function inspectTarget(store) {
  const exists = await store.exists();
  if (!exists) return { exists, initialized: false, empty: true };
  let tree;
  try {
    tree = await store.readTree();
  } catch {
    return { exists, initialized: false, empty: false };
  }
  let model;
  try {
    model = (await store.readBaseline()).model;
  } catch {
    return { exists, initialized: true, empty: false };
  }
  const empty = countNodes(tree) === 0 && model.requirements.length === 0;
  return { exists, initialized: true, empty };
}

/**
 * 导入 bundle（整段在写锁内；失败回滚）。
 * @param {Store} store
 * @param {any} bundle
 * @param {{confirm?: string, now?: () => Date}} [options]
 */
export async function importBundle(store, bundle, options = {}) {
  if (options.confirm !== "IMPORT") {
    fail(CODES.INVALID_ARG, '导入必须显式传 confirm: "IMPORT"（强二次确认）');
  }
  const normalized = validateBundle(bundle);
  const now = options.now ?? (() => new Date());

  return store.run(async () => {
    const target = await inspectTarget(store);
    if (!target.empty) {
      fail(
        CODES.INVALID_ARG,
        "导入目标板非空：为避免半覆盖，只允许导入到空板（新工作区，或先清空当前工作区任务板数据）"
      );
    }

    const createdDirs = !target.exists;
    /** @type {string[]} */
    const writtenDetails = [];
    try {
      await fs.mkdir(path.join(store.dataDir, "tasks", "details"), { recursive: true });
      if (createdDirs) {
        await store.writeMeta({
          schema: 1,
          plugin: "dsh-compass",
          workspace_name: normalized.workspace.name ?? store.workspaceName,
          original_path: store.workspacePath,
          path_hash: path.basename(store.dataDir).split("-").pop(),
          created_at: normalized.source_created_at ?? now().toISOString(),
          plugin_version: store.pluginVersion,
          imported_from: {
            workspace_id: normalized.workspace.workspace_id,
            name: normalized.workspace.name,
            original_path: normalized.workspace.original_path,
            exported_at: normalized.exported_at,
            plugin_version: normalized.plugin_version
          }
        });
      }
      // 先记录当前版本（空板），写 tree/baseline 时校验不会被并发改动
      if (target.initialized) {
        await store.readTree();
        await store.readBaseline();
      }
      syncRequirementExecStates(normalized.tree);
      await store.writeTree(normalized.tree);
      await store.writeBaseline(normalized.baseline.model);
      for (const id of safeDetailIds(Object.keys(normalized.details))) {
        const entry = normalized.details[id];
        if (entry.md !== "") await store.writeDetail(id, entry.md);
        if (entry.note !== "") await store.writeNote(id, entry.note);
        if (entry.md !== "" || entry.note !== "") writtenDetails.push(id);
      }
      return {
        imported: {
          nodes: countNodes(normalized.tree),
          details: writtenDetails.length,
          baseline_requirements: normalized.baseline.model.requirements.length
        },
        workspace: {
          workspace_id: store.workspaceId,
          name: normalized.workspace.name ?? store.workspaceName,
          source: normalized.workspace,
          exported_at: normalized.exported_at
        }
      };
    } catch (err) {
      // 回滚：未初始化目标删掉本次新建的数据目录；空板目标恢复空树/空基线并删除已写详情
      if (createdDirs) {
        await fs.rm(store.dataDir, { recursive: true, force: true }).catch(() => {});
      } else {
        try {
          await store.writeTree(emptyTree());
          await store.writeBaseline(emptyBaseline());
          for (const id of writtenDetails) {
            await fs.rm(store.detailPath(id), { force: true }).catch(() => {});
            await fs.rm(store.notePath(id), { force: true }).catch(() => {});
          }
        } catch {
          // 回滚失败：保留原始错误，交由上层提示（不静默）
        }
      }
      throw err;
    }
  });
}

/**
 * 导入包的人类可读摘要（UI 确认面板用，纯函数）。
 * @param {any} bundle
 */
export function summarizeBundle(bundle) {
  const workspace = bundle?.workspace ?? {};
  let nodes = 0;
  let requirements = 0;
  const walk = (node) => {
    for (const child of node?.children ?? []) {
      nodes += 1;
      if (child.kind === "requirement") requirements += 1;
      walk(child);
    }
  };
  walk(bundle?.tree?.root);
  return {
    format: bundle?.format ?? null,
    schema: bundle?.schema ?? null,
    exported_at: typeof bundle?.exported_at === "string" ? bundle.exported_at : null,
    plugin_version: typeof bundle?.plugin_version === "string" ? bundle.plugin_version : null,
    workspace_name: typeof workspace.name === "string" ? workspace.name : null,
    original_path: typeof workspace.original_path === "string" ? workspace.original_path : null,
    nodes,
    requirements,
    details: Object.keys(bundle?.details ?? {}).length
  };
}
