# dsh-taskbearing UI 设计（右侧栏任务板）

**版本 v1.1（v1.0 评审稿 + v1.1 增量：搜索框） · 2026-11-11**

---

## 0 文档信息

| 项 | 内容 |
|---|---|
| 定位 | 本文件是 dsh-taskbearing **侧边栏 UI 的详细设计**，是数据与接口契约（schema-v2）中 UI 章节的实现级展开；本文件为历史设计稿，行为以 `docs/philosophy.md` 与 `docs/schema-v2.md` 为准。 |
| 依据 | 契约 v1.6 §8（UI 规格）；SPIKE 与宿主 API 调研（本文件 §2）；参考实现 dsh-im（`（参考实现仓库）`）的 client 经验 |
| 目标读者 | 设计评审人（用户）与实现者 |
| 阅读约定 | **D-n**＝设计决策；**C-n**＝实现约束（红线）；【契约】＝契约条款落点；【证据】＝平台事实出处 |

## 0.1 本设计要解决什么

契约只定义了 UI 的**行为**（三视图、钉顶、下钻、详情、复制、轮询），没有定义**形态与实现路径**。本设计回答：

1. 面板长在 DSH 的哪里（哪个 slot/tab 体系）；
2. 数据怎么从 host 到 client、怎么写回去；
3. 每个组件怎么拆、状态怎么管、刷新怎么调度；
4. **哪些坑（尤其 dsh-im 重做过的）现在就用约束封死**，不给自己留第二次重做的机会。

## 0.2 非目标

- 不做新会话首回合自动注入（契约 §7.4）；UI 不碰模型上下文。
- 不做「说人话」按钮、不做机器分层展示、不做拖拽排序、不做删除（契约 §8.9）。
- 不做多窗口/多实例一致性（契约 O-5，单窗口假设）。
- 不做局部渲染的过度优化：MVP 接受整表重渲染（契约 §11.3 降级形态），但结构上留局部渲染的口。

---

## 1 平台事实与约束（先有证据，再有设计）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 右侧栏是 **tab 体系**：`ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted? })`，注册走 `ctx.effect(...)`；body 用 `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, Body)`；body 里 `useTabInfo()` 拿到 `{ sidebar, panel, tab }`，`tab.visible` 区分 body/标题可见性，`tab.signal` 是 abort，`tab.actions` 带 `openTab/openResource/bindCommands` 等 | asar `dsh-client-ui-sidebar-right/README.md`（Extension seats、Tab domain）；`dsh-client-ui-plan`/`ui-schedule`/`ui-sidebar-files` 等 8 个现有插件同一用法 |
| F2 | Guide 入口：tab 类型声明 `guide` 条目 → 右侧栏 guide 页出现卡片，点开进入本页；已有 tab 从 guide/加号/链接打开 | 同上（The guide） |
| F3 | 右侧栏 tab 布局（含收起/全屏/分屏）由 kit 管理，tab 内容区是一个普通 React 容器；**容器高度可能是 auto，必须自己量出像素高度**，否则内部 overflow 不触发（滚动失效 + 顶部空白） | dsh-im `client-entry.tsx` 注释 + `panel-size.ts`（`availablePanelHeight(rect.top, window.innerHeight)`，并在 `transitionend/animationend` 多次重算） |
| F4 | 主题跟随宿主：`usePanelTheme()` 读宿主 DOM 投影（light/dark 自动切换），面板**禁止自造主题**；样式作用域化 | dsh-im `theme.ts`、`scoped-css.ts` |
| F5 | 数据通道：host 侧 `ctx.webServer.register({ kind, path, handler })`，client 用 `fetch`；client facet 不直接读文件 | dsh-im `httpStore.ts`（`/api/im/*`）与 SPIKE（SP-3 静态确认） |
| F6 | client facet 以 `dsh.client.platform="web"` + `dsh.client.inject=["@deepseek-ai/dsh-client-ui-layout"]` 接入宿主 | dsh-im `package.json` |
| F7 | 右侧栏 tab 状态按 session 存 `dsh.sidebar-right.v1.<sessionId>`（kit 自己管）；我们的**视图偏好/展开路径不属于 kit 状态**，要单独存 | asar README（State） |
| F8 | 现有 tab 类型的注册形态可照抄：`ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title }), label)`；错误注册会在装载时报错（warning，不进面板） | `ui-plan/lib/client.js:630`、E2E 装载报错先例（缺 output 时 host 报 must declare） |

