/**
 * client facet 入口：注册右侧栏 tab 类型 + guide 入口 + tab 内容（CompassTab）。
 * 与 ui-plan / ui-schedule / ui-sidebar-files 同款注册形态（F1/F8）。
 *
 * 工作区解析（实测）：`sidebar.right.pane.tab` 的 body props 自带 `sessionId`；
 * 客户端 `ctx.sessions` 没有 `.list.getSnapshot()`（与桌面插件不同），
 * 所以用 `ctx.workspaces.list.getSnapshot().items` 按 sessionIds 反查工作区路径；
 * 反查不到时把 sessionId 传给 host 路由 `/api/compass/current` 由宿主解析。
 */

import CompassTab from "./CompassTab.js";
import { CompassApi } from "./api.js";
import { sessionLinkState } from "./pointer-view.js";
import { jumpToTurn as jumpToTurnCore, resolveJumpTarget } from "./turn-jump.js";
import styles from "./styles.css?raw";

export const inject = ["slots", "sidebarRightTabs", "sessions", "workspaces", "uiWorkspace", "sidebarRight"];

const STYLE_ID = "dsh-taskbearing-css";

function installStyles() {
  const existing = document.getElementById(STYLE_ID);
  if (existing) {
    existing.textContent = styles;
    return () => existing.remove();
  }
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = styles;
  document.head.appendChild(el);
  return () => el.remove();
}

/** 按 sessionId 反查工作区路径（绝对路径）；查不到返回 null。 */
function workspacePathFor(ctx, sessionId) {
  if (!sessionId) return null;
  try {
    const snapshot = ctx.workspaces?.list?.getSnapshot?.() ?? ctx.workspaces?.getSnapshot?.() ?? null;
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const selected = items.find((item) => Array.isArray(item?.sessionIds) && item.sessionIds.includes(sessionId));
    return selected?.path || selected?.cwd || null;
  } catch {
    return null;
  }
}

/**
 * 会话可用性上下文（SP-9）：优先用 sessions 快照（`.ids`/`.phase`），
 * 退化从 workspaces 快照的 `items[].sessionIds` 汇总；宿主不提供时返回空上下文（UI 走不可用降级）。
 * @param {any} ctx
 */
function sessionStateContext(ctx) {
  try {
    const sessionsSnapshot = ctx.sessions?.list?.getSnapshot?.() ?? null;
    const workspacesSnapshot = ctx.workspaces?.list?.getSnapshot?.() ?? null;
    let sessions = sessionsSnapshot && Array.isArray(sessionsSnapshot.ids) ? sessionsSnapshot : null;
    if (!sessions) {
      const ids = [];
      for (const item of Array.isArray(workspacesSnapshot?.items) ? workspacesSnapshot.items : []) {
        for (const id of Array.isArray(item?.sessionIds) ? item.sessionIds : []) ids.push(id);
      }
      if (ids.length > 0) sessions = { ids, phase: "ready" };
    }
    const workspaces = workspacesSnapshot ?? (sessions ? { state: "ready" } : null);
    const canOpen = typeof ctx.uiWorkspace?.openSession === "function";
    return { canOpen, sessions, workspaces };
  } catch {
    return { canOpen: false, sessions: null, workspaces: null };
  }
}

export function apply(ctx) {
  ctx.effect(() => installStyles(), "dsh-taskbearing: styles");

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: "dsh-taskbearing",
        kind: "compass",
        title: () => "任务板",
        guide: [
          {
            id: "compass-board",
            order: 10,
            title: () => "任务板",
            description: () => "需求与任务进度板"
          }
        ]
      }),
    "dsh-taskbearing: tab type"
  );

  ctx.effect(
    () =>
      ctx.slots.register({ name: "sidebar.right.pane.tab", key: "dsh-taskbearing" }, (props) => {
        const sessionId = props?.sessionId ?? null;
        return CompassTab({
          ...props,
          sessionId,
          projectRoot: workspacePathFor(ctx, sessionId),
          // 追溯指针跳转（SP-9）：每次渲染按最新快照判定可用性
          getSessionLinkState: (pointerSessionId) => sessionLinkState(pointerSessionId, sessionStateContext(ctx)),
          openSession: (pointerSessionId) => {
            try {
              if (typeof ctx.uiWorkspace?.openSession !== "function") return false;
              ctx.uiWorkspace.openSession(pointerSessionId);
              return true;
            } catch {
              return false;
            }
          },          // 追溯指针跳转（SP-9 / B-61）：先用宿主会话日志核验/还原真实轮次，再定位并高亮
          jumpToTurn: async ({ sessionId: pointerSessionId, turn, at, cwd } = {}) => {
            const openTarget = (id) => {
              try {
                if (typeof ctx.uiWorkspace?.openSession !== "function") return false;
                ctx.uiWorkspace.openSession(id);
                return true;
              } catch {
                return false;
              }
            };
            const plan = await resolveJumpTarget({
              sessionId: pointerSessionId,
              turn,
              at,
              request:
                cwd && pointerSessionId
                  ? (params) => CompassApi.sessionTurn(cwd, params)
                  : null
            });
            // 日志缺失 / 戳记轮次不存在 / 无轮次：如实提示，只打开原会话（子代理会话则打开父会话）
            if (plan.reason === "log-unavailable" || plan.reason === "turn-missing" || plan.reason === "no-turn") {
              const openSessionId = plan.meta?.target_session ?? pointerSessionId;
              let opened = true;
              if (openSessionId !== sessionId) opened = openTarget(openSessionId) !== false;
              return { ok: false, reason: plan.reason, opened, pages: 0, plan };
            }
            const result = await jumpToTurnCore({
              sessionId: plan.meta?.target_session ?? pointerSessionId,
              turn: plan.targetTurn,
              currentSessionId: sessionId,
              openSession: openTarget
            });
            return { ...result, plan };
          },
          // 会话可用性核验（B-61）：快照里没有的历史会话，按日志存在性覆盖「会话不可用」假阴性
          checkSessions: async (cwd, ids) => {
            if (!cwd || !Array.isArray(ids) || ids.length === 0) return null;
            try {
              const data = await CompassApi.sessionLinks(cwd, ids);
              const map = {};
              for (const item of data?.sessions ?? []) map[item.session] = item.exists === true;
              return map;
            } catch {
              // 旧宿主缺接口/网络失败：保持原有降级（不阻断面板）
              return null;
            }
          },
          // 文件锚点（SP-10）：用侧边栏资源打开（与聊天内点文件同款）；不支持时返回 false 由 UI 降级
          openResource: (address, options) => {
            try {
              if (typeof ctx.sidebarRight?.openResource !== "function") return false;
              ctx.sidebarRight.openResource(address, options);
              return true;
            } catch {
              return false;
            }
          }
        });
      }),
    "dsh-taskbearing: tab body"
  );
}
