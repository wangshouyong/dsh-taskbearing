import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Store } from "../src/core/store.js";
import { createCompass } from "../src/core/tools.js";

/** 祖先链完成汇总标准文本（v1.31 / B-62）：父级、父级的父级、需求都要写这三段。 */
export const SUMMARY_DETAIL = "验收范围：该节点下全部任务与验收项\n完成结论：已完成并留证据\n遗留风险：无";

/** @param {string} id 祖先节点 id（需求或父任务） */
export function ancestorDetail(id) {
  return { [id]: SUMMARY_DETAIL };
}

/**
 * 建一个隔离的测试环境：临时 storage 根 + 临时工作区目录 + 固定时钟。
 * @param {{capture?: null | ((refs:any, ctx:any)=>Promise<any>), verify?: null | ((text:string, ctx:any)=>Promise<any>), sessionId?: string, turn?: number|null}} [opts]
 */
export async function makeEnv(opts = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-compass-test-"));
  const workspace = path.join(root, "ws");
  await fs.mkdir(workspace, { recursive: true });
  const storageRoot = path.join(root, "storages");
  const store = Store.forWorkspace({ storageRoot, workspacePath: workspace, workspaceName: "demo" });

  let clock = new Date("2026-11-11T14:31:07.000Z");
  const now = () => new Date(clock.getTime());
  const sessionId = opts.sessionId ?? "s-test";
  const turn = opts.turn === undefined ? 7 : opts.turn;
  const compass = createCompass({
    store,
    sessionId,
    turn,
    now,
    captureOriginal: opts.capture ?? null,
    verifyOriginal: opts.verify ?? null
  });

  return {
    root,
    workspace,
    storageRoot,
    store,
    compass,
    get now() {
      return new Date(clock.getTime());
    },
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

/**
 * 断言 promise 抛出指定 code 的 CompassError。
 * @param {Promise<any>} promise
 * @param {string} code
 */
export async function rejectsWith(promise, code) {
  try {
    await promise;
  } catch (err) {
    assert.equal(err?.code, code, `期望 ${code}，实际 ${err?.code}: ${err?.message}`);
    return err;
  }
  assert.fail(`期望抛出 ${code}，但成功返回`);
}