**从 F1–F8 推出来的实现红线（C-n）：**

- **C-1 形态**：UI 必须是一个右侧栏 **tab 类型 + guide 入口**，不是自造 webview/弹窗/独立窗口。【F1/F2】
- **C-2 高度**：面板根节点必须落地 `availablePanelHeight` + `transitionend/animationend/resize/ResizeObserver` 多次重算；这是 S1 的验收点，不许省。【F3】
- **C-3 主题**：只允许 `data-theme={theme}` + CSS 变量；不写死颜色。【F4】
- **C-4 数据**：所有读写经 host 路由；写路径白名单（仅 `<id>.note.md` 与 `ui-state.json`）。【F5】
- **C-5 状态**：kit 的 tab 状态不动；视图偏好全局一份、展开路径按工作区，存 `_ui.json` / `ui-state.json`（见 D-10）。【F7】
- **C-6 作用域**：所有样式经 `scopeCss` 前缀 `.dsh-taskbearing`，不污染宿主。【F4】
- **C-7 注册**：tab 类型与 body 都必须包在 `ctx.effect(...)` 里，随插件生命周期释放。【F8】

---

## 2 关键决策（D-1 ~ D-12）

> 每个决策给出备选与理由；标注需要评审确认的点（默认建议值已通过理由收敛）。

### D-1 形态：右侧栏 tab（不是左侧 panellist / 独立面板）

- **选**：右侧栏 tab 类型 `kind="compass"` + guide 入口「任务板」。
- **备选**：dsh-im 式左侧 `sidebar.panellist` 面板。
- **理由**：任务板是「常驻、低操作密度的清单查看器」，右栏 tab 不抢占聊天主区、kit 管理收起/全屏/分屏、guide 提供自然入口；左侧 panellist 适合大面板 IM（多窗格会话管理），对任务板是过度形态，而且用户要的是「瞥一眼就知道做到哪」。
- 【契约】§8.1 面板与信息架构；【证据】F1/F2。

### D-2 数据通道：host 路由 + client fetch，写路径白名单

- **选**：host 用 `ctx.webServer.register` 暴露 `/api/compass/*`；client fetch；路由层做 cwd 校验与只写白名单（只允许写 `<id>.note.md`、`ui-state.json`、`_ui.json`）。
- **备选**：client 直接 fs（做不到，client 无文件系统权限）/ 共享状态对象（跨进程边界不可行）。
- **理由**：与 dsh-im 同构、最短路；安全边界清楚（C-4）。
- 【契约】§3.3 数据通道；【证据】F5。

### D-3 刷新：2s mtime 轮询 + 可见暂停 + 编辑期跳过 + 待刷新标记

- **选**：`GET /api/compass/tree?ifmtime=<ts>`（未变返回 `{changed:false}`，变了返回整树 + mtime）；仅在 `tab.visible && document.visibilityState === "visible"` 时轮询；详情编辑期间暂停清单刷新；编辑结束后若有变更显示「有更新」+ 手动刷新按钮；手动「刷新」入口始终可用。
- **备选**：文件监听（SP-7 未跑，轮询是既定降级）。
- 【契约】§8.7 刷新与轮询、§11.3（局部渲染未承诺）。

### D-4 三视图 + 钉顶区

