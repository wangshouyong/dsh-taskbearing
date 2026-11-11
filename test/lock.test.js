/**
 * 跨进程写锁 + 乐观版本校验（B-39 / A26）测试。
 * 覆盖：获取/释放、排队等待、超时 E_LOCK_BUSY、过期抢占、token 释放保护、
 *       版本冲突 E_CONFLICT、多文件事务预检、同进程双实例并发、双进程并发。
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CODES } from "../src/core/errors.js";
import { WriteLock, inspectLock, lockFilePath } from "../src/core/lock.js";
import { Store } from "../src/core/store.js";
import { createCompass } from "../src/core/tools.js";
import { rejectsWith } from "./helpers.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "scripts", "fixtures", "concurrent-writer.mjs");

/** 快速锁参数：测试不等 5s/10s。 */
const FAST_LOCK = { staleMs: 400, heartbeatMs: 100, acquireTimeoutMs: 300, retryMs: 10 };

/**
 * @param {{storageRoot: string, workspacePath: string, lock?: any}} input
 */
function makeStore(input) {
  return Store.forWorkspace({
    storageRoot: input.storageRoot,
    workspacePath: input.workspacePath,
    workspaceName: "demo",
    lock: input.lock ?? FAST_LOCK
  });
}

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-compass-lock-"));
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const storageRoot = path.join(root, "storages");
  return { root, workspace, storageRoot, workspacePath: path.resolve(workspace) };
}

