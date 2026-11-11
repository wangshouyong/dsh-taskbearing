import assert from "node:assert/strict";
import test from "node:test";

import {
  BASELINE_SCHEMA_LINE,
  BASELINE_TITLE,
  addRequirement,
  appendVersion,
  emptyBaseline,
  escapeOriginal,
  findRequirement,
  parseBaseline,
  serializeBaseline,
  unescapeOriginal,
  validateModel
} from "../src/core/baseline.js";

function sampleModel() {
  const model = emptyBaseline();
  addRequirement(model, {
    id: "R-001",
    title: "PPT 矢量转可拖顶点形状",
    surface: "把 PPT 里的图变成能拖顶点的形状",
    version: {
      version: "v1",
      at: "2026-11-11T14:31:07.000Z",
      summary: "把 PPT 里的图变成能拖顶点的形状",
      original: "把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏",
      originalLock: true,
      msg: { session: "s-8f3a", at: "2026-11-11T14:30:52.000Z" }
    }
  });
  appendVersion(model, "R-001", {
    at: "2026-11-11T15:02:10.000Z",
    summary: "同上，并明确「静态显示别弄坏」",
    original: "……原来静态显示也不能坏",
    originalLock: true,
    msg: { session: "s-9c11", at: "2026-11-11T15:01:44.000Z" }
  });
  return model;
}

test("空文本解析为空白基线", () => {
  const model = parseBaseline("");
  assert.deepEqual(model.requirements, []);
});

test("序列化 → 解析往返一致", () => {
  const model = sampleModel();
  const text = serializeBaseline(model);
  assert.ok(text.startsWith(BASELINE_TITLE));
  assert.ok(text.includes(BASELINE_SCHEMA_LINE));
  const parsed = parseBaseline(text);
  assert.equal(parsed.requirements.length, 1);
  const req = parsed.requirements[0];
  assert.equal(req.id, "R-001");
  assert.equal(req.versions.length, 2);
  assert.equal(req.versions[0].original, "把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏");
  assert.deepEqual(req.versions[0].msg, { session: "s-8f3a", at: "2026-11-11T14:30:52.000Z" });
  assert.equal(req.versions[1].version, "v2");
  assert.equal(parsed.requirements[0].surface, "同上，并明确「静态显示别弄坏」");
});

test("原话待锁：标记与空原话可往返", () => {
  const model = emptyBaseline();
  addRequirement(model, {
    id: "R-002",
    title: "矩形也能拖顶点",
    surface: "矩形也能拖",
    version: {
      version: "v1",
      at: "2026-11-11T16:00:00.000Z",
      summary: "矩形也能拖",
      original: "",
      originalLock: false,
      msg: null
    }
  });
  const parsed = parseBaseline(serializeBaseline(model));
  assert.equal(parsed.requirements[0].versions[0].originalLock, false);
  assert.equal(parsed.requirements[0].versions[0].original, "");
});

test("appendVersion：版本号递增并刷新明面", () => {
  const model = sampleModel();
  const label = appendVersion(model, "R-001", {
    at: "2026-11-11T16:00:00.000Z",
    summary: "第三版明面",
    original: "原话三",
    originalLock: true,
    msg: { session: "s-x", at: "2026-11-11T15:59:00.000Z" }
  });
  assert.equal(label, "v3");
  assert.equal(findRequirement(model, "R-001").surface, "第三版明面");
});

test("缺少需求 → E_REQUIREMENT_NOT_FOUND", () => {
  const model = emptyBaseline();
  assert.throws(
    () => appendVersion(model, "R-404", { at: "2026-11-11T16:00:00.000Z", summary: "x", original: "", originalLock: false }),
    (err) => err.code === "E_REQUIREMENT_NOT_FOUND"
  );
});

test("格式损坏 → E_STORE_CORRUPT 且指出行号", () => {
  assert.throws(() => parseBaseline("# 别的标题\n"), (err) => err.code === "E_STORE_CORRUPT" && /第 1 行/.test(err.message));
  assert.throws(
    () => parseBaseline(`${BASELINE_TITLE}\n## R-001 标题\n**明面**：x\n**版本**：\n- v1（昨天｜原话已锁）：\n  - 精简：x\n  - 原话（待锁）：「」\n`),
    (err) => err.code === "E_STORE_CORRUPT" && /时间戳非法/.test(err.message)
  );
});

test("模型校验：版本乱序、缺精简、已锁但原话为空", () => {
  const model = sampleModel();
  model.requirements[0].versions[1].version = "v1";
  assert.throws(() => validateModel(model), (err) => err.code === "E_STORE_CORRUPT");
});

test("schema 2：多行原话逐字往返（换行/反斜杠转义）", () => {
  const model = emptyBaseline();
  const original = "第一行原文\n第二行原文\\n字面反斜杠\n第三行";
  addRequirement(model, {
    id: "R-003",
    title: "多行原话",
    surface: "多行",
    version: {
      version: "v1",
      at: "2026-11-11T17:00:00.000Z",
      summary: "多行",
      original,
      originalLock: true,
      msg: { session: "file:D:/x/status.md#L3-L9", at: "2026-11-11T16:59:00.000Z" }
    }
  });
  const text = serializeBaseline(model);
  const originalLine = text.split("\n").find((line) => line.includes("原话（会话"));
  assert.ok(originalLine, "原话必须在同一行内（行式格式）");
  assert.equal(text.includes("第一行原文\n第二行原文"), false, "原文不得真的换行落盘");
  const parsed = parseBaseline(text);
  assert.equal(parsed.requirements[0].versions[0].original, original, "多行原话必须逐字还原");
});

test("schema 1 兼容：旧文件中的字面反斜杠不被反转义", () => {
  const legacy = [
    "# 需求基线",
    "<!-- dsh-compass:baseline-schema 1 -->",
    "",
    "## R-001 旧需求",
    "",
    "**明面**：旧",
    "**版本**：",
    "- v1（2026-11-11T14:31:07.000Z｜原话已锁）：",
    "  - 精简：旧",
    "  - 原话（会话 s-1 · 2026-11-11T14:30:52.000Z）：「字面\\n不是换行」",
    ""
  ].join("\n");
  const parsed = parseBaseline(legacy);
  assert.equal(parsed.requirements[0].versions[0].original, "字面\\n不是换行");
});

test("escapeOriginal / unescapeOriginal：互逆且覆盖边界", () => {
  const cases = ["", "a", "a\nb", "a\\b", "a\\nb", "\n\n", "尾\\", "中文\n换行\\路径", "emoji 😀\n第二行"];
  for (const value of cases) {
    assert.equal(unescapeOriginal(escapeOriginal(value)), value.replace(/\r\n?/g, "\n"), JSON.stringify(value));
  }
  assert.equal(escapeOriginal("a\nb\\c"), "a\\nb\\\\c");
});
