#!/usr/bin/env node
/**
 * 文档镜像检查：核心 docs 必须有英文镜像，且中英互链、章节结构一致。
 * 中文版是唯一权威（canonical）；英文版是镜像，本检查只防"漏译/漏链/结构漂移"，不校验翻译质量。
 *
 * 用法：node scripts/check-docs-en.mjs
 * 退出码：0 = 全部通过；1 = 有缺失/不一致（打印明细）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 必须带英文镜像的核心文档（新增核心文档时在这里登记） */
export const MIRRORED_DOCS = ["philosophy", "schema-v2"];

/** 允许只有中文的文档（历史设计稿等） */
export const CHINESE_ONLY_DOCS = ["ui-design"];

const HEADING_RE = /^#{1,3} /gm;

/** @param {string} file */
function headingCount(file) {
  const text = fs.readFileSync(file, "utf8");
  return (text.match(HEADING_RE) ?? []).length;
}

/** @param {string} file */
function exists(file) {
  return fs.existsSync(file);
}

const problems = [];

for (const name of MIRRORED_DOCS) {
  const zhFile = path.join(root, "docs", `${name}.md`);
  const enFile = path.join(root, "docs", `${name}.en.md`);
  if (!exists(zhFile)) {
    problems.push(`缺少中文权威文档：docs/${name}.md`);
    continue;
  }
  if (!exists(enFile)) {
    problems.push(`缺少英文镜像：docs/${name}.en.md`);
    continue;
  }
  const zh = fs.readFileSync(zhFile, "utf8");
  const en = fs.readFileSync(enFile, "utf8");
  if (!zh.includes(`${name}.en.md`)) problems.push(`docs/${name}.md 没有链接到英文镜像 ${name}.en.md`);
  if (!en.includes(`${name}.md`)) problems.push(`docs/${name}.en.md 没有链接回中文权威版 ${name}.md`);
  if (!/canonical/i.test(en)) problems.push(`docs/${name}.en.md 缺少 "canonical" 权威说明（中文为权威）`);
  const zhHeadings = headingCount(zhFile);
  const enHeadings = headingCount(enFile);
  if (zhHeadings !== enHeadings) {
    problems.push(`docs/${name}: 章节数不一致（中文 ${zhHeadings} / 英文 ${enHeadings}），英文镜像可能漏译或结构漂移`);
  }
}

for (const name of CHINESE_ONLY_DOCS) {
  const enFile = path.join(root, "docs", `${name}.en.md`);
  if (exists(enFile)) {
    problems.push(`docs/${name}.en.md 存在但该文档被标记为「仅中文」；如要翻译请移到 MIRRORED_DOCS`);
  }
}

if (problems.length > 0) {
  console.error("文档镜像检查失败：");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`文档镜像检查通过：${MIRRORED_DOCS.length} 个核心文档中英成对、互链、章节数一致；仅中文：${CHINESE_ONLY_DOCS.join("、")}`);