test("WriteLock：获取后写锁文件存在，释放后删除", async () => {
  const env = await makeRoot();
  try {
    const dataDir = path.join(env.storageRoot, "demo-lock");
    const lock = new WriteLock(dataDir, FAST_LOCK);
    const release = await lock.acquire();
    const file = lockFilePath(dataDir);
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(typeof raw.token, "string");
    assert.equal(raw.pid, process.pid);
    const inspected = await inspectLock(dataDir, FAST_LOCK);
    assert.equal(inspected.held, true);
    await release();
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
    // release 幂等
    await release();
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test("WriteLock：占用期间第二个获取者等待，释放后取得", async () => {
  const env = await makeRoot();
  try {
    const dataDir = path.join(env.storageRoot, "demo-wait");
    const first = new WriteLock(dataDir, { ...FAST_LOCK, acquireTimeoutMs: 2_000 });
    const releaseFirst = await first.acquire();
    const order = [];
    const second = new WriteLock(dataDir, { ...FAST_LOCK, acquireTimeoutMs: 2_000 });
    const pending = second.acquire().then(async (releaseSecond) => {
      order.push("second-acquired");
      await releaseSecond();
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(order, []);
    await releaseFirst();
    await pending;
    assert.deepEqual(order, ["second-acquired"]);
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test("WriteLock：锁被占用时超时返回 E_LOCK_BUSY（可重试语义）", async () => {
  const env = await makeRoot();
  try {
    const dataDir = path.join(env.storageRoot, "demo-timeout");
    const holder = new WriteLock(dataDir, { ...FAST_LOCK, acquireTimeoutMs: 2_000 });
    const releaseHolder = await holder.acquire();
    const contender = new WriteLock(dataDir, { ...FAST_LOCK, acquireTimeoutMs: 120 });
    const err = await rejectsWith(contender.acquire(), CODES.LOCK_BUSY);
    assert.equal(err.code, CODES.LOCK_BUSY);
    assert.ok(err.details?.owner?.pid === process.pid);
    await releaseHolder();
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test("WriteLock：过期锁可被抢占；被抢占者释放时不误删新锁", async () => {
  const env = await makeRoot();
  try {
    const dataDir = path.join(env.storageRoot, "demo-stale");
    const oldLock = new WriteLock(dataDir, FAST_LOCK);
    const releaseOld = await oldLock.acquire();
    const file = lockFilePath(dataDir);
    // 模拟持有者崩溃：把心跳时间倒推到过期
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(file, stale, stale);

    const taker = new WriteLock(dataDir, { ...FAST_LOCK, acquireTimeoutMs: 1_500 });
    const releaseTaker = await taker.acquire();
    const newOwner = JSON.parse(await fs.readFile(file, "utf8"));
    assert.notEqual(newOwner.token, oldLock.token, "抢占后锁持有者 token 必须变化");

    // 旧持有者迟到的 release 不能删掉新锁
    await releaseOld();
    const inspected = await inspectLock(dataDir, FAST_LOCK);
    assert.equal(inspected.held, true);
    assert.equal(inspected.owner.token, newOwner.token);
    await releaseTaker();
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test("Store：读入后被其它实例改动 ⇒ 写回 E_CONFLICT 且不覆盖对方数据", async () => {
  const env = await makeRoot();
  try {
    const storeA = makeStore(env);
    const storeB = makeStore(env);
    const compassA = createCompass({ store: storeA, sessionId: "s-a" });
    const compassB = createCompass({ store: storeB, sessionId: "s-b" });
    await compassA.init();
    await compassA.require({ title: "需求", human_line: "需求", surface: "需求" });

    const treeA = await storeA.readTree();
    const treeB = await storeB.readTree();
    treeB.root.children[0].children.push({
      id: "R-001-T-99",
      kind: "task",
      title: "B 写的",
      human_line: "B 写的",
      exec_state: "未开始",
      verdict_state: null,
      dead_reason: null,
      merged_into: null,
      pointers: [],
      children: []
    });
    await storeB.writeTree(treeB);

    treeA.root.children[0].children.push({ ...treeB.root.children[0].children[0], id: "R-001-T-98", title: "A 写的" });
    const err = await rejectsWith(storeA.writeTree(treeA), CODES.CONFLICT);
    assert.equal(err.details?.file, storeA.treePath);

    const disk = await storeA.readTree();
    const ids = disk.root.children[0].children.map((node) => node.id);
    assert.deepEqual(ids, ["R-001-T-99"], "A 的冲突写不得覆盖 B 的节点");
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test("Store.assertUnchanged：多文件事务在写第一个文件前即拒绝", async () => {
  const env = await makeRoot();
  try {
    const storeA = makeStore(env);
    const storeB = makeStore(env);
    const compassA = createCompass({ store: storeA, sessionId: "s-a" });
    const compassB = createCompass({ store: storeB, sessionId: "s-b" });
    await compassA.init();
    await compassA.require({ title: "事务需求", human_line: "事务需求", surface: "事务需求" });

    // A 读入两个文件（模拟一次多文件事务的开始）
    await storeA.readTree();
    await storeA.readBaseline();
    // B 在 A 的读-改-写之间改了 baseline（第二个文件）
    await compassB.change({ requirement_id: "R-001", new_text: "新明面", reason: "并发改动" });
    // A 在写任何文件之前必须发现冲突
    await rejectsWith(storeA.assertUnchanged(), CODES.CONFLICT);
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test("同进程两个 Store 实例并发建任务：40 个节点全部落盘、ID 唯一", async () => {
  const env = await makeRoot();
  try {
    const storeA = makeStore(env);
    const storeB = makeStore(env);
    const compassA = createCompass({ store: storeA, sessionId: "s-a" });
    const compassB = createCompass({ store: storeB, sessionId: "s-b" });
    await compassA.init();
    await compassA.require({ title: "并发需求", human_line: "并发需求", surface: "并发需求" });

    const tasks = [];
    for (let i = 0; i < 20; i += 1) {
      tasks.push(compassA.plan({ parent_id: "R-001", title: `A-${i}`, human_line: `A ${i}` }));
      tasks.push(compassB.plan({ parent_id: "R-001", title: `B-${i}`, human_line: `B ${i}` }));
    }
    const results = await Promise.all(tasks);
    assert.equal(results.length, 40);

    const tree = await storeA.readTree();
    const children = tree.root.children[0].children;
    assert.equal(children.length, 40);
    assert.equal(new Set(children.map((node) => node.id)).size, 40);
    assert.equal(new Set(children.map((node) => node.title)).size, 40);
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test("跨进程两个子进程并发写同一工作区：40 个节点全部落盘", async () => {
  const env = await makeRoot();
  try {
    const store = makeStore(env);
    const compass = createCompass({ store, sessionId: "s-main" });
    await compass.init();
    await compass.require({ title: "跨进程需求", human_line: "跨进程需求", surface: "跨进程需求" });

    /** @param {string} prefix */
    const runChild = (prefix) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [FIXTURE, store.dataDir, store.workspacePath, "R-001", "20", prefix],
          { stdio: ["ignore", "pipe", "pipe"] }
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => {
          out += chunk;
        });
        child.stderr.on("data", (chunk) => {
          err += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) reject(new Error(`child ${prefix} exit ${code}: ${err || out}`));
          else resolve(out.trim());
        });
      });

    const [outA, outB] = await Promise.all([runChild("P1"), runChild("P2")]);
    assert.match(outA, /created 20/);
    assert.match(outB, /created 20/);

    const tree = await store.readTree();
    const children = tree.root.children[0].children;
    assert.equal(children.length, 40);
    assert.equal(new Set(children.map((node) => node.id)).size, 40);
    assert.equal(children.filter((node) => node.title.startsWith("P1-")).length, 20);
    assert.equal(children.filter((node) => node.title.startsWith("P2-")).length, 20);
  } finally {
    await fs.rm(env.root, { recursive: true, force: true });
  }
});