- 契约已定，不展开重设计：「只看当前（默认）/ 只看在动 / 完整轨迹」一排小标签；待裁决跨层级聚合成钉顶区置顶；废弃/替代仅完整轨迹。
- 【契约】§6.3、§8.2。

### D-5 需求层 + 任务下钻 + 机械计数

- 需求行（第一层）显示：折叠三角 + `human_line` + 汇总徽标 + 机械计数（`n 条任务：进行中 x / 已执行 y / 待裁决 z`）。
- 下钻：需求 → 任务 → 步骤；默认全折叠；点击行切换展开。
- 【契约】§4.4、§6.7、§8.3。

### D-6 详情：tab 内弹层（不是模态、不是新 tab）

- **选**：详情面板以**固定覆盖层**（absolute/fixed 在面板根内）呈现，关闭即回清单；不与宿主全局模态打架。
- **备选**：再开一个 tab（打乱用户节奏）、inline 展开（长详情挤占清单）。
- **理由**：与清单渲染解耦（契约 §8.3）、编辑时清单可以停刷、关闭即回到原位；实现成本低且不需要宿主模态。
- 【契约】§8.3/§8.5。

### D-7 备注编辑：500ms 防抖自动保存 + 状态提示 + 失败重试

- 右栏备注用 textarea，停止输入 500ms 后自动 POST；顶部显示「保存中…/已保存 HH:mm:ss/保存失败」；失败保留草稿 + 重试按钮；编辑中若树变了不打断（D-3）。
- 【契约】§8.5。

### D-8 复制交接格式：契约模板 + 一键复制

- 「复制」按契约 §8.6 模板拼接（任务路径、两线状态、追溯链、所属需求明面、AI 详情、用户备注），写入剪贴板，成功短暂提示「已复制，可粘贴到新会话」。
- 【契约】§8.6。

### D-9 折叠：默认全折叠；「记住展开路径」可选（默认关）

- 开关在设置里：开 → 按工作区存 `ui-state.json` 的 `expanded:[id...]`；关 → 展开状态只在内存，关闭时清空。
- 【契约】§4.9、§8.4。

### D-10 视图偏好：全局一份，存 `_ui.json`（退化方案；O-3 定稿）

- **选**：视图选择（三视图之一）全局一份，经 host 路由读写 `$DSH_HOME/storages/compass/_ui.json`；若宿主配置 API（SP-5）之后可用，无缝替换存储层，行为不变。
- **理由**：O-3 的退化方案即可满足「跨工作区固定」；避免再等 SP-5。
- 【契约】§4.9、O-3。

### D-11 视觉：跟宿主主题；徽标颜色映射

- `usePanelTheme()` + `data-theme`；颜色用宿主变量（`var(--dsh-*)` 存在时优先，备用回退色）；徽标：未开始 灰 / 进行中 蓝 / 已执行 绿 / 待裁决 红 / 废弃与替代 灰删除线。
- 【证据】F4；【契约】§8.3。

### D-12 失败不静默：ErrorState 统一处理

- 路由失败 / 数据损坏 / 未初始化 → 显示错误页（原因 + 重试 + 诊断信息），**不得**静默渲染空板（dsh-im 教训：400 被渲染成空团队）。
- 保存失败 → 状态条 + 重试；编辑中 `beforeunload` 拦截。
- 【证据】F5 + dsh-im `loadFailure` 做法；【契约】§8.8。

---

## 3 信息架构与线框

### 3.1 面板（tab 内容区）

