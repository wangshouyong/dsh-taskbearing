/**
 * 存储层：工作区数据目录、原子写、串行队列、schema 校验。
 * 设计契约：docs/schema-v2.md §4.7 / §4.8。
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { emptyBaseline, parseBaseline, serializeBaseline, validateModel } from "./baseline.js";
import { CODES, CompassError, fail } from "./errors.js";
import { assertId } from "./ids.js";
import { WriteLock } from "./lock.js";
import { resolveWorkspacePath, workspaceDirName } from "./paths.js";
import { TREE_SCHEMA, emptyTree, validateTree } from "./tree.js";

export const META_SCHEMA = 1;
export const PLUGIN_NAME = "dsh-compass";
export const DEFAULT_QUEUE_LIMIT = 32;

/**
 * @typedef {Object} StoreOptions
 * @property {string} dataDir 工作区数据目录（绝对路径）
 * @property {string} workspacePath 规范化后的工作区路径
 * @property {string} [workspaceName] 工作区展示名
 * @property {number} [queueLimit] 写队列上限
 * @property {string} [pluginVersion] 插件版本（写入 meta）
 * @property {Partial<{staleMs: number, heartbeatMs: number, acquireTimeoutMs: number, retryMs: number}>} [lock]
 *   跨进程写锁参数（测试可调小；默认见 lock.js）
 */

export class Store {
  /**
   * @param {StoreOptions} options
   */
  constructor(options) {
    if (!options?.dataDir) throw new Error("Store 需要 dataDir");
    this.dataDir = options.dataDir;
    this.workspacePath = options.workspacePath;
    this.workspaceName = options.workspaceName ?? "workspace";
    this.queueLimit = options.queueLimit ?? DEFAULT_QUEUE_LIMIT;
    this.pluginVersion = options.pluginVersion ?? "0.1.0";
    this.lockOptions = options.lock ?? {};

    this._tail = Promise.resolve();
    this._pending = 0;
    /** 读入时的文件版本（mtime+size），写回前校验；null = 期望文件不存在 */
    this._versions = { tree: undefined, baseline: undefined };
  }

  /**
   * 按工作区构造 Store：数据固定在 storageRoot 下，目录名 = <工作区名>-<hash>。
   * @param {{storageRoot: string, workspacePath: string, workspaceName?: string, queueLimit?: number, pluginVersion?: string}} input
   */
  static forWorkspace(input) {
    const normalized = resolveWorkspacePath(input.workspacePath);
    const dirName = workspaceDirName(normalized, input.workspaceName);
    const name = input.workspaceName ?? path.posix.basename(normalized) ?? "workspace";
    return new Store({
      dataDir: path.join(input.storageRoot, dirName),
      workspacePath: normalized,
      workspaceName: name,
      queueLimit: input.queueLimit,
      pluginVersion: input.pluginVersion
    });
  }

  get workspaceId() {
    return path.basename(this.dataDir);
  }

  get metaPath() {
    return path.join(this.dataDir, "meta.json");
  }

  get treePath() {
    return path.join(this.dataDir, "tasks", "tree.json");
  }

  get baselinePath() {
    return path.join(this.dataDir, "baseline.md");
  }

  get detailsDir() {
    return path.join(this.dataDir, "tasks", "details");
  }

  /** @param {string} id */
  detailPath(id) {
    assertId(id);
    return path.join(this.detailsDir, `${id}.md`);
  }

  /** @param {string} id */
  notePath(id) {
    assertId(id);
    return path.join(this.detailsDir, `${id}.note.md`);
  }

