/**
 * 视图过滤 / 钉顶 / 排序 / 机械计数（纯逻辑，不依赖 DOM）。
 * 契约：docs/schema-v2.md §6.3、§8.2、§8.3、§8.4。
 */

export const VIEW_CURRENT = "current"; // 只看当前：排除废弃/替代，含已执行
export const VIEW_ACTIVE = "active";   // 只看在动：排除废弃/替代 + 已执行
export const VIEW_ALL = "all";         // 完整轨迹：全部

export const VIEWS = [VIEW_CURRENT, VIEW_ACTIVE, VIEW_ALL];

const TERMINAL = new Set(["已废弃", "已替代"]);
const PINNED_VERDICTS = new Set(["待裁决", "冲突"]);

/** @param {any} node @param {string} view */
export function isVisible(node, view) {
  const verdict = node.verdict_state ?? null;
  if (view === VIEW_ALL) return true;
  if (view === VIEW_CURRENT) return verdict === null || PINNED_VERDICTS.has(verdict);
  // active
  return (verdict === null || PINNED_VERDICTS.has(verdict)) && node.exec_state !== "已执行";
}

/** @param {any} node */
function lastPointerTime(node) {
  const pointers = node?.pointers;
  if (!Array.isArray(pointers) || pointers.length === 0) return 0;
  const last = pointers[pointers.length - 1];
  const time = last?.at ? Date.parse(last.at) : 0;
  return Number.isFinite(time) ? time : 0;
}

/**
 * 待裁决/冲突钉顶区：跨层级聚合所有 verdict ∈ {待裁决, 冲突} 的节点，带父链，按最近 pointer 时间倒序。
 * @param {any} tree
 * @returns {Array<{node: any, path: string[]}>} path = 父链 human_line（不含自身）
 */
export function pinnedNodes(tree) {
  const out = [];
  const visit = (node, path) => {
    if (PINNED_VERDICTS.has(node.verdict_state)) out.push({ node, path });
    for (const child of node.children ?? []) visit(child, [...path, node.human_line]);
  };
  for (const req of tree?.root?.children ?? []) visit(req, []);
  out.sort((a, b) => lastPointerTime(b.node) - lastPointerTime(a.node));
  return out;
}

/**
 * 生成可见行（深度优先，按树序；父节点不满足视图时整棵子树隐藏，待裁决仍进钉顶区）。
 * @param {any} tree
 * @param {string} view
 * @param {Record<string, boolean>} expanded
 * @returns {Array<{node: any, depth: number, hasChildren: boolean, expanded: boolean, kind: string}>}
 */
export function visibleRows(tree, view, expanded) {
  const rows = [];
  const visit = (node, depth) => {
    if (!isVisible(node, view)) return;
    const children = node.children ?? [];
    const visibleChildren = children.filter((child) => isVisible(child, view));
    const open = expanded?.[node.id] === true;
    rows.push({ node, depth, hasChildren: children.length > 0, expanded: open, kind: node.kind });
    if (!open) return;
    for (const child of visibleChildren) visit(child, depth + 1);
  };
  for (const req of tree?.root?.children ?? []) visit(req, 0);
  return rows;
}

/**
 * 机械计数（纯展示，不算语义判断）。
 * @param {any} node
 * @returns {{total: number, active: number, done: number, pendingVerdict: number}}
 */
export function countDescendants(node) {
  let total = 0;
  let active = 0;
  let done = 0;
  let blocked = 0;
  let pendingVerdict = 0;
  let conflict = 0;
  const visit = (n) => {
    total += 1;
    if (n.exec_state === "进行中") active += 1;
    else if (n.exec_state === "已阻塞") blocked += 1;
    else if (n.exec_state === "已执行") done += 1;
    if (n.verdict_state === "待裁决") pendingVerdict += 1;
    if (n.verdict_state === "冲突") conflict += 1;
    for (const child of n.children ?? []) visit(child);
  };
  for (const child of node.children ?? []) visit(child);
  return { total, active, blocked, done, pendingVerdict, conflict };
}

/** @param {{total: number, active: number, blocked: number, done: number, pendingVerdict: number, conflict?: number}} c */
export function formatCounts(c) {
  const parts = [`${c.total} 条任务`];
  if (c.active > 0) parts.push(`进行中 ${c.active}`);
  if (c.blocked > 0) parts.push(`已阻塞 ${c.blocked}`);
  if (c.done > 0) parts.push(`已执行 ${c.done}`);
  if (c.pendingVerdict > 0) parts.push(`待裁决 ${c.pendingVerdict}`);
  if (c.conflict > 0) parts.push(`冲突 ${c.conflict}`);
  return parts.join(" · ");
}