```text
┌─ dsh-taskbearing · compass ───────────────────────────┐
│ [只看当前] [只看在动] [完整轨迹]          [设置]  │
├────────────────────────────────────────────────────┤
│ ● 待裁决区（跨层级置顶）                            │
│   R-001 › 让曲线也能拖控制点               [待裁决] │
├────────────────────────────────────────────────────┤
│ ▾ R-001 把 PPT 里的图变成能拖顶点的形状             │
│     3 条任务：进行中 1 / 已执行 1 / 待裁决 1         │
│     ▾ R-001-T-1 让曲线也能拖控制点       [进行中]    │
│        ▸ R-001-T-1-T-1 松手后控制点能存住            │
│     ▸ R-001-T-2 矩形也能拖顶点           [未开始]    │
│ ▾ R-002 把矩形顶点也做掉                    [进行中] │
│     2 条任务：进行中 1 / 未开始 1                    │
├────────────────────────────────────────────────────┤
│ 最后更新 15:44 · 每 2s 自动刷新 · [手动刷新]        │
└────────────────────────────────────────────────────┘
```

- 顶部视图标签一排固定（只看当前默认亮起）；右上角设置入口。
- 钉顶区只列 `verdict=待裁决` 的节点（跨层级，按最近 pointer 时间倒序），每行显示父链。
- 需求行右侧显示机械计数（纯展示）。
- 底部状态条：最后更新时间、轮询状态、「有更新」标记。

### 3.2 详情弹层（覆盖在面板根内）

```text
┌─ 详情：R-001-T-1 曲线能拖控制点 ─────────────── ✕ ┐
│ 执行：进行中 · 裁决：待裁决 · 路径：R-001 › R-001-T-1 │
├──────────────────────────┬─────────────────────────┤
│ 详情（AI 写，只读）        │ 备注（可编辑）           │
│ editor/shape-path.ts ... │ 顺手把弹回问题也带上     │
│                          │                          │
│                          │ 已保存 15:44             │
├──────────────────────────┴─────────────────────────┤
│ [复制交接内容]  已复制 ✓   [关闭]                   │
└────────────────────────────────────────────────────┘
```

- 左右两栏；左栏 AI 详情只读（等宽字体），右栏备注可编辑（D-7）。
- 底部「复制交接内容」按钮 + 状态提示。
- 原话未锁定时在详情顶部显示「原话待锁：粘贴原始需求文后锁定」（V2，预留区块，MVP 可为空态）。

### 3.3 空态 / 错误态

```text
[未初始化]  任务板尚未初始化。让 AI 调用 compass_init 初始化当前工作区。  [复制提示]
[空板]      任务板还是空的。让 AI 用 compass_require 建第一条需求，再用 compass_plan 拆任务。  [复制提示]
[错误]      读取任务板失败：<原因>。  [重试]  诊断：data_dir / mtime / 最近错误
```

## 3.4 设置菜单

- 视图偏好（只读显示当前视图 + 说明「全局固定」）；
- 「记住展开路径」开关（默认关）；
- 「诊断」：data_dir、节点数、tree.json 字节数、详情文件数、最近写入时间、规则区块状态；
- 「关于」：版本、契约链接。

---

## 4 组件树

```text
CompassTab (面板根：主题/高度/轮询/路由/全局错误态)
├─ TopBar
│  ├─ ViewTabs (只看当前 / 只看在动 / 完整轨迹)
│  └─ SettingsMenu (视图偏好显示 / 记住展开路径 / 诊断 / 关于)
├─ PinnedList (待裁决区：跨层级置顶，父链 + 徽标)
├─ TreeView
│  └─ TreeNode (递归)
│     ├─ RequirementRow (折叠三角 + human_line + 汇总徽标 + 机械计数)
│     └─ TaskRow       (折叠三角 + human_line + 徽标 + dead_reason 截断行)
├─ EmptyState / ErrorState (未初始化 / 空板 / 失败)
├─ DetailPanel (tab 内弹层)
│  ├─ DetailHeader (id/title/两线状态/路径/原话待锁 banner[V2])
│  ├─ DetailBody (左：AI 详情只读；右：NoteEditor)
│  │  └─ NoteEditor (textarea + 自动保存状态)
│  └─ DetailFooter (复制按钮 + 状态 + 关闭)
└─ StatusBar (最后更新 / 轮询状态 / 有更新 / 手动刷新)
```

