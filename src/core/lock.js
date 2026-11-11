/**
 * 跨进程写锁（B-39）：同一工作区的读-改-写在 Store.run 内持有 locks/write.lock。
 * 锁只是「降低冲突概率」的互斥优化；正确性由 Store 的乐观版本校验（mtime+size）兜底。
 *
 * 协议（契约 v1.18 §4.7）：
 * - 获取：open(lock, "wx") 原子创建，内容 {pid, hostname, token, acquired_at}；
 * - 判活：锁文件 mtime 心跳（持锁期间每 heartbeatMs utimes 一次），超过 staleMs 未心跳视为过期；
 * - 抢占：过期锁整份 rename 到 write.lock.stale-<ts>-<rand> 后重试创建（rename 成功者获得抢占权）；
 * - 释放：校验 token 一致后才删除，避免误删被抢占后的新锁；
 * - 超时：acquireTimeoutMs 内未取得 ⇒ E_LOCK_BUSY（可重试语义）。
 */

import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CODES, fail } from "./errors.js";

export const LOCK_DIR_NAME = "locks";
export const LOCK_FILE_NAME = "write.lock";

export const DEFAULT_LOCK_OPTIONS = Object.freeze({
  /** 多久没有心跳视为过期（毫秒） */
  staleMs: 10_000,
  /** 持锁期间心跳间隔（毫秒） */
  heartbeatMs: 2_000,
  /** 获取锁的最长等待（毫秒） */
  acquireTimeoutMs: 5_000,
  /** 竞争重试基础间隔（毫秒，含抖动） */
  retryMs: 25
});

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 锁文件路径（工作区数据目录下）。
 * @param {string} dataDir
 */
export function lockFilePath(dataDir) {
  return path.join(dataDir, LOCK_DIR_NAME, LOCK_FILE_NAME);
}

/**
 * 读取锁当前持有者信息（诊断/状态用；不修改任何东西）。
 * @param {string} dataDir
 * @returns {Promise<{held: boolean, path: string, owner: any|null, age_ms: number|null}>}
 */
export async function inspectLock(dataDir, options = {}) {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const file = lockFilePath(dataDir);
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return { held: false, path: file, owner: null, age_ms: null };
  }
  let owner = null;
  try {
    owner = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    owner = null;
  }
  const age = Date.now() - stat.mtimeMs;
  return { held: age <= opts.staleMs, path: file, owner, age_ms: age, stale: age > opts.staleMs };
}

/**
 * 跨进程写锁句柄。同一对象只 acquire 一次；用完必须 release。
 */
export class WriteLock {
  /**
   * @param {string} dataDir 工作区数据目录
   * @param {Partial<typeof DEFAULT_LOCK_OPTIONS>} [options]
   */
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.options = { ...DEFAULT_LOCK_OPTIONS, ...options };
    this.path = lockFilePath(dataDir);
    this.dir = path.dirname(this.path);
    this.token = `${process.pid}-${os.hostname()}-${randomBytes(6).toString("hex")}`;
    /** @type {ReturnType<typeof setInterval>|null} */
    this._timer = null;
    this._held = false;
  }

  /** @returns {Promise<() => Promise<void>>} release 函数（幂等） */
  async acquire() {
    const { staleMs, heartbeatMs, acquireTimeoutMs, retryMs } = this.options;
    const startedAt = Date.now();
    const deadline = startedAt + acquireTimeoutMs;
    await fsp.mkdir(this.dir, { recursive: true });
    // 顺手清理遗留的抢占残留（超过 1 小时），失败不影响获取
    await this._sweepStale(60 * 60 * 1000);

    for (;;) {
      const created = await this._tryCreate();
      if (created) break;

      const stat = await statOrNull(this.path);
      if (!stat) continue; // 刚被释放：立刻重试创建

      if (Date.now() - stat.mtimeMs > staleMs) {
        // 过期：rename 到唯一名（抢占权 = rename 成功）
        const grave = `${this.path}.stale-${Date.now()}-${randomBytes(3).toString("hex")}`;
        try {
          await fsp.rename(this.path, grave);
          await fsp.rm(grave, { force: true }).catch(() => {});
          continue;
        } catch {
          // 别的进程抢先移走/创建，继续循环
          continue;
        }
      }

      if (Date.now() >= deadline) {
        const owner = await readOwner(this.path);
        fail(
          CODES.LOCK_BUSY,
          `写锁被占用（${describeOwner(owner)}），${acquireTimeoutMs}ms 内未取得；请稍后重试`,
          { lock: this.path, owner, waited_ms: Date.now() - startedAt }
        );
      }
      await sleep(retryMs + Math.random() * retryMs);
    }

    this._held = true;
    this._timer = setInterval(() => {
      void this._heartbeat();
    }, heartbeatMs);
    this._timer.unref?.();

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await this._release();
    };
  }

  /** @returns {Promise<boolean>} */
  async _tryCreate() {
    let handle;
    try {
      handle = await fsp.open(this.path, "wx");
    } catch (err) {
      if (err?.code === "EEXIST") return false;
      fail(CODES.WRITE_FAILED, `创建写锁失败：${this.path}（${err?.message ?? err}）`);
    }
    try {
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          token: this.token,
          acquired_at: new Date().toISOString()
        }),
        "utf8"
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  }

  async _heartbeat() {
    if (!this._held) return;
    const now = new Date();
    try {
      await fsp.utimes(this.path, now, now);
    } catch {
      // 锁已被抢占/删除：下一次写回会由版本校验发现并报 E_CONFLICT
    }
  }

  async _release() {
    this._held = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    const owner = await readOwner(this.path);
    if (!owner || owner.token !== this.token) return; // 已被抢占：不删别人的锁
    await fsp.rm(this.path, { force: true }).catch(() => {});
  }

  /** @param {number} maxAgeMs */
  async _sweepStale(maxAgeMs) {
    let entries;
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return;
    }
    const now = Date.now();
    for (const name of entries) {
      if (!name.startsWith(`${LOCK_FILE_NAME}.stale-`)) continue;
      const file = path.join(this.dir, name);
      try {
        const stat = await fsp.stat(file);
        if (now - stat.mtimeMs > maxAgeMs) await fsp.rm(file, { force: true });
      } catch {
        // 忽略清理失败
      }
    }
  }
}

/** @param {string} file */
async function statOrNull(file) {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}

/** @param {string} file */
async function readOwner(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** @param {any} owner */
function describeOwner(owner) {
  if (!owner) return "未知进程";
  return `pid=${owner.pid ?? "?"} host=${owner.hostname ?? "?"} acquired_at=${owner.acquired_at ?? "?"}`;
}
