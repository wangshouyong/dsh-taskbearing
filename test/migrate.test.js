/**
 * 旧 status.md 迁移（B-44 / A13）：preview 解析、行段逐字原话、apply 建树/基线/归档、幂等与校验。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_SOURCE_BYTES,
  applyMigration,
  classifyItem,
  excerptByRef,
  parseMigrationHeadings,
  parseMigrationSource,
  previewMigration
} from "../src/core/migrate.js";
import { makeEnv, rejectsWith } from "./helpers.js";

const DOC_LINES = [
  "# 旧项目状态",
  "",
  "## 最初需求与验收",
  "- 把 PPT 里的图变成能拖顶点的形状（最初说法）",
  "  验收：静态显示别弄坏",
  "  验收：导出后位置不漂移",
  "- 导出 PNG 保真",
  "",
  "## 当前执行",
  "- [x] 曲线能拖控制点",
  "- [ ] 矩形也能拖",
  "",
  "## 下一步",
  "- 下一步：统一导出设置",
  "",
  "## 废弃记录",
  "- 旧方案：canvas 像素级编辑（已废弃，改为矢量）",
  ""
];
const DOC = DOC_LINES.join("\n");

/** 找某行文本的行号（1 基），用于构造 ref。 */
function lineOf(needle) {
  const index = DOC_LINES.findIndex((line) => line.includes(needle));
  assert.ok(index >= 0, `样本文档必须包含：${needle}`);
  return index + 1;
}
const refOf = (needle) => `L${lineOf(needle)}-L${lineOf(needle)}`;

async function writeDoc(env, name = "status.md") {
  const file = path.join(env.root, name);
  await fs.writeFile(file, DOC, "utf8");
  return file;
}

test("parseMigrationSource：列表/复选框/续行/标题路径/关键词提示（纯函数）", () => {
  const items = parseMigrationSource(DOC);
  const texts = items.map((item) => item.text);
  assert.ok(texts.some((text) => text.includes("最初说法")));

  const first = items.find((item) => item.text.includes("最初说法"));
  assert.equal(first.kind_hint, "other");
  assert.deepEqual(first.heading_path, ["旧项目状态", "最初需求与验收"]);
  assert.ok(first.text.includes("验收：静态显示别弄坏"), "续行必须并入同一条目");
  assert.ok(first.text.includes("验收：导出后位置不漂移"));
  assert.equal(first.ref, `L${first.line_from}-L${first.line_to}`);

  assert.equal(items.find((item) => item.text.includes("曲线能拖控制点")).kind_hint, "done");
  assert.equal(items.find((item) => item.text.includes("矩形也能拖")).kind_hint, "other");
  assert.equal(items.find((item) => item.text.includes("统一导出设置")).kind_hint, "next");
  assert.equal(items.find((item) => item.text.includes("canvas")).kind_hint, "dead");
});

test("parseMigrationHeadings：标题候选（可用于基线最初说法）", () => {
  const headings = parseMigrationHeadings(DOC);
  assert.ok(headings.length >= 5);
  const first = headings[0];
  assert.equal(first.text, "旧项目状态");
  assert.deepEqual(first.heading_path, ["旧项目状态"]);
  assert.equal(first.ref, "L1-L1");
  const section = headings.find((heading) => heading.text === "最初需求与验收");
  assert.equal(section.level, 2);
  assert.deepEqual(section.heading_path, ["旧项目状态", "最初需求与验收"]);
  assert.equal(headings.find((heading) => heading.text === "废弃记录").kind_hint, "dead");
});

test("classifyItem：机械关键词分类口径", () => {
  assert.equal(classifyItem("已完成：x"), "done");
  assert.equal(classifyItem("x", true), "done", "勾选框优先 done");
  assert.equal(classifyItem("进行中"), "doing");
  assert.equal(classifyItem("TODO 后续"), "next");
  assert.equal(classifyItem("已废弃"), "dead");
  assert.equal(classifyItem("随便一段"), "other");
});

test("excerptByRef：行段逐字（含续行换行），非法/越界 E_MIGRATE_REF", () => {
  const lines = DOC.split("\n");
  const from = lineOf("最初说法");
  const to = from + 2;
  const got = excerptByRef(lines, `L${from}-L${to}`);
  assert.equal(got.text, DOC_LINES.slice(from - 1, to).join("\n"));
  assert.ok(got.text.includes("\n"), "多行段必须保留换行");
  assert.throws(() => excerptByRef(lines, "L0"), (err) => err.code === "E_MIGRATE_REF");
  assert.throws(() => excerptByRef(lines, "L1-L9999"), (err) => err.code === "E_MIGRATE_REF");
  assert.throws(() => excerptByRef(lines, "第3行"), (err) => err.code === "E_MIGRATE_REF");
});

