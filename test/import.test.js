import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCompass } from "../src/core/tools.js";
import { Store } from "../src/core/store.js";

const SUMMARY_DETAIL = "验收范围：该节点下全部任务与验收项\n完成结论：已完成并留证据\n遗留风险：无";

const LONG_TEXT = "把 PPT 里的图变成能拖顶点的形状，" + "细节".repeat(900);

/** 假历史读取器：两条消息，其中一条超长（验证 preview 截断）。 */
function fakeHistory() {
  const messages = [
    { session: "session-hist", index: 1, at: "2026-11-11T01:00:00.000Z", turn: 1, text: LONG_TEXT },
    { session: "session-hist", index: 2, at: "2026-11-11T02:00:00.000Z", turn: 2, text: "另外矩形也要能拖" }
  ];
  return {
    async listMessages() {
      return [{ session: "session-hist", cwd: "D:\\work\\demo", messages }];
    },
    async readMessage(ref) {
      const found = messages.find((message) => message.session === ref.session && message.index === ref.index);
      return found ?? null;
    }
  };
}

async function makeCompass(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-import-"));
  const store = Store.forWorkspace({ storageRoot: path.join(root, "storages"), workspacePath: path.join(root, "ws") });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const compass = createCompass({
    store,
    sessionId: "session-current",
    turn: 7,
    history: fakeHistory(),
    now: () => new Date("2026-11-11T09:00:00.000Z")
  });
  await compass.init();
  return { compass, store };
}

test("import preview：逐字消息、超长截断并带 chars/truncated", async (t) => {
  const { compass } = await makeCompass(t);
  const preview = await compass.import({ mode: "preview", limit: 10 });
  assert.equal(preview.mode, "preview");
  assert.equal(preview.sessions.length, 1);
  const [first, second] = preview.sessions[0].messages;
  assert.equal(first.index, 1);
  assert.equal(first.chars, LONG_TEXT.length);
  assert.equal(first.truncated, true);
  assert.ok(first.text.length <= 801);
  assert.equal(second.truncated, false);
  assert.equal(second.text, "另外矩形也要能拖");
});

test("import apply：回填需求 + 任务，历史指针与基线原话逐字、且可重复（幂等）", async (t) => {
  const { compass, store } = await makeCompass(t);
  const items = [
    {
      type: "requirement",
      title: "PPT 矢量转可拖顶点形状",
      human_line: "把 PPT 里的图变成能拖顶点的形状",
      surface: "把 PPT 里的图变成能拖顶点的形状",
      detail: "验收范围：历史阶段一\n完成结论：历史任务已完成\n遗留风险：无",
      refs: [{ session: "session-hist", index: 1 }],
      note: "方案评审阶段"
    },
    {
      type: "task",
      parent_id: "R-001",
      title: "曲线能拖控制点",
      human_line: "让曲线也能拖控制点",
      exec_state: "已执行",
      detail: "查询结论：历史阶段已完成\n数据来源：历史会话 index 2\n后续建议：无",
      refs: [{ session: "session-hist", index: 2 }],
      note: "实现阶段"
    }
  ];
  const applied = await compass.import({ mode: "apply", items });
  assert.equal(applied.mode, "apply");
  assert.deepEqual(applied.created.map((entry) => entry.id), ["R-001", "R-001-T-1"]);
  assert.deepEqual(applied.created[0], { id: "R-001", type: "requirement", session: "session-hist", at: "2026-11-11T01:00:00.000Z" });

  const tree = await store.readTree();
  const requirement = tree.root.children[0];
  const task = requirement.children[0];
  assert.equal(requirement.pointers[0].session, "session-hist");
  assert.equal(requirement.pointers[0].at, "2026-11-11T01:00:00.000Z");
  assert.equal(requirement.pointers[0].note, "历史回填：方案评审阶段");
  assert.equal(requirement.pointers[0].turn, undefined);
  assert.equal(task.pointers[0].note, "历史回填：实现阶段");
  assert.equal(task.exec_state, "已执行");

  const baseline = await compass.read({ scope: "baseline" });
  const version = baseline.requirements[0].versions[0];
  assert.equal(version.original, LONG_TEXT); // 落盘必须是完整原文，不是 preview 截断
  assert.equal(version.originalLock, true);
  assert.equal(version.msg.session, "session-hist");
  assert.equal(version.msg.at, "2026-11-11T01:00:00.000Z");

  // 重复 apply：按 (parent,title) 去重
  const again = await compass.import({ mode: "apply", items });
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.existed, [
    { id: "R-001", title: "PPT 矢量转可拖顶点形状" },
    { id: "R-001-T-1", title: "曲线能拖控制点" }
  ]);
  const tree2 = await store.readTree();
  assert.equal(tree2.root.children[0].children.length, 1);
});

test("import apply：ref 不存在 → E_HISTORY_REF_INVALID，且不写任何数据（整批原子）", async (t) => {
  const { compass, store } = await makeCompass(t);
  await assert.rejects(
    () =>
      compass.import({
        mode: "apply",
        items: [
          { type: "requirement", title: "好需求", human_line: "人话", refs: [{ session: "session-hist", index: 2 }] },
          { type: "requirement", title: "坏需求", human_line: "人话", refs: [{ session: "session-hist", index: 99 }] }
        ]
      }),
    (err) => {
      assert.equal(err.code, "E_HISTORY_REF_INVALID");
      return true;
    }
  );
  const tree = await store.readTree();
  assert.equal(tree.root.children.length, 0);
});

test("import：参数校验（mode/items/limit/type/parent/terminal）", async (t) => {
  const { compass } = await makeCompass(t);
  await assert.rejects(() => compass.import({ mode: "nope" }), (err) => err.code === "E_INVALID_ARG");
  await assert.rejects(() => compass.import({ mode: "apply" }), (err) => err.code === "E_IMPORT_ITEM_INVALID");
  await assert.rejects(
    () => compass.import({ mode: "apply", items: new Array(51).fill({ type: "task" }) }),
    (err) => err.code === "E_IMPORT_LIMIT"
  );
  await assert.rejects(
    () => compass.import({ mode: "apply", items: [{ type: "bogus", title: "x", human_line: "y", refs: [{ session: "s", index: 1 }] }] }),
    (err) => err.code === "E_IMPORT_ITEM_INVALID"
  );
  await assert.rejects(
    () => compass.import({ mode: "apply", items: [{ type: "task", title: "x", human_line: "y", refs: [{ session: "session-hist", index: 1 }] }] }),
    (err) => err.code === "E_PARENT_REQUIRED"
  );
  await assert.rejects(
    () =>
      compass.import({
        mode: "apply",
        items: [
          {
            type: "task",
            parent_id: "R-001",
            title: "x",
            human_line: "y",
            verdict_state: "已废弃",
            refs: [{ session: "session-hist", index: 1 }]
          }
        ]
      }),
    (err) => err.code === "E_PARENT_NOT_FOUND" || err.code === "E_IMPORT_ITEM_INVALID"
  );
});

test("import preview：宿主无历史读取器 → E_INVALID_ARG", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-import2-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = Store.forWorkspace({ storageRoot: path.join(root, "storages"), workspacePath: path.join(root, "ws") });
  const compass = createCompass({ store, sessionId: "s" });
  await compass.init();
  await assert.rejects(() => compass.import({ mode: "preview" }), (err) => err.code === "E_INVALID_ARG");
});