  /**
   * 串行执行：同一时刻至多一个写操作（进程内队列 + 跨进程写锁）。
   * 队列超限抛 E_BUSY；锁获取超时抛 E_LOCK_BUSY。
   * 注意：**不可重入**（run 内不要再调 run / init）。
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(fn) {
    if (this._pending >= this.queueLimit) {
      fail(CODES.BUSY, `写队列已满（${this.queueLimit}），请稍后重试`);
    }
    this._pending += 1;
    const previous = this._tail;
    /** @type {() => void} */
    let release = () => {};
    this._tail = new Promise((resolve) => {
      release = resolve;
    });
    try {
      try {
        await previous;
      } catch {
        // 前序失败不影响后续任务
      }
      const lock = new WriteLock(this.dataDir, this.lockOptions);
      const unlock = await lock.acquire();
      try {
        return await fn();
      } finally {
        await unlock();
      }
    } finally {
      this._pending -= 1;
      release();
    }
  }

  async exists() {
    try {
      await fs.promises.access(this.metaPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 初始化（幂等）：建目录 + meta.json + 空 tree + 空 baseline。
   * @returns {Promise<{created: boolean}>}
   */
  async init() {
    return this.run(async () => {
      if (await this.exists()) {
        const meta = await this.readMeta();
        if (meta.original_path !== this.workspacePath) {
          fail(
            CODES.WORKSPACE_MISMATCH,
            `工作区目录与既有数据不匹配：数据记录的是 ${meta.original_path}，当前是 ${this.workspacePath}`,
            { recorded: meta.original_path, current: this.workspacePath }
          );
        }
        return { created: false };
      }
      await fs.promises.mkdir(path.join(this.dataDir, "tasks", "details"), { recursive: true });
      await this.writeMeta({
        schema: META_SCHEMA,
        plugin: PLUGIN_NAME,
        workspace_name: this.workspaceName,
        original_path: this.workspacePath,
        path_hash: path.basename(this.dataDir).split("-").pop(),
        created_at: new Date().toISOString(),
        plugin_version: this.pluginVersion
      });
      await this.writeTree(emptyTree());
      await this.writeBaseline(emptyBaseline());
      return { created: true };
    });
  }

  /** @returns {Promise<any>} */
  async readMeta() {
    const text = await this._readFile(this.metaPath, null);
    if (text === null) fail(CODES.NOT_INITIALIZED, "任务板尚未初始化（缺少 meta.json），请先调用 compass_init");
    let meta;
    try {
      meta = JSON.parse(text);
    } catch {
      fail(CODES.STORE_CORRUPT, "meta.json 不是合法 JSON");
    }
    if (typeof meta.schema === "number" && meta.schema > META_SCHEMA) {
      fail(CODES.SCHEMA_VERSION, `meta.json schema=${meta.schema} 高于当前插件支持的 ${META_SCHEMA}，请升级插件`);
    }
    return meta;
  }

  /** @param {any} meta */
  async writeMeta(meta) {
    await this._writeFileAtomic(this.metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }

  /**
   * 读整棵树并校验不变量；未初始化抛 E_NOT_INITIALIZED。
   * 同时记录文件版本（mtime+size），供写回前的乐观校验使用。
   * @returns {Promise<any>}
   */
  async readTree() {
    const snapshot = await this._readSnapshot(this.treePath);
    this._versions.tree = snapshot.version;
    if (snapshot.text === null) {
      fail(CODES.NOT_INITIALIZED, "任务树不存在，请先调用 compass_init");
    }
    let tree;
    try {
      tree = JSON.parse(snapshot.text);
    } catch {
      fail(CODES.STORE_CORRUPT, "tree.json 不是合法 JSON");
    }
    return validateTree(tree);
  }

  /** @param {any} tree */
  async writeTree(tree) {
    validateTree(tree);
    await this._assertUnchanged("tree.json", this.treePath, this._versions.tree);
    await this._writeFileAtomic(this.treePath, `${JSON.stringify(tree, null, 2)}\n`);
    this._versions.tree = await this._currentVersion(this.treePath);
  }

  /**
   * @returns {Promise<{raw: string, model: any}>}
   */
  async readBaseline() {
    const snapshot = await this._readSnapshot(this.baselinePath);
    this._versions.baseline = snapshot.version;
    const raw = snapshot.text ?? "";
    return { raw, model: parseBaseline(raw) };
  }

  /** @param {any} model */
  async writeBaseline(model) {
    validateModel(model);
    await this._assertUnchanged("baseline.md", this.baselinePath, this._versions.baseline);
    await this._writeFileAtomic(this.baselinePath, serializeBaseline(model));
    this._versions.baseline = await this._currentVersion(this.baselinePath);
  }

  /** @param {string} id @returns {Promise<string>} */
  async readDetail(id) {
    return (await this._readFile(this.detailPath(id), "")) ?? "";
  }

  /** @param {string} id @param {string} content */
  async writeDetail(id, content) {
    await this._writeFileAtomic(this.detailPath(id), String(content ?? ""));
  }

  /** @param {string} id @returns {Promise<string>} */
  async readNote(id) {
    return (await this._readFile(this.notePath(id), "")) ?? "";
  }

  /** @param {string} id @param {string} content */
  async writeNote(id, content) {
    await this._writeFileAtomic(this.notePath(id), String(content ?? ""));
  }

  /**
   * 一致性自检：需求层节点集合 与 baseline 需求集合 应完全一致。
   * @returns {Promise<{ok: boolean, missingInTree: string[], missingInBaseline: string[]}>}
   */
  async verifyConsistency() {
    const tree = await this.readTree();
    const { model } = await this.readBaseline();
    const treeReqIds = new Set(
      (tree.root.children ?? []).filter((node) => node.kind === "requirement").map((node) => node.id)
    );
    const baseReqIds = new Set(model.requirements.map((req) => req.id));
    const missingInTree = [...baseReqIds].filter((id) => !treeReqIds.has(id));
    const missingInBaseline = [...treeReqIds].filter((id) => !baseReqIds.has(id));
    return { ok: missingInTree.length === 0 && missingInBaseline.length === 0, missingInTree, missingInBaseline };
  }

  /** @param {string|number} schemaVersion */
  static checkTreeSchema(schemaVersion) {
    if (typeof schemaVersion === "number" && schemaVersion > TREE_SCHEMA) {
      fail(CODES.SCHEMA_VERSION, `tree.json schema=${schemaVersion} 高于当前插件支持的 ${TREE_SCHEMA}，请升级插件`);
    }
  }

  /**
   * 一致快照：stat 与内容取自同一文件句柄，避免「读到旧内容却记下新 mtime」。
   * @param {string} file
   * @returns {Promise<{text: string|null, version: {mtimeMs: number, size: number}|null}>}
   */
  async _readSnapshot(file) {
    let handle;
    try {
      handle = await fs.promises.open(file, "r");
    } catch (err) {
      if (err?.code === "ENOENT") return { text: null, version: null };
      throw new CompassError(CODES.WRITE_FAILED, `读取失败：${file}（${err?.message ?? err}）`);
    }
    try {
      const stat = await handle.stat();
      const text = await handle.readFile({ encoding: "utf8" });
      return { text, version: { mtimeMs: stat.mtimeMs, size: stat.size } };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  /**
   * @param {string} file
   * @returns {Promise<{mtimeMs: number, size: number}|null>} 文件不存在返回 null
   */
  async _currentVersion(file) {
    try {
      const stat = await fs.promises.stat(file);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch (err) {
      if (err?.code === "ENOENT") return null;
      throw new CompassError(CODES.WRITE_FAILED, `读取失败：${file}（${err?.message ?? err}）`);
    }
  }

  /**
   * 多文件事务预检（B-39）：在写任何文件之前，确认本次读入的 tree/baseline 均未被他人改动。
   * 用于一次操作要写两个文件（如 require 写 tree + baseline），避免「第一个文件已写、第二个冲突」留下半套数据。
   */
  async assertUnchanged() {
    await this._assertUnchanged("tree.json", this.treePath, this._versions.tree);
    await this._assertUnchanged("baseline.md", this.baselinePath, this._versions.baseline);
  }

  /**
   * 写回前的乐观版本校验（B-39）：文件在本次读入后未被其它写者改动。
   * expected === undefined 表示本次没有读入期望（如初始化首写），跳过校验。
   * @param {string} name
   * @param {string} file
   * @param {{mtimeMs: number, size: number}|null|undefined} expected
   */
  async _assertUnchanged(name, file, expected) {
    if (expected === undefined) return;
    const actual = await this._currentVersion(file);
    const same =
      expected === null
        ? actual === null
        : actual !== null && actual.mtimeMs === expected.mtimeMs && actual.size === expected.size;
    if (!same) {
      fail(
        CODES.CONFLICT,
        `写回冲突：${name} 在本次操作期间被其它写者改动（多窗口并发），本操作未覆盖对方数据，请重试`,
        { file, expected, actual }
      );
    }
  }

  /** @param {string} file @param {string|null} fallback */
  async _readFile(file, fallback) {
    try {
      return await fs.promises.readFile(file, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return fallback;
      throw new CompassError(CODES.WRITE_FAILED, `读取失败：${file}（${err?.message ?? err}）`);
    }
  }

  /**
   * 原子写：临时文件 + fsync + rename；失败清理临时文件并抛 E_WRITE_FAILED。
   * @param {string} file
   * @param {string} content
   */
  async _writeFileAtomic(file, content) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    let handle;
    try {
      handle = await fs.promises.open(tmp, "w");
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.promises.rename(tmp, file);
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      fail(CODES.WRITE_FAILED, `写入失败：${file}（${err?.message ?? err}）`);
    }
  }
}