test("preview：只读解析 + file_mtime + 1MB 上限", async () => {
  const env = await makeEnv();
  try {
    const file = await writeDoc(env);
    const before = await fs.readFile(file, "utf8");
    const preview = await previewMigration(file);
    assert.equal(preview.mode, "preview");
    assert.equal(preview.source.path, path.resolve(file));
    assert.equal(typeof preview.file_mtime, "string");
    assert.ok(preview.items.length >= 6);
    assert.match(preview.hint, /ref 必须来自本结果的 items 或 headings 行号段/);
    assert.ok(Array.isArray(preview.headings) && preview.headings.length > 0, "preview 必须返回标题候选");
    assert.equal(await fs.readFile(file, "utf8"), before, "preview 不得修改源文件");

    const big = path.join(env.root, "big-status.md");
    await fs.writeFile(big, "x".repeat(MAX_SOURCE_BYTES + 10), "utf8");
    await rejectsWith(previewMigration(big), "E_MIGRATE_SOURCE");
    await rejectsWith(previewMigration(path.join(env.root, "missing.md")), "E_MIGRATE_SOURCE");
  } finally {
    await env.cleanup();
  }
});

test("apply：建需求 + 任务 + 详情；基线原话按行段逐字；源文件归档（A13）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    const file = await writeDoc(env);
    const preview = await previewMigration(file);
    const reqRef = `L${lineOf("最初说法")}-L${lineOf("导出后位置不漂移")}`;
    const taskRef = refOf("曲线能拖控制点");
    const result = await applyMigration(env.store, {
      path: file,
      file_mtime: preview.file_mtime,
      items: [
        {
          type: "requirement",
          title: "PPT 矢量转可拖形状",
          human_line: "把 PPT 的图变成能拖顶点的形状",
          surface: "把图变成能拖顶点的形状",
          ref: reqRef,
          detail: "迁移自旧 status.md：最初需求段"
        },
        {
          type: "task",
          parent_id: "R-001",
          title: "曲线能拖控制点",
          human_line: "曲线能拖控制点",
          exec_state: "已执行",
          ref: taskRef
        }
      ],
      archive: true
    });

    assert.equal(result.mode, "apply");
    assert.equal(result.created.length, 2);
    assert.equal(result.created[0].type, "requirement");
    assert.equal(result.created[1].type, "task");
    assert.ok(result.archived_to && result.archived_to.includes("status-archive-"));
    assert.equal(path.basename(result.archived_to).startsWith("status-archive-"), true);
    await assert.rejects(fs.access(file), "原名文件必须已归档");
    const archivedText = await fs.readFile(result.archived_to, "utf8");
    assert.equal(archivedText, DOC, "归档文件内容必须与源文件一致");

    const tree = await env.store.readTree();
    const requirement = tree.root.children.find((node) => node.kind === "requirement");
    assert.equal(requirement.title, "PPT 矢量转可拖形状");
    assert.equal(requirement.pointers[0].session, `file:${path.resolve(file)}#${reqRef}`);
    assert.equal(requirement.pointers[0].note, "迁移：PPT 矢量转可拖形状");
    const task = requirement.children[0];
    assert.equal(task.exec_state, "已执行");
    assert.equal(task.pointers[0].session, `file:${path.resolve(file)}#${taskRef}`);

    const { model } = await env.store.readBaseline();
    const req = model.requirements[0];
    assert.equal(req.id, "R-001");
    assert.ok(req.versions[0].originalLock, "迁移原话必须锁定");
    const expectedOriginal = DOC_LINES.slice(lineOf("最初说法") - 1, lineOf("导出后位置不漂移")).join("\n");
    assert.equal(req.versions[0].original, expectedOriginal, "基线原话必须与源文件行段逐字节一致");
    assert.match(req.versions[0].msg.session, /^file:.*status\.md#L\d+-L\d+$/);
    assert.equal(req.versions[0].msg.at, preview.file_mtime);

    assert.equal(await env.store.readDetail(task.id), "", "未给 detail 的任务详情为空");
    assert.equal(
      await env.store.readDetail("R-001"),
      "迁移自旧 status.md：最初需求段",
      "需求详情应写入"
    );

    // 基线文件可被独立解析（多行原话转义往返）
    const { raw } = await env.store.readBaseline();
    assert.ok(raw.includes("baseline-schema 2"), "写回应升级到 schema 2");
    assert.ok(!raw.includes("\n  验收"), "多行原话不得以原始换行落盘");
  } finally {
    await env.cleanup();
  }
});

