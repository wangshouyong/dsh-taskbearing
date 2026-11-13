/**
 * 右侧栏任务板主面板（CompassTab）。
 * 契约：docs/schema-v2.md §8 + 《UI 设计》。
 * 约束：高度校准（C-2）、主题跟随（C-3）、失败不静默（D-12）、样式作用域（C-6）。
 */

import * as React from "react";
import { CompassApi, ApiError } from "./api.js";
import { BACKFILL_PROMPT, INIT_PROMPT, describeUninitialized } from "./uninitialized.js";
import {
  areRowPropsEqual,
  badgesFor,
  collisionOf,
  collisionTitle,
  countDescendants,
  countTreeByExec,
  formatCounts,
  pinnedNodes,
  rowSignature,
  searchRows,
  truncateLine,
  visibleRows,
  VIEWS
} from "./board-view.js";
import { collectTrashed, pruneTrashed } from "../core/tree.js";
import { formatHandoff, requirementIdOf } from "./copy-format.js";
import { describeBundle, summarizeBundle } from "./bundle-view.js";
import { extractFileAnchors, fileAddressFor } from "./file-anchor.js";
import { SESSION_STATES, describeSessionLink, isValidSessionId, pointerRow, resolveSessionLinkState } from "./pointer-view.js";
import { describeJumpStatus } from "./turn-jump.js";
import { normalizePrefs, persistableExpanded, toggleExpanded } from "./ui-state.js";
import { POLL_INTERVAL_MS, shouldFetchNow, shouldPoll } from "./polling.js";
import { usePanelHeight, usePanelTheme } from "./theme.js";
import { Icon } from "./icons.js";
import { PortalDialog, DialogHead } from "./modal.js";

const h = React.createElement;
const { useCallback, useEffect, useMemo, useRef, useState } = React;

const VIEW_LABEL = { current: "只看当前", active: "只看在动", all: "完整轨迹" };
const TONE_CLASS = { gray: "tone-gray", blue: "tone-blue", green: "tone-green", red: "tone-red", orange: "tone-orange", yellow: "tone-yellow", muted: "tone-muted" };

/** 单条徽标。 */
function Badge({ label, tone }) {
  return h("span", { className: `badge ${TONE_CLASS[tone] ?? "tone-gray"}` }, label);
}

