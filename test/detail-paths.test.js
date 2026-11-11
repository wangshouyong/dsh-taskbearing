/**
 * detail 路径存在性强校验（B-57，v1.26）：工具层写 detail 前 fs.existsSync 检查，
 * 缺失即拒绝并给出整改指引；识别规则与 UI 锚点共用 core/file-paths。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { extractFileAnchors } from "../src/core/file-paths.js";
import { checkDetailPaths, detailPathErrorMessage } from "../src/core/detail-path-guard.js";
import { makeEnv, rejectsWith } from "./helpers.js";

test("checkDetailPaths：相对/绝对/行号/目录/通配符/URL 的判定（B-57）", async () => {
  const env = await makeEnv();
  try {
    await fs.mkdir(path.join(env.workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(env.workspace, "src", "real.ts"), "export {};", "utf8");
    const realAbs = path.join(env.workspace, "src", "real.ts").replace(/\\/g, "/");

    const text = [
      "核心文件：`src/real.ts:12`（相对，存在）",
      `绝对：\`${realAbs}\`（存在）`,
      "目录：`src`（存在，非文件也放行）",
      "缺失：`src/ghost.ts`（不存在）",
      "通配：`src/**/*.ts`（跳过校验）",
      "URL：https://example.com/a.ts（识别层已排除）"
    ].join("\n");

    const { checked, missing } = checkDetailPaths(text, env.workspace);
    const byPath = Object.fromEntries(checked.map((entry) => [entry.path, entry]));
    assert.equal(byPath["src/real.ts"].exists, true);
    assert.equal(byPath[realAbs].exists, true, "绝对路径按原样检查");
    assert.equal(byPath["src"], undefined, "目录不识别为文件锚点（识别要求扩展名）");
    assert.equal(byPath["src/ghost.ts"].exists, false);
    assert.deepEqual(missing.map((entry) => entry.path), ["src/ghost.ts"]);
    assert.equal(checked.some((entry) => entry.path.includes("example.com")), false, "URL 不进锚点");

    const wildcard = checkDetailPaths("未来文件：`src/**/*.ts`", env.workspace);
    assert.equal(wildcard.missing.length, 0, "通配符跳过校验");

    const empty = checkDetailPaths("没有路径，只有文字。", env.workspace);
    assert.equal(empty.checked.length, 0);
    assert.equal(empty.missing.length, 0);
  } finally {
    await env.cleanup();
  }
});

test("detailPathErrorMessage：结论 + 缺失清单 + 整改指引（固定格式）", () => {
  const message = detailPathErrorMessage([{ path: "src/api/user.ts" }]);
  assert.match(message, /^\[Error\] 详情写入被拒绝。/);
  assert.match(message, /原因：检测到详情内容中包含不存在的文件路径 "src\/api\/user\.ts"。/);
  assert.match(message, /建议操作：请使用终端命令或文件工具核实当前工作区的真实文件结构/);
  assert.match(message, /严禁捏造路径。/);

  const multi = detailPathErrorMessage([{ path: "a.ts" }, { path: "b.ts" }]);
  assert.match(multi, /2 个不存在的文件路径：\"a\.ts\"、\"b\.ts\"/);
});

test("compass_plan：detail 含缺失路径 ⇒ E_DETAIL_PATH_NOT_FOUND 且节点不建（A40）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
    const before = await env.store.readTree();

    const err = await rejectsWith(
      env.compass.plan({
        parent_id: "R-001",
        title: "任务",
        human_line: "任务",
        detail: "核心文件：`src/api/user.ts`\n契约/文档：无\n避坑指南：无"
      }),
      "E_DETAIL_PATH_NOT_FOUND"
    );
    assert.match(err.message, /详情写入被拒绝/);
    assert.deepEqual(err.details.missing_paths, ["src/api/user.ts"]);
    const after = await env.store.readTree();
    assert.deepEqual(after, before, "节点未建、树未变");

    await fs.mkdir(path.join(env.workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(env.workspace, "src", "real.ts"), "x", "utf8");
    const ok = await env.compass.plan({
      parent_id: "R-001",
      title: "任务2",
      human_line: "任务2",
      detail: "核心文件：`src/real.ts`\n契约/文档：无\n避坑指南：无"
    });
    assert.equal(ok.task_id, "R-001-T-1");
    const detail = await env.store.readDetail("R-001-T-1");
    assert.match(detail, /src\/real\.ts/);
  } finally {
    await env.cleanup();
  }
});

test("compass_update：detail 含缺失路径 ⇒ 拒绝且详情/状态都不落盘（A40）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    await env.compass.require({ title: "需求", human_line: "需求", surface: "需求" });
    await env.compass.plan({ parent_id: "R-001", title: "任务", human_line: "任务" });
    const beforeTree = await env.store.readTree();
    const beforeDetail = await env.store.readDetail("R-001-T-1");

    const err = await rejectsWith(
      env.compass.update({
        task_ids: ["R-001-T-1"],
        exec_state: "进行中",
        pointer_note: "开工",
        detail: "核心文件：`src/missing-a.ts`、`docs/missing-b.md`\n契约/文档：无\n避坑指南：无"
      }),
      "E_DETAIL_PATH_NOT_FOUND"
    );
    assert.deepEqual(err.details.missing_paths, ["src/missing-a.ts", "docs/missing-b.md"]);
    assert.match(err.message, /2 个不存在的文件路径/);
    assert.deepEqual(await env.store.readTree(), beforeTree, "状态与追溯链未变");
    assert.equal(await env.store.readDetail("R-001-T-1"), beforeDetail, "详情未变");

    await fs.mkdir(path.join(env.workspace, "docs"), { recursive: true });
    await fs.writeFile(path.join(env.workspace, "docs", "real.md"), "# real", "utf8");
    const ok = await env.compass.update({
      task_ids: ["R-001-T-1"],
      detail: "核心文件：`docs/real.md`\n契约/文档：无\n避坑指南：无",
      details: { "R-001": "验收范围：该需求\n完成结论：任务详情已写\n遗留风险：无" }
    });
    assert.deepEqual(new Set(ok.updated), new Set(["R-001-T-1", "R-001"]));
    assert.match(await env.store.readDetail("R-001-T-1"), /docs\/real\.md/);
  } finally {
    await env.cleanup();
  }
});

test("extractFileAnchors：带行号/反引号/围栏代码仍正常识别（回归）", () => {
  const anchors = extractFileAnchors("核心文件：`src/a.ts:12`\n```\nsrc/b.ts\n```\nhttps://x.com/c.ts");
  assert.deepEqual(
    anchors.map((anchor) => `${anchor.path}:${anchor.line ?? ""}`),
    ["src/a.ts:12", "src/b.ts:"]
  );
});

test("extractFileAnchors：中文标点紧邻路径不前并后并（B-57 回归）", () => {
  const anchors = extractFileAnchors(
    "核心文件：`docs/contract.md` 与 devDependency vite）、D:/workspace/app/README.md 以及（package.json）"
  );
  assert.deepEqual(
    anchors.map((anchor) => anchor.path),
    ["docs/contract.md", "D:/workspace/app/README.md"]
  );
});