/**
 * 全树按执行态计数（状态条「阻塞 N」用；纯机械计数）。
 * @param {any} tree
 */
export function countTreeByExec(tree) {
  const counts = { 未开始: 0, 进行中: 0, 已阻塞: 0, 已执行: 0 };
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (counts[child.exec_state] !== undefined) counts[child.exec_state] += 1;
      visit(child);
    }
  };
  visit(tree?.root ?? { children: [] });
  return counts;
}

/**
 * 徽标（文本 + 色调），不做语义判断。
 * @param {any} node
 * @returns {{label: string, tone: "gray"|"blue"|"green"|"red"|"muted"}[]}
 */
export function badgesFor(node) {
  const out = [];
  const exec = node.exec_state;
  if (exec === "已阻塞") out.push({ label: "已阻塞", tone: "yellow" });
  else if (exec === "进行中") out.push({ label: "进行中", tone: "blue" });
  else if (exec === "已执行") out.push({ label: "已执行", tone: "green" });
  else out.push({ label: "未开始", tone: "gray" });

  const verdict = node.verdict_state ?? null;
  if (verdict === "待裁决") out.push({ label: "待裁决", tone: "red" });
  else if (verdict === "冲突") out.push({ label: "冲突", tone: "orange" });
  else if (verdict === "已废弃") out.push({ label: "已废弃", tone: "muted" });
  else if (verdict === "已替代") out.push({ label: "已替代", tone: "muted" });
  if (node.merged_into) out.push({ label: `已并入 ${node.merged_into}`, tone: "muted" });
  return out;
}

/** 撞车警示时间窗（B-48/v1.22）：只有最近 30 分钟内的活跃任务才算并发冲突。 */
export const COLLISION_WINDOW_MS = 30 * 60 * 1000;
const ACTIVE_EXEC_STATES = new Set(["进行中", "已阻塞"]);
const TERMINAL_COLLISION_VERDICTS = new Set(["已废弃", "已替代"]);

/**
 * 近期并发撞车判定（B-48，v1.22 重构）：
 * 仅当 ① exec_state ∈ {进行中, 已阻塞} ② 非终态裁决（历史事实不算冲突）
 * ③ 最后一条 pointer 在 30 分钟内 ④ pointer.session 非空且 ≠ 当前会话 时才算撞车。
 * 已执行 / 未开始 / 过期 pointer 一律不报（避免满屏红灯）。
 * @param {any} node
 * @param {string|null|undefined} currentSessionId
 * @param {{now?: number, windowMs?: number}} [options]
 * @returns {{session: string, at: string, note: string, minutesAgo: number} | null}
 */
export function collisionOf(node, currentSessionId, options = {}) {
  if (!currentSessionId || typeof currentSessionId !== "string") return null;
  if (!ACTIVE_EXEC_STATES.has(node?.exec_state)) return null;
  if (TERMINAL_COLLISION_VERDICTS.has(node?.verdict_state ?? null)) return null;
  const pointers = node?.pointers;
  if (!Array.isArray(pointers) || pointers.length === 0) return null;
  const last = pointers[pointers.length - 1];
  const session = typeof last?.session === "string" ? last.session : "";
  if (!session || session === currentSessionId) return null;
  const at = typeof last?.at === "string" ? Date.parse(last.at) : NaN;
  if (!Number.isFinite(at)) return null;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : COLLISION_WINDOW_MS;
  const age = now - at;
  if (age > windowMs || age < -60 * 1000) return null;
  return {
    session,
    at: String(last.at),
    note: typeof last?.note === "string" ? last.note : "",
    minutesAgo: Math.max(0, Math.floor(Math.max(0, age) / 60000))
  };
}

/** 撞车提示文案（B-48/v1.22）：『⚠️ 另一会话在 X 分钟前正在操作此任务』。 */
export function collisionTitle(collision) {
  if (!collision) return "";
  const minutes = Number(collision.minutesAgo);
  if (Number.isFinite(minutes) && minutes >= 1) {
    return `⚠️ 另一会话在 ${minutes} 分钟前正在操作此任务`;
  }
  return "⚠️ 另一会话刚刚正在操作此任务";
}

/**
 * 行渲染签名〔B-40〕：覆盖该行渲染依赖的全部字段。
 * 两行签名相同 ⇒ 渲染结果相同，可跳过重渲染（React.memo）。
 * 注意：需求行的机械计数依赖整棵子树，必须计入签名；撞车标记依赖当前会话，也必须计入。
 * @param {{node: any, depth: number, hasChildren: boolean, expanded: boolean, kind?: string}} row
 * @param {{currentSessionId?: string|null, now?: number}} [options]
 * @returns {string}
 */