test("apply：archive=false 时源文件保留；重复 apply 幂等（existed 不重复建）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    const file = await writeDoc(env);
    const preview = await previewMigration(file);
    const args = {
      path: file,
      file_mtime: preview.file_mtime,
      items: [
        { type: "requirement", title: "旧需求", human_line: "旧需求", surface: "旧需求", ref: refOf("最初说法") },
        { type: "task", parent_id: "R-001", title: "任务一", human_line: "任务一", ref: refOf("矩形也能拖") }
      ],
      archive: false
    };
    const first = await applyMigration(env.store, args);
    assert.equal(first.created.length, 2);
    assert.equal(first.archived_to, null);
    await fs.access(file);

    const second = await applyMigration(env.store, args);
    assert.equal(second.created.length, 0);
    assert.equal(second.existed.length, 2);
    const tree = await env.store.readTree();
    assert.equal(tree.root.children.length, 1);
    assert.equal(tree.root.children[0].children.length, 1);
  } finally {
    await env.cleanup();
  }
});

test("apply：校验（file_mtime 过期/ref 越界/父节点缺失/type/terminal 原因）且失败不留半套数据", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    const file = await writeDoc(env);
    const preview = await previewMigration(file);
    const baseItem = {
      type: "requirement",
      title: "要迁移的需求",
      human_line: "要迁移的需求",
      surface: "要迁移的需求",
      ref: refOf("最初说法")
    };

    await rejectsWith(
      applyMigration(env.store, { path: file, file_mtime: "2000-01-01T00:00:00.000Z", items: [baseItem] }),
      "E_MIGRATE_REF"
    );
    await rejectsWith(
      applyMigration(env.store, { path: file, file_mtime: preview.file_mtime, items: [{ ...baseItem, ref: "L9999" }] }),
      "E_MIGRATE_REF"
    );
    await rejectsWith(
      applyMigration(env.store, {
        path: file,
        file_mtime: preview.file_mtime,
        items: [baseItem, { type: "task", parent_id: "R-404", title: "x", human_line: "x", ref: refOf("矩形也能拖") }]
      }),
      "E_PARENT_NOT_FOUND"
    );
    await rejectsWith(
      applyMigration(env.store, {
        path: file,
        file_mtime: preview.file_mtime,
        items: [baseItem, { type: "bad", title: "x", human_line: "x", ref: refOf("矩形也能拖") }]
      }),
      "E_MIGRATE_ITEM_INVALID"
    );
    await rejectsWith(
      applyMigration(env.store, {
        path: file,
        file_mtime: preview.file_mtime,
        items: [{ ...baseItem, verdict_state: "已废弃" }]
      }),
      "E_MIGRATE_ITEM_INVALID"
    );

    const tree = await env.store.readTree();
    assert.deepEqual(tree.root.children, [], "任何失败都不得留下半套数据");
    const { model } = await env.store.readBaseline();
    assert.deepEqual(model.requirements, []);
    await fs.access(file);
  } finally {
    await env.cleanup();
  }
});

test("apply：任务项支持 after 定位（迁移顺序可控）", async () => {
  const env = await makeEnv();
  try {
    await env.compass.init();
    const file = await writeDoc(env);
    const preview = await previewMigration(file);
    const result = await applyMigration(env.store, {
      path: file,
      file_mtime: preview.file_mtime,
      items: [
        { type: "requirement", title: "R", human_line: "R", surface: "R", ref: refOf("最初说法") },
        { type: "task", parent_id: "R-001", title: "A", human_line: "A", ref: refOf("曲线能拖控制点") },
        { type: "task", parent_id: "R-001", title: "B", human_line: "B", ref: refOf("矩形也能拖") },
        {
          type: "task",
          parent_id: "R-001",
          title: "A0",
          human_line: "A0",
          ref: refOf("统一导出设置"),
          after: "R-001-T-1"
        }
      ],
      archive: false
    });
    assert.equal(result.created.length, 4);
    const tree = await env.store.readTree();
    assert.deepEqual(tree.root.children[0].children.map((node) => node.title), ["A", "A0", "B"]);
  } finally {
    await env.cleanup();
  }
});