/** 设置页：本机任务板数据管理（磁盘清理）+ 迁移备份 + 一键卸载（v1.24 / §8.12）。 */
function SettingsWorkspaces({ cwd, onImported }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [uninstallConfirm, setUninstallConfirm] = useState(false);
  const [uninstallResult, setUninstallResult] = useState(null);
  const [importDraft, setImportDraft] = useState(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await CompassApi.workspaces(cwd);
      setList(data.workspaces ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // 失败时结束「加载中…」（旧宿主缺接口时也能看到可读错误，B-55）
      setList([]);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportBoard = useCallback(async () => {
    if (!cwd) {
      setError("尚未绑定工作区，无法导出");
      return;
    }
    setError(null);
    setNotice(null);
    setExporting(true);
    try {
      const { json, filename } = await CompassApi.exportBoard(cwd);
      let summary = null;
      try {
        summary = summarizeBundle(JSON.parse(json));
      } catch {
        summary = null;
      }
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `已导出 ${filename}${summary ? `（${summary.requirements} 需求 · ${summary.nodes} 节点 · ${summary.details} 详情/备注）` : ""}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [cwd]);

  const onPickFile = useCallback(async (event) => {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = "";
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      setImportDraft({ filename: file.name, bundle, summary: summarizeBundle(bundle) });
    } catch (err) {
      setImportDraft(null);
      setError(`导入文件不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!importDraft || !cwd) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await CompassApi.importBoard(cwd, importDraft.bundle);
      const imported = result?.imported ?? {};
      setNotice(
        `已导入：${imported.nodes ?? 0} 节点 · ${imported.details ?? 0} 详情/备注 · ${imported.baseline_requirements ?? 0} 需求基线`
      );
      setImportDraft(null);
      await load();
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [cwd, importDraft, load, onImported]);

  const removeWorkspace = useCallback(
    async (workspaceId) => {
      try {
        await CompassApi.removeWorkspace(workspaceId);
        setConfirmId(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load]
  );

  const uninstall = useCallback(async () => {
    try {
      const result = await CompassApi.uninstall();
      setUninstallResult(`规则区块：${result.rules}；已删除 ${result.workspaces_removed} 份任务板数据`);
      setUninstallConfirm(false);
      setList([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const wsMetaLine = (ws) => {
    const parts = [`${ws.node_count} 节点`];
    if (Number.isInteger(ws.requirement_count)) parts.push(`${ws.requirement_count} 需求`);
    if (ws.exec) parts.push(`进行中 ${ws.exec.doing}`);
    if (ws.verdict) parts.push(`待裁决 ${ws.verdict.pending}`);
    return parts.join(" · ");
  };

  return h(
    React.Fragment,
    null,
    h(
      "section",
      { className: "settings-section" },
      h("h3", { className: "settings-heading" }, "迁移与备份"),
      h(
        "div",
        { className: "ws-tools" },
        h(
          "button",
          { type: "button", className: "btn", onClick: () => void exportBoard(), disabled: exporting || !cwd },
          h(Icon, { name: "download", size: 14 }),
          exporting ? "导出中…" : "导出任务板"
        ),
        h(
          "button",
          { type: "button", className: "btn", onClick: () => fileInputRef.current?.click() },
          h(Icon, { name: "upload", size: 14 }),
          "导入任务板"
        ),
        h("input", {
          type: "file",
          accept: ".json,application/json",
          ref: fileInputRef,
          style: { display: "none" },
          onChange: (event) => void onPickFile(event)
        })
      ),
      importDraft
        ? h(
            "div",
            { className: "ws-import" },
            h("div", { className: "ws-import-file" }, `待导入：${importDraft.filename}`),
            h("pre", { className: "ws-import-summary" }, describeBundle(importDraft.summary)),
            h("div", { className: "ws-warn" }, "导入只允许写入空板；目标板非空会被拒绝。导入会整体写入树/详情/备注/基线。"),
            h(
              "div",
              { className: "ws-confirm" },
              h(
                "button",
                { type: "button", className: "btn danger", onClick: () => void confirmImport(), disabled: importing },
                importing ? "导入中…" : "确认导入"
              ),
              h(
                "button",
                { type: "button", className: "btn", onClick: () => setImportDraft(null), disabled: importing },
                "取消"
              )
            )
          )
        : null
    ),
    h(
      "section",
      { className: "settings-section" },
      h(
        "h3",
        { className: "settings-heading" },
        h("span", null, `本机任务板数据（${list ? list.length : "…"}）`),
        h("button", { type: "button", className: "link-btn", onClick: () => void load() }, "刷新")
      ),
      h(
        "div",
        { className: "settings-row hint" },
        "本机全部任务板数据（磁盘清理用），不是看板切换器；删除只清理数据目录，不动原项目文件。"
      ),
      notice ? h("div", { className: "settings-row hint" }, notice) : null,
      error ? h("div", { className: "settings-row ws-error" }, error) : null,
      !list
        ? h("div", { className: "settings-row hint" }, "加载中…")
        : list.length === 0
          ? h("div", { className: "settings-row hint" }, "本机暂无任务板数据")
          : list.map((ws) =>
              h(
                "div",
                { key: ws.workspace_id, className: `ws-row ${ws.orphan ? "orphan" : ""}` },
                h(
                  "div",
                  { className: "ws-main" },
                  h("span", { className: "ws-name", title: ws.name }, `${ws.current ? "● 当前 · " : ""}${ws.name}`),
                  h("span", { className: "ws-meta" }, wsMetaLine(ws)),
                  ws.orphan ? h("span", { className: "ws-orphan" }, "路径已失效 · 可清理") : null
                ),
                h("div", { className: "ws-path", title: ws.original_path ?? "" }, ws.original_path ?? "(未知路径)"),
                confirmId === ws.workspace_id
                  ? h(
                      "div",
                      { className: "ws-confirm" },
                      h(
                        "span",
                        { className: "ws-warn" },
                        ws.current
                          ? "这是当前会话正在使用的数据，删除后任务板将变为空板。数据目录将永久删除："
                          : "删除后该数据目录将永久删除（原项目文件不受影响）："
                      ),
                      h(
                        "button",
                        { type: "button", className: "btn danger", onClick: () => void removeWorkspace(ws.workspace_id) },
                        "确认清理"
                      ),
                      h("button", { type: "button", className: "btn", onClick: () => setConfirmId(null) }, "取消")
                    )
                  : h(
                      "button",
                      { type: "button", className: "link-btn ws-delete", onClick: () => setConfirmId(ws.workspace_id) },
                      "清理"
                    )
              )
            )
    ),
    h(
      "section",
      { className: "settings-section danger" },
      h("h3", { className: "settings-heading" }, "危险区"),
      uninstallConfirm
        ? h(
            "div",
            { className: "ws-confirm" },
            h("span", { className: "ws-warn" }, `将永久清除：AGENTS.md 规则区块 + 全部 ${list?.length ?? 0} 份任务板数据`),
            h("button", { type: "button", className: "btn danger", onClick: () => void uninstall() }, "确认卸载"),
            h("button", { type: "button", className: "btn", onClick: () => setUninstallConfirm(false) }, "取消")
          )
        : h(
            "button",
            { type: "button", className: "btn danger", onClick: () => setUninstallConfirm(true) },
            h(Icon, { name: "trash", size: 14 }),
            "卸载插件（自动清理）"
          ),
      uninstallResult ? h("div", { className: "settings-row hint" }, uninstallResult) : null
    )
  );
}

/** 顶部：分段视图 + 搜索 + 回收站 + 刷新/设置（v1.24 移除时间线；v1.33 加回收站入口）。 */
function TopBar({ view, onView, query, onQuery, searching, matchCount, trashCount, onOpenTrash, onRefresh, onOpenSettings }) {
  return h(
    "div",
    { className: "topbar" },
    h(
      "div",
      { className: "view-tabs", role: "group", "aria-label": "视图" },
      VIEWS.map((value) =>
        h(
          "button",
          {
            key: value,
            type: "button",
            className: `view-tab ${view === value ? "on" : ""}`,
            onClick: () => onView(value),
            "aria-pressed": view === value
          },
          VIEW_LABEL[value]
        )
      )
    ),
    h(
      "div",
      { className: "topbar-tools" },
      h(
        "div",
        { className: "search-box" },
        h("span", { className: "search-icon" }, h(Icon, { name: "search", size: 14 })),
        h("input", {
          type: "search",
          className: "search-input",
          placeholder: "搜索任务…",
          value: query,
          "aria-label": "搜索任务",
          onChange: (event) => onQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Escape") onQuery("");
          }
        }),
        searching ? h("span", { className: "search-count" }, `${matchCount} 项`) : null
      ),
      h(
        "button",
        {
          type: "button",
          className: `icon-btn trash-entry${trashCount > 0 ? " has-items" : ""}`,
          title: trashCount > 0 ? `回收站：${trashCount} 项` : "回收站（空）",
          "aria-label": trashCount > 0 ? `回收站，${trashCount} 项` : "回收站",
          onClick: onOpenTrash
        },
        h(Icon, { name: "trash" }),
        trashCount > 0 ? h("span", { className: "trash-count" }, trashCount > 99 ? "99+" : String(trashCount)) : null
      ),
      h(
        "button",
        { type: "button", className: "icon-btn", title: "刷新", onClick: onRefresh, "aria-label": "刷新" },
        h(Icon, { name: "refresh" })
      ),
      h(
        "button",
        { type: "button", className: "icon-btn", title: "设置", onClick: onOpenSettings, "aria-label": "设置" },
        h(Icon, { name: "settings" })
      )
    )
  );
}

/** 设置弹窗（B-51）：偏好 / 诊断 / 迁移与备份 / 工作区 / 危险区，内容区独立滚动。 */
function SettingsPanel({ view, rememberExpand, onToggleRemember, diagnostics, cwd, onImported, onClose }) {
  return h(
    PortalDialog,
    { variant: "center", onClose, label: "设置", className: "settings-card" },
    h(DialogHead, { title: "设置", subtitle: "偏好 · 备份 · 工作区管理", onClose }),
    h(
      "div",
      { className: "modal-body" },
      h(
        "section",
        { className: "settings-section" },
        h("h3", { className: "settings-heading" }, "偏好"),
        h("div", { className: "settings-row" }, "视图偏好：全局固定（", VIEW_LABEL[view], "）"),
        h(
          "label",
          { className: "settings-row checkbox" },
          h("input", {
            type: "checkbox",
            checked: rememberExpand,
            onChange: (e) => onToggleRemember(e.target.checked)
          }),
          "记住展开路径（按工作区）"
        )
      ),
      diagnostics
        ? h(
            "section",
            { className: "settings-section" },
            h("h3", { className: "settings-heading" }, "诊断"),
            h("div", { className: "settings-row diagnostics" }, diagnostics)
          )
        : null,
      h(SettingsWorkspaces, { cwd, onImported }),
      h("div", { className: "settings-row hint" }, "判断由 AI 完成，插件只展示")
    ),
    h(
      "div",
      { className: "modal-foot" },
      h("button", { type: "button", className: "btn", onClick: onClose }, "关闭")
    )
  );
}

/** 待裁决钉顶区。 */
function PinnedList({ items, onJump }) {
  if (items.length === 0) return null;
  return h(
    "div",
    { className: "pinned" },
    h(
      "div",
      { className: "pinned-title" },
      h(Icon, { name: "pin", size: 12 }),
      `待裁决 ${items.length}`
    ),
    h(
      "div",
      { className: "pinned-list" },
      items.map(({ node, path }) =>
        h(
          "button",
          {
            key: node.id,
            type: "button",
            className: "pinned-row",
            onClick: () => onJump(node),
            title: node.human_line
          },
          h("span", { className: "pinned-path", title: path.join(" › ") }, path.join(" › ") || "—"),
          h("span", { className: "pinned-sep" }, "›"),
          h("span", { className: "pinned-text" }, node.human_line),
          h(Badge, { label: "待裁决", tone: "red" })
        )
      )
    )
  );
}

/** 清单行（B-40）：React.memo + 行签名，未变行跳过重渲染。 */
const TreeRow = React.memo(function TreeRow({ row, expanded, onToggle, onOpenDetail, onDiscard, depth, currentSessionId, nowMs }) {
  if (typeof window !== "undefined" && window.__DSH_COMPASS_PROFILE__) {
    // CDP 验收用行渲染计数（默认关闭，生产无副作用）
    window.__DSH_COMPASS_ROW_RENDERS__ = (window.__DSH_COMPASS_ROW_RENDERS__ ?? 0) + 1;
  }
  const { node, hasChildren } = row;
  const badges = badgesFor(node);
  const isRequirement = node.kind === "requirement";
  const counts = isRequirement ? countDescendants(node) : null;
  const dead = node.dead_reason;
  const collision = collisionOf(node, currentSessionId, { now: nowMs });
  const rowClass = `tree-row depth-${depth} kind-${node.kind}${node.exec_state === "已阻塞" ? " exec-blocked" : ""}`;
  const dotClass =
    node.exec_state === "进行中"
      ? "exec-doing"
      : node.exec_state === "已执行"
        ? "exec-done"
        : node.exec_state === "已阻塞"
          ? "exec-blocked"
          : "exec-idle";
  return h(
    "div",
    { className: rowClass, style: { paddingLeft: 4 + depth * 14 } },
    h(
      "button",
      {
        type: "button",
        className: `row-toggle ${hasChildren ? (row.expanded ? "open" : "") : "leaf"}`,
        onClick: () => hasChildren && onToggle(node.id),
        "aria-expanded": hasChildren ? row.expanded : undefined,
        "aria-label": hasChildren ? (row.expanded ? "收起" : "展开") : "详情",
        tabIndex: hasChildren ? 0 : -1
      },
      hasChildren ? h(Icon, { name: "chevron", size: 12 }) : h("span", { className: "row-leaf-dot" })
    ),
    h(
      "div",
      { className: "row-main", onClick: () => onOpenDetail(node.id), role: "button", tabIndex: 0, "aria-label": node.human_line },
      h("span", { className: `row-dot ${dotClass}`, title: `执行：${node.exec_state ?? "未开始"}` }),
      h("span", { className: `row-text ${node.verdict_state === "已废弃" || node.verdict_state === "已替代" ? "struck" : ""}`, title: node.human_line },
        node.human_line
      ),
      counts ? h("span", { className: "row-counts" }, formatCounts(counts)) : null,
      dead ? h("span", { className: "row-dead", title: dead }, truncateLine(dead, 60)) : null
    ),
    h(
      "div",
      { className: "row-badges" },
      collision
        ? h(
            "span",
            {
              className: "ghost-mark",
              title: collision.note ? `${collisionTitle(collision)}（${collision.note}）` : collisionTitle(collision),
              "aria-label": "近期并发操作"
            },
            "👻"
          )
        : null,
      badges.map((b) => h(Badge, { key: b.label, label: b.label, tone: b.tone })),
      h(
        "button",
        {
          type: "button",
          className: "row-discard-btn",
          title: "丢弃到回收站（可还原）",
          "aria-label": `丢弃到回收站：${node.human_line}`,
          onClick: (e) => {
            e.stopPropagation();
            onDiscard(node.id);
          }
        },
        h(Icon, { name: "trash", size: 12 })
      ),
      h(
        "button",
        {
          type: "button",
          className: "row-detail-btn",
          title: "详情",
          onClick: (e) => {
            e.stopPropagation();
            onOpenDetail(node.id);
          }
        },
        "详情"
      )
    )
  );
}, areRowPropsEqual);

/** 递归树。 */
function TreeView({ rows, expanded, onToggle, onOpenDetail, onDiscard, currentSessionId, nowMs }) {
  if (rows.length === 0) return null;
  return h(
    "div",
    { className: "tree" },
    rows.map((row) =>
      h(TreeRow, {
        key: row.node.id,
        row,
        signature: row.signature,
        expanded,
        onToggle,
        onOpenDetail,
        onDiscard,
        depth: row.depth,
        currentSessionId,
        nowMs
      })
    )
  );
}

/** 回收站抽屉（v1.33）：列出已丢弃节点；可还原 / 彻底删除（需求层只允许保留，禁物理删除）。 */
function TrashDrawer({ entries, busy, notice, onRestore, onPurge, onClose }) {
  const [confirmId, setConfirmId] = React.useState(null);
  useEffect(() => {
    // 列表变化（还原/删除后）→ 收起未完成的二次确认，避免误删下一行
    setConfirmId(null);
  }, [entries.length]);
  return h(
    PortalDialog,
    { variant: "drawer", onClose, label: "回收站", className: "trash-card" },
    h(DialogHead, {
      title: "回收站",
      subtitle: entries.length > 0 ? `${entries.length} 项 · 丢弃不改状态，随时可还原` : "空 · 任务行上的垃圾桶按钮可把一次性任务丢进来",
      onClose
    }),
    h(
      "div",
      { className: "modal-body trash-body" },
      notice ? h("div", { className: "trash-notice", role: "status" }, notice) : null,
      entries.length === 0
        ? h(
            "div",
            { className: "trash-empty" },
            h(Icon, { name: "inbox", size: 28 }),
            h("div", { className: "trash-empty-title" }, "回收站是空的"),
            h("div", { className: "hint" }, "任务行右侧的垃圾桶按钮：一次点击丢弃，整棵子树一起收起来，随时还原。")
          )
        : h(
            "div",
            { className: "trash-list" },
            entries.map(({ node, path, descendants }) => {
              const isRequirement = node.kind === "requirement";
              const pending = confirmId === node.id;
              return h(
                "div",
                { className: `trash-row${isRequirement ? " kind-requirement" : ""}`, key: node.id },
                h(
                  "div",
                  { className: "trash-row-main" },
                  h("div", { className: "trash-row-title", title: node.human_line }, node.human_line),
                  h(
                    "div",
                    { className: "trash-row-meta" },
                    isRequirement ? "需求" : node.kind === "task" ? "任务" : "步骤",
                    path.length > 0 ? ` · ${path.join(" › ")}` : "",
                    descendants > 0 ? ` · 含 ${descendants} 个后代` : "",
                    ` · 丢弃于 ${formatTrashTime(node.trashedAt)}`
                  )
                ),
                h(
                  "div",
                  { className: "trash-row-actions" },
                  pending
                    ? [
                        h(
                          "button",
                          {
                            key: "ok",
                            type: "button",
                            className: "btn danger",
                            disabled: busy,
                            onClick: () => {
                              setConfirmId(null);
                              onPurge(node.id);
                            }
                          },
                          descendants > 0 ? `确认删除（含 ${descendants} 个后代）` : "确认删除"
                        ),
                        h(
                          "button",
                          { key: "cancel", type: "button", className: "btn", disabled: busy, onClick: () => setConfirmId(null) },
                          "取消"
                        )
                      ]
                    : [
                        h(
                          "button",
                          {
                            key: "restore",
                            type: "button",
                            className: "btn",
                            disabled: busy,
                            onClick: () => onRestore(node.id)
                          },
                          "还原"
                        ),
                        h(
                          "button",
                          {
                            key: "purge",
                            type: "button",
                            className: `btn danger${isRequirement ? " disabled-look" : ""}`,
                            disabled: busy || isRequirement,
                            title: isRequirement
                              ? "需求带着基线原话与追溯链，只能保留在回收站，不能彻底删除"
                              : "彻底删除（先备份到 data/.trash，保留 30 天）",
                            onClick: () => {
                              if (!isRequirement) setConfirmId(node.id);
                            }
                          },
                          isRequirement ? "不可删除" : "彻底删除"
                        )
                      ]
                )
              );
            })
          )
    )
  );
}

/** 回收站时间：ISO → 本地「MM-DD HH:mm」（非法输入不编造）。 */
function formatTrashTime(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return "未知时间";
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 空态 / 错误态。actions 可选：[{label, onClick, primary, disabled}]（B-63 暂无数据空态用）。 */
function EmptyState({ kind, message, hint, onRetry, onCopyHint, retryLabel = "重试", actions }) {
  return h(
    "div",
    { className: "empty-state" },
    h("div", { className: "empty-icon" }, h(Icon, { name: kind === "error" ? "alert" : "inbox", size: 36 })),
    h(
      "div",
      { className: "empty-title" },
      {
        uninitialized: "任务板暂无数据",
        empty: "任务板还是空的",
        search: "无匹配",
        loading: "加载中",
        error: "读取失败"
      }[kind] ?? "提示"
    ),
    h("div", { className: "empty-message" }, message),
    hint ? h("div", { className: "empty-hint" }, hint) : null,
    h(
      "div",
      { className: "empty-actions" },
      ...(Array.isArray(actions) ? actions : []).map((action, index) =>
        h(
          "button",
          {
            key: `${action.label}-${index}`,
            type: "button",
            className: `btn${action.primary ? " primary" : ""}`,
            disabled: action.disabled === true,
            onClick: action.onClick
          },
          action.label
        )
      ),
      onRetry ? h("button", { type: "button", className: "btn", onClick: onRetry }, retryLabel) : null,
      onCopyHint ? h("button", { type: "button", className: "btn", onClick: onCopyHint }, "复制提示") : null
    )
  );
}

/** 备注编辑（500ms 防抖自动保存）。 */
function NoteEditor({ value, status, onChange }) {
  return h(
    "div",
    { className: "note-editor" },
    h("textarea", {
      className: "note-input",
      value,
      placeholder: "写点备注…",
      onChange: (e) => onChange(e.target.value)
    }),
    h(
      "div",
      { className: `note-status status-${status.state}` },
      status.state === "saving"
        ? "保存中…"
        : status.state === "saved"
          ? `已保存 ${status.savedAt}`
          : status.state === "error"
            ? `保存失败：${status.message}`
            : status.state === "dirty"
              ? "编辑中…"
              : "自动保存已开启"
    )
  );
}

/** 单条追溯指针行（B-43/B-50/B-61）：可用会话可跳转；带 turn 时定位该轮并高亮；失败明确提示。 */
function PointerRow({ pointer, index, getSessionLinkState, hostSession, openSession, jumpToTurn, onJumpError, cwd }) {
  const row = pointerRow(pointer, index);
  const snapshotState =
    typeof getSessionLinkState === "function" ? getSessionLinkState(row.session) : SESSION_STATES.UNSUPPORTED;
  // B-61：宿主按会话日志核验过存在 ⇒ 覆盖快照的「会话不可用」假阴性（子代理会话跳父会话）
  const state = resolveSessionLinkState(snapshotState, hostSession?.exists);
  const degraded = state !== SESSION_STATES.AVAILABLE;
  const inParent = state === SESSION_STATES.AVAILABLE && hostSession?.targetSession && hostSession.targetSession !== row.session;
  // 子代理会话的 turn 是该子代理自己的轮次，父会话轮次需按 at 解析 ⇒ 按钮不写死数字
  const jumpLabel = row.turn !== null ? (inParent ? "跳到父会话对应轮次" : `跳到第 ${row.turn} 轮`) : "打开原会话";
  const [status, setStatus] = useState("");
  const jump = async () => {
    if (typeof jumpToTurn !== "function") {
      onJumpError?.("宿主不支持会话跳转");
      return;
    }
    if (row.turn !== null) setStatus(`定位第 ${row.turn} 轮…`);
    else setStatus("定位中…");
    let result = null;
    try {
      result = await jumpToTurn({ sessionId: row.session, turn: row.turn, at: pointer?.at ?? null, cwd });
    } catch (err) {
      setStatus(`跳转失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const text = describeJumpStatus(result, result?.plan ?? null);
    setStatus(text || (result?.ok ? "已定位并高亮" : "未能定位该轮次"));
    if (result?.reason === "open-failed") onJumpError?.("打开会话失败：宿主未提供会话跳转");
  };
  return h(
    "div",
    { key: row.key, className: `pointer-row ${degraded ? "degraded" : ""}` },
    h("span", { className: "pointer-at" }, row.at || "时间未知"),
    row.turn !== null ? h("span", { className: "pointer-turn" }, `第 ${row.turn} 轮`) : null,
    h("span", { className: "pointer-note", title: row.note }, row.note),
    h(
      "span",
      { className: "pointer-session", title: row.session },
      state === SESSION_STATES.FILE ? row.session.replace(/#.*$/, "") : row.shortSession
    ),
    h(
      "span",
      { className: "pointer-actions" },
      state === SESSION_STATES.AVAILABLE
        ? h(
            "button",
            { type: "button", className: "link-btn pointer-jump", onClick: () => void jump() },
            jumpLabel
          )
        : h("span", { className: "pointer-degraded" }, describeSessionLink(state)),
      degraded && state !== SESSION_STATES.FILE
        ? h(
            "button",
            {
              type: "button",
              className: "link-btn",
              title: "复制会话 id",
              onClick: () => navigator.clipboard?.writeText?.(row.session)
            },
            "复制 id"
          )
        : null
    ),
    status ? h("span", { className: "pointer-jump-status" }, status) : null
  );
}

/** 详情弹层。 */
function DetailPanel({
  node,
  detail,
  noteState,
  onClose,
  onNoteChange,
  onCopy,
  copied,
  pathTitles,
  getSessionLinkState,
  openSession,
  jumpToTurn,
  fileAnchors,
  onOpenFile,
  collision,
  cwd
}) {
  const badges = badgesFor(node);
  const [jumpError, setJumpError] = useState("");
  const [fileHint, setFileHint] = useState("");
  const pointers = Array.isArray(node.pointers) ? node.pointers : [];
  const anchors = Array.isArray(fileAnchors) ? fileAnchors : [];
  // v1.25 / B-56：锚点存在性检测（只读 stat，结果不落盘）
  const [anchorKinds, setAnchorKinds] = useState({});
  const [checkError, setCheckError] = useState("");
  const anchorPathsKey = anchors.map((anchor) => anchor.path).join("\n");
  // v1.30 / B-61：会话可用性核验（宿主按会话日志判断存在，覆盖客户端快照假阴性）
  const [hostSessions, setHostSessions] = useState({});
  const sessionIdsKey = [...new Set(pointers.map((item) => (typeof item?.session === "string" ? item.session : "")).filter((id) => id && isValidSessionId(id)))].join(",");
  useEffect(() => {
    if (!cwd || !sessionIdsKey) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await CompassApi.sessionLinks(cwd, sessionIdsKey.split(","));
        const map = {};
        for (const item of data?.sessions ?? []) map[item.session] = { exists: item.exists === true, origin: item.origin ?? null, openable: item.openable !== false, targetSession: item.target_session ?? null };
        if (!cancelled) setHostSessions(map);
      } catch {
        // 旧宿主缺接口/网络失败：保持快照判定，不阻断详情面板
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, sessionIdsKey]);
  useEffect(() => {
    if (!cwd || !anchorPathsKey) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await CompassApi.fileExists(cwd, anchorPathsKey.split("\n"));
        const map = {};
        for (const item of data?.results ?? []) map[item.path] = item.kind;
        if (!cancelled) {
          setAnchorKinds(map);
          setCheckError("");
        }
      } catch {
        if (!cancelled) setCheckError("无法检测文件是否存在（宿主版本过旧），点击仍会尝试打开");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, anchorPathsKey]);
  return h(
    PortalDialog,
    { variant: "center", onClose, label: `详情 ${node.id}`, className: "detail-card" },
    h(
      "div",
      { className: "modal-head" },
      h(
        "div",
        { className: "modal-head-text" },
        h(
          "div",
          { className: "modal-title" },
          h("span", { className: "node-id" }, node.id),
          h("span", null, node.title)
        ),
        h(
          "div",
          { className: "detail-meta" },
          h("span", { className: "meta-item" }, "执行：", node.exec_state),
          h("span", { className: "meta-item" }, "裁决：", node.verdict_state ?? "无"),
          badges.filter((b) => b.tone !== "gray").map((b) => h(Badge, { key: b.label, label: b.label, tone: b.tone })),
          node.dead_reason ? h("span", { className: "meta-item dead-reason" }, "原因：", node.dead_reason) : null,
          h("span", { className: "meta-item path", title: pathTitles.join(" › ") }, "路径：", pathTitles.join(" › "))
        )
      ),
      h(
        "button",
        { type: "button", className: "icon-btn modal-close", onClick: onClose, "aria-label": "关闭", "data-autofocus": true },
        h(Icon, { name: "close" })
      )
    ),
    h(
      "div",
      { className: "modal-body" },
      collision
        ? h(
            "div",
            { className: "detail-collision" },
            h(Icon, { name: "alert", size: 14 }),
            h("span", null, `${collisionTitle(collision)}${collision.note ? `（${collision.note}）` : ""}`)
          )
        : null,
      h(
        "section",
        { className: "detail-section" },
        h("div", { className: "col-title" }, `追溯链（${pointers.length}）`),
        pointers.length === 0
          ? h("div", { className: "pointer-empty" }, "（暂无追溯记录）")
          : h(
              "div",
              { className: "pointer-list" },
              pointers.map((pointer, index) =>
                h(PointerRow, {
                  key: `${pointer?.at ?? ""}#${index}`,
                  pointer,
                  index,
                  getSessionLinkState,
                  hostSession: hostSessions[pointer?.session] ?? undefined,
                  openSession,
                  jumpToTurn,
                  cwd,
                  onJumpError: setJumpError
                })
              )
            ),
        jumpError ? h("div", { className: "pointer-error" }, jumpError) : null
      ),
      anchors.length > 0
        ? h(
            "section",
            { className: "detail-section" },
            h("div", { className: "col-title" }, `文件锚点（${anchors.length}）`),
            h(
              "div",
              { className: "file-chips" },
              anchors.map((anchor) => {
                const kind = anchorKinds[anchor.path];
                const missing = kind === "missing";
                const unknown = kind === "unknown";
                return h(
                  "button",
                  {
                    key: `${anchor.path}#${anchor.line ?? ""}`,
                    type: "button",
                    className: `file-chip ${missing ? "missing" : ""} ${unknown ? "unknown" : ""}`.trim(),
                    title: missing
                      ? `路径不存在：${anchor.path}（点击复制路径）`
                      : unknown
                        ? `无法检测：${anchor.path}（点击尝试打开）`
                        : `打开 ${anchor.path}${anchor.line ? ` 第 ${anchor.line} 行` : ""}`,
                    onClick: () => {
                      if (missing) {
                        navigator.clipboard?.writeText?.(anchor.path);
                        setFileHint(`路径不存在，已复制：${anchor.path}`);
                        return;
                      }
                      const ok = onOpenFile?.(anchor);
                      if (ok) setFileHint("");
                      else setFileHint(`宿主不支持直接打开，已复制路径：${anchor.path}`);
                    }
                  },
                  h(Icon, { name: "file", size: 12 }),
                  `${anchor.path}${anchor.line ? `:${anchor.line}` : ""}`
                );
              })
            ),
            fileHint ? h("div", { className: "file-hint" }, fileHint) : null,
            checkError ? h("div", { className: "file-hint" }, checkError) : null
          )
        : null,
      h(
        "div",
        { className: "detail-body" },
        h(
          "div",
          { className: "detail-col detail-ai" },
          h("div", { className: "col-title" }, "详情（AI 写，只读）"),
          h("pre", { className: "detail-text" }, detail || "（暂无详情）")
        ),
        h(
          "div",
          { className: "detail-col detail-note" },
          h("div", { className: "col-title" }, "备注（可编辑）"),
          h(NoteEditor, { value: noteState.text, status: noteState.status, onChange: onNoteChange })
        )
      )
    ),
    h(
      "div",
      { className: "modal-foot" },
      h(
        "button",
        { type: "button", className: "btn primary", onClick: onCopy },
        h(Icon, { name: copied ? "check" : "copy", size: 14 }),
        copied ? "已复制 ✓" : "复制交接内容"
      ),
      h("button", { type: "button", className: "btn", onClick: onClose }, "关闭")
    )
  );
}

/** 状态条。 */
function StatusBar({ lastUpdated, pollingOn, dirty, onRefresh, workspaceLabel, boardBehind, blocked }) {
  return h(
    "div",
    { className: "statusbar" },
    workspaceLabel
      ? h(
          "span",
          { className: "status-item workspace", title: workspaceLabel },
          workspaceLabel
        )
      : null,
    h("span", { className: "status-item updated" }, lastUpdated ? `最后更新 ${lastUpdated}` : "尚未加载"),
    h(
      "span",
      { className: "status-item poll", title: pollingOn ? `每 ${POLL_INTERVAL_MS / 1000}s 自动刷新` : "已暂停刷新" },
      h("span", { className: `poll-dot ${pollingOn ? "" : "off"}` }),
      pollingOn ? `每 ${POLL_INTERVAL_MS / 1000}s 自动刷新` : "已暂停刷新"
    ),
    blocked > 0
      ? h(
          "span",
          {
            className: "status-item blocked-count",
            title: "执行态为「已阻塞」的任务数（等第三方/等确认/被卡住，需要人工介入；仅机械计数）"
          },
          `阻塞 ${blocked}`
        )
      : null,
    boardBehind > 0
      ? h(
          "span",
          {
            className: "status-item board-behind",
            title: "板面在最近这些轮次里没有更新；仅提示，不阻塞（B-32）"
          },
          `板面 ${boardBehind} 轮未落板`
        )
      : null,
    dirty ? h("button", { type: "button", className: "link-btn dirty", onClick: onRefresh }, "有更新，点击刷新") : null,
    h("button", { type: "button", className: "link-btn status-refresh", onClick: onRefresh }, "手动刷新")
  );
}

/**
 * 主面板。
 * @param {{useTabInfo?: () => any}} props
 */
export function CompassTab(props) {
  const theme = usePanelTheme();
  const rootRef = useRef(null);
  usePanelHeight(rootRef);

  const tabInfo = props.useTabInfo ? props.useTabInfo() : null;
  const tabVisible = tabInfo?.tab?.visible !== false;

  const [workspace, setWorkspace] = useState(null);
  const [tree, setTree] = useState(null);
  const [mtime, setMtime] = useState(null);
  const [initialized, setInitialized] = useState(false);
  // B-63（v1.32）：暂无数据空态（不是错误态）：未初始化 + 历史会话摘要 + 回填指令发送状态
  const [uninitialized, setUninitialized] = useState(false);
  const [historyInfo, setHistoryInfo] = useState(null);
  const [dismissedUninit, setDismissedUninit] = useState(false);
  const [backfill, setBackfill] = useState({ status: "idle", reason: null, copied: false });
  const [copyNotice, setCopyNotice] = useState(null);
  const [view, setView] = useState("current");
  const [rememberExpand, setRememberExpand] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [noteState, setNoteState] = useState({ text: "", status: { state: "idle" } });
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  // v1.33 回收站：抽屉开关 / 操作中 / 抽屉内可见提示（不切整面板错误态）
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashNotice, setTrashNotice] = useState(null);
  const [boardStatus, setBoardStatus] = useState(null);
const [nowTick, setNowTick] = useState(() => Date.now());
  const [baselineCache, setBaselineCache] = useState({});
useEffect(() => {
  // 撞车警示依赖 30 分钟时间窗：每分钟重算一次，过期标记自动消失
  const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000);
  return () => window.clearInterval(timer);
}, []);

// 样式自愈（B-63 补）：DSH 0.2.0-rc.2 的 client-modules 会把「无主 <style>」认领给
// 后物化的插件，那个插件一重载/卸载就把本插件样式连带删掉（cdp 插件同款故障）。
// 挂载时补一次归属；轮询与 tab 可见时再补（≤2s 自愈），见下方 effects。
useEffect(() => {
  if (typeof props.ensureStyles === "function") props.ensureStyles();
}, [props.ensureStyles]);

  // v1.33 回收站：常规视图/计数/搜索/钉顶只看「板上可见」的树；回收站抽屉单独列已丢弃项
  const boardTree = useMemo(() => (tree ? pruneTrashed(tree) : null), [tree]);
  const trashEntries = useMemo(() => (tree ? collectTrashed(tree) : []), [tree]);

  // 详情节点从当前树实时取（树刷新后详情跟着更新；也避免 openDetail 依赖 tree 导致行回调不稳定）
  const detailNode = useMemo(() => (detailId && boardTree ? findNode(boardTree, detailId) : null), [detailId, boardTree]);
  const detailCollision = useMemo(
    () => (detailNode ? collisionOf(detailNode, props.sessionId) : null),
    [detailNode, props.sessionId]
  );
  const fileAnchors = useMemo(
    () => (detailNode ? extractFileAnchors(`${detail?.detail ?? ""}\n${noteState.text ?? ""}`) : []),
    [detail, detailNode, noteState.text]
  );

  const editing = noteState.status.state === "saving" || noteState.status.state === "dirty";
  const cwd = workspace?.cwd;

  const fail = useCallback((err) => {
    const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    setError({ message });
  }, []);

  /** 板面可用：清空暂无数据空态（回填完成 / 轮询检测到 tree 后自动切换，§8.21）。 */
  const markReady = useCallback(() => {
    setUninitialized(false);
    setInitialized(true);
    setError(null);
    setDismissedUninit(false);
    setHistoryInfo(null);
    setCopyNotice(null);
    setBackfill((state) => (state.status === "idle" ? state : { status: "idle", reason: null, copied: false }));
  }, []);

  /**
   * 暂无数据空态（B-63）：识别未初始化 → 拉只读历史会话摘要（旧会话判断）。
   * 这是状态，不是错误：不 setError。
   */
  const markUninitialized = useCallback(async (targetCwd) => {
    setError(null);
    setInitialized(false);
    setUninitialized(true);
    setDismissedUninit(false);
    setCopyNotice(null);
    setBackfill({ status: "idle", reason: null, copied: false });
    setHistoryInfo(null);
    if (!targetCwd) return;
    try {
      const summary = await CompassApi.historySummary(targetCwd);
      setHistoryInfo(summary && typeof summary === "object" ? summary : null);
    } catch {
      // 旧宿主缺路由 / 网络失败：摘要不可用不阻塞空态，文案走「无法读取历史会话摘要」分支
      setHistoryInfo(null);
    }
  }, []);

  /** 复制固定指令（回填 / 初始化）：给可见反馈，失败也要说清楚（D-12 不静默）。 */
  const copyInstruction = useCallback(async (text, label) => {
    let copied = false;
    try {
      await navigator.clipboard?.writeText?.(text);
      copied = true;
    } catch {
      copied = false;
    }
    setCopyNotice(copied ? `${label}已复制到剪贴板` : "复制失败，请手动复制");
    window.setTimeout(() => setCopyNotice(null), 2500);
    return copied;
  }, []);

  /**
   * 把固定指令发进当前会话（经宿主 conversation 服务）。
   * 成功 ⇒「已发送」态；不可用/失败 ⇒ 复制指令 + 可见原因（不静默、不假装成功）。
   */
  const sendInstruction = useCallback(
    async (text) => {
      setBackfill((state) => ({ ...state, status: "sending", reason: null, copied: false }));
      setCopyNotice(null);
      let result = null;
      try {
        result = typeof props.sendPrompt === "function" ? await props.sendPrompt(text) : null;
      } catch (err) {
        result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      if (result?.ok === true) {
        setBackfill({ status: "sent", reason: null, copied: false });
        return;
      }
      const reason =
        typeof result?.reason === "string" && result.reason.trim() ? result.reason.trim() : "自动发送不可用";
      const copied = await copyInstruction(text, "回填指令");
      setBackfill({ status: "fallback", reason, copied });
    },
    [copyInstruction, props.sendPrompt]
  );

  /** 空态刷新：先试 tree（回填可能已完成），仍无数据则重拉历史摘要；不重置已发送状态。 */
  const refreshUninitialized = useCallback(async () => {
    if (!cwd) return;
    try {
      const data = await CompassApi.tree(cwd);
      if (data && data.changed !== false && data.tree) {
        setTree(data.tree);
        setMtime(data.mtimeMs);
        markReady();
        return;
      }
    } catch {
      // 仍未初始化：继续刷新摘要
    }
    try {
      const summary = await CompassApi.historySummary(cwd);
      setHistoryInfo(summary && typeof summary === "object" ? summary : null);
    } catch {
      setHistoryInfo(null);
    }
  }, [cwd, markReady]);

  const onUninitializedAction = useCallback(
    (actionId) => {
      if (actionId === "backfill") void sendInstruction(BACKFILL_PROMPT);
      else if (actionId === "init") void sendInstruction(INIT_PROMPT);
      else if (actionId === "dismiss") setDismissedUninit(true);
      else if (actionId === "refresh") void refreshUninitialized();
      else if (actionId === "copy") void copyInstruction(BACKFILL_PROMPT, "回填指令");
      else if (actionId === "copy-init") void copyInstruction(INIT_PROMPT, "初始化提示");
    },
    [copyInstruction, refreshUninitialized, sendInstruction]
  );

  const loadTree = useCallback(
    async (targetCwd, opts = {}) => {
      if (!targetCwd) return;
      try {
        const data = await CompassApi.tree(targetCwd, opts.ifmtime);
        if (data.changed === false) return;
        setTree(data.tree);
        setMtime(data.mtimeMs);
        markReady();
        if (!opts.keepDirty) setDirty(false);
      } catch (err) {
        // 未初始化是状态而非故障（B-63）：进入暂无数据空态，不显示「读取失败」
        if (err instanceof ApiError && err.code === "E_NOT_INITIALIZED") {
          await markUninitialized(targetCwd);
          return;
        }
        fail(err);
      }
    },
    [fail, markReady, markUninitialized]
  );

  // 初始化：拿当前工作区（优先用宿主传入的 projectRoot）→ 读偏好 → 读 UI 状态 → 拉树
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seed = props.projectRoot;
        const sessionSeed = props.sessionId;
        const current = seed && /^[A-Za-z]:[\\/]|^\//.test(seed)
          ? await CompassApi.current({ cwd: seed })
          : sessionSeed
            ? await CompassApi.current({ sessionId: sessionSeed })
            : await CompassApi.current();
        if (cancelled) return;
        setWorkspace(current);
        const [prefs, uiState] = await Promise.all([
          CompassApi.getPrefs().catch(() => null),
          CompassApi.getUiState(current.cwd).catch(() => null)
        ]);
        if (cancelled) return;
        const normalizedPrefs = normalizePrefs(prefs ?? {});
        setView(normalizedPrefs.view);
        setRememberExpand(uiState?.rememberExpand === true);
        setExpanded(uiState?.rememberExpand === true ? uiState?.expanded ?? {} : {});
        // B-63：/current 明确未初始化 ⇒ 直接进入暂无数据空态（不请求 tree，避免把 404 当故事）
        if (current.initialized === false) {
          await markUninitialized(current.cwd);
          return;
        }
        await loadTree(current.cwd);
        const status = await CompassApi.status(current.cwd, props.sessionId).catch(() => null);
        if (!cancelled && status) setBoardStatus(status);
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fail, loadTree, markUninitialized]);

  // 轮询
  useEffect(() => {
    if (!cwd) return undefined;
    const timer = window.setInterval(() => {
      if (!shouldPoll({ tabVisible, docVisible: document.visibilityState === "visible", editing })) return;
      // 样式自愈：每次轮询确认本插件 <style> 仍存在且带归属标记（丢失则当场补回）
      if (typeof props.ensureStyles === "function") props.ensureStyles();
      void CompassApi.status(cwd, props.sessionId)
        .then((status) => setBoardStatus(status))
        .catch(() => {});
      void (async () => {
        try {
          const before = mtime;
          const data = await CompassApi.tree(cwd, before ?? undefined);
          if (data.changed === false) return;
          if (editing) setDirty(true);
          else {
            setTree(data.tree);
            setMtime(data.mtimeMs);
            // 回填完成后自动切回列表（B-63 / §8.7 未初始化期间保持轮询）
            markReady();
          }
        } catch {
          // 轮询失败不打断；未初始化时 404 属预期（§8.21）
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [cwd, mtime, editing, tabVisible, props.sessionId, markReady, props.ensureStyles]);

  // 可见性恢复立即刷新
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && cwd) void loadTree(cwd, { ifmtime: mtime ?? undefined });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [cwd, loadTree, mtime]);

  const onView = useCallback((next) => {
    setView(next);
    void CompassApi.putPrefs({ view: next }).catch(() => {});
  }, []);

  const onToggle = useCallback(
    (id) => {
      setExpanded((current) => {
        const next = toggleExpanded(current, id);
        if (rememberExpand && cwd) {
          void CompassApi.putUiState(cwd, { expanded: next, rememberExpand: true }).catch(() => {});
        }
        return next;
      });
    },
    [cwd, rememberExpand]
  );

  const onToggleRemember = useCallback(
    (checked) => {
      setRememberExpand(checked);
      if (cwd) {
        void CompassApi.putUiState(cwd, {
          expanded: checked ? expanded : {},
          rememberExpand: checked
        }).catch(() => {});
      }
    },
    [cwd, expanded]
  );

  const loadRequirementSurface = useCallback(
    async (reqId) => {
      if (!reqId || baselineCache[reqId] !== undefined) return baselineCache[reqId];
      try {
        const data = await CompassApi.baseline(cwd, reqId);
        const surface = data?.surface ?? null;
        setBaselineCache((cache) => ({ ...cache, [reqId]: surface }));
        return surface;
      } catch {
        setBaselineCache((cache) => ({ ...cache, [reqId]: null }));
        return null;
      }
    },
    [baselineCache, cwd]
  );

  const openDetail = useCallback(
    async (id) => {
      setDetailId(id);
      setDetail(null);
      setCopied(false);
      try {
        const data = await CompassApi.detail(cwd, id);
        setDetail(data);
        setNoteState({ text: data.note ?? "", status: { state: "idle" } });
      } catch (err) {
        fail(err);
        setDetailId(null);
      }
    },
    [cwd, fail]
  );

  // 详情自动跟随板面更新（v1.32 / B-63 补）：弹窗打开期间 tree mtime 变化 ⇒ 重拉 AI 详情。
  // 否则 AI 刚落盘的详情/追溯链要等用户关掉再打开才看得到（会被误认为「校验没生效/详情被绕过」）。
  // 用户正在编辑备注（dirty / saving）时保留草稿，不拿服务端内容覆盖输入。
  useEffect(() => {
    if (!detailId || !cwd || mtime === null || mtime === undefined) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await CompassApi.detail(cwd, detailId);
        if (cancelled) return;
        setDetail(data);
        setNoteState((state) =>
          state.status.state === "dirty" || state.status.state === "saving"
            ? state
            : { text: data.note ?? "", status: { state: "idle" } }
        );
      } catch {
        // 刷新失败不打断阅读；下次板面变化再试（关闭重开也可）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, detailId, mtime]);

  // 面板重新可见时立即刷新一次（不等 2s 轮询）：后台/其它 tab 期间的变化切回即时可见。
  const tabVisibleRef = useRef(null);
  useEffect(() => {
    const wasVisible = tabVisibleRef.current;
    tabVisibleRef.current = tabVisible;
    if (tabVisible) {
      if (typeof props.ensureStyles === "function") props.ensureStyles();
      if (wasVisible === false && cwd) void loadTree(cwd, { ifmtime: mtime ?? undefined });
    }
  }, [tabVisible, cwd, loadTree, mtime, props.ensureStyles]);

  const saveTimer = useRef(0);
  const onNoteChange = useCallback(
    (text) => {
      if (!detailId || !cwd) return;
      setNoteState((state) => ({ text, status: { state: "dirty" } }));
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        setNoteState((state) => ({ text: state.text, status: { state: "saving" } }));
        try {
          await CompassApi.saveNote(cwd, detailId, text, props.sessionId);
          setNoteState((state) => ({
            text: state.text,
            status: { state: "saved", savedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }) }
          }));
          void loadTree(cwd, { ifmtime: mtime ?? undefined });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setNoteState((state) => ({ text: state.text, status: { state: "error", message } }));
        }
      }, 500);
    },
    [cwd, detailId, loadTree, mtime, props.sessionId]
  );

  // 文件锚点点击（B-47）：侧边栏打开；宿主不支持时复制路径（回调返回 false 由详情面板给出可见提示）
  const openFileAnchor = useCallback(
    (anchor) => {
      const sessionId = props.sessionId;
      if (!sessionId || !anchor?.path) return false;
      const address = fileAddressFor(sessionId, workspace?.cwd, anchor.path);
      const ok =
        typeof props.openResource === "function" &&
        props.openResource(address, anchor.line ? { params: { line: anchor.line } } : undefined);
      if (!ok) {
        try {
          navigator.clipboard?.writeText?.(anchor.path);
        } catch {
          // 复制失败不影响后续提示
        }
      }
      return Boolean(ok);
    },
    [props.openResource, props.sessionId, workspace]
  );

  const onCopy = useCallback(async () => {
    if (!detailNode) return;
    const node = detailNode;
    const reqId = requirementIdOf(node.id);
    let surface = null;
    if (reqId) surface = await loadRequirementSurface(reqId);
    const text = formatHandoff(
      node,
      [...(detail?.pathTitles ?? [node.human_line])],
      reqId ? { id: reqId, surface } : null,
      detail?.detail ?? "",
      noteState.text
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [detail, detailNode, noteState.text, loadRequirementSurface]);

  const jumpTo = useCallback((node) => {
    setExpanded((current) => ({ ...current, [node.id]: true }));
    void openDetail(node.id);
  }, [openDetail]);

  // ---------------------------------------------------------------- 回收站（v1.33）
  /** 回收站操作：成功写可见提示 + 刷新板面；失败把原因放在抽屉里，不切整面板错误态。 */
  const runTrashAction = useCallback(
    async (action, successNote) => {
      if (!cwd) return;
      setTrashBusy(true);
      setTrashNotice(null);
      try {
        const result = await action();
        setTrashNotice(typeof successNote === "function" ? successNote(result) : successNote);
        await loadTree(cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setTrashNotice(message);
      } finally {
        setTrashBusy(false);
      }
    },
    [cwd, loadTree]
  );

  const discardNode = useCallback(
    (id) => {
      void runTrashAction(() => CompassApi.discard(cwd, [id]), "已丢进回收站（可在回收站还原）");
    },
    [cwd, runTrashAction]
  );

  const restoreTrash = useCallback(
    (id) => {
      void runTrashAction(() => CompassApi.restore(cwd, [id]), "已还原，状态保持丢弃前的样子");
    },
    [cwd, runTrashAction]
  );

  const purgeTrash = useCallback(
    (id) => {
      void runTrashAction(
        () => CompassApi.purge(cwd, id),
        (result) => (result?.backup ? `已彻底删除（备份：${result.backup}，保留 30 天）` : "已彻底删除")
      );
    },
    [cwd, runTrashAction]
  );

  const search = useMemo(
    () => (boardTree ? searchRows(boardTree, view, expanded, query) : { rows: [], matchCount: 0, searching: false }),
    [boardTree, view, expanded, query]
  );
  // 行签名（B-40）：只有签名变化的行会重渲染（TreeRow 的 React.memo 比较器）；撞车标记依赖当前会话
  const rows = useMemo(
    () => search.rows.map((row) => ({ ...row, signature: rowSignature(row, { currentSessionId: props.sessionId }) })),
    [search.rows, props.sessionId]
  );
  const pinned = useMemo(() => (boardTree ? pinnedNodes(boardTree) : []), [boardTree]);
  const execCounts = useMemo(() => (boardTree ? countTreeByExec(boardTree) : null), [boardTree]);

  if (error) {
    return h(
      "div",
      { className: "dsh-compass-root", "data-theme": theme, ref: rootRef },
      h(EmptyState, {
        kind: "error",
        message: error.message,
        onRetry: () => {
          setError(null);
          if (cwd) void loadTree(cwd);
        }
      })
    );
  }

  if (!workspace) {
    return h(
      "div",
      { className: "dsh-compass-root", "data-theme": theme, ref: rootRef },
      h(EmptyState, { kind: "loading", message: "加载任务板…" })
    );
  }

  // 暂无数据（B-63 / §8.21）：旧会话识别 + 回填与否由用户决定；不是错误态
  if (uninitialized) {
    const description = describeUninitialized({ history: historyInfo, dismissed: dismissedUninit, backfill });
    return h(
      "div",
      { className: "dsh-compass-root", "data-theme": theme, ref: rootRef },
      h(EmptyState, {
        kind: "uninitialized",
        message: description.message,
        hint: copyNotice ?? description.hint,
        actions: description.actions.map((action) => ({
          label: action.label,
          primary: action.primary === true,
          disabled: action.disabled === true,
          onClick: () => onUninitializedAction(action.id)
        }))
      }),
      h(StatusBar, {
        workspaceLabel: workspace.cwd ? workspace.cwd.split(/[\\/]/).filter(Boolean).pop() : null,
        lastUpdated: null,
        pollingOn: shouldPoll({ tabVisible, docVisible: document.visibilityState === "visible", editing }),
        dirty: false,
        boardBehind: 0,
        blocked: 0,
        onRefresh: () => void refreshUninitialized()
      })
    );
  }

  const detailPathTitles = detailNode ? buildPathTitles(boardTree, detailNode.id) : [];

  return h(
    "div",
    { className: "dsh-compass-root", "data-theme": theme, ref: rootRef },
    h(TopBar, {
      view,
      onView,
      query,
      onQuery: setQuery,
      searching: search.searching,
      matchCount: search.matchCount,
      trashCount: trashEntries.length,
      onOpenTrash: () => {
        setTrashNotice(null);
        setTrashOpen(true);
      },
      onRefresh: () => cwd && void loadTree(cwd),
      onOpenSettings: () => setSettingsOpen(true)
    }),
    h(PinnedList, { items: pinned, onJump: jumpTo }),
    initialized && boardTree && (boardTree.root?.children?.length ?? 0) === 0
      ? h(EmptyState, {
          kind: "empty",
          message: "任务板还是空的。",
          hint:
            trashEntries.length > 0
              ? `板上没有可见任务，回收站里还有 ${trashEntries.length} 项（顶栏垃圾桶图标可还原）。`
              : "让 AI 用 compass_require 建第一条需求，再用 compass_plan 拆任务。",
          onCopyHint: () => navigator.clipboard.writeText("请用 compass_require 建第一条需求，再用 compass_plan 拆任务。")
        })
      : initialized && search.searching && rows.length === 0
        ? h(EmptyState, {
            kind: "search",
            message: `当前视图无匹配：${query}`,
            hint: "可切到「完整轨迹」再搜，或清空搜索。",
            onRetry: () => setQuery(""),
            retryLabel: "清空搜索"
          })
        : initialized
          ? h(TreeView, {
              rows,
              expanded,
              onToggle,
              onOpenDetail: openDetail,
              onDiscard: discardNode,
              currentSessionId: props.sessionId,
              nowMs: nowTick
            })
          : h(EmptyState, { kind: "loading", message: "加载任务板…" }),
    h(StatusBar, {
      workspaceLabel: workspace?.cwd ? workspace.cwd.split(/[\\/]/).filter(Boolean).pop() : null,
      lastUpdated: mtime ? new Date(mtime).toLocaleTimeString("zh-CN", { hour12: false }) : null,
      pollingOn: shouldPoll({ tabVisible, docVisible: document.visibilityState === "visible", editing }),
      dirty,
      boardBehind: boardStatus?.turns_since_board_update ?? 0,
      blocked: execCounts ? execCounts["已阻塞"] : 0,
      onRefresh: () => cwd && void loadTree(cwd)
    }),
    settingsOpen
      ? h(SettingsPanel, {
          view,
          rememberExpand,
          onToggleRemember,
          cwd,
          onImported: () => {
            if (cwd) void loadTree(cwd);
          },
          diagnostics: workspace.dataDir
            ? `data: ${workspace.dataDir}\n多窗口并发保护：已启用（写锁 + 版本校验）`
            : null,
          onClose: () => setSettingsOpen(false)
        })
      : null,
    trashOpen
      ? h(TrashDrawer, {
          entries: trashEntries,
          busy: trashBusy,
          notice: trashNotice,
          onRestore: restoreTrash,
          onPurge: purgeTrash,
          onClose: () => {
            setTrashOpen(false);
            setTrashNotice(null);
          }
        })
      : null,
    detailId && detailNode
      ? h(DetailPanel, {
          node: detailNode,
          detail: detail?.detail ?? "",
          noteState,
          onClose: () => setDetailId(null),
          onNoteChange,
          onCopy,
          copied,
          pathTitles: detailPathTitles,
          getSessionLinkState: props.getSessionLinkState,
          openSession: props.openSession,
          jumpToTurn: props.jumpToTurn,
          fileAnchors,
          onOpenFile: openFileAnchor,
          collision: detailCollision,
          cwd
        })
      : null,
  );
}

/** @param {any} tree @param {string} id */
function findNode(tree, id) {
  let found = null;
  const visit = (node) => {
    if (node.id === id) found = node;
    for (const child of node.children ?? []) visit(child);
  };
  for (const req of tree?.root?.children ?? []) visit(req);
  return found;
}

/** @param {any} tree @param {string} id */
function buildPathTitles(tree, id) {
  const path = [];
  const visit = (node, trail) => {
    if (node.id === id) {
      path.push(...trail, node.human_line);
      return true;
    }
    for (const child of node.children ?? []) {
      if (visit(child, [...trail, node.human_line])) return true;
    }
    return false;
  };
  for (const req of tree?.root?.children ?? []) visit(req, []);
  return path;
}

export default CompassTab;
