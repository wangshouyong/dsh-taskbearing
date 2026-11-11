/**
 * 工作区路径规范化、hash 与目录命名。
 * 设计契约：docs/schema-v2.md §4.1。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

/** @param {string} p */
export function toPosix(p) {
  return p.replace(/\\/g, "/");
}

/**
 * 规范化工作区绝对路径：realpath → 正斜杠 → 去尾部斜杠 → Windows 盘符大写。
 * hash 计算时再按平台统一大小写（见 hashPath），因此大小写不同的同一目录得到同一 hash。
 * @param {string} input
 * @returns {string}
 */
export function resolveWorkspacePath(input) {
  const raw = String(input ?? "");
  if (!raw.trim()) {
    throw new Error("工作区路径为空");
  }
  let absolute = path.resolve(raw);
  try {
    absolute = fs.realpathSync.native(absolute);
  } catch {
    // 路径暂不存在时保留 resolve 结果（例如还没建目录的工作区）
  }
  let p = toPosix(absolute).replace(/\/+$/, "");
  if (!p) p = "/";
  if (process.platform === "win32") {
    p = p.replace(/^([a-z]):/, (_m, d) => `${d.toUpperCase()}:`);
  }
  return p;
}

/**
 * 工作区路径 hash：SHA-256 前 8 位小写 hex。
 * 大小写不敏感平台先统一小写，避免同一目录两份数据。
 * @param {string} normalizedPath resolveWorkspacePath 的结果
 * @returns {string}
 */
export function hashPath(normalizedPath) {
  const key = CASE_INSENSITIVE ? normalizedPath.toLowerCase() : normalizedPath;
  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 8);
}

/**
 * 目录展示名清洗：非法字符换成 _，去掉 Windows 尾部点/空格，长度 ≤ 40。
 * @param {string} name
 * @returns {string}
 */
export function sanitizeWorkspaceName(name) {
  let s = String(name ?? "").trim();
  s = s.replace(/[\\/:*?"<>|]/g, "_");
  s = s.replace(/[. ]+$/, "");
  s = Array.from(s).slice(0, 40).join("");
  return s || "workspace";
}

/**
 * 数据目录名：<工作区名>-<hash>
 * @param {string} normalizedPath
 * @param {string} [name]
 * @returns {string}
 */
export function workspaceDirName(normalizedPath, name) {
  const dirName = name ?? path.posix.basename(normalizedPath) ?? "workspace";
  return `${sanitizeWorkspaceName(dirName)}-${hashPath(normalizedPath)}`;
}
