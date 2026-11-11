/**
 * detail 路径存在性校验（B-57，v1.26）：工具层专用（含 node:fs），不进入 client 包。
 * 识别规则复用 core/file-paths.js（与 UI 锚点同源）。
 */

import fs from "node:fs";
import path from "node:path";

import { extractFileAnchors, isAbsoluteWorkspacePath } from "./file-paths.js";

/** detail 强校验最多检查的路径数（防超长详情拖慢工具调用）。 */
export const DETAIL_PATH_LIMIT = 50;
const WILDCARD_RE = /[*?{}[\]]/;
/**
 * detail 路径存在性核查（v1.26 / B-57）：相对路径按工作区根解析，绝对路径原样；
 * 通配符（* ? { } [ ]）不检查，视为跳过；结果不落盘。
 * @param {string} text
 * @param {string} workspacePath
 * @param {{limit?: number}} [options]
 * @returns {{checked: Array<{path: string, line: number|null, resolved: string|null, exists: boolean, skipped: boolean}>, missing: Array<any>}}
 */
export function checkDetailPaths(text, workspacePath, options = {}) {
  const anchors = extractFileAnchors(text, { limit: options.limit ?? DETAIL_PATH_LIMIT });
  const root = workspacePath ? path.resolve(String(workspacePath)) : null;
  const checked = anchors.map((anchor) => {
    const normalized = anchor.path.replace(/\\/g, "/");
    if (WILDCARD_RE.test(normalized)) {
      return { ...anchor, resolved: null, exists: true, skipped: true };
    }
    const resolved = isAbsoluteWorkspacePath(normalized)
      ? path.resolve(normalized)
      : root
        ? path.resolve(root, normalized)
        : null;
    if (!resolved) return { ...anchor, resolved: null, exists: true, skipped: true };
    return { ...anchor, resolved, exists: fs.existsSync(resolved), skipped: false };
  });
  return { checked, missing: checked.filter((entry) => !entry.skipped && !entry.exists) };
}

/**
 * detail 写入被拒绝时的固定报错文案（B-57）：结论 + 缺失清单 + 整改指引。
 * @param {Array<{path: string}>} missing
 */
export function detailPathErrorMessage(missing) {
  const quoted = missing.map((entry) => `"${entry.path}"`).join("、");
  const reason =
    missing.length === 1
      ? `原因：检测到详情内容中包含不存在的文件路径 ${quoted}。`
      : `原因：检测到详情内容中包含 ${missing.length} 个不存在的文件路径：${quoted}。`;
  return [
    "[Error] 详情写入被拒绝。",
    reason,
    "建议操作：请使用终端命令或文件工具核实当前工作区的真实文件结构，并使用真实的绝对路径或相对路径重新提交。严禁捏造路径。"
  ].join("\n");
}
