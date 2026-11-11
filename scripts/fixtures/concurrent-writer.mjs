/**
 * 跨进程并发写夹具（lock.test.js 用）：
 * node concurrent-writer.mjs <dataDir> <workspacePath> <parentId> <count> <prefix>
 * 连续建 count 个任务；每个 plan 都是一次独立的「读-改-写」，用于验证跨进程写锁。
 */

import path from "node:path";

import { Store } from "../../src/core/store.js";
import { createCompass } from "../../src/core/tools.js";

const [dataDir, workspacePath, parentId, countRaw, prefix] = process.argv.slice(2);
const count = Number(countRaw);
if (!dataDir || !workspacePath || !parentId || !Number.isInteger(count) || count <= 0) {
  console.error("usage: concurrent-writer.mjs <dataDir> <workspacePath> <parentId> <count> <prefix>");
  process.exit(2);
}
if (!prefix) {
  console.error("prefix required");
  process.exit(2);
}

const store = new Store({ dataDir, workspacePath: path.resolve(workspacePath) });
const compass = createCompass({ store, sessionId: `s-${prefix}` });

let created = 0;
for (let i = 0; i < count; i += 1) {
  await compass.plan({ parent_id: parentId, title: `${prefix}-${i}`, human_line: `${prefix} 任务 ${i}` });
  created += 1;
}
console.log(`created ${created}`);
