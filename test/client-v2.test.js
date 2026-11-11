/**
 * v2.0 客户端纯逻辑（B-45 ~ B-48）：阻塞态视图/徽标、撞车判定与签名、文件锚点。
 * 变更流展示测试已随全局时间线移除（v1.24，B-46 废止）。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  badgesFor,
  collisionOf,
  collisionTitle,
  countDescendants,
  countTreeByExec,
  formatCounts,
  isVisible,
  rowSignature,
  visibleRows
} from "../src/client/board-view.js";
import { describeApiError } from "../src/client/api.js";
import {
  extractFileAnchors,
  fileAddressFor,
  isAbsoluteWorkspacePath,
  sessionFileAddress
} from "../src/client/file-anchor.js";
import { shortSessionId } from "../src/client/pointer-view.js";

const SID = "session-aaaaaaaa-1111-2222-3333-444455556666";
const OTHER = "session-bbbbbbbb-1111-2222-3333-444455556666";

function node(id, overrides = {}) {
  return {
    id,
    kind: "task",
    title: `t-${id}`,
    human_line: `h-${id}`,
    exec_state: "未开始",
    verdict_state: null,
    dead_reason: null,
    merged_into: null,
    pointers: [],
    children: [],
    ...overrides
  };
}

function tree() {
  return {
    schema: 1,
    root: {
      id: "ROOT",
      kind: "project",
      children: [
        {
          id: "R-001",
          kind: "requirement",
          title: "需求",
          human_line: "需求",
          exec_state: "进行中",
          verdict_state: null,
          dead_reason: null,
          merged_into: null,
          pointers: [],
          children: [node("R-001-T-1"), node("R-001-T-2", { verdict_state: "已废弃", dead_reason: "不做" })]
        }
      ]
    }
  };
}

test("已阻塞：三视图可见性、徽标、计数、状态条全树计数（A30）", () => {
  const blocked = node("R-001-T-3", { exec_state: "已阻塞" });
  assert.equal(isVisible(blocked, "current"), true);
  assert.equal(isVisible(blocked, "active"), true, "只看在动必须包含阻塞（需要人工介入）");
  assert.equal(isVisible(blocked, "all"), true);
  assert.deepEqual(badgesFor(blocked)[0], { label: "已阻塞", tone: "yellow" });

  const requirement = tree().root.children[0];
  requirement.children.push(blocked);
  const counts = countDescendants(requirement);
  assert.equal(counts.blocked, 1);
  assert.match(formatCounts(counts), /已阻塞 1/);
  const rows = visibleRows(
    { schema: 1, root: { id: "ROOT", children: [requirement] } },
    "active",
    { "R-001": true }
  );
  assert.ok(rows.some((row) => row.node.id === "R-001-T-3"), "阻塞节点在只看在动中可见");
  const byExec = countTreeByExec({ root: { id: "ROOT", children: [requirement] } });
  assert.equal(byExec["已阻塞"], 1);
});

test("撞车警示（v1.22 重构）：仅近期活跃、跨会话、非终态才报（A32）", () => {
  const NOW = Date.parse("2026-11-11T12:10:00.000Z");
  const pointerOf = (session, minutesAgo = 5, note = "改动") => ({
    session,
    at: new Date(NOW - minutesAgo * 60 * 1000).toISOString(),
    note
  });
  const opts = { now: NOW };

  assert.equal(collisionOf(node("x"), SID, opts), null, "无 pointer 不报");
  assert.equal(collisionOf(node("x", { pointers: [pointerOf(OTHER)] }), null, opts), null, "当前会话未知不报");
  assert.equal(collisionOf(node("x", { pointers: [pointerOf(OTHER)] }), "", opts), null);
  assert.equal(collisionOf(node("x", { pointers: [pointerOf(SID)] }), SID, opts), null, "同一会话不报");

  assert.equal(collisionOf(node("x", { exec_state: "已执行", pointers: [pointerOf(OTHER)] }), SID, opts), null);
  assert.equal(collisionOf(node("x", { exec_state: "未开始", pointers: [pointerOf(OTHER)] }), SID, opts), null);
  assert.equal(collisionOf(node("x", { exec_state: "进行中", pointers: [pointerOf(OTHER, 31)] }), SID, opts), null);
  assert.equal(
    collisionOf(node("x", { exec_state: "进行中", verdict_state: "已废弃", pointers: [pointerOf(OTHER)] }), SID, opts),
    null
  );

  const active = collisionOf(node("x", { exec_state: "进行中", pointers: [pointerOf(OTHER, 5, "改接口")] }), SID, opts);
  assert.equal(active.session, OTHER);
  assert.equal(active.note, "改接口");
  assert.equal(active.minutesAgo, 5);
  assert.equal(collisionTitle(active), "⚠️ 另一会话在 5 分钟前正在操作此任务");
  assert.equal(collisionOf(node("x", { exec_state: "已阻塞", pointers: [pointerOf(OTHER, 0)] }), SID, opts).minutesAgo, 0);
  assert.equal(
    collisionTitle(collisionOf(node("x", { exec_state: "进行中", pointers: [pointerOf(OTHER, 0)] }), SID, opts)),
    "⚠️ 另一会话刚刚正在操作此任务"
  );

  const row = {
    node: node("x", { exec_state: "进行中", pointers: [pointerOf(OTHER)] }),
    depth: 0,
    hasChildren: false,
    expanded: false
  };
  const sigCollision = rowSignature(row, { currentSessionId: SID, now: NOW });
  assert.notEqual(rowSignature(row, { now: NOW }), sigCollision);
  assert.match(sigCollision, /session-bbbbbbbb/);
});

test("文件锚点：识别/去重/行号/排除 URL 与纯包名（A31）", () => {
  const text = [
    "改动：`src/api/user.ts:12` 和 src/api/user.ts:12（重复）",
    "依赖 `docs/contract-v1.md`。",
    "见 https://example.com/src/api/user.ts 不是文件。",
    "```",
    "src/server/app.mjs",
    "```",
    "还有 D:\\work\\repo\\README.md 与 package.json（无分隔符不识别）。",
    "超长路径：" + "a/".repeat(120) + "x.ts"
  ].join("\n");
  const anchors = extractFileAnchors(text);
  const paths = anchors.map((anchor) => `${anchor.path}${anchor.line ? `:${anchor.line}` : ""}`);
  assert.ok(paths.includes("src/api/user.ts:12"), "代码段内路径 + 行号");
  assert.ok(paths.includes("docs/contract-v1.md"), "反引号内文档");
  assert.ok(paths.includes("src/server/app.mjs"), "围栏代码块内路径");
  assert.ok(paths.some((path) => path.includes("D:/work/repo/README.md")), "Windows 绝对路径归一为正斜杠");
  assert.equal(paths.filter((path) => path.startsWith("src/api/user.ts")).length, 1, "去重");
  assert.ok(!paths.some((path) => path.includes("example.com")), "排除 URL");
  assert.ok(!paths.includes("package.json"), "无分隔符普通文件名不识别");
  assert.ok(!paths.some((path) => path.length > 200), "超长串排除");
});

test("文件地址：session 地址编码（逐段/冒号字面）与 cwd 相对化（SP-10）", () => {
  assert.equal(
    sessionFileAddress(SID, "src/api/user.ts"),
    `dsh-resource://file/session/${encodeURIComponent(SID)}/src/api/user.ts`
  );
  assert.equal(
    sessionFileAddress(SID, "D:\\work space\\a b.ts"),
    `dsh-resource://file/session/${encodeURIComponent(SID)}/D:/work%20space/a%20b.ts`,
    "盘符冒号保留字面、空格编码"
  );
  assert.equal(isAbsoluteWorkspacePath("D:\\x\\y.ts"), true);
  assert.equal(isAbsoluteWorkspacePath("src/y.ts"), false);
  const relative = fileAddressFor(SID, "D:\\work\\repo", "D:\\work\\repo\\src\\a.ts");
  assert.equal(relative, `dsh-resource://file/session/${encodeURIComponent(SID)}/src/a.ts`);
  const outside = fileAddressFor(SID, "D:\\work\\repo", "D:\\other\\a.ts");
  assert.ok(outside.includes("/D:/other/a.ts"));
  // 相对路径不依赖 cwd
  assert.equal(fileAddressFor(SID, null, "src/a.ts"), sessionFileAddress(SID, "src/a.ts"));
});

test("旧宿主缺路由：E_NOT_FOUND / 404 转为可读提示（B-55）", () => {
  const outdated = describeApiError({ code: "E_NOT_FOUND", message: "unknown route: GET /workspaces" }, 404);
  assert.equal(outdated.code, "E_HOST_OUTDATED");
  assert.match(outdated.message, /旧版宿主/);
  assert.match(outdated.message, /重启 DSH/);
  assert.doesNotMatch(outdated.message, /unknown route/);

  const plain404 = describeApiError({}, 404);
  assert.equal(plain404.code, "E_HOST_OUTDATED");

  const other = describeApiError({ code: "E_INVALID_ARG", message: "cwd 非法" }, 400);
  assert.equal(other.code, "E_INVALID_ARG");
  assert.match(other.message, /E_INVALID_ARG: cwd 非法/);
});
