/**
 * 文件路径识别与地址构造（B-47 / A31；B-56）。
 * - 机械识别：从文本中提取锚点路径（反引号/围栏代码/全文扫描 + 扩展名白名单）；
 * - 地址构造：DSH `dsh-resource://file/session/<sid>/<path>`（SP-10）。
 * 纯函数、无 node 依赖；client 侧 file-anchor.js 直接复用本模块。
 * 写 detail 的存在性强校验（fs.existsSync）在 core/detail-path-guard.js（工具层专用）。
 */

/** 扩展名白名单（机械识别用）。 */
export const FILE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "md",
  "css",
  "scss",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "hpp",
  "yml",
  "yaml",
  "toml",
  "ini",
  "sh",
  "ps1",
  "html",
  "vue",
  "svelte",
  "sql",
  "txt"
]);

const MAX_PATH_LENGTH = 200;
const DEFAULT_LIMIT = 20;
/** detail 强校验最多检查的路径数（防超长详情拖慢工具调用）。 */
export const DETAIL_PATH_LIMIT = 50;
const WILDCARD_RE = /[*?{}[\]]/;

/** Windows 盘符或 UNC 或 POSIX 绝对路径。 */
export function isAbsoluteWorkspacePath(value) {
  const text = String(value ?? "");
  return text.startsWith("/") || /^[A-Za-z]:[/\\]/.test(text) || text.startsWith("\\\\");
}

/** 路径段编码：逐段 encodeURIComponent，`:` 保留字面（与 DSH 地址语法一致）。 */
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}

/** @param {string} filePath @returns {string} */
function encodePath(filePath) {
  return filePath.split("/").map(encodeSegment).join("/");
}

/**
 * `dsh-resource://file/session/<sid>/<path>` 地址（SP-10 / §8.16）。
 * @param {string} sessionId
 * @param {string} filePath 相对或绝对路径（反斜杠自动归一）
 */
export function sessionFileAddress(sessionId, filePath) {
  const normalized = String(filePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "");
  return `dsh-resource://file/session/${encodeSegment(String(sessionId ?? ""))}/${encodePath(normalized)}`;
}

/**
 * 与 DSH `fileAddressFor` 等价：cwd 内绝对路径转相对；其它绝对路径原样进 session 地址。
 * @param {string} sessionId
 * @param {string|null|undefined} cwd
 * @param {string} filePath
 */
export function fileAddressFor(sessionId, cwd, filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd ? String(cwd).replace(/\\/g, "/").replace(/\/+$/, "") : "";
  if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
  if (root !== "" && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  }
  return sessionFileAddress(sessionId, normalized);
}

/** 从 token 尾部拆出行号：`path:12`、`path:12:3`、`path#L12`。 */
function splitLineSuffix(token) {
  const hash = /^(.*?)#L(\d+)$/.exec(token);
  if (hash) return { path: hash[1], line: Number(hash[2]) };
  const colon = /^(.*?):(\d+)(?::\d+)?$/.exec(token);
  if (colon && !/^[A-Za-z]$/.test(colon[1])) return { path: colon[1], line: Number(colon[2]) };
  return { path: token, line: null };
}

/**
 * 去掉标签前缀（`核心文件：src/a.ts` / `URL：https://…` / `label:src/a.ts`），
 * 避免把标签文字并进路径导致误判（B-57 强校验依赖准确识别）。
 * @param {string} token
 */
function stripLabelPrefix(token) {
  const full = token.lastIndexOf("：");
  if (full >= 0 && full < token.length - 1) return token.slice(full + 1);
  // ASCII 标签：不含分隔符/盘符冒号的短前缀 + `:`
  const labeled = /^[^:\\/]{1,20}:([A-Za-z0-9_.$~%+\-][^\s]*)$/.exec(token);
  if (labeled) return labeled[1];
  return token;
}

/**
 * 判断候选串是否像文件路径；返回规范化后的锚点或 null。
 * @param {string} raw
 */
function toAnchor(raw) {
  let token = String(raw ?? "").trim();
  if (!token) return null;
  token = token.replace(/^`+|`+$/g, "").replace(/^["'(<[]+|["')>\]]+$/g, "");
  token = stripLabelPrefix(token);
  if (!token || token.length > MAX_PATH_LENGTH) return null;
  if (/:\/\//.test(token)) return null;
  if (/^(?:https?|ftp|file):\/\//i.test(token)) return null;
  if (/[\s<>|*?"]/.test(token)) return null;
  const { path, line } = splitLineSuffix(token);
  const normalized = path.replace(/\\/g, "/");
  if (!normalized) return null;
  const extMatch = /\.([A-Za-z0-9]{1,10})$/.exec(normalized);
  const ext = extMatch ? extMatch[1].toLowerCase() : "";
  const hasSeparator = normalized.includes("/");
  if (!FILE_EXTENSIONS.has(ext)) return null;
  // 纯包名不要（无分隔符时仅允许已知源码文件名形态）
  if (!hasSeparator && !/^[\w.-]+\.(?:json|md|txt|toml|ini|ya?ml)$/i.test(normalized)) return null;
  return { path: normalized, line: Number.isInteger(line) && line > 0 ? line : null };
}

/** 全文本路径匹配（要求至少一个路径分隔符）。 */
const TOKEN_RE = /(?:[A-Za-z]:[\\/]|\/|\\\\)?[^\s`"'<>|*?]+[\\/][^\s`"'<>|*?]+(?::\d+(?::\d+)?|#L\d+)?/g;

/**
 * 从详情/备注文本中机械提取文件锚点（去重、限 20）。
 * @param {string} text
 * @param {{limit?: number}} [options]
 * @returns {Array<{path: string, line: number|null, raw: string}>}
 */
export function extractFileAnchors(text, options = {}) {
  const limit = Math.max(1, Math.min(Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT, 50));
  const source = String(text ?? "");
  if (!source) return [];

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<{path: string, line: number|null, raw: string}>} */
  const anchors = [];

  const push = (candidate) => {
    // 中文标点常与路径紧邻（如「… vite）、D:/x/y.ts」），先按标点切分成候选片段再识别
    const pieces = String(candidate ?? "")
      .replace(/[、，。；：！？（）【】「」《》]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const piece of pieces) {
      const anchor = toAnchor(piece);
      if (!anchor) continue;
      const key = `${anchor.path}#${anchor.line ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push({ ...anchor, raw: piece.trim() });
      if (anchors.length >= limit) return;
    }
  };

  // 1) 反引号代码段 / 围栏代码块：优先在其中找路径
  const codeSegments = [];
  const fenceRe = /```[\s\S]*?```|`[^`\n]{1,200}`/g;
  let match;
  while ((match = fenceRe.exec(source)) !== null) {
    codeSegments.push(match[0].replace(/```/g, " "));
  }
  for (const segment of codeSegments) {
    for (const token of segment.split(/\s+/)) push(token);
  }

  // 2) 全文扫描带分隔符的路径（非代码段）
  const plain = source.replace(fenceRe, " ");
  while ((match = TOKEN_RE.exec(plain)) !== null) {
    push(match[0]);
    if (anchors.length >= limit) break;
  }

  return anchors.slice(0, limit);
}
