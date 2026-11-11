import assert from "node:assert/strict";
import test from "node:test";

import { nextRequirementId, nextTaskId, pad } from "../src/core/ids.js";
import { emptyTree, walk } from "../src/core/tree.js";

test("pad：3 位补零，超 999 自然进位", () => {
  assert.equal(pad(1), "001");
  assert.equal(pad(999), "999");
  assert.equal(pad(1000), "1000");
});

test("nextRequirementId：按现有最大序号 +1", () => {
  const root = emptyTree().root;
  assert.equal(nextRequirementId(root), "R-001");
  root.children.push({ id: "R-001" }, { id: "R-009" }, { id: "R-002" });
  assert.equal(nextRequirementId(root), "R-010");
});

test("nextTaskId：父 id 前缀 + 父内序号", () => {
  const parent = { id: "R-001", children: [] };
  assert.equal(nextTaskId(parent), "R-001-T-1");
  parent.children.push({ id: "R-001-T-1" }, { id: "R-001-T-3" });
  assert.equal(nextTaskId(parent), "R-001-T-4");
});

test("节点 id 与 walk 基本行为", () => {
  const tree = emptyTree();
  tree.root.children.push({ id: "R-001", kind: "requirement", children: [] });
  const ids = [];
  walk(tree.root, (node) => ids.push(node.id));
  assert.deepEqual(ids, ["ROOT", "R-001"]);
});

test("nextTaskId：嵌套超过 id 长度上限时报 E_INVALID_ARG（不生成非法 id）", async () => {
  const { nextTaskId } = await import("../src/core/ids.js");
  // 构造一个 61 字符的 id，再加一层会超 64
  let parent = { id: "R-001-T-1", children: [] };
  for (let i = 0; i < 13; i += 1) {
    const childId = nextTaskId(parent);
    parent = { id: childId, children: [] };
  }
  assert.equal(parent.id.length <= 61, true);
  assert.throws(
    () => nextTaskId(parent),
    (err) => {
      assert.equal(err.code, "E_INVALID_ARG");
      assert.match(err.message, /嵌套过深/);
      return true;
    }
  );
});