export function rowSignature(row, options = {}) {
  const node = row?.node ?? {};
  const counts = node.kind === "requirement" ? countDescendants(node) : null;
  const collision = collisionOf(node, options.currentSessionId, { now: options.now });
  return JSON.stringify([
    node.id,
    node.kind,
    node.human_line,
    node.exec_state,
    node.verdict_state ?? null,
    node.dead_reason ?? null,
    node.merged_into ?? null,
    row.depth,
    row.hasChildren === true,
    row.expanded === true,
    counts,
    collision ? `${collision.session}@${collision.at}@${collision.minutesAgo}` : null
  ]);
}

/**
 * 行签名 diff〔B-40〕：只关心哪些行新增/变化/删除（渲染调度用，纯函数）。
 * @param {Array<{node: any, signature: string}>} prevRows
 * @param {Array<{node: any, signature: string}>} nextRows
 * @returns {{added: string[], changed: string[], removed: string[], changedCount: number}}
 */
export function diffRowSigs(prevRows, nextRows) {
  /** @type {Map<string, string>} */
  const before = new Map();
  for (const row of prevRows ?? []) {
    if (row?.node?.id) before.set(row.node.id, row.signature);
  }
  /** @type {Set<string>} */
  const seen = new Set();
  const added = [];
  const changed = [];
  for (const row of nextRows ?? []) {
    const id = row?.node?.id;
    if (!id) continue;
    seen.add(id);
    if (!before.has(id)) added.push(id);
    else if (before.get(id) !== row.signature) changed.push(id);
  }
  const removed = [...before.keys()].filter((id) => !seen.has(id));
  return { added, changed, removed, changedCount: added.length + changed.length + removed.length };
}

/**
 * 行组件是否可跳过重渲染〔B-40〕：签名相同且回调引用稳定。
 * @param {any} prevProps
 * @param {any} nextProps
 */
export function areRowPropsEqual(prevProps, nextProps) {
  return (
    prevProps?.signature === nextProps?.signature &&
    prevProps?.onToggle === nextProps?.onToggle &&
    prevProps?.onOpenDetail === nextProps?.onOpenDetail
  );
}

/** @param {string|null|undefined} text */
export function truncateLine(text, max = 80) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** @param {unknown} query */
export function normalizeQuery(query) {
  return String(query ?? "").trim().toLowerCase();
}

/**
 * 关键词匹配：title / human_line / dead_reason 子串；多词全部命中。
 * @param {any} node
 * @param {string[]} tokens
 */
export function matchesQuery(node, tokens) {
  if (tokens.length === 0) return true;
  const haystack = [node.title, node.human_line, node.dead_reason]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * 搜索视图（契约 §8.10）：先按视图过滤，再按关键词过滤；
 * 命中节点的祖先链自动展开、同层未命中兄弟隐藏；返回命中数与是否处于搜索态。
 * @param {any} tree
 * @param {string} view
 * @param {Record<string, boolean>} expanded
 * @param {string} query
 * @returns {{rows: Array<{node: any, depth: number, hasChildren: boolean, expanded: boolean, kind: string}>, matchCount: number, searching: boolean}}
 */
export function searchRows(tree, view, expanded, query) {
  const normalized = normalizeQuery(query);
  const tokens = normalized ? normalized.split(/\s+/).filter(Boolean) : [];
  if (tokens.length === 0) {
    return { rows: visibleRows(tree, view, expanded), matchCount: 0, searching: false };
  }

  /** @type {Set<string>} */
  const matched = new Set();
  const visit = (node) => {
    if (!isVisible(node, view)) return;
    if (matchesQuery(node, tokens)) matched.add(node.id);
    for (const child of node.children ?? []) visit(child);
  };
  for (const requirement of tree?.root?.children ?? []) visit(requirement);

  /** @type {(node: any) => boolean} */
  const containsMatch = (node) => matched.has(node.id) || (node.children ?? []).some(containsMatch);

  /** @type {Array<{node: any, depth: number, hasChildren: boolean, expanded: boolean, kind: string}>} */
  const rows = [];
  const render = (node, depth) => {
    if (!containsMatch(node)) return;
    const children = (node.children ?? []).filter(containsMatch);
    rows.push({ node, depth, hasChildren: children.length > 0, expanded: true, kind: node.kind });
    for (const child of children) render(child, depth + 1);
  };
  for (const requirement of tree?.root?.children ?? []) {
    if (containsMatch(requirement)) render(requirement, 0);
  }
  return { rows, matchCount: matched.size, searching: true };
}
