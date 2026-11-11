import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { hashPath, resolveWorkspacePath, sanitizeWorkspaceName, workspaceDirName } from "../src/core/paths.js";

test("resolveWorkspacePath：统一斜杠、去尾斜杠、盘符大写", () => {
  const p = resolveWorkspacePath("D:\\work\\demo\\");
  assert.equal(p, "D:/work/demo");
});

test("hashPath：8 位小写 hex，且大小写不同的同一路径得到同一 hash", () => {
  const a = hashPath(resolveWorkspacePath("D:/work/demo"));
  const b = hashPath("d:/WORK/DEMO");
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, b);
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