## 5 状态模型（client）

```ts
type CompassUiState = {
  // 数据
  tree: Tree | null
  mtime: number | null
  workspace: { cwd: string; workspaceId: string } | null
  // 视图
  view: 'current' | 'active' | 'all'          // 全局一份（D-10）
  rememberExpand: boolean                      // 按工作区（D-9）
  expanded: Record<string, boolean>            // 当前会话内展开集合
  // 选择
  detail: { id: string; open: boolean; tab?: 'ai' | 'note' } | null
  // 编辑
  noteDraft: { id: string; text: string; status: 'idle'|'saving'|'saved'|'error'; savedAt?: string } | null
  // 刷新
  polling: { visible: boolean; editing: boolean; dirty: boolean; lastFetchedAt?: string }
  // 错误
  error: { code?: string; message: string; dataDir?: string; retry?: () => void } | null
}
```

- **view 持久化**：写入 `_ui.json`（全局），跨工作区固定；改变时先乐观更新、后台写。
- **expanded**：`rememberExpand=false` 时仅内存；`true` 时写入 `ui-state.json`（按工作区）。
- **detail**：打开时拉详情 + 备注；关闭释放草稿（未保存先拦）。

## 6 数据 API（host 路由）

> 路由层只读 tree/details、只写 note.md / ui-state.json / _ui.json；cwd 必须绝对路径，服务端用 `resolveWorkspacePath` 规范化。

| 路由 | 方法 | 用途 | 入参 | 返回 |
|---|---|---|---|---|
| `/api/compass/current` | GET | 取当前工作区（客户端首次进入时） | — | `{ cwd, workspaceId, initialized, dataDir }` |
| `/api/compass/tree` | GET | 读整树；未变返回空差 | `cwd`, `ifmtime?` | `{ tree, mtimeMs, size }` 或 `{ changed: false }` |
| `/api/compass/detail` | GET | 详情 + 备注 | `cwd`, `id` | `{ id, detail, note, detailMtime, noteMtime }` |
| `/api/compass/note` | POST | 写备注（UI 独占） | `{ cwd, id, content }` | `{ ok: true, mtime }` |
| `/api/compass/ui-state` | GET/PUT | 工作区 UI 状态 | `cwd` / `{ cwd, expanded, rememberExpand }` | `{ expanded: [], rememberExpand: false }` |
| `/api/compass/prefs` | GET/PUT | 全局偏好（视图） | — / `{ view }` | `{ view }` |

- 错误返回统一 `{ error: { code, message, details? } }`（HTTP 400/500），前端 ErrorState 统一展示（D-12）。
- 路由要校验 `id`（`^[A-Za-z0-9-]{1,64}$`）与 `cwd` 绝对路径；写路径拒绝 `tree.json` / `details/<id>.md`（两写者物理分离）。

## 7 刷新与轮询时序

```text
mount → fetch current → fetch tree → 渲染
轮询（每 2000ms，仅 visible 且非编辑中）：
  GET tree?ifmtime=<lastMtime>
    changed=false → 只更新「轮询中」心跳
    changed=true  → 更新 tree + mtime → 渲染；若在编辑中 → 记 dirty=true
编辑结束 / 手动刷新：
  dirty=true → 显示「有更新」并立即拉一次；dirty=false → 无操作
visible 从 false → true：
  立即拉一次（不等到下个 2s）
```

## 8 交互清单

