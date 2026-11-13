/**
 * /api/compass/* 数据路由（只读 tree/details/baseline/workspaces/session-links/session-turn/history-summary、
 * 只写 note.md / ui-state.json / _ui.json）。
 * 安全边界（C-4）：写路径白名单，拒绝写 tree.json 与 details/<id>.md；cwd 必须绝对路径。
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { CODES, CompassError, fail } from "../core/errors.js";
import { buildBundle, importBundle } from "../core/exchange.js";
import { assertId } from "../core/ids.js";
import { resolveWorkspacePath } from "../core/paths.js";
import { Store } from "../core/store.js";
import { findRequirement, parseBaseline } from "../core/baseline.js";
import { collectTrashed, pruneTrashed } from "../core/tree.js";
import {
  buildTrashBackup,
  cleanupTrashBackups,
  discardNodes,
  inspectPurge,
  normalizeTrashIds,
  removeNode,
  restoreNodes,
  writeTrashBackup
} from "../core/trash.js";
import { computeBoardStatus } from "./board-status.js";
import { findSessionLogFile, isSessionId, readSessionMeta, resolveTurnForJump, summarizeWorkspaceSessions } from "./history.js";
import { removeRuleBlock } from "./rules.js";

const WORKSPACE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

const ABS_PATH_RE = /^([A-Za-z]:[\\/]|\/|\\\\)/;
const VIEWS = new Set(["current", "active", "all"]);

function normalizeCwd(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    fail(CODES.INVALID_ARG, "缺少 cwd（客户端应传当前工作区绝对路径）");
  }
  const value = cwd.trim();
  if (!ABS_PATH_RE.test(value)) {
    fail(CODES.INVALID_ARG, `cwd 必须是绝对路径：${value}`);
  }
  return resolveWorkspacePath(value);
}

function isCompassError(err) {
  return err instanceof CompassError;
}

function statusOf(err) {
  if (!isCompassError(err)) return 500;
  if (err.code === CODES.NOT_INITIALIZED) return 404;
  return 400;
}

/**
 * 注册 /api/compass 前缀路由。
 * @param {any} ctx
 * @param {{storageRoot: string, pluginVersion?: string, rulesPath?: string, sessionsRoot?: string}} deps
 * @returns {() => void} disposer
 */
