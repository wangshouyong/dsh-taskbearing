import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCompass } from "../src/core/tools.js";
import { Store } from "../src/core/store.js";
import { flattenLite } from "../src/core/tree.js";

const SUMMARY_DETAIL = "验收范围：该节点下全部任务与验收项\n完成结论：已完成并留证据\n遗留风险：无";

async function makeCompass(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-position-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = Store.forWorkspace({ storageRoot: path.join(root, "storages"), workspacePath: path.join(root, "ws") });
  const compass = createCompass({ store, sessionId: "session-pos", turn: 3, now: () => new Date("2026-11-11T10:00:00.000Z") });
  await compass.init();
  await compass.require({ title: "需求", human_line: "需求", surface: "需求" });
  return { compass, store };
}

/** @param {any} compass */
async function ids(compass) {
  const rows = flattenLite(await compass.read({ scope: "tree" }));
  return rows.map((row) => row.id);
}

test("plan：after 插到兄弟之后、before 插到兄弟之前（默认末尾）", async (t) => {
  const { compass } = await makeCompass(t);
  const a = await compass.plan({ parent_id: "R-001", title: "A", human_line: "A" });
  const c = await compass.plan({ parent_id: "R-001", title: "C", human_line: "C" });
  const b = await compass.plan({ parent_id: "R-001", title: "B", human_line: "B", after: a.task_id });

  let order = (await ids(compass)).filter((id) => /^R-001-T-\d+$/.test(id));
  assert.deepEqual(order, [a.task_id, b.task_id, c.task_id]);

  const zero = await compass.plan({ parent_id: "R-001", title: "Z", human_line: "Z", before: a.task_id });
  order = (await ids(compass)).filter((id) => /^R-001-T-\d+$/.test(id));
  assert.deepEqual(order, [zero.task_id, a.task_id, b.task_id, c.task_id]);
});

test("plan：id 序号只代表创建顺序，允许大于显示位置（B-30）", async (t) => {
  const { compass } = await makeCompass(t);
  const a = await compass.plan({ parent_id: "R-001", title: "A", human_line: "A" });
  const b = await compass.plan({ parent_id: "R-001", title: "B", human_line: "B" });
  const late = await compass.plan({ parent_id: "R-001", title: "L", human_line: "L", after: a.task_id });
  const order = (await ids(compass)).filter((id) => /^R-001-T-\d+$/.test(id));
  // L 的序号 > B，但显示在 B 之前
  assert.deepEqual(order, [a.task_id, late.task_id, b.task_id]);
  assert.ok(Number(late.task_id.split("-").at(-1)) > Number(b.task_id.split("-").at(-1)));
});

test("plan：after 与 before 互斥 → E_POSITION_CONFLICT，数据未变", async (t) => {
  const { compass } = await makeCompass(t);
  const a = await compass.plan({ parent_id: "R-001", title: "A", human_line: "A" });
  const before = await ids(compass);
  await assert.rejects(
    () => compass.plan({ parent_id: "R-001", title: "X", human_line: "X", after: a.task_id, before: a.task_id }),
    (err) => err.code === "E_POSITION_CONFLICT"
  );
  assert.deepEqual(await ids(compass), before);
});

test("plan：sibling 不存在 / 不在同一父节点 → E_SIBLING_NOT_FOUND，不静默退化为末尾", async (t) => {
  const { compass } = await makeCompass(t);
  const a = await compass.plan({ parent_id: "R-001", title: "A", human_line: "A" });
  const child = await compass.plan({ parent_id: a.task_id, title: "A1", human_line: "A1" });

  await assert.rejects(
    () => compass.plan({ parent_id: "R-001", title: "X", human_line: "X", after: "R-001-T-99" }),
    (err) => err.code === "E_SIBLING_NOT_FOUND"
  );
  await assert.rejects(
    () => compass.plan({ parent_id: "R-001", title: "X", human_line: "X", after: child.task_id }),
    (err) => err.code === "E_SIBLING_NOT_FOUND" && err.details?.sibling_id === child.task_id
  );
  const order = (await ids(compass)).filter((id) => /^R-001-T-\d+$/.test(id));
  assert.equal(order.length, 1);
});



test("import：after/before 落位与校验（独立用例）", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compass-position-import-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = Store.forWorkspace({ storageRoot: path.join(root, "storages"), workspacePath: path.join(root, "ws") });
  const messages = [
    { session: "session-hist", index: 1, at: "2026-11-11T01:00:00.000Z", turn: 1, text: "早期原话" },
    { session: "session-hist", index: 2, at: "2026-11-11T02:00:00.000Z", turn: 2, text: "中期原话" }
  ];
  const history = {
    async listMessages() {
      return [{ session: "session-hist", cwd: "D:\\ws", messages }];
    },
    async readMessage(ref) {
      return messages.find((message) => message.session === ref.session && message.index === ref.index) ?? null;
    }
  };
  const compass = createCompass({ store, sessionId: "session-current", turn: 5, history });
  await compass.init();
  await compass.require({ title: "需求", human_line: "需求", surface: "需求" });
  const t1 = await compass.plan({ parent_id: "R-001", title: "T1", human_line: "T1" });
  const t2 = await compass.plan({ parent_id: "R-001", title: "T2", human_line: "T2" });

  const applied = await compass.import({
    mode: "apply",
    items: [
      {
        type: "task",
        parent_id: "R-001",
        title: "历史早期",
        human_line: "历史早期",
        exec_state: "已执行",
        detail: "查询结论：历史早期任务已完成\n数据来源：历史会话 index 1\n后续建议：无",
        refs: [{ session: "session-hist", index: 1 }],
        before: t1.task_id
      },
      {
        type: "task",
        parent_id: "R-001",
        title: "历史中期",
        human_line: "历史中期",
        exec_state: "已执行",
        detail: "查询结论：历史中期任务已完成\n数据来源：历史会话 index 2\n后续建议：无",
        refs: [{ session: "session-hist", index: 2 }],
        after: t1.task_id
      }
    ]
  });
  assert.equal(applied.created.length, 2);
  const order = flattenLite(await compass.read({ scope: "tree" }))
    .filter((row) => /^R-001-T-\d+$/.test(row.id))
    .map((row) => row.id);
  assert.deepEqual(order, [applied.created[0].id, t1.task_id, applied.created[1].id, t2.task_id]);

  await assert.rejects(
    () =>
      compass.import({
        mode: "apply",
        items: [
          {
            type: "requirement",
            title: "X",
            human_line: "X",
            refs: [{ session: "session-hist", index: 1 }],
            after: t1.task_id
          }
        ]
      }),
    (err) => err.code === "E_IMPORT_ITEM_INVALID"
  );
});