| 操作 | 触发 | 结果 | 边界 |
|---|---|---|---|
| 切视图 | 点视图标签 | `view` 更新 + 写 `_ui.json` | 三选一，不做下拉 |
| 展开/收起 | 点行 | `expanded[id]` 翻转；`rememberExpand=true` 时写 `ui-state.json` | 默认全折叠 |
| 打开详情 | 行尾「详情」 | `detail.open=true`，拉 detail/note | 同一时间只开一个 |
| 编辑备注 | 输入 | 500ms 防抖自动保存；状态提示 | 失败保留草稿 + 重试 |
| 复制交接内容 | 详情底部「复制」 | 按契约模板拼文本 → 剪贴板 → 「已复制 ✓」 | 客户端纯拼接 |
| 待裁决钉顶点击 | 钉顶区行 | 跳到对应需求/任务并展开父链 | 钉顶区跨层级 |
| 手动刷新 | 状态条按钮 | 立即 GET tree | 编辑中不触发 |
| 设置-记住展开路径 | 开关 | 切换时写 `ui-state.json`；关时清空当前工作区记录 | 默认关 |
| 关闭面板 | kit 的 tab 关闭 | 释放轮询与监听 | kit 管布局 |

## 9 视觉规范

- **颜色**：优先 `var(--dsh-*)`；回退：灰 `#8a8f98`（未开始/已替代）、蓝 `#3b82f6`（进行中）、绿 `#22c55e`（已执行）、红 `#ef4444`（待裁决）、灰删除线（已废弃）。
- **字号**：主文本 13px；计数/路径/状态条 12px；AI 详情等宽 12px。
- **间距**：行高 28px；行内左右 padding 8px；钉顶区上下分隔线 1px。
- **图标**：内联 SVG（单例，不引外部图标库；避免依赖宿主内部图标 API）。
- **可达性**：行可键盘聚焦；按钮 aria-label；待裁决行同时给文字「待裁决」（不只颜色）。

## 10 性能

- 目标规模：≤500 节点（契约 §4.10）；首屏渲染预算 <200ms（本地 fetch + 一次渲染）。
- 每行渲染轻量（无重组件）；计数在需求行一次性算（`countDescendants`）。
- 轮询未变时不拉整树（`ifmtime`）；编辑期间暂停。

## 11 测试计划

**client 纯逻辑（node --test，不依赖 DOM）**

| 文件 | 用例 |
|---|---|
| `board-view.ts` | 三视图过滤、钉顶提取、排序（钉顶倒序 + 树序）、机械计数、dead_reason 截断标记 |
| `copy-format.ts` | 契约模板拼接（含父链、两线状态、追溯链、需求明面、两栏正文）、缺备注省略 |
| `ui-state.ts` | 偏好默认值、rememberExpand 开关语义、按工作区合并 |
| `polling.ts` | 可见性/编辑中/防抖的调度决策（纯函数） |

**手工 / 端到端（真实 DSH web）**

- S1：打开 tab、树渲染、高度正确、内部可滚动；
- S2：三视图切换、钉顶区跨层级、需求计数、折叠默认全折叠；
- S3：详情弹层、备注自动保存、复制交接内容到新会话能被 AI 正确读板（A7）；
- S4：轮询刷新（落板后 ≤2s 可见）、编辑期不刷新、待刷新标记（A9）；
- S5：视图偏好跨工作区固定、展开路径按工作区记忆（A12）。

## 12 文件计划

```text
src/client/
  entry.tsx            # apply(ctx)：注册 tab 类型 + guide 入口 + body
  CompassTab.tsx       # 面板根：主题/高度/轮询/路由/全局错误态
  store.ts             # UI 状态与 reducer（纯）
  board-view.ts        # 视图过滤/钉顶/排序/计数（纯）
  copy-format.ts       # 复制交接模板（纯）
  ui-state.ts          # 偏好/展开状态（纯）
  polling.ts           # 刷新调度（纯）
  api.ts               # fetch 封装
  styles.css           # scoped 样式
  components/
    TopBar.tsx / ViewTabs.tsx / SettingsMenu.tsx
    PinnedList.tsx / TreeView.tsx / TreeNode.tsx / RequirementRow.tsx / TaskRow.tsx / StatusBadge.tsx
    DetailPanel.tsx / NoteEditor.tsx / EmptyState.tsx / StatusBar.tsx
src/host/
  routes.js            # /api/compass/* 路由（只读 + 写白名单）
test/
  board-view.test.ts / copy-format.test.ts / ui-state.test.ts / polling.test.ts
```