export function registerCompassRoutes(webServer, deps) {
  if (typeof webServer?.register !== "function") {
    return () => {};
  }
  const storageRoot = deps.storageRoot;
  const sessionsRoot = typeof deps.sessionsRoot === "string" && deps.sessionsRoot ? deps.sessionsRoot : null;
  const pluginVersion = deps.pluginVersion ?? "0.1.0";

  /** @type {Map<string, Store>} */
  const stores = new Map();
  const storeFor = (cwd) => {
    const normalized = normalizeCwd(cwd);
    let store = stores.get(normalized);
    if (!store) {
      store = Store.forWorkspace({ storageRoot, workspacePath: normalized, pluginVersion });
      stores.set(normalized, store);
    }
    return store;
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === "string") {
          try {
            resolve(JSON.parse(req.body));
          } catch {
            resolve({});
          }
          return;
        }
        resolve(req.body);
        return;
      }
      let data = "";
      req.on?.("data", (chunk) => {
        data += chunk;
      });
      req.on?.("end", () => {
        if (!data) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new CompassError(CODES.INVALID_ARG, `请求体不是合法 JSON：${err.message}`));
        }
      });
      req.on?.("error", reject);
      if (typeof req.on !== "function") resolve({});
    });

  const send = (res, status, payload, extraHeaders = {}) => {
    const body = JSON.stringify(payload ?? {});
    res.writeHead?.(status, { "content-type": "application/json; charset=utf-8", ...extraHeaders });
    res.end?.(body);
  };

  const uiStatePath = (store) => path.join(store.dataDir, "ui-state.json");
  const prefsPath = () => path.join(storageRoot, "_ui.json");

  const readJsonFile = async (file, fallback) => {
    try {
      const text = await fsp.readFile(file, "utf8");
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };

  const writeJsonFileAtomic = async (file, payload) => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    await fsp.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fsp.rename(tmp, file);
  };

  const fileMtime = async (file) => {
    try {
      const stat = await fsp.stat(file);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return { mtimeMs: 0, size: 0 };
    }
  };

  async function handleCurrent(url) {
    const cwdParam = url.searchParams.get("cwd");
    let cwd = cwdParam && cwdParam.trim() ? cwdParam : null;
    if (!cwd) {
      const sessionId = url.searchParams.get("sessionId");
      if (sessionId && typeof deps.getSessionCwd === "function") {
        try {
          cwd = deps.getSessionCwd(sessionId) ?? null;
        } catch {
          cwd = null;
        }
      }
    }
    if (!cwd) cwd = process.cwd();
    const normalized = normalizeCwd(cwd);
    const store = storeFor(normalized);
    let initialized = false;
    let meta = null;
    try {
      meta = await store.readMeta();
      initialized = true;
    } catch {
      initialized = false;
    }
    return {
      cwd: normalized,
      workspaceId: store.workspaceId,
      initialized,
      dataDir: store.dataDir,
      meta
    };
  }

  async function handleTree(url) {
    const store = storeFor(url.searchParams.get("cwd"));
    const stat = await fileMtime(store.treePath);
    const ifmtime = Number(url.searchParams.get("ifmtime") ?? NaN);
    if (Number.isFinite(ifmtime) && ifmtime === stat.mtimeMs) {
      return { changed: false, mtimeMs: stat.mtimeMs, size: stat.size };
    }
    const tree = await store.readTree();
    return { changed: true, tree, mtimeMs: stat.mtimeMs, size: stat.size };
  }

  async function handleDetail(url) {
    const store = storeFor(url.searchParams.get("cwd"));
    const id = assertId(String(url.searchParams.get("id") ?? ""));
    const [detail, note, detailStat, noteStat] = await Promise.all([
      store.readDetail(id),
      store.readNote(id),
      fileMtime(store.detailPath(id)),
      fileMtime(store.notePath(id))
    ]);
    return { id, detail, note, detailMtime: detailStat.mtimeMs, noteMtime: noteStat.mtimeMs };
  }

  /** 单次文件存在性检测上限（B-56）。 */
  const MAX_FILE_CHECK = 50;
  const MAX_ANCHOR_PATH_LEN = 512;

  /**
   * 锚点路径解析（B-56）：绝对路径原样；相对路径按 cwd 解析且不得越界；非法返回 null。
   * @param {string} cwd
   * @param {unknown} rawPath
   * @returns {string|null}
   */
  function resolveAnchorPath(cwd, rawPath) {
    const text = typeof rawPath === "string" ? rawPath.trim() : "";
    if (!text || text.length > MAX_ANCHOR_PATH_LEN || text.includes("\0")) return null;
    const normalized = text.replace(/\\/g, "/");
    if (ABS_PATH_RE.test(normalized)) return path.resolve(normalized);
    const base = path.resolve(cwd);
    const resolved = path.resolve(base, normalized);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    return resolved;
  }

  /** POST /api/compass/file-exists（B-56，只读）：批量机械 stat，供文件锚点三态展示。 */
  async function handleFileExists(body) {
    const cwd = normalizeCwd(body.cwd);
    const paths = Array.isArray(body.paths) ? body.paths : [];
    if (paths.length === 0) return { results: [] };
    if (paths.length > MAX_FILE_CHECK) {
      fail(CODES.INVALID_ARG, `单次最多检测 ${MAX_FILE_CHECK} 个路径`);
    }
    const results = [];
    for (const raw of paths) {
      const resolved = resolveAnchorPath(cwd, raw);
      if (!resolved) {
        results.push({ path: raw, exists: false, kind: "unknown" });
        continue;
      }
      try {
        const stat = await fsp.stat(resolved);
        results.push({ path: raw, exists: true, kind: stat.isDirectory() ? "directory" : "file" });
      } catch (err) {
        const code = err && typeof err === "object" ? err.code : "";
        results.push({
          path: raw,
          exists: false,
          kind: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unknown"
        });
      }
    }
    return { results };
  }

  async function handleBaseline(url) {
    const store = storeFor(url.searchParams.get("cwd"));
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!/^R-\d{3,4}$/.test(id)) {
      fail(CODES.INVALID_ARG, `requirement_id 非法：${id}`);
    }
    const { model } = await store.readBaseline();
    const req = findRequirement(model, id);
    if (!req) fail(CODES.REQUIREMENT_NOT_FOUND, `需求 ${id} 不存在`);
    const latest = req.versions[req.versions.length - 1] ?? null;
    return {
      id,
      title: req.title,
      surface: req.surface,
      version: latest?.version ?? null,
      originalLock: latest?.originalLock === true,
      at: latest?.at ?? null
    };
  }

  async function handleNote(body) {
    const store = storeFor(body.cwd);
    const id = assertId(String(body.id ?? ""));
    const content = String(body.content ?? "");
    await store.writeNote(id, content);
    const stat = await fileMtime(store.notePath(id));
    return { ok: true, mtime: stat.mtimeMs };
  }

  // ---------------------------------------------------------------- 回收站（v1.33）

  /**
   * POST /api/compass/discard（v1.33）：丢弃到回收站（打独立删除标记，连带整棵子树隐藏）。
   * 不写追溯链、不要求理由、不改执行态/裁决态；可随时还原。
   */
  async function handleDiscard(body) {
    const store = storeFor(body?.cwd);
    const ids = normalizeTrashIds(body?.ids);
    return store.run(async () => {
      const tree = await store.readTree();
      const at = new Date().toISOString();
      const result = discardNodes(tree, ids, at);
      await store.writeTree(tree);
      return { ...result, at, trash_count: collectTrashed(tree).length };
    });
  }

  /** POST /api/compass/restore（v1.33）：从回收站还原（清标记，原状态原样回来）。 */
  async function handleRestore(body) {
    const store = storeFor(body?.cwd);
    const ids = normalizeTrashIds(body?.ids);
    return store.run(async () => {
      const tree = await store.readTree();
      const result = restoreNodes(tree, ids);
      await store.writeTree(tree);
      return { ...result, trash_count: collectTrashed(tree).length };
    });
  }

  /**
   * POST /api/compass/purge（v1.33）：彻底删除（二次确认 confirm:"DELETE"）。
   * 只允许任务/步骤；需求层与被 merged_into 引用的节点拒绝。
   * 先整包备份到 data/.trash（保留 30 天）再删，失败即中止、不落半盘。
   */
  async function handlePurge(body) {
    const store = storeFor(body?.cwd);
    const id = assertId(String(body?.id ?? "").trim());
    if (body?.confirm !== "DELETE") {
      fail(CODES.INVALID_ARG, '彻底删除必须显式传 confirm: "DELETE"（二次确认，删除后只能从 data/.trash 备份手工恢复）');
    }
    return store.run(async () => {
      const tree = await store.readTree();
      const info = inspectPurge(tree, id);
      /** @type {Record<string, {md: string, note: string}>} */
      const details = {};
      for (const nodeId of info.ids) {
        const [md, note] = await Promise.all([store.readDetail(nodeId), store.readNote(nodeId)]);
        if (md !== "" || note !== "") details[nodeId] = { md, note };
      }
      const backup = buildTrashBackup({
        node: info.node,
        ids: info.ids,
        tree,
        workspaceId: store.workspaceId,
        pluginVersion,
        details,
        now: new Date().toISOString()
      });
      // 备份成功才动数据：备份失败 ⇒ E_WRITE_FAILED，树不删
      const backupFile = await writeTrashBackup(store, backup);
      const removed = removeNode(tree, id);
      await store.writeTree(tree);
      for (const nodeId of removed.ids) {
        await fsp.rm(store.detailPath(nodeId), { force: true }).catch(() => {});
        await fsp.rm(store.notePath(nodeId), { force: true }).catch(() => {});
      }
      await cleanupTrashBackups(store).catch(() => 0);
      return {
        purged: id,
        descendants: Math.max(0, removed.ids.length - 1),
        backup: path.relative(store.dataDir, backupFile).replace(/\\/g, "/"),
        trash_count: collectTrashed(tree).length
      };
    });
  }

  async function handleGetUiState(url) {
    const store = storeFor(url.searchParams.get("cwd"));
    const state = await readJsonFile(uiStatePath(store), { expanded: {}, rememberExpand: false });
    return {
      expanded: state && typeof state.expanded === "object" && state.expanded !== null ? state.expanded : {},
      rememberExpand: state?.rememberExpand === true
    };
  }

  async function handlePutUiState(body) {
    const store = storeFor(body.cwd);
    const expanded = body.expanded && typeof body.expanded === "object" && !Array.isArray(body.expanded) ? body.expanded : {};
    const rememberExpand = body.rememberExpand === true;
    await writeJsonFileAtomic(uiStatePath(store), { expanded, rememberExpand });
    return { ok: true };
  }

  async function handleStatus(url) {
    const store = storeFor(url.searchParams.get("cwd"));
    return computeBoardStatus({
      store,
      turns: deps.turns ?? null,
      sessionId: url.searchParams.get("sessionId")
    });
  }

  /** 单次会话可用性核验上限（B-61）。 */
  const MAX_SESSION_CHECK = 50;

  /**
   * GET /api/compass/session-links?cwd=&ids=a,b,c（B-61，只读）：
   * 客户端会话快照只含「已加载」会话，历史会话会假阴性（显示会话不可用）。
   * 这里按会话日志的存在性给权威答案，供 UI 覆盖快照判定。
   */
  async function handleSessionLinks(url) {
    if (!sessionsRoot) fail(CODES.INVALID_ARG, "宿主未提供会话日志根目录，无法核验会话可用性");
    const cwd = normalizeCwd(url.searchParams.get("cwd"));
    const ids = String(url.searchParams.get("ids") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (ids.length > MAX_SESSION_CHECK) fail(CODES.INVALID_ARG, `单次最多核验 ${MAX_SESSION_CHECK} 个会话`);
    const sessions = [];
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (!isSessionId(id)) {
        sessions.push({ session: id, exists: false, origin: null, openable: false, target_session: null });
        continue;
      }
      const file = await findSessionLogFile({ sessionsRoot, workspacePath: cwd, sessionId: id });
      if (!file) {
        sessions.push({ session: id, exists: false, origin: null, openable: false, target_session: null });
        continue;
      }
      const meta = await readSessionMeta(file);
      const isSubagent = meta?.origin === "subagent";
      sessions.push({
        session: id,
        exists: true,
        origin: meta?.origin ?? null,
        openable: !isSubagent,
        // 子代理会话不可直接打开 ⇒ 跳父会话（B-61）
        target_session: isSubagent ? meta?.parent_session ?? null : null
      });
    }
    return { sessions };
  }

  /**
   * GET /api/compass/session-turn?cwd=&session=&turn=&at=（B-61，只读）：
   * 追溯跳转前用会话日志核验/还原真实轮次（旧版插件写过错误 turn 的历史指针也能跳对）。
   */
  async function handleSessionTurn(url) {
    if (!sessionsRoot) fail(CODES.INVALID_ARG, "宿主未提供会话日志根目录，无法核验轮次");
    const cwd = normalizeCwd(url.searchParams.get("cwd"));
    const session = String(url.searchParams.get("session") ?? "").trim();
    if (!isSessionId(session)) fail(CODES.INVALID_ARG, `会话 id 非法：${session}`);
    const turnParam = Number(url.searchParams.get("turn"));
    const atRaw = String(url.searchParams.get("at") ?? "").trim();
    return resolveTurnForJump({
      sessionsRoot,
      workspacePath: cwd,
      sessionId: session,
      turn: Number.isInteger(turnParam) && turnParam >= 1 ? turnParam : null,
      at: atRaw || null
    });
  }

  /**
   * GET /api/compass/history-summary?cwd=（B-63 / v1.32，只读）：
   * 面板在「暂无数据」空态判断是「插件安装前的旧会话」还是「全新工作区」。
   * 只列会话目录 + stat（不解压日志）；无 sessionsRoot 的宿主明确降级为 unavailable，不报错阻塞面板。
   */
  async function handleHistorySummary(url) {
    const cwd = normalizeCwd(url.searchParams.get("cwd"));
    if (!sessionsRoot) {
      return { available: false, sessions: 0, latest_at: null, truncated: false };
    }
    const summary = await summarizeWorkspaceSessions({ sessionsRoot, workspacePath: cwd });
    return {
      available: true,
      sessions: summary.sessions,
      latest_at: summary.latestMs ? new Date(summary.latestMs).toISOString() : null,
      truncated: summary.truncated
    };
  }

  /** 统计树节点与状态分布（A14 多工作区总览用；纯机械计数）。 */
  function summarizeTree(rawTree) {
    const tree = pruneTrashed(rawTree); // v1.33：回收站节点不计入任何统计
    const summary = {
      node_count: 0,
      requirement_count: 0,
      exec: { todo: 0, doing: 0, done: 0 },
      verdict: { pending: 0, conflict: 0, dead: 0 }
    };
    const walk = (node) => {
      for (const child of node.children ?? []) {
        summary.node_count += 1;
        if (child.kind === "requirement") summary.requirement_count += 1;
        if (child.exec_state === "进行中") summary.exec.doing += 1;
        else if (child.exec_state === "已执行") summary.exec.done += 1;
        else summary.exec.todo += 1;
        if (child.verdict_state === "待裁决") summary.verdict.pending += 1;
        else if (child.verdict_state === "冲突") summary.verdict.conflict += 1;
        else if (child.verdict_state === "已废弃" || child.verdict_state === "已替代") summary.verdict.dead += 1;
        walk(child);
      }
    };
    walk(tree.root);
    return summary;
  }

  /** GET /api/compass/workspaces（A24/B-37：列表 + 孤儿检测 + 当前标记）。 */
  async function handleWorkspaces(url) {
    let entries = [];
    try {
      entries = await fsp.readdir(storageRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const currentCwd = String(url.searchParams.get("cwd") ?? "").trim();
    /** 路径统一规范化（realpath + 正斜杠 + 盘符大写）；8.3 短路径/大小写差异不得影响「当前工作区」判定 */
    const normalizeForCompare = (value) => {
      try {
        return resolveWorkspacePath(value).toLowerCase();
      } catch {
        return null;
      }
    };
    const currentNorm = currentCwd ? normalizeForCompare(currentCwd) : null;
    const workspaces = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !WORKSPACE_ID_RE.test(entry.name)) continue;
      const dir = path.join(storageRoot, entry.name);
      let meta = null;
      try {
        meta = JSON.parse(await fsp.readFile(path.join(dir, "meta.json"), "utf8"));
      } catch {
        meta = null;
      }
      let nodeCount = 0;
      let updatedAt = null;
      let summary = { node_count: 0, requirement_count: 0, exec: { todo: 0, doing: 0, done: 0 }, verdict: { pending: 0, conflict: 0, dead: 0 } };
      try {
        const treePath = path.join(dir, "tasks", "tree.json");
        const tree = JSON.parse(await fsp.readFile(treePath, "utf8"));
        summary = summarizeTree(tree);
        nodeCount = summary.node_count;
        updatedAt = (await fsp.stat(treePath)).mtime.toISOString();
      } catch {
        // 未初始化/损坏：保留 0/null，不报错
      }
      const originalPath = typeof meta?.original_path === "string" ? meta.original_path : null;
      let exists = false;
      if (originalPath) {
        try {
          exists = fs.existsSync(originalPath);
        } catch {
          exists = false;
        }
      }
      const normalizedOriginal = originalPath ? normalizeForCompare(originalPath) : null;
      workspaces.push({
        workspace_id: entry.name,
        name: meta?.workspace_name ?? entry.name,
        original_path: originalPath,
        exists,
        orphan: originalPath ? !exists : true,
        node_count: nodeCount,
        requirement_count: summary.requirement_count,
        exec: summary.exec,
        verdict: summary.verdict,
        updated_at: updatedAt,
        current: Boolean(currentNorm && normalizedOriginal === currentNorm)
      });
    }
    workspaces.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
    return { workspaces, count: workspaces.length };
  }

  /** POST /api/compass/workspaces/remove（A24/B-37：二次确认 + 路径围栏）。 */
  async function handleRemoveWorkspace(body) {
    const workspaceId = String(body?.workspace_id ?? "").trim();
    if (!WORKSPACE_ID_RE.test(workspaceId)) fail(CODES.INVALID_ARG, `workspace_id 非法：${workspaceId}`);
    if (body?.confirm !== "DELETE") fail(CODES.INVALID_ARG, '删除必须显式传 confirm: "DELETE"（二次确认）');
    const root = path.resolve(storageRoot);
    const target = path.resolve(path.join(storageRoot, workspaceId));
    if (path.dirname(target) !== root) fail(CODES.PATH_INVALID, "只允许删除 storageRoot 下的工作区目录");
    try {
      await fsp.access(target);
    } catch {
      fail(CODES.INVALID_ARG, `工作区不存在：${workspaceId}`);
    }
    await fsp.rm(target, { recursive: true, force: true });
    for (const [key, store] of stores.entries()) {
      if (path.resolve(store.dataDir) === target) stores.delete(key);
    }
    return { removed: workspaceId };
  }

  /** POST /api/compass/rules/remove（§8.12 卸载清理 UI）。 */
  async function handleRemoveRules() {
    if (!deps.rulesPath) fail(CODES.INVALID_ARG, "宿主未提供规则文件路径，无法移除规则区块");
    return removeRuleBlock(deps.rulesPath);
  }

  /** POST /api/compass/uninstall（B-38 一键卸载：规则区块 + 全部工作区数据，损坏中止）。 */
  async function handleUninstall(body) {
    if (body?.confirm !== "UNINSTALL") fail(CODES.INVALID_ARG, '卸载必须显式传 confirm: "UNINSTALL"（强二次确认）');
    if (!deps.rulesPath) fail(CODES.INVALID_ARG, "宿主未提供规则文件路径，无法卸载");
    // 规则区块先删；损坏会抛错 ⇒ 整个卸载中止，不删任何工作区数据
    const rules = await removeRuleBlock(deps.rulesPath);
    let entries = [];
    try {
      entries = await fsp.readdir(storageRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const root = path.resolve(storageRoot);
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !WORKSPACE_ID_RE.test(entry.name)) continue;
      const target = path.resolve(path.join(storageRoot, entry.name));
      if (path.dirname(target) !== root) continue;
      await fsp.rm(target, { recursive: true, force: true });
      removed += 1;
    }
    stores.clear();
    return { rules: rules.status, workspaces_removed: removed };
  }

  /** GET /api/compass/export（A15/B-41）：只读下载整个任务板 bundle。 */
  async function handleExport(url) {
    const store = storeFor(url.searchParams.get("cwd"));
    const bundle = await buildBundle(store, { pluginVersion });
    const stamp = String(bundle.exported_at).replace(/[^0-9]/g, "").slice(0, 12);
    const safeName = String(bundle.workspace.name ?? "workspace").replace(/[\\/:*?"<>|]/g, "_");
    return { bundle, filename: `${safeName}-taskboard-${stamp}.json` };
  }

  /** POST /api/compass/import（A15/B-41）：只允许导入到空板，整段原子。 */
  async function handleImport(body) {
    const store = storeFor(body?.cwd);
    return importBundle(store, body?.bundle, { confirm: body?.confirm });
  }

  async function handleGetPrefs() {    const prefs = await readJsonFile(prefsPath(), { view: "current" });
    return { view: VIEWS.has(prefs?.view) ? prefs.view : "current" };
  }

  async function handlePutPrefs(body) {
    const view = String(body?.view ?? "current");
    if (!VIEWS.has(view)) {
      fail(CODES.INVALID_ARG, `view 非法：${view}`);
    }
    await writeJsonFileAtomic(prefsPath(), { view });
    return { ok: true };
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? "/api/compass", "http://localhost");
      const sub = url.pathname.replace(/^\/api\/compass\/?/, "/");
      const method = (req.method ?? "GET").toUpperCase();

      if (method === "GET" && sub === "/current") return send(res, 200, await handleCurrent(url));
      if (method === "GET" && sub === "/tree") return send(res, 200, await handleTree(url));
      if (method === "GET" && sub === "/detail") return send(res, 200, await handleDetail(url));
      if (method === "GET" && sub === "/baseline") return send(res, 200, await handleBaseline(url));
      if (method === "GET" && sub === "/status") return send(res, 200, await handleStatus(url));
      if (method === "GET" && sub === "/session-links") return send(res, 200, await handleSessionLinks(url));
      if (method === "GET" && sub === "/session-turn") return send(res, 200, await handleSessionTurn(url));
      if (method === "GET" && sub === "/history-summary") return send(res, 200, await handleHistorySummary(url));
      if (method === "GET" && sub === "/workspaces") return send(res, 200, await handleWorkspaces(url));
      if (method === "POST" && sub === "/workspaces/remove") return send(res, 200, await handleRemoveWorkspace(await readBody(req)));
      if (method === "POST" && sub === "/rules/remove") return send(res, 200, await handleRemoveRules());
      if (method === "POST" && sub === "/uninstall") return send(res, 200, await handleUninstall(await readBody(req)));
      if (method === "GET" && sub === "/export") {
        const { bundle, filename } = await handleExport(url);
        const asciiName = filename.replace(/[^ -~]/g, "_").replace(/["\\]/g, "_");
        return send(res, 200, bundle, {
          "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
        });
      }
      if (method === "POST" && sub === "/import") return send(res, 200, await handleImport(await readBody(req)));
      if (method === "POST" && sub === "/note") return send(res, 200, await handleNote(await readBody(req)));
      if (method === "POST" && sub === "/discard") return send(res, 200, await handleDiscard(await readBody(req)));
      if (method === "POST" && sub === "/restore") return send(res, 200, await handleRestore(await readBody(req)));
      if (method === "POST" && sub === "/purge") return send(res, 200, await handlePurge(await readBody(req)));
      if (method === "POST" && sub === "/file-exists") return send(res, 200, await handleFileExists(await readBody(req)));
      if (method === "GET" && sub === "/ui-state") return send(res, 200, await handleGetUiState(url));
      if (method === "PUT" && sub === "/ui-state") return send(res, 200, await handlePutUiState(await readBody(req)));
      if (method === "GET" && sub === "/prefs") return send(res, 200, await handleGetPrefs());
      if (method === "PUT" && sub === "/prefs") return send(res, 200, await handlePutPrefs(await readBody(req)));

      return send(res, 404, { error: { code: "E_NOT_FOUND", message: `unknown route: ${method} ${sub}` } });
    } catch (err) {
      const status = statusOf(err);
      const code = isCompassError(err) ? err.code : "E_INTERNAL";
      const message = err instanceof Error ? err.message : String(err);
      return send(res, status, { error: { code, message, details: isCompassError(err) ? err.details : undefined } });
    }
  };

  const dispose = webServer.register({ kind: "prefix", path: "/api/compass", handler });
  return () => dispose?.();
}

export default registerCompassRoutes;
