import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { hashPath, resolveWorkspacePath, sanitizeWorkspaceName, workspaceDirName } from "../src/core/paths.js";

// 平台差异（P1：曾导致 npm publish 工作流 gate 在 ubuntu 上失败）：
// - 盘符语义只有 Windows 有；POSIX 上 "D:\..." 是相对路径，path.resolve 会拼上 cwd。
// - hash 只在大小写不敏感平台（win32 / darwin）统一小写，Linux 必须区分大小写。
const IS_WIN = process.platform === "win32";
const CASE_INSENSITIVE = IS_WIN || process.platform === "darwin";

test("resolveWorkspacePath：统一斜杠、去尾斜杠、盘符大写（按平台）", () => {
  const input = IS_WIN ? "d:\\work\\demo\\" : "/work/demo/";
  const expected = IS_WIN ? "D:/work/demo" : "/work/demo";
  assert.equal(resolveWorkspacePath(input), expected);
});

test("hashPath：8 位小写 hex，且大小写不同的同一路径在大小写不敏感平台得到同一 hash", () => {
  const base = IS_WIN ? "D:/work/demo" : "/work/demo";
  const upper = IS_WIN ? "d:/WORK/DEMO" : "/WORK/DEMO";
  const a = hashPath(resolveWorkspacePath(base));
  assert.match(a, /^[0-9a-f]{8}$/);
  if (CASE_INSENSITIVE) {
    assert.equal(hashPath(resolveWorkspacePath(upper)), a);
  } else {
    // Linux 大小写敏感：不同大小写是不同工作区，hash 必须不同（否则两份数据会互相覆盖）
    assert.notEqual(hashPath(upper), a);
  }
});

test("sanitizeWorkspaceName：非法字符替换、空名兜底", () => {
  assert.equal(sanitizeWorkspaceName('a/b:c*d?"e<f>g|h'), "a_b_c_d__e_f_g_h");
  assert.equal(sanitizeWorkspaceName("   "), "workspace");
  assert.equal(sanitizeWorkspaceName("x".repeat(60)).length, 40);
});

test("workspaceDirName：<名>-<hash>", () => {
  const normalized = resolveWorkspacePath("D:/work/demo");
  const dir = workspaceDirName(normalized, "plan");
  assert.equal(dir, `plan-${hashPath(normalized)}`);
  assert.equal(path.posix.basename(dir), dir);
});