构建：`vite build --config vite.dsh-client.ts`（同 dsh-im：CJS lib + react 外部化 + wrap）；`package.json` 加 `dsh.client`（platform web + inject layout）。

## 13 实施步骤

| 步骤 | 内容 | 验收 |
|---|---|---|
| S1 | entry 注册 + 路由 + 只读树渲染 + 高度/滚动 | tab 能开，树显示，内部可滚（C-2 验收点） |
| S2 | 三视图 + 钉顶 + 需求计数 + 折叠 | 视图切换正确，待裁决置顶，计数正确 |
| S3 | 详情弹层 + 备注自动保存 + 复制 | 编辑自动保存成功/失败有提示；复制文本可被新会话 AI 读板 |
| S4 | 轮询/可见性/编辑期/待刷新 | 落板后 ≤2s 可见；编辑不打断；待刷新标记出现 |
| S5 | 视图偏好/展开记忆/空态错误态/设置 | 偏好跨工作区固定；展开按工作区记忆；失败不静默 |

每步跑 `node --test`（纯逻辑）+ 真实 DSH web 手工核对。

---

## 14 重做预防清单（把「会重做」的点提前封死）

| 教训（dsh-im 真实踩过） | 本设计的对应约束 |
|---|---|
| 面板高度 auto → 内部 overflow 永不触发（不滚 + 顶部空白） | **C-2**：S1 必须落地 `availablePanelHeight` + `transitionend/animationend/resize/ResizeObserver` 多次重算；这是 S1 的验收点，不许省 |
| 自造主题/配色 → 与宿主违和、返工 | **C-3**：只允许 `data-theme` + CSS 变量；禁止写死颜色与主题开关 |
| 400 被渲染成「空团队」→ 误以为数据没了 | **D-12**：所有失败走 ErrorState（原因 + 重试 + 诊断），禁止静默渲染空板 |
| 数据根指向错（`.dsh-im` 内部 / 相对路径）→ 写错位置 | **C-4 + 路由校验**：cwd 必须绝对路径，服务端 `resolveWorkspacePath` 规范化；写路径白名单 |
| scoped CSS 污染宿主 | **C-6**：全部样式经 `scopeCss` 前缀 `.dsh-taskbearing` |
| persist 失败静默 → 刷新丢数据 | **D-7/D-12**：保存失败状态条 + 重试；编辑中 `beforeunload` 拦截 |
| 自定义形态跟平台布局打架（想自造面板/webview） | **D-1/C-1**：只用右侧栏 tab 体系，不自造容器 |
| 状态存错地方（tab 状态/视图偏好/数据混在一起） | **C-5/D-10**：kit 管 tab 布局；视图偏好存 `_ui.json`；展开按工作区存 `ui-state.json`；数据留 `$DSH_HOME` |

---

## 15 待评审确认（默认建议值，评审通过即冻结）

| 编号 | 决策 | 建议 |
|---|---|---|
| Q-1 | 形态 | 右侧栏 tab（D-1） |
| Q-2 | 数据通道 | host 路由 + 写白名单（D-2） |
| Q-3 | 详情形态 | tab 内弹层（D-6） |
| Q-4 | 视图偏好存储 | `_ui.json`（D-10，O-3 按退化定稿） |
| Q-5 | 刷新 | 2s mtime 轮询 + 可见暂停 + 编辑期跳过（D-3） |
| Q-6 | 局部渲染 | MVP 不承诺（整表重渲染），结构留口（D-3） |

## 附录 A：平台 API 摘要（照抄用）

- 注册类型：`ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide? }), "dsh-taskbearing: tab type")`
- 注册 body：`ctx.slots.register({ name: "sidebar.right.pane.tab", key: "dsh-taskbearing" }, CompassTab)`；body 用 `useTabInfo()` 拿 `{ sidebar, panel, tab }`（`tab.visible / tab.signal / tab.actions`）
- guide 入口：`guide: [{ id: "compass-board", title: "任务板", description: "需求与任务进度板" }]`
- 数据路由：host `ctx.webServer.register({ kind: "compass", path: "/api/compass/...", handler })`
- 主题：`usePanelTheme()` → `data-theme={theme}`；高度：`availablePanelHeight(el.top, window.innerHeight)` + `transitionend/animationend/resize/ResizeObserver`
- 样式：`scopeCss(css)` + `<style id="dsh-taskbearing-css">`

## 附录 B：与契约 §8 的对照

| 契约条款 | 本设计落点 |
|---|---|
| §8.1 面板与信息架构 | §3.1 + D-1 |
| §8.2 视图规则 | §3.1 + D-4 + board-view.js |
| §8.3 清单行 | §3.1 + TreeNode/RequirementRow/TaskRow |
| §8.4 折叠 | D-9 + ui-state.js |
| §8.5 详情面板 | D-6/D-7 + DetailPanel/NoteEditor |
| §8.6 复制交接格式 | D-8 + copy-format.js |
| §8.7 刷新与轮询 | D-3 + polling.js |
| §8.8 空态/错误态 | D-12 + EmptyState/ErrorState |
| §8.9 不做清单 | §0.2 + D-1 |

## 附录 C：实施中发现的平台事实（2026-11-11，CDP 真机验收）

真机（隔离 web profile `compass-web` + agent CDP 浏览器）跑通后补正的平台事实，**与设计不冲突，是实现细节**：

1. **client bundle 必须包 `window.__ModuleLoader__`**：DSH 以 factory 形式装载 client facet（`load({ id, factory: (require) => {... return module.exports } })`）。直接交 Vite 的 CJS 产物会在模块顶层 `require("react")` 处报 `import failed`。构建步骤 = `vite build`（CJS，react 外部化）→ 包装成 `__ModuleLoader__.load(...)`（`scripts/build-client.mjs`）。
2. **guide 条目的 `title`/`description` 是函数**（`() => "任务板"`），不是字符串；字符串会让 guide 渲染抛错、面板空白。另需 `order` 字段。
3. **`sidebar.right.pane.tab` body props 自带 `sessionId`**：工作区解析直接用它；客户端 `ctx.sessions` 是 `{ids, byId, phase}`（**没有** `.list.getSnapshot()`，与桌面插件不同），反查工作区用 `ctx.workspaces.list.getSnapshot().items[].sessionIds`，查不到再把 `sessionId` 传给 host 路由由宿主解析。
4. **`tab` 记录字段**：`{ id, kind, contentId, title, visible, navigation, signal, actions, refreshShortcut }`（无 sessionId，sessionId 在 body props）。
5. 面板挂在真实会话里按会话绑定工作区验证通过：状态条显示工作区名（`plan`）作为绑定自证，防止错误工作区被当成正确数据。

验收证据：`（开发期证据路径）`（guide、任务板、展开+复制、详情）。
## 附录 D：v1.1 增量（搜索框，2026-11-11）

- **D-13 搜索**：面板顶部与视图标签同一行加搜索框；匹配 title/human_line/dead_reason（大小写不敏感、多词全命中）；先视图过滤再关键词过滤；命中节点祖先链自动展开、未命中兄弟隐藏；显示命中数；空结果「无匹配」+「清空搜索」；Esc 清空；不持久化。
- 组件增 `SearchBox`（在 `TopBar` 内）；`board-view.js` 增 `searchRows()`；空态增 `kind="search"`。
- 交互：输入即过滤；搜索不改变当前视图；搜索期间轮询继续（数据变化后重新过滤）。