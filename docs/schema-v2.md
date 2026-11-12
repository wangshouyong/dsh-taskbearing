# dsh-taskbearing 数据与接口契约（schema-v2）

[**中文**](schema-v2.md) | [English](schema-v2.en.md)

> **本文件为中文权威版**；英文镜像见 [schema-v2.en.md](schema-v2.en.md)。契约变更先改中文版，再同步英文镜像。

> 适用版本：`0.1.1`。文中「v1.2x」是内部迭代标记，仅用于指明某项约定的引入时间，不是对外版本号。

> 面向二次开发：数据结构、字段格式、工具 API、状态枚举与迁移/交换格式。
> 产品行为、设计哲学与使用方式见 [philosophy.md](philosophy.md)。
> 当前数据格式：`meta.json` / `tree.json` schema `1`，`baseline.md` schema `2`（多行原话转义）。文档版本：基于契约 v1.32。

本文件中的路径占位符：`<DSH_HOME>` = DSH 用户数据根目录；`<WORKSPACE_PATH>` = 当前工作区根目录。

## 3 总体架构

### 3.1 分层

```text
┌──────────────────────────────────────────────────────────┐
│                        UI 层（client facet）             │
│  侧边栏：需求 → 任务 → 步骤（三视图 / 折叠下钻 / 详情）   │
│  只做渲染与用户输入，不做任何语义判断                     │
└───────────────────────┬──────────────────────────────────┘
                        │ 数据通道（宿主提供：HTTP 路由 / IPC）
┌───────────────────────▼──────────────────────────────────┐
│                     工具层（host facet）                 │
│  init / require / plan / update / read / change / merge  │
│  move / import / status / migrate（11 个工具）           │
│  格式与完整性校验、patch 语义、串行写队列                 │
└───────────────────────┬──────────────────────────────────┘
                        │ 读写文件（内部串行化 + 原子写）
┌───────────────────────▼──────────────────────────────────┐
│                        存储层                            │
│  $DSH_HOME/storages/compass/<工作区名>-<hash>/           │
│    meta.json / baseline.md / tasks/tree.json / details/  │
└───────────────────────┬──────────────────────────────────┘
                        │ 规则标记区块
┌───────────────────────▼──────────────────────────────────┐
│                        规则层                            │
│  安装 / 升级 / 清理 $DSH_HOME/AGENTS.md 中的标记区块      │
└──────────────────────────────────────────────────────────┘
```

### 3.2 组件职责与边界

| 层 | 职责 | 明确不做 | 实现载体 |
|---|---|---|---|
| UI 层 | 清单渲染、视图切换、折叠、详情面板、备注编辑、复制 | 不判断、不生成摘要、不改 AI 栏 | client facet（Web 面板） |
| 工具层 | 七个工具的入参校验、patch 合并、结构校验、原话取回、串行写、错误码 | 不判断语义、不替 AI 决定状态 | host facet（cordis 插件） |
| 存储层 | 文件读写、原子写、schema 校验与迁移、目录定位 | 不缓存后推断、不静默修复 | host 侧 store 模块 |
| 规则层 | 规则区块安装/升级/卸载清理、幂等 | 不改标记区块以外的任何内容 | host facet |

### 3.3 数据通道

- UI（client facet）**不假设**具备文件系统权限；所有数据访问经宿主提供的能力（HTTP 路由、IPC 或宿主 fs 服务），具体形态由宿主能力决定（见 [philosophy.md](philosophy.md)）。
- **只读**：`tree.json`、`details/*`、`baseline.md`、`meta.json`。
- **只写**：`details/<id>.note.md`、UI 状态文件（视图偏好 / 展开路径）。
- `tree.json`、`baseline.md`、`details/<id>.md` 三处**只能由工具层写**，UI 不得写。

### 3.4 运行时与并发

- host 侧所有写操作经**进程内 FIFO 串行队列**执行；每次操作按「读全量 → 内存修改 → 原子写回」完成，AI 不感知并发、也不需要「先读最新」。
- **跨进程写锁**：同一工作区的读-改-写操作在 `Store.run` 内持有数据目录下的锁文件（`locks/write.lock`，mtime 心跳判活、过期可抢占）；拿不到锁时退避重试，超时返回 `E_LOCK_BUSY`。锁是**互斥优化**，正确性由下一条兜底。
- **乐观版本校验（正确性兜底）**：写回前比对目标文件在本次读入时的 `mtime+size`，若已被其它写者改动，本次操作返回 `E_CONFLICT` 并由工具层整段重做（≤3 次）；重试耗尽仍冲突则如实报错，**不静默覆盖**。
- UI 写备注与 AI 写详情是**不同文件**，不共享锁，互不阻塞；UI 备注写入不参与树写锁。
- 同一工作区开多个 DSH 窗口/多个宿主：并发写不丢更新（锁 + 版本校验 + 重试）；UI 仍按单窗口主视图设计，多窗口同时编辑同一备注以最后写入者为准（备注是用户草稿，不是任务数据）。

### 3.5 数据流

1. AI 在对话中调用 `compass_plan` 建任务、`compass_update` 以 patch 语义改状态并写详情。
2. 插件内部读-改-写串行化，AI 不感知并发。
3. UI 每 2 秒静默轮询文件 mtime（仅面板可见时），变更则重渲染；详情编辑在独立面板，与清单渲染解耦。
4. 用户点某条任务的「复制详情」，手工粘到新会话。
5. 新会话 AI 按需调 `compass_read` 读任务树、上游详情、基线，自行补上下文。

---


### 3.6 追溯与会话核验只读接口

宿主 host facet 提供三个只读 HTTP 路由，供 UI 做事实核验（不写任何数据）：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/compass/session-links?cwd=&ids=a,b,c` | GET | 按会话日志核验存在性；返回 `{sessions:[{session, exists, origin, openable, target_session}]}`；单次 ≤ 50 个。`origin="subagent"` 表示子代理会话（不可直接打开，`target_session` 给父会话） |
| `/api/compass/session-turn?cwd=&session=&turn=&at=` | GET | 跳转前核验/还原真实轮次；返回 `{exists, log_available, turn_count, requested_turn, turn, source, origin, target_session}`；`source ∈ exact / by-at / exact-no-at / parent-at` |
| `/api/compass/history-summary?cwd=` | GET | 面板「暂无数据」空态用：返回本工作区历史会话摘要 `{available, sessions, latest_at, truncated}`。只扫会话目录 + stat，不解压会话日志、不写盘；`sessions>0` 表示是「插件安装前就有会话的旧工作区」 |

规则：

1. 只读；会话 id 接受 `session-<…>`（主会话）与裸 UUID（子代理会话）。
2. `at` 权威：`at` 能定位到轮次就以它为准（旧数据写错的 `turn` 会被还原并标 `by-at`）；`at` 缺失或定位不到时，只有 `turn` 真实存在于日志才接受。
3. 日志不可读 ⇒ `log_available=false`；UI 必须显式降级，不得猜测轮次。
4. 子代理会话：返回父会话 `target_session` 与父会话对应轮次；父会话日志缺失时 `turn=null`。
5. `history-summary` 不依赖任务板是否已初始化；宿主未提供会话日志根目录时返回 `available=false`，客户端按「无法读取历史会话摘要」降级，不阻塞空态。

## 4 存储设计

### 4.1 数据根与工作区定位

- **数据根**：`$DSH_HOME/storages/compass/`（DSH 用户数据根，文档统一以 `$DSH_HOME` 表示）。
- **工作区目录名**：`<工作区名>-<hash>`。
  - 工作区名：工作区目录 `basename`；`compass_init` 允许 `workspace_name` 覆盖；非法字符（`\ / : * ? " < > |`）替换为 `_`，长度 ≤ 40。
  - hash：工作区**规范化绝对路径**的 SHA-256，取前 8 位小写十六进制。
- **定位只用 hash**：数据固定在 `$DSH_HOME`，与工作区物理位置解耦；`meta.json` 的原始路径**仅用于展示和冲突校验**，不作定位依据。
- **路径规范化**：解析软链接/junction（realpath）→ 统一为正斜杠 → Windows 盘符统一大写 → 去除末尾分隔符 → 大小写不敏感平台（Windows/macOS）统一转小写后再 hash，避免同一目录因大小写不同产生两份数据。
- **hash 冲突处理**：目录已存在时读 `meta.json`，若 `original_path` 与当前规范化路径不一致，判定为 hash 冲突，返回 `E_WORKSPACE_MISMATCH`，提示人工处理（不自动合并、不覆盖）。

### 4.2 目录结构

```text
$DSH_HOME/storages/compass/<工作区名>-<hash>/
├── meta.json              # 工作区名、hash、原始路径、schema 版本、创建时间
├── baseline.md            # 需求基线：AI 精简版明面 + 原话折叠
├── ui-state.json          # UI 状态：按工作区的展开路径（UI 独占写）
├── locks/write.lock       # 跨进程写锁（临时文件，正常释放后不存在）
└── tasks/
    ├── tree.json          # 任务树：层级、状态、追溯链、合并关系、废弃理由
    └── details/
        ├── <task-id>.md       # AI 写栏：术语/文件名，给 AI 读
        └── <task-id>.note.md  # 用户备注栏：UI 直接写，物理分离
```

- **两写者分离**：AI 写 `<id>.md`、UI 写 `<id>.note.md`，互不覆盖；读取时拼接，复制时合并（顺序：AI 写 → 用户备注）。
- **高频读低容量**：`tree.json` 保持小，打开板子一次全加载；`details/` 按需读，不撑爆 AI 上下文。
- **视图偏好不在此**：全局偏好存插件配置，跨工作区一份；展开路径按工作区记（见 §4.9）。

### 4.3 meta.json

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schema` | int | 是 | meta 结构版本，当前 `1` |
| `plugin` | string | 是 | 固定 `"dsh-compass"` |
| `workspace_name` | string | 是 | 工作区名（展示用） |
| `original_path` | string | 是 | 规范化后的工作区绝对路径（展示与冲突校验） |
| `path_hash` | string | 是 | 路径 hash（8 位小写 hex） |
| `created_at` | string | 是 | ISO-8601 带时区，如 `2026-11-11T11:25:56+08:00` |
| `plugin_version` | string | 是 | 首次写入该文件的插件版本，用于诊断 |

示例：

```json
{
  "schema": 1,
  "plugin": "dsh-compass",
  "workspace_name": "demo",
  "original_path": "<WORKSPACE_PATH>",
  "path_hash": "3f9a1c2e",
  "created_at": "2026-11-11T11:25:56+08:00",
  "plugin_version": "0.1.0"
}
```

### 4.4 tree.json

树是三层：**项目（隐式根）→ 需求 → 任务（可继续嵌套步骤）**。需求是第一层可见单元。

```json
{
  "schema": 1,
  "root": {
    "id": "ROOT",
    "kind": "project",
    "children": [
      {
        "id": "R-001",
        "kind": "requirement",
        "title": "PPT 矢量转可拖动顶点的几何形状",
        "human_line": "把 PPT 里的图变成能拖顶点的形状",
        "exec_state": "进行中",
        "verdict_state": null,
        "dead_reason": null,
        "merged_into": null,
        "pointers": [
          {"session": "s-8f3a", "at": "2026-11-11T14:31:07+08:00", "turn": 1, "note": "提出需求并锁定原话"}
        ],
        "children": [
          {
            "id": "R-001-T-1",
            "kind": "task",
            "title": "曲线能拖控制点",
            "human_line": "让曲线也能拖控制点",
            "exec_state": "进行中",
            "verdict_state": "待裁决",
            "dead_reason": null,
            "merged_into": null,
            "pointers": [
              {"session": "s-2c91", "at": "2026-11-11T18:20:05+08:00", "turn": 12, "note": "开始"},
              {"session": "s-2c91", "at": "2026-11-11T19:03:44+08:00", "turn": 31, "note": "与老需求撞车，提请裁决"}
            ],
            "children": [
              {
                "id": "R-001-T-1-T-1",
                "kind": "task",
                "title": "贝塞尔控制点持久化",
                "human_line": "松手之后控制点能存住",
                "exec_state": "已执行",
                "verdict_state": null,
                "dead_reason": null,
                "merged_into": null,
                "pointers": [
                  {"session": "s-2c91", "at": "2026-11-11T18:45:12+08:00", "turn": 18, "note": "写完并过测试"}
                ],
                "children": []
              }
            ]
          },
          {
            "id": "R-001-T-2",
            "kind": "task",
            "title": "矩形能拖顶点",
            "human_line": "矩形也能拖顶点",
            "exec_state": "未开始",
            "verdict_state": null,
            "dead_reason": null,
            "merged_into": null,
            "pointers": [],
            "children": []
          }
        ]
      }
    ]
  }
}
```

**节点类型与层级**

| kind | 位置 | 字段 | 说明 |
|---|---|---|---|
| `project` | 仅根节点（`id` 固定 `ROOT`） | `id`、`kind`、`children` | 隐式容器，UI 不渲染为清单行；面板标题显示工作区名 |
| `requirement` | **只能是根的直接子节点** | 全字段 | 需求层，第一层可见单元；`exec_state` 由 AI 汇总子任务判断后写 |
| `task` | 需求之下，或任务之下（可多级） | 全字段 | 任务/步骤；最细一层是一两句「要干啥、盖到哪」 |

**字段说明**

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | int | 树结构版本，当前 `1`（发布前结构直接定稿，见设计文档） |
| `root` | object | 唯一根节点，`kind=project`；未初始化时 `children: []` |
| `id` | string | 见下「ID 规则」 |
| `kind` | enum | `project` / `requirement` / `task` |
| `title` | string | 规范名，给 AI 与追溯链用；非空 |
| `human_line` | string | 一句话人话，给用户看；非空、单行 |
| `exec_state` | enum | `未开始` / `进行中` / `已执行` |
| `verdict_state` | enum \| null | `null` / `待裁决` / `冲突` / `已废弃` / `已替代` / `已确认继续`（落板即回 `null`；`冲突` 为非终端状态） |
| `dead_reason` | string \| null | 仅废弃/替代条目有：一句人话（AI 精简、引用用户裁决原话要点）；复活时清空 |
| `merged_into` | string \| null | 合并目标 id，由 `compass_merge` 写；允许跨需求指向 |
| `pointers` | array | 追溯链；每项 `{session, at, turn, note}`；只追加；`session`/`at` 必填，`turn` 可选 |
| `children` | array | 子节点数组，按创建顺序 |

**不变量**（写入前必须校验，违反即拒绝写入）

1. `root` 唯一且 `kind=project`；项目节点只有 `id`/`kind`/`children`，不含状态与追溯链。
2. `requirement` 节点只能是 `root` 的直接子节点；`task` 节点的父必须是 `requirement` 或 `task`。
3. 树中 `id` 全局唯一；`kind` 合法。
4. `exec_state`、`verdict_state` 只能取上述枚举值（`verdict_state` 含 `冲突`，非终端）。
5. `verdict_state` 为 `已废弃` 或 `已替代` ⇒ `dead_reason` 必须为非空字符串；`null` / `待裁决` / `冲突` ⇒ `dead_reason` 必须为 `null`。
6. `merged_into` 非空时，必须指向树中已存在的 id，且不等于自身。
7. `pointers` 只追加不修改；每项 `note` 非空，`session` 非空，`at` 为 ISO-8601 时间戳（含时区）；`turn` 可选，存在时须为非负整数。
8. `children` 顺序即建树顺序，不由 UI 或时间排序改写。

**ID 规则**

- 根节点固定 `ROOT`（不占需求/任务序号）。
- 需求节点：`R-<3 位序号>`，从 `R-001` 起按现有最大序号 +1（超过 999 自然进位，不截断）。
- 任务节点：`<parentId>-T-<序号>`，序号在父节点内从 1 递增。
- 序号不回收（插件不提供删除）。
- `id` 只允许 `[A-Za-z0-9-]`，长度 ≤ 64。

**需求与任务的挂载关系**

- 一条任务**只属于一个需求**：就是它的祖先需求节点（方案 a）。不设「属于多个需求」的字段——多隶属会让需求层的汇总状态说不清。
- 若两处确实在做同一件事：各自建节点，用 `compass_merge` 把次要节点指向主节点（`merged_into`），UI 归并显示；不复制节点、不多挂。
- 需求层 `exec_state` 是**插件按子任务机械聚合**的派生值（v1.28）：规则见 §6.7；AI 不可手写（`compass_update` 传需求 `exec_state` ⇒ `E_INVALID_ARG`）。UI 机械计数（`n 条任务：进行中 x / 已执行 y`）与聚合状态一致。

**显示顺序与 ID 序号**

- `children` 数组顺序**就是**唯一显示顺序；插入位置由 `compass_plan` 的 `after` / `before` 决定（见 §5.4）。
- `id` 里的序号（`R-001-T-2` 的 `2`）只代表**创建顺序**，不声明显示位置；中间插入后新节点序号可能大于其显示位置（如 `-T-4` 显示在第 2 位），属正常，等同数据库自增主键。
- **禁止**为保持序号连续而重排 id：会同时破坏 `pointers` 追溯链与外部引用，硬禁止。
- UI 清单**不显示 id 序号**（只显示 `human_line` / `title`）；id 仅用于工具引用、复制交接与追溯链。

### 4.5 详情文件

**`<task-id>.md`（AI 写栏）**

```markdown
# R-001-T-1 曲线能拖控制点

- 当前改动：editor/shape-path.ts 的 bezier 控制点持久化
- 已过测试：path.test.ts 1-4
- 未过：path.test.ts 第 5 条（松手弹回）
- 关键决策：走 SVG→DrawingML 路线；否决 LLM 直吐坐标（会话 s-8f3a 第 8 轮）
- 接手提示：坐标系转换是坑，查第 31 轮讨论
```

**`<task-id>.note.md`（用户备注栏）**

```markdown
# 备注

顺手把上次那个弹回问题也带上。
```

规则：

- 编码 UTF-8 无 BOM，换行 LF；缺失文件按空内容处理，不报错。
- AI 栏由 `compass_plan(detail)` / `compass_update(detail)` **整段覆盖**写入；UI 只读。
- 备注栏由 UI **整文件覆盖**写入；工具层只读，不写。
- 详情长度不设上限，由 AI 自行控制，插件不拦。
- 读取详情前必须校验 id 形如 `^[A-Za-z0-9-]{1,64}$`，防止路径穿越；非法 id 返回 `E_PATH_INVALID`。
- 读取与复制时拼接顺序：AI 栏 → 用户备注；中间以空行分隔（复制模板见 [philosophy.md](philosophy.md)）。

**父详情跟随**

父任务/需求节点上的 AI 详情是给 AI 读的**滚动汇总**：当前进展、卡点、子任务状态概览。子任务的状态或详情发生变化后，AI 应同步检查并更新父节点的详情（尤其是「验收/优化项挂在验收任务下」这类分组节点）；插件**不自动汇总**（与 §1.4 非目标一致），由 AI 判断哪些父节点需要更新。

### 4.6 baseline.md

基线只回答「需求是什么 + 原话是什么 + 变过几版」，**不存状态**：进度只在任务树（需求节点 `exec_state` + 子任务状态）。

```markdown
# 需求基线
<!-- dsh-compass:baseline-schema 1 -->

## R-001 PPT 矢量转可拖顶点形状

**明面**：把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏
**版本**：
- v1（2026-11-11T14:31:07+08:00｜原话已锁）：
  - 精简：把 PPT 里的图变成能拖顶点的形状
  - 原话（会话 s-8f3a · 2026-11-11T14:30:52+08:00）：「把 PPT 里的图变成能拖顶点的形状，原来的静态显示别弄坏」
- v2（2026-11-11T15:02:10+08:00｜原话已锁）：
  - 精简：同上，并明确「静态显示别弄坏」
  - 原因：用户第 12 轮补充约束
  - 原话（会话 s-9c11 · 2026-11-11T15:01:44+08:00）：「……原来静态显示也不能坏」
```

规则：

- **明面**永远是最新 AI 精简版，不直接抄用户原话。
- **原话逐字保存**：原话必须与用户消息逐字一致，每条原话附会话与消息时间；严禁 AI 转述、改写或「顺手优化」。
- **当前会话原话写入**：当前会话中用户刚说过的原话，允许 AI 通过 `original_text` 传入；插件从**当前会话**用户消息中逐字比对，一致才记 `原话已锁`，不一致返回 `E_ORIGINAL_MISMATCH` 且不写数据。这样既满足「当前上下文已有的信息不再跨会话取证」，又保留保真兜底（AI 无法把转述/改写锁进基线）。转义与注入块剥离由插件完成。
- **跨会话原话**：仍由插件按 `original_refs` 取回（`compass_import` 回填或显式 refs）；该通道只用于「新会话交接不足需溯源」与「跨会话数据修复/审计」，禁止用于重复拉取当前上下文已有的信息。
- **剥离机器注入块**：DSH 会把 `<system-reminder>…</system-reminder>`、运行时上下文快照（`Time sampled while preparing turn …`、`Browser time zone for this request:`、`Elapsed since the preceding …`）、技能清单等以 user 角色注入；两个通道取原话都必须剥掉/排除这些内容，只保留用户真正打出的文字。
- **原话权威来源**：优先取 `session/event` 中 `user/message` 且 `data.source.kind="user"` 的消息正文——`deriveMessages()` 会丢 `source`，无法区分真实用户与机器注入；退化路径才用 deriveMessages 启发式（剥注入 + 排除 runtime-context / 指令基线特征 + 排除超长指令文件）；两条都取不到记「原话待锁」。
- **历史回填原话**：回填需求的 v1 原话由 `compass_import` 从历史会话日志逐字读出（`refs` 指向 preview 结果），AI 不传原话正文；历史 `pointer.session` 指向历史会话、`at` 取消息时间、`turn` 不可靠时留空。
- **原话锁定**：取回成功即记 `原话已锁`；取不回（插件读不到、消息找不到）则记 `原话待锁`，由用户在 UI 粘贴后才锁定（由用户在 UI 粘贴后锁定）。
- **变更用 `compass_change` 追加版本**，不覆盖旧版；每次追加都要重新锁定该版原话。
- 解析约束：一级标题固定 `# 需求基线`；文件头带 `<!-- dsh-compass:baseline-schema N -->`；每个需求以 `## R-<3 位数字> <标题>` 开头；正文含 `**明面**：` 与 `**版本**：`；版本条目形如 `- v<N>（<at>｜原话已锁|原话待锁）：`，其下含 `- 精简：`、可选 `- 原因：`（`compass_change` 的改写原因）与 `- 原话（会话 <id> · <at>）：「<逐字原文>」`（未锁时该行为 `- 原话（待锁）：「」`）。解析失败时 `compass_read(scope=baseline)` 返回 `E_STORE_CORRUPT` 并指出行号。
- **多行原话转义（schema 2，B-44）**：原话可能来自多行文档段（迁移）。基线是行式格式，原话中换行写作字面 `\n`、反斜杠写作 `\\`，解析时按文件头 schema 号还原：`schema >= 2` 反转义、`schema = 1`（旧文件）原样读取；写回时统一升级为 schema 2。迁移的「逐字」以**还原后的文本**为准（与源文件对应行段逐字节一致）。
- `requirement_id` 由 `compass_require` 生成（`R-<3 位>`，从 `R-001` 递增），`compass_change` 只引用已有 id。
- 基线不含状态字段；UI 若需展示需求状态，取任务树中该需求节点的 `exec_state`，不另存一份。

### 4.7 写入协议

1. **单写者**：每个文件同一时刻只有一个写者（工具层写 `tree.json`/`baseline.md`/`<id>.md`；UI 写 `<id>.note.md`/`ui-state.json`）。跨写者的文件不得混写。
2. **读-改-写**：工具每次调用从磁盘读全量 `tree.json` → 内存修改 → 校验 → 写回；不依赖内存缓存跨调用存活。整段「读-改-写」必须在 `Store.run` 内完成，不得拆成多次 `run`。
3. **原子写**：先写同目录临时文件 `<file>.tmp-<pid>-<rand>`，`fsync` 后 `rename` 覆盖目标；失败保留原文件并返回 `E_WRITE_FAILED`。不得直接截断目标文件。
4. **串行队列（进程内）**：host 侧维护 FIFO 队列，同一时刻至多一个写操作；队列长度上限（如 32）超出时拒绝并提示（`E_BUSY`）。
5. **跨进程写锁**：数据目录下 `locks/write.lock`。
   - 获取：`open(..., "wx")` 原子创建，内容 `{pid, hostname, token, acquired_at}`；已存在则按锁文件 mtime 判活（默认 10s 无心跳视为过期），过期锁整份 `rename` 到 `write.lock.stale-<ts>-<rand>` 后重试创建（rename 成功者获得抢占权，避免双抢占）。
   - 心跳：持锁期间每 2s `utimes` 刷新锁文件 mtime；释放时校验 `token` 一致后删除，避免误删被抢占后的新锁。
   - 退避重试至多 5s，超时返回 `E_LOCK_BUSY`（可重试语义，message 说明稍后重试）。
   - 锁只为降低冲突概率；正确性由第 6 条兜底。
6. **乐观版本校验**：`readTree`/`readBaseline` 记录文件 `mtime+size` 版本；`writeTree`/`writeBaseline` 在 rename 前校验版本未变，变化则返回 `E_CONFLICT`。工具层捕获 `E_CONFLICT` 后整段重做（最多 3 次），耗尽则报错；**不得**用「后写覆盖」吞掉他人的更新。
7. **损坏处理**：读取时 JSON 解析失败返回 `E_STORE_CORRUPT`，并提示可用最近的 `.bak` 恢复；**不静默重建**、不丢用户数据。
8. **变更事件日志已废止**：原 `events.jsonl` 备注事件与 `GET /api/compass/changelog` 随全局时间线一并移除（v1.24 废止）。备注保存不再追加事件；已存在的 `events.jsonl` 文件保留在磁盘、不再读写。

### 4.8 schema 版本与迁移

- `meta.json.schema` 与 `tree.json.schema` 均带版本号。
- 读取时：`schema < 当前` ⇒ 先备份（`*.schema-<旧版本>.bak`）再迁移；`schema > 当前` ⇒ 返回 `E_SCHEMA_VERSION`，提示升级插件。
- 迁移在首次读取/`compass_init` 时执行；迁移失败回滚到备份并报错。
- 迁移函数必须可在旧数据上重复执行（幂等）。

### 4.9 UI 状态

| 状态 | 作用域 | 存放 | 写者 | 说明 |
|---|---|---|---|---|
| 当前视图（只看当前/只看在动/完整轨迹） | 全局一份，跨工作区固定 | 插件配置（首选）；退化方案见 | UI | 默认「只看当前」 |
| 展开路径集合 | 按工作区 | `<ws>/ui-state.json` | UI | 只记展开的节点 id 与路径；不记滚动位置 |
| 详情面板打开状态 | 按会话/临时 | 内存 | UI | 不持久化 |

- 「记住展开路径」是**可选项**，默认关闭；开启后按工作区持久化，关闭时清空该工作区记录。
- 视图偏好与展开状态均**不影响**任务数据，删除这些状态不损失任何任务信息。

### 4.10 容量与性能假设

- 任务节点量级：**几百条**（设计目标 ≤ 500）。`tree.json` 在该量级下预计 < 200KB，可整树一次加载。
- 详情文件按需读取；单文件可达数十 KB，不做限制。
- 打开面板首帧 ≤ 200ms（本地文件读取 + 一次渲染）；轮询开销只在面板可见时产生。
- 不为此设计分片、索引或数据库；见 [philosophy.md](philosophy.md) 的「防膨胀」说明。

---


## 5 工具 API

### 5.1 通用约定

**参数与返回**

- 参数一律使用 JSON 对象；字段名 `snake_case`；未列出的字段忽略（但不得静默纠正非法值）。
- 成功：直接返回结果对象（不含信封），便于 AI 直接读取。
- 失败：抛出结构化错误，含 `code`（错误码）、`message`（一句中文，说明怎么了、怎么改）、`details`（可选，含缺失 id 等结构化信息）。具体抛错形态以宿主工具机制为准（SP-1 验证）。

**错误码表**

| 错误码 | 含义 | 触发工具 |
|---|---|---|
| `E_INVALID_ARG` | 参数缺失/类型/取值非法 | 全部 |
| `E_NOT_INITIALIZED` | 工作区未初始化（无 `meta.json`）。**状态而非故障**：`/tree` 返回 HTTP 404 + 该 code 时，客户端必须识别为「暂无数据」空态，不得显示「旧版宿主」 | require/plan/update/read/change/merge、路由 |
| `E_NOT_FOUND` | 未知路由（宿主版本低于客户端预期时的唯一信号）。只有它才被客户端映射为「旧版宿主，缺少该接口」 | 路由层 |
| `E_PARENT_REQUIRED` | 建任务未给 `parent_id`（需求层请用 `compass_require`） | plan |
| `E_ORIGINAL_UNRESOLVED` | 原话取回失败（**warning 级**：写入成功但原话待锁） | require/change |
| `E_ORIGINAL_MISMATCH` | `original_text` 与当前会话用户消息不逐字一致（**错误级**：不写任何数据，提示改用 refs 由插件取回） | require/change |
| `E_DETAIL_PATH_NOT_FOUND` | detail 中识别出的文件路径在磁盘上不存在（**错误级**：整次写入拒绝，`details.missing_paths` 返回缺失清单） | plan/update |
| `E_DETAIL_REQUIRED` | 单节点标记「已执行」时缺少完成说明且无合格旧详情可继承（**错误级**：不写数据） | update |
| `E_BATCH_DETAIL_REQUIRED` | 批量标记「已执行」时存在任务缺少完成说明且无可继承的合格旧详情（**错误级**：整批不写，`details.missing` 返回缺失 id） | update |
| `E_DETAIL_CONTENT_INVALID` | 完成说明不满足内容标准：缺段落，或标签不在行首/段内容为空（修改/构建型缺「核心文件/契约/避坑指南」，查询/调研型缺「查询结论/数据来源/后续建议」）（**错误级**：整次写入拒绝） | update |
| `E_REQUIREMENT_DETAIL_REQUIRED` | 需求即将聚合为「已执行」但需求详情缺少「验收范围 / 完成结论 / 遗留风险」（**错误级**：写树前拒绝，整次不落盘） | update / 写树动作 |
| `E_ANCESTOR_DETAIL_REQUIRED` | 写节点详情（含完成说明）时，其祖先链（父任务 / 父级的父级 / 需求）缺汇总详情或汇总缺段（**错误级**：整次不落盘；`details.missing_ancestors` 给出缺失 id） | update |
| `E_WORKSPACE_MISMATCH` | `meta.original_path` 与当前工作区不一致（hash 冲突） | 全部 |
| `E_PARENT_NOT_FOUND` | `parent_id` 不存在 | plan |
| `E_SIBLING_NOT_FOUND` | `after`/`before` 指定的兄弟节点不存在，或不在同一父节点下 | plan/import |
| `E_POSITION_CONFLICT` | `after` 与 `before` 同时传（互斥） | plan/import |
| `E_TASK_NOT_FOUND` | `task_ids` / `source_id` / `target_id` 含不存在 id | update/merge/read(detail) |
| `E_POINTER_NOTE_REQUIRED` | 状态/裁决/合并变更未带非空 `pointer_note` | update/merge |
| `E_INVALID_TRANSITION` | 状态转移不在 §6.2 矩阵内 | update |
| `E_SUBTREE_INCOMPLETE` | 废弃/替代未覆盖整棵子树；`details.missing` 返回缺失 id | update |
| `E_DEAD_REASON_REQUIRED` | 落 `已废弃`/`已替代` 未给 `dead_reason` | update |
| `E_SELF_MERGE` | `source_id === target_id` | merge |
| `E_REQUIREMENT_NOT_FOUND` | `requirement_id` 不存在（新建需求请用 `compass_require`） | change |
| `E_PATH_INVALID` | 非法 task id（路径穿越风险）/非法工作区名 | read(detail)/init |
| `E_SCHEMA_VERSION` | 数据 schema 高于当前插件支持 | 全部读取 |
| `E_STORE_CORRUPT` | 存储文件解析失败/结构非法 | 全部读取 |
| `E_WRITE_FAILED` | 原子写失败（磁盘/权限） | 全部写入 |
| `E_BUSY` | 写队列超限 | 全部写入 |
| `E_LOCK_BUSY` | 跨进程写锁 5s 内未取得（可重试：稍后再调） | 全部写入 |
| `E_CONFLICT` | 写回前发现目标文件已被其它写者改动（自动重试耗尽后的可见错误） | 全部写入 |
| `E_MIGRATE_SOURCE` | 迁移源文件不存在/不可读/超过 1MB | migrate |
| `E_MIGRATE_REF` | 迁移 `ref` 行号段非法/越界/与 preview 不一致 | migrate |
| `E_MIGRATE_ITEM_INVALID` | 迁移 `items` 字段非法（type/parent/terminal 约束等） | migrate |
| `E_MIGRATE_ARCHIVE` | 迁移成功后原文件归档改名失败（数据已导入，返回改名错误供人工处理） | migrate |

**上下文（session / at / turn / 工作区根）**

- 工具必须能定位「当前工作区根目录」，否则 `compass_init`/`compass_read` 无法工作。
- `session`：插件从宿主上下文**自动填充**，不得由 AI 传入或编造（验证见 SP-1）。
- `at`：插件在追加 pointer 时写入**标准时间戳**（ISO-8601，含时区），不依赖 AI 提供。
- `turn`：三级来源——① host facet 订阅 `session/event` 的 `turn/start`（权威）；② 插件在轮次中途加载时，由宿主读**当前会话日志**还原当前轮（`turn/start`/`turn/end` 同源编号）；③ 都取不到留空。**禁止**用「用户消息条数」估计轮次（DSH 会以 user 角色注入大量伪消息，计数会虚高）。该字段可选，不存在「由 AI 填」的口子（来源见 §6.4）。
- AI 若要在追溯里表达「第 31 轮」，写进 `pointer_note` 的自由文本（如「主会话第 31 轮拍板」）；该文本不承担权威性，权威时间以 `at` 为准。

**幂等性**

| 工具 | 幂等性 |
|---|---|
| `compass_init` | 幂等：重复调用不重建、不覆盖既有数据，返回值标明 `created: false` |
| `compass_require` | 非幂等：每次调用新建一条需求并写基线 v1 |
| `compass_plan` | 非幂等：每次调用都新建节点；`after`/`before` 只影响插入位置 |
| `compass_update` | 目标状态与当前一致时视为成功（不追加空 note），但未带 `pointer_note` 的状态变更仍拒绝 |
| `compass_change` | 非幂等：每次调用追加一个新版本 |
| `compass_merge` | 重复同一对 source→target 视为幂等成功（不重复挪数据；`pointers` 追加一条说明） |
| `compass_read` | 纯读 |
| `compass_status` | 纯读 |
| `compass_move` | 同父同位置重复移动视为成功（不追加空 note）；ID 不变 |
| `compass_import` | 幂等：重复 apply 按 `(parent_id, title)` 去重，已存在返回 existing id，不重复建节点 |

### 5.2 compass_init

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspace_name` | string | 否 | 覆盖目录展示名；缺省取工作区目录名 |
| `root_path` | string | 否 | 覆盖工作区根；缺省取当前会话工作区根 |

- **行为**：解析并规范化路径 → 计算 hash → 创建目录与 `meta.json`、空 `tree.json`（`{"schema":1,"root":{"id":"ROOT","kind":"project","children":[]}}`）、空 `baseline.md`（带 schema 注释）→ 安装/升级全局规则区块（§7.3）。
- **幂等**：目录与 `meta.json` 已存在时：路径一致 ⇒ 返回 `created:false`，仅做规则区块升级检查；路径不一致 ⇒ `E_WORKSPACE_MISMATCH`。
- **返回**：`{ "workspace_id": "<目录名>", "data_dir": "<绝对路径>", "created": true|false, "rule_block": "installed"|"updated"|"unchanged" }`。
- **错误**：`E_INVALID_ARG`（工作区名非法）、`E_PATH_INVALID`、`E_WRITE_FAILED`。
- 若规则区块写入失败（权限等），**不得**让初始化失败：`rule_block` 返回 `"failed"`，并附带可复制的规则文本。

### 5.3 compass_require

新建一条需求（需求层节点）并写入基线 v1；原话支持 AI 传入（当前会话逐字校验）或由插件按 refs 取回。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 规范名，非空、单行 |
| `human_line` | string | 是 | 一句话人话，非空、单行 |
| `surface` | string | 是 | 基线「明面」：AI 精简后的一句话 |
| `original_text` | string | 否 | **v1.24 新增**：当前会话中用户刚说过的原话（逐字）。插件与当前会话用户消息逐字比对，一致才锁定；不一致 ⇒ `E_ORIGINAL_MISMATCH`（不写数据）。与 `original_refs` 互斥，同时传 ⇒ `E_INVALID_ARG` |
| `original_refs` | array \| string | 否 | 跨会话原话来源：`[{"session":"s-xxx","turn":3}]` 或 `"current"`；缺省等价 `"current"`。仅用于新会话溯源/跨会话修复（§5.9 边界） |
| `pointer_note` | string | 否 | 建需求时的一句话；缺省「建需求」 |

- **行为**：生成 `R-<n>` 挂到 `root.children` 末尾 → 写基线条目（明面 + v1 版本）→ 原话：传 `original_text` 则做当前会话逐字校验（通过记 `原话已锁`，附匹配消息的会话与时间）；否则按 `original_refs` 从会话记录**逐字**取回（优先 `session/event` 的 `source.kind="user"` 消息；退化才剥注入，见 §4.6）：成功记 `原话已锁`，失败记 `原话待锁`（原话留空）。
- **返回**：`{ "requirement_id": "R-002", "version": "v1", "original_locked": true|false, "warnings": [...] }`；v1.29 起与板上活跃节点机械查重，命中返回 `POSSIBLE_DUPLICATE` 候选（只提示、不阻断）。
- **约束**：AI 只能在用户确认需求后调用（插件不做语义校验）；`original_text` 必须逐字，**不得转述或改写**——插件逐字校验会拒绝不一致内容；跨会话原话不得由 AI 传入。
- **错误**：`E_INVALID_ARG`、`E_NOT_INITIALIZED`、`E_WRITE_FAILED`、`E_ORIGINAL_MISMATCH`（错误级）、`E_ORIGINAL_UNRESOLVED`（warning，写入仍成功）。

### 5.4 compass_plan

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `parent_id` | string | 是 | 父节点 id：`R-<n>`（需求）或任务 id；**不再接受 `null`**，建需求请用 `compass_require` |
| `title` | string | 是 | 规范名，非空、单行 |
| `human_line` | string | 是 | 一句话人话，非空、单行 |
| `detail` | string | 否 | AI 栏初始内容（整段写入 `<id>.md`） |
| `after` | string | 否 | 插到同一父节点下该兄弟节点**之后**；与 `before` 互斥 |
| `before` | string | 否 | 插到同一父节点下该兄弟节点**之前**；与 `after` 互斥 |
| `pointer_note` | string | 否 | 建节点时的一句话；缺省写「建任务」 |

- **行为**：按 ID 规则生成 id → 定位插入位置（`after` → 该兄弟之后；`before` → 该兄弟之前；都不传 → 末尾）→ `parent.children.splice(index, 0, newNode)` → 写 `tree.json` → 有 `detail` 时写 `<id>.md`。
- **detail 路径校验**：写 `<id>.md` 前机械识别其中的文件路径并用 `fs.existsSync()` 校验（相对路径按工作区根解析）；任一不存在 ⇒ `E_DETAIL_PATH_NOT_FOUND`，本次调用**不写任何数据**（节点也不建）。
- **约束**：`parent_id` 缺失/为空 ⇒ `E_PARENT_REQUIRED`（提示改用 `compass_require` 建需求）；父节点不存在 ⇒ `E_PARENT_NOT_FOUND`，**不静默创建**；`after` 与 `before` 同时传 ⇒ `E_POSITION_CONFLICT`；兄弟不存在或不在 `parent` 下 ⇒ `E_SIBLING_NOT_FOUND`（**不静默退化为末尾**）。调用时机由 AI 判断（仅在用户确认开工后调用，插件不做语义校验）。
- **返回**：`{ "task_id": "<新 id>", "warnings": [...] }`；v1.29 起建任务时与板上活跃节点机械查重，命中返回 `POSSIBLE_DUPLICATE` 候选（只提示、不阻断）。
- **说明**：插入位置只影响 `children` 顺序；`id` 序号只代表创建顺序、不声明位置（§4.4 /）。

### 5.5 compass_update

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_ids` | string[] | 是 | 待更新节点（任务或需求）；批量共享同一 payload；长度 ≥ 1 |
| `exec_state` | enum | 否 | `未开始` / `进行中` / `已执行` |
| `verdict_state` | enum | 否 | `待裁决` / `冲突` / `已废弃` / `已替代` / `已确认继续` |
| `dead_reason` | string | 否 | 落废弃/替代时必填 |
| `detail` | string | 否 | 整段覆盖 `<id>.md`；**仅作用于单个节点**；标记已执行时作为完成说明校验内容标准 |
| `details` | object | 否 | 双用途：①本次标记完成的任务 → 完成说明 `{ "<task-id>": "说明" \| {kind:"build"\|"research", text} }`（整段替换详情）；②本次更新节点的**祖先链** → 汇总 `{ "<祖先id>": "验收范围…/完成结论…/遗留风险…" }`。key 只能是「本次 task_ids」或「本次更新节点的祖先」；可与 `detail` 同传 |
| `pointer_note` | string | 否 | 追溯链的一句话；状态/裁决变更时**必填** |

- **patch 语义**：只改传入字段，未传字段保持原值；插件内部读-改-写，AI 不感知并发，也不需要「先读最新」。
- **批量共享 payload**：`task_ids` + 一组共享字段值；用于「废弃父节点批量标子树状态」。只做共享 payload，不做 per-id payload，不做批量 detail。整批**原子生效**：任一校验失败则整批不写。
- **pointer 追加**：每个受影响节点各追加一条 `{session, at, turn?, note}`；`session`/`at` 由插件填，`turn` 可得才填，`note` 取同一 `pointer_note`。
- **需求节点**：`task_ids` 可包含需求节点（写详情、改裁决）；需求层 `exec_state` **由插件按子任务机械聚合**，AI 传入 ⇒ `E_INVALID_ARG`（§6.7）；废弃/替代需求时 `task_ids` 必须覆盖该需求整棵子树。
- **批量「随父废弃」例外**：同一批 `task_ids` 中，作为被废弃/替代节点后代的节点，允许从 `null` 直接落 `已废弃`/`已替代`（视为随父处置，豁免单节点转移矩阵）；`dead_reason` 与整棵子树覆盖仍必须满足。
- **校验（按序）**：
  1. 存在性：所有 id 必须存在，否则 `E_TASK_NOT_FOUND`（返回缺失 id）。
  2. 至少一个可写字段（`exec_state`/`verdict_state`/`dead_reason`/`detail`）。
  3. 状态或裁决变更 ⇒ `pointer_note` 非空，否则 `E_POINTER_NOTE_REQUIRED`。
  4. 转移合法性：按 §6.2 校验，非法 ⇒ `E_INVALID_TRANSITION`。
  5. 落 `已废弃`/`已替代`：`dead_reason` 非空（否则 `E_DEAD_REASON_REQUIRED`）；`task_ids` 必须覆盖**该节点整棵子树**（含自身与全部后代，含已废弃/已替代节点），否则 `E_SUBTREE_INCOMPLETE` 并返回 `details.missing`。
  6. `verdict_state = 已确认继续`：接受为输入，**落板写回 `null`**，`pointer_note` 必填（§6.6）。
  7. `dead_reason` 只能在落废弃/替代时给出，或随复活清空。
  8. **detail 路径存在性**：传 `detail` 时，机械识别其中的文件路径并 `fs.existsSync()` 校验（相对路径按工作区根解析）；任一不存在 ⇒ `E_DETAIL_PATH_NOT_FOUND`（`details.missing_paths` 给出清单），**整次写入拒绝**（状态/裁决/详情均不落盘）。
9. **完成说明（标记已执行时）**：单节点传 `detail`、批量传 `details`；每个任务要么有新完成说明，要么可继承**已满足内容标准的旧详情**，否则 `E_BATCH_DETAIL_REQUIRED` / `E_DETAIL_REQUIRED`。
10. **完成说明内容标准（结构化段落）**：三段必须**各起一行、标签在行首、段内容非空**（只把标签写进句子里不算）。修改/构建型：核心文件 / 契约（或 契约/文档）/ 避坑指南，且路径必须真实存在；查询/调研型：查询结论 / 数据来源 / 后续建议，允许无路径并跳过存在性校验；未声明 kind 时按两套标准自动识别。缺段 ⇒ `E_DETAIL_CONTENT_INVALID`。
11. **整条祖先链（v1.31）**：本次写详情的节点（`detail` 或完成说明；**标记已执行即使继承旧详情也算**）必须在同一批 `details` 里给**全部祖先**写汇总（summary 标准，见 §5.15）；缺任一祖先 ⇒ `E_ANCESTOR_DETAIL_REQUIRED`，整次不写。
12. **需求完成汇总（v1.31）**：需求将因本批完成而聚合为「已执行」时，需求详情必须已满足 summary 标准，否则 `E_REQUIREMENT_DETAIL_REQUIRED`（update 在写盘前用内存副本预检，保证整批原子）。
13. `details` 键必须是「本次 task_ids」或「本次更新节点的祖先」，否则 `E_INVALID_ARG`；`details` 若含某个 task_id 但不处于「已执行」批次，则该键必须是该节点的祖先（即只能作为汇总），否则 `E_INVALID_ARG`。
14. **幂等重标**：已处于「已执行」的节点重复标注不视为状态变更，不强制重写完成说明（只校验本次真正转为已执行的节点）。
- **返回**：`{ "updated": [...], "rollups": [...], "verdict_normalized": [...], "unchanged": [...], "warnings": [...] }`（`updated` 含一并更新的祖先；`rollups` 列出本次写入的祖先链汇总 id；`verdict_normalized` 列出被落板归零的「已确认继续」节点；标记完成/废弃时机械查重，命中返回 `POSSIBLE_DUPLICATE` 候选，只提示不阻断）。
- **detail 报错文案**：

```text
[Error] 详情写入被拒绝。
原因：检测到详情内容中包含不存在的文件路径 "src/api/user.ts"。
建议操作：请使用终端命令或文件工具核实当前工作区的真实文件结构，并使用真实的绝对路径或相对路径重新提交。严禁捏造路径。
```
- **示例（批量废弃需求整棵子树）**：

```json
{
  "task_ids": ["R-002", "R-002-T-1", "R-002-T-1-T-1", "R-002-T-2"],
  "verdict_state": "已废弃",
  "dead_reason": "用户第 31 轮拍板：该需求整体改由 R-003 覆盖",
  "pointer_note": "主会话第 31 轮拍板废弃 R-002 整棵子树，原因见 dead_reason"
}
```

### 5.6 compass_read

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `scope` | string | 是 | `tree` / `tree-lite` / `detail:<id>` / `baseline` |

| scope | 返回 |
|---|---|
| `tree` | 完整 `tree.json` 内容（含隐式 `ROOT`） |
| `tree-lite` | 节点数组，每项只含 `id / kind / title / human_line / exec_state / verdict_state`；**不带** `pointers`、**不带**详情。层级关系以 id 前缀表达，不重复输出父链 |
| `detail:<id>` | `{ "id", "detail": "<AI 栏原文>", "note": "<备注原文>" }`；缺失文件对应字段为空串 |
| `baseline` | `{ "raw": "<baseline.md 原文>", "requirements": [{ "id", "title", "surface", "versions": [{ "version", "at", "original", "original_lock", "summary" }] }] }` |

- `tree-lite` 的定位是**省 AI 上下文**，不是防体积；`kind` 让 AI 分清需求层与任务层。
- 读取不做权限过滤：新会话 AI 可读任意节点（插件不限读取范围）。

### 5.7 compass_change

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `requirement_id` | string | 是 | 已有需求 id，如 `R-001` |
| `new_text` | string | 是 | 新的「明面」一句人话 |
| `reason` | string | 是 | 为什么改（一句话） |
| `original_text` | string | 否 | **v1.24 新增**：当前会话中用户刚说过的原话（逐字），校验规则同 `compass_require`；与 `original_refs` 互斥 |
| `original_refs` | array \| string | 否 | 跨会话本版原话来源，同 `compass_require`；缺省 `"current"` |

- **行为**：在 `baseline.md` 对应需求下**追加**一个版本（`vN`，N = 现有最大版本 +1），记录 `new_text`、`reason` 与逐字原话（传 `original_text` 时先做当前会话逐字校验；否则按 refs 取回；取回失败记原话待锁）。
- **返回**：`{ "appended": "v3", "original_locked": true|false }`。
- **不输出影响提示**：影响分析由 AI 自行读 `tree-lite` 判断。
- **约束**：只对已存在的 `requirement_id` 生效（否则 `E_REQUIREMENT_NOT_FOUND`）；`original_text` 必须逐字，不一致 ⇒ `E_ORIGINAL_MISMATCH`（不写数据）；跨会话原话不得由 AI 传入。

### 5.8 compass_merge

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source_id` | string | 是 | 被合并节点 |
| `target_id` | string | 是 | 合并目标节点（允许跨需求） |
| `pointer_note` | string | 是 | 合并原因（一句话） |

- **行为**：只写 `source.merged_into = target_id` + 追加追溯链；**不挪子节点、不删数据**；UI 归并显示。
- **校验**：两 id 均存在（否则 `E_TASK_NOT_FOUND`）；`source_id !== target_id`（否则 `E_SELF_MERGE`）；`pointer_note` 非空（否则 `E_POINTER_NOTE_REQUIRED`）。
- **返回**：`{ "merged_into": "<target_id>" }`。

### 5.9 compass_import

**职责**：把插件安装前的历史会话内容回填成板面记录，保证原话逐字可追溯。语义判断仍归 AI（回填哪些需求/任务、挂在哪、状态如何，由 AI 决定）。

**模式一：`preview`（只读）**

- 参数：`session_ids?`（省略 = 当前工作区全部历史会话）、`limit?`（默认 200 条，上限 500）。
- 返回：`{ sessions: [{ session, cwd, messages: [{ index, at, turn?, text }] }] }`；`index` 为该会话内用户消息序号（1 起），`text` 为逐字原文。
- 约束：只读历史会话日志；不写任何数据。

**模式二：`apply`（写板）**

- 参数：`items: [{ type: "requirement"|"task", parent_id?, title, human_line, surface?, exec_state?, verdict_state?, dead_reason?, detail?, refs: [{session, index}], note?, after?, before? }]`，最多 50 项。`after`/`before` 仅 `type=task` 允许，语义与校验同 §5.4（回填按历史顺序落位）。
- `refs` 必须来自 `preview` 返回且真实存在；插件按 ref 重新从日志读原文，**不接受 AI 传入的原话正文**。
- `type=requirement`：建需求 + 基线 v1（原话 = `refs[0]` 的逐字文本，`原话已锁`），`pointer` = `{session: ref.session, at: ref.at, note: "历史回填：" + note}`。
- `type=task`：`parent_id` 必填；建任务，`pointer` 同上。**回填 `exec_state=已执行` 的节点必须自带合格完成说明**（`items[].detail`，内容标准同 §5.15，跨工作区可见跳过路径存在性校验），否则 `E_BATCH_DETAIL_REQUIRED`；回填导致需求聚合为「已执行」时，需求 item 的 `detail` 必须已含完成汇总（`E_REQUIREMENT_DETAIL_REQUIRED`）。
- 去重：`(parent_id, title)` 已存在 → 跳过并返回 `existing`（幂等）。
- 返回：`{ created: [{id, type, refs}], existed: [{id, title}], warnings: [] }`。

**错误码**：`E_HISTORY_NOT_FOUND`（会话不存在/日志不可读）、`E_HISTORY_REF_INVALID`（ref 不在 preview 结果或越界）、`E_IMPORT_LIMIT`（超过 50 项）、`E_IMPORT_ITEM_INVALID`（item 结构非法）。

**与其它工具的关系**：不改动已有七个工具行为；`compass_import` 仅用于"回填历史"，日常仍用 `require` / `plan` / `update`。

**使用边界**：`compass_import`（含 `preview`）是**跨会话历史扫描**，成本高，只允许两种场景：

1. **新会话 + 交接不足**：当前处于新会话，交接文档中的信息不足以支撑判断，需要向前溯源；
2. **跨会话数据修复/审计**：修复历史数据错误或审计原话保真（执行前须向用户说明用途与范围）。

- **禁止**：当前会话上下文中已完全存在用户诉求/原话等信息时，不得再用 `compass_import` 重新拉取；直接使用当前上下文（原话走 `original_text` 逐字校验写入）。
- 违反边界的调用视为过度取证，属于流程缺陷（与数据缺陷同等级记录）。

### 5.10 compass_status

**职责**：只读自查工具。把「板面是否新鲜」变成机械计数，供 AI 每轮结束前自查、供 UI 显示提醒；不做语义判断、不写任何文件。

**参数**：无（工作区/会话/轮次由宿主注入）。

**返回**：

| 字段 | 说明 |
|---|---|
| `board_updated_at` | `tree.json` 最后写入时间（ISO）；板面未初始化时为 `null` |
| `current_turn` | 当前轮次（平台给得出才填，否则 `null`） |
| `turns_since_board_update` | 本会话在板面最后写入**之后**又开始的轮次数（插件实例启动后才开始计数；启动前的历史轮次计 0，由 `note` 说明） |
| `tool_calls_since_board_update` | 同一窗口内观察到的工具调用次数（含读，仅作"是否有活动"信号；**不含 `compass_status` 自身调用**，避免自计数） |
| `suggest` | `"self_check"`（窗口内有活动）/ `"fresh"`（无活动） |
| `health` | 板面健康自检（机械事实，不判断语义）：`{duplicate_pairs:[{a,b,score}], open_task_count, threshold, missing_detail:{tasks,tasks_total,requirements,requirements_total}, stale_chains:{count,items}}`；未初始化时 `null` |
| `note` | 口径说明（含「启动前轮次未计入」限制）与 health 说明 |

**约束**：只读（`tree` 的 mtime 与 `session/event` 的轮次/工具调用计数）；不改变轮询、不写文件。

### 5.11 compass_move

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source_id` | string | 是 | 要移动的节点 id（任务/步骤；需求只能挂根下，不可移动） |
| `parent_id` | string | 是 | 新父节点 id（需求或任务；不能是项目根） |
| `after` / `before` | string | 否 | 新父节点下的位置（同父兄弟 id，语义与 §5.4 相同，互斥） |
| `pointer_note` | string | 否 | 缺省「移动节点」；追加到追溯链 |

- **行为**：从原父节点摘下 → 按新父节点定位插入（缺省末尾）→ 追加追溯链 → 写 `tree.json`。**ID 不变**（：id 是身份不是位置）。
- **约束**：source 不存在 ⇒ `E_TASK_NOT_FOUND`；parent 不存在/是项目根 ⇒ `E_PARENT_NOT_FOUND` / `E_INVALID_ARG`；source 是需求或项目 ⇒ `E_INVALID_ARG`；**不能移进自己的子树**（成环）⇒ `E_INVALID_ARG`（details 给 source/parent）；`after`/`before` 校验同 §5.4。
- **返回**：`{ "moved": "<id>", "from": "<旧父 id>", "to": "<新父 id>" }`。
- **幂等**：同父同位置重复移动视为成功，不追加空 note。
- **ID 全局唯一**：移动后 id 与其父不再有前缀关系（id 是身份不是位置）；新建节点生成 id 时必须基于全树已有 id 去重，跳过被移动节点占用的旧序号。

### 5.12 校验规则汇总

| # | 规则 | 强度 | 错误 |
|---|---|---|---|
| V1 | `task_ids` 全部存在 | 硬 | `E_TASK_NOT_FOUND` |
| V2 | `parent_id` 存在且非空（需求层用 `compass_require`） | 硬 | `E_PARENT_REQUIRED` / `E_PARENT_NOT_FOUND` |
| V3 | 状态/裁决/合并变更必带 `pointer_note` | 硬 | `E_POINTER_NOTE_REQUIRED` |
| V4 | 转移必须在 §6.2 矩阵内 | 硬 | `E_INVALID_TRANSITION` |
| V5 | 废弃/替代覆盖整棵子树 | 硬 | `E_SUBTREE_INCOMPLETE` |
| V6 | 废弃/替代必有 `dead_reason` | 硬 | `E_DEAD_REASON_REQUIRED` |
| V7 | `task_ids` 非空；`detail` 仅单节点 | 硬 | `E_INVALID_ARG` |
| V8 | 批量更新原子生效 | 硬 | 任一失败整批不写 |
| V9 | id / 工作区名格式合法 | 硬 | `E_PATH_INVALID` |
| V10 | human_line 单行、非空 | 软（提示） | 不拒绝，返回 warning |
| V11 | 父任务内容变更须在 note 写明子树是否受影响 | 规则层（AI 自查） | 程序不校验（§6.5） |
| V12 | 节点 `kind` 与层级合法（requirement 只挂 root；task 只挂 requirement/task） | 硬 | `E_INVALID_ARG` |
| V13 | `after`/`before` 互斥；兄弟节点存在且在同一父节点下 | 硬 | `E_POSITION_CONFLICT` / `E_SIBLING_NOT_FOUND` |
| V14 | 标记已执行必须有合格完成说明（新写或继承合格旧详情） | 硬 | `E_BATCH_DETAIL_REQUIRED` / `E_DETAIL_REQUIRED` |
| V15 | 完成说明/汇总按结构化段落校验（行首标签 + 段内容非空） | 硬 | `E_DETAIL_CONTENT_INVALID` |
| V16 | 写详情必须同批更新整条祖先链汇总 | 硬 | `E_ANCESTOR_DETAIL_REQUIRED` |
| V17 | 需求聚合为已执行前必须有需求完成汇总 | 硬 | `E_REQUIREMENT_DETAIL_REQUIRED` |
| V18 | 回填「已执行」节点必须自带合格完成说明 | 硬 | `E_BATCH_DETAIL_REQUIRED` |

> V10 的「软校验」是本方案「只做格式与完整性校验」的边界：插件可以提示，但不替 AI 决定内容。

### 5.13 工具与文件映射

| 工具 | `meta.json` | `tree.json` | `details/*.md` | `details/*.note.md` | `baseline.md` | 规则区块 |
|---|---|---|---|---|---|---|
| `compass_init` | 写 | 建空 | — | — | 建空 | 写 |
| `compass_require` | — | 写 | — | — | 写 | — |
| `compass_plan` | — | 写 | 写（可选） | — | — | — |
| `compass_update` | — | 写 | 写（可选） | — | — | — |
| `compass_read` | 读 | 读 | 读 | 读 | 读 | — |
| `compass_change` | — | — | — | — | 写 | — |
| `compass_merge` | — | 写 | — | — | — | — |
| `compass_import` | — | 写 | 写（可选） | — | 写（requirement） | — |
| `compass_status` | — | 读 | — | — | — | — |
| `compass_move` | — | 写 | — | — | — | — |
| `compass_migrate` | — | 写 | 写（可选） | — | 写（requirement） | — |
| UI 备注编辑 | — | — | — | 写 | — | — |
| UI 复制 / 轮询 | 读 | 读 | 读 | 读 | 读 | — |
| UI 导出 / 导入 | 读写（导入） | 读写（导入） | 读写（导入） | 读写（导入） | 读写（导入） | — |
| UI 本机数据列表（设置页） | 读 | 读 | 读 | 读 | 读 | — |
| UI 文件存在性检测 | 读 | 读 | 读 | 读 | 读 | — |


---

### 5.14 compass_migrate（V3 迁移）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| mode | string | 是 | `preview` / `apply` |
| path | string | 均需 | 旧 `status.md` 绝对路径（预览与导入必须同一文件；apply 时校验与 preview 记录的 mtime 一致，变了要求重新 preview） |
| file_mtime | string | apply 建议 | preview 返回的 `file_mtime`；不一致 ⇒ `E_MIGRATE_REF`（要求重新 preview） |
| archive | boolean | 否 | 成功后归档源文件（默认 true） |
| items | array | apply | `[{type:"requirement"|"task", parent_id?, title, human_line, surface?, exec_state?, verdict_state?, dead_reason?, detail?, ref:"Lx-Ly", note?, after?, before?}]` |

- **preview**：只读扫描（上限 1MB），按 Markdown 结构产出候选，不修改任何数据：
  - 标题 → `headings` 候选（标题行本身可作基线「最初说法」的 ref）+ 层级 `heading_path`；列表项 / 复选框 → `items` 候选条目；每项返回 `{ref:"Lx-Ly", text(截断), kind_hint, heading_path}`；
  - `kind_hint` 为**机械关键词提示**（插件不判断语义）：`done` / `doing` / `next` / `dead` / `other`；
  - 返回 `{mode:"preview", source, file_mtime, items:[...], headings:[...], hint}`。
- **apply**：`ref` 必须来自 preview 的 `items` 或 `headings` 且行号段在文件内；插件**逐字**读取该段原文作为需求 v1 原话（§4.6），pointer 为 `{session:"file:<path>#Lx-Ly", at:文件 mtime, note:"迁移：<note|title>"}`；`human_line`/`surface` 由 AI 提供；节点按 items 顺序建（需求在根、任务挂 `parent_id`，支持 after/before 定位）。
- 整段在 `Store.run` 内（B-39）；失败不留半套数据。
- 成功且 `archive !== false` 时原文件改名为 `status-archive-<YYYY-MM-DD>.md`（同目录、不覆盖：重名追加 `-2`…），返回 `{archived_to}`；改名失败返回 `E_MIGRATE_ARCHIVE`（数据已导入，不改回）。
- 幂等：按 `(parent_id, title)` 去重，已存在返回 existing（与 `compass_import` 一致）。
- 迁移后唯一需要人工校验的是：`baseline.md` 的「最初说法」是否正确。


---


### 5.15 完成说明与祖先链校验

**内容标准（结构化段落）**

| kind | 适用 | 段落（各起一行、标签在行首、段内容非空） |
|---|---|---|
| build | 本次标记完成的修改 / 构建型任务 | 核心文件 / 契约（或 契约/文档）/ 避坑指南；路径必须真实存在 |
| research | 本次标记完成的查询 / 调研型任务 | 查询结论 / 数据来源 / 后续建议；允许无路径（跨工作区 import 跳过路径校验） |
| summary | 祖先链汇总：需求、父任务、父级的父级… | 验收范围 / 完成结论 / 遗留风险 |

**硬门**

1. 标记「已执行」：新写完成说明或继承已满足标准的旧详情；幂等重标（状态未变化）不强制重写。
2. 本次写详情的节点（含「标记已执行」即便继承旧详情）⇒ 其**整条祖先链**必须在同批 `details` 里给汇总；缺任一祖先 ⇒ `E_ANCESTOR_DETAIL_REQUIRED`（不写任何数据）。
3. 需求即将聚合为「已执行」⇒ 需求详情必须已满足 summary 标准；否则 `E_REQUIREMENT_DETAIL_REQUIRED`。
4. `update` 返回 `rollups`（本次写入的祖先链汇总 id），`updated` 包含祖先。
5. **「继承旧详情」不豁免祖先链（v0.1.1 起由代码强制）**：标记「已执行」但本次没有写详情（继承合格旧详情）同样视为一次完成动作，祖先链汇总必须同批提供，否则 `E_ANCESTOR_DETAIL_REQUIRED`；批量逐任务同样适用。避免「继承」成为绕过父链汇总的后门。

**存量自检（`compass_status.health`）**

| 字段 | 机械口径 | 用途 |
|---|---|---|
| `missing_detail.tasks` / `.requirements` | `exec_state="已执行"` 且详情文件为空 | 暴露「已执行但没有交接文档」 |
| `stale_chains.count` / `.items` | 某节点详情文件的 mtime 比其某个祖先新（或祖先为空） | 暴露「子任务更新了、父链没跟随」的陈旧链 |

**豁免**：`compass_migrate`（历史文档迁移）与整板 bundle 恢复（`POST /api/compass/import`）不做祖先链校验；`compass_import`（历史会话回填）按 §5.9 要求完成说明。豁免项仍会被 `health` 机械暴露。

## 6 状态模型

### 6.1 双线定义

| 线 | 字段 | 取值 | 语义 |
|---|---|---|---|
| 执行线 | `exec_state` | 未开始 / 进行中 / 已阻塞 / 已执行 | 活干到哪一步；AI 自行判断，用户可口头要求拨回。「已阻塞」= AI 卡在等第三方/等确认/被别的 bug 挡住，需要人工介入（非终端，可任意互转） |
| 裁决线 | `verdict_state` | null / 待裁决 / 冲突 / 已废弃 / 已替代 / 已确认继续 | 这件事是否被废弃/替代/待拍板/与其它需求冲突；由主会话裁决 |

两条线**物理分开、互不覆盖**：同一条任务可以同时是「已执行 + 待裁决」，也可以同时是「进行中 + 已废弃」。`冲突` 与 `待裁决` 的区别：冲突=与其它/新需求撞车、尚未定性；待裁决=需要用户拍板（不一定冲突）。

### 6.2 状态转移矩阵

| 从 → 到 | 合法 | 附加条件 / 说明 |
|---|---|---|
| `null` → `待裁决` | ✅ | 干活 AI 提请拍板；`pointer_note` 必填 |
| `null` → `冲突` | ✅ | 与其它/新需求撞车、尚未定性；`pointer_note` 必填 |
| `冲突` ↔ `待裁决` | ✅ | 冲突升级为待拍板 或 待裁决被判定为冲突；`pointer_note` 必填 |
| `冲突` → `已废弃` / `已替代` | ✅ | 拍板结论；必带 `dead_reason`；必须覆盖整棵子树 |
| `冲突` → `已确认继续` | ✅ | 落板即回 `null`，结论写进 `pointer_note` |
| `冲突` → `null` | ⚠️ | 仅「撤回冲突标记」；`pointer_note` 必须写原因 |
| `冲突` → `冲突` | ✅ | 幂等（带新 note 视为补充说明） |
| `null` → `已废弃` / `已替代` | ❌ | 必须先走 `待裁决` 再拍板；直接废弃见 |
| `null` → `已确认继续` | ❌ | 瞬时值，不作落板目标 |
| `待裁决` → `已废弃` / `已替代` | ✅ | 主 Agent 拍板；必带 `dead_reason`；必须覆盖整棵子树 |
| `待裁决` → `已确认继续` | ✅ | 落板即回 `null`，结论写进 `pointer_note` |
| `待裁决` → `null` | ⚠️ | 仅「撤回提请」；`pointer_note` 必须写原因 |
| `待裁决` → `待裁决` | ✅ | 幂等（不追加空 note；若带新 note 则视为补充说明） |
| `已废弃` / `已替代` → `待裁决` | ✅ | 复活重议；`pointer_note` 必须写明推翻理由；`dead_reason` 清空，理由进 `pointers` |
| `已废弃` ↔ `已替代` | ✅ | 结论修正；`pointer_note` 必填；`dead_reason` 按新结论更新 |
| `已废弃` / `已替代` → `null` | ❌ | 复活必须先到 `待裁决` |
| `已确认继续` → 任意 | ❌ | 瞬时值，不作起点 |

**批量废弃的「随父废弃」例外**：同一批 `task_ids` 中，作为被废弃/替代节点后代的节点，允许从 `null` 直接落 `已废弃`/`已替代`（视为随父处置，豁免单节点转移矩阵）；`dead_reason` 与整棵子树覆盖仍必须满足。

**执行线规则**：`exec_state` 四个取值之间可任意互转（含「已执行 → 进行中」回退、进行中 ↔ 已阻塞），必须带 `pointer_note`；插件不做跨线约束（「已废弃」的任务仍可改 `exec_state`，显示权由 §6.3 决定）。阻塞原因写在 detail 首行（规则层约束，插件不解析语义）。

**非法转移处理**：返回 `E_INVALID_TRANSITION`，`message` 明确写出允许的目标状态；不写入任何字段。

### 6.3 显示主导权

| 节点状态 | 清单行表现 | 可见视图 | 排序 |
|---|---|---|---|
| `verdict=null` | 执行态徽标 | 只看当前、只看在动、完整轨迹 | 树序 |
| `verdict=null` 且 `exec=已阻塞` | 黄色「已阻塞」标（暂停图标）；hover 显示 detail 首行阻塞原因 | 只看当前、只看在动、完整轨迹 | 树序（状态条单列「阻塞 N」） |
| `verdict=待裁决` | 执行态徽标 + 红色「待裁决」标 | **任何视图** | **钉顶区**（全局置顶） |
| `verdict=冲突` | 执行态徽标 + 橙色「冲突」标 | **任何视图** | **钉顶区**（全局置顶） |
| `verdict=已废弃` | 灰色 + 删除线；执行态降级为次要文字；行内显示 `dead_reason` | 仅完整轨迹 | 树序 |
| `verdict=已替代` | 灰色；执行态降级为次要文字；行内显示 `dead_reason` | 仅完整轨迹 | 树序 |
| `merged_into ≠ null` | 追加「已并入 `<target>`」灰标 | 同其 verdict 规则 | 树序 |

规则：

- **待裁决 / 冲突**只看 `verdict_state`、不看 `exec_state`：即使执行态是「已执行」也要钉顶显示。
- **已废弃 / 已替代夺走主导权**：行的视觉主角是裁决结果，执行态退为辅助信息。
- **已确认继续**不落板、不显示（落板即 `null`）。
- **阻塞不夺走裁决主导权**：待裁决/冲突节点即使执行态为「已阻塞」，仍按裁决规则钉顶；阻塞只作为执行标显示（黄色暂停），并在状态条计数。
- 钉顶区是**跨层级聚合**的独立区块，位于清单最上方，避免深层待裁决节点因父节点折叠而不可见。

### 6.4 追溯链

| 字段 | 类型 | 说明 |
|---|---|---|
| `session` | string | 会话标识；插件自动填，AI 不可写 |
| `at` | string | 落板时刻，ISO-8601 含时区；插件必填 |
| `turn` | int \| 缺失 | 会话内轮次；来源见下「turn 来源」，拿不到可缺省 |
| `note` | string | 自由文本：谁、做了什么、依据是什么；非空；可写「第 N 轮」等说法，不承担权威性 |

追加时机：

| 动作 | 是否追加 pointer | note 内容要求 |
|---|---|---|
| `compass_plan` | 是（可用 `pointer_note` 覆盖默认「建任务」） | 一句话 |
| `compass_update` 改 `exec_state` / `verdict_state` / `dead_reason` | 是（必填） | 说明变更与依据；废弃/替代须引用用户原话要点 |
| `compass_update` 仅改 `detail` | 否（可选带） | 建议带一句「更新详情」 |
| `compass_merge` | 是（必填） | 合并原因 |
| `compass_change` | 否（版本记录在 baseline） | — |

追溯链只追加、不修改、不删除；按时间自然成链。权威时间以 `at` 为准；`note` 里的轮次说法仅供人读，不参与校验。

**turn 来源**

| 优先级 | 来源 | 精度 | 说明 |
|---|---|---|---|
| 1 | `session/event` 的 `turn/start`（`event.data.turn`） | 权威 | host facet 订阅事件流维护 per-session tracker；`turn/end` 关闭 |
| 2 | 当前会话日志还原（`turn/start` / `turn/end` 区间） | 权威同源 | 仅当插件在轮次中途加载（tracker 无当前轮且未见过任何轮次）时使用；按会话缓存 60s，tracker 拿到权威轮次后不再退化 |
| 3 | 留空 | — | 会话日志不可读（如未持久化）时留空；`at` 是权威时间，`note` 可自由写「第 N 轮」 |

- **禁止**用「用户消息条数」估计轮次：DSH 会以 user 角色注入 runtime-context / 技能清单 / agent 消息 / 子代理结果 / 工具通知 / 时间快照，计数虚高（内部实测把第 3 轮记成第 38/48 轮），导致追溯跳转永远定位不到。
- 允许**只读**会话日志（`<DSH_HOME>/sessions/<workspace-key>/<session-id>/session.v4.jsonl.zstd`）做轮次还原与跳转核验——这是持久化数据格式，不是弃用的宿主 API（`eventAt` / `snapshotEvents` 仍禁止）。
- **跳转前核验**：UI 点击追溯记录时先调 §3.6 的 `/session-turn`，以 `at` 为准还原真实轮次；子代理会话跳父会话。失败文案必须区分「日志缺失 / 轮次不存在 / 未渲染」，不得把没定位到说成已定位。
- `turn` 只落数字、不落来源；不参与校验。

### 6.5 证据要求

- AI 写废弃理由时**必须**能追溯到追溯链（哪个会话、什么时刻，轮次说法可写在 `note`）；没有证据不得写「已废弃」。
- 插件**不校验**证据强度（无法程序化判断），只在 UI 中把 `pointers` 完整展示，供用户核对。
- `dead_reason` 由 AI 精简生成，须引用用户裁决时的原话要点；用户可在详情备注中补充自己的判断。

### 6.6 「已确认继续」的瞬时语义

- 作为**输入值**合法：仅允许 `待裁决` → `已确认继续`。
- 落板时**不持久化**：写回 `null`，并在 `pointers` 追加一条包含结论的 note（必填）。
- 若 `pointer_note` 为空 ⇒ `E_POINTER_NOTE_REQUIRED`（否则结论丢失，追溯链断）。
- 读取时不会读到 `已确认继续`；历史结论只能从 `pointers` 中查。

---

### 6.7 需求层状态（插件机械聚合，v1.28）

- 需求节点与任务节点共用 `exec_state` / `verdict_state` 语义；需求层 `exec_state` 是**插件按子任务机械聚合**的派生值（v1.28），不是 AI 写的。
- 聚合规则（忽略 `已废弃`/`已替代` 子树，嵌套任务计入）：无活跃任务 ⇒ `未开始`；任一「已阻塞」⇒ `已阻塞`；任一「进行中」⇒ `进行中`；全部「已执行」⇒ `已执行`；全部「未开始」⇒ `未开始`；其余混合 ⇒ `进行中`。
- 插件在 `plan` / `update` / `move` / `import` / `migrate` 等所有写树动作落盘前自动同步全部需求状态；AI 传需求 `exec_state` ⇒ `E_INVALID_ARG`；旧数据在下次写操作或手动同步时纠正。
- UI 需求行同时显示机械计数（`n 条任务：进行中 x / 已执行 y / 待裁决 z`），与聚合状态一致。
- 需求层被废弃/替代时，`compass_update` 的 `task_ids` 必须覆盖该需求整棵子树（§5.5 结构校验）。
- **完成汇总门（v1.31）**：需求即将聚合为「已执行」时，插件在写树前校验需求详情是否满足 summary 标准（验收范围 / 完成结论 / 遗留风险，各起一行）；缺则 `E_REQUIREMENT_DETAIL_REQUIRED`，整次不落盘。即：标记最后一个子任务之前，必须先写需求完成汇总。

### 6.8 历史回填的追溯链

- 回填节点允许 `pointers[].session` 指向**非当前会话**；`at` 必填且取该历史消息时间；`turn` 取不到可靠值时为 `null`（不得编造）。
- 回填 `pointer.note` 必须以 `历史回填：` 开头，后接一句话说明（例：`历史回填：方案评审阶段`）。
- 回填需求的基线 v1 原话必须与历史消息逐字一致，`msg.session/at` 指向该历史消息；取不到则拒绝回填（`E_HISTORY_NOT_FOUND`），不降级为 AI 代写。
- 回填不改变状态语义：历史已完成任务写 `已执行`，被废弃的写 `已废弃` + `dead_reason`。
- 回填只追加：不回写、不删除、不修改历史会话与既有节点。


## 7 规则区块：安装 / 升级 / 卸载

| 场景 | 行为 |
|---|---|
| 首次安装 | 文件不存在则创建；存在则**追加**区块（前置空行分隔） |
| 重复 init | 区块已存在且内容一致 ⇒ `unchanged`，不重复追加 |
| 插件升级 | **替换**区块内内容为当前版本；不堆叠、不留旧版、不动区块外内容 |
| 卸载 | **一键卸载**：UI「卸载插件」按钮自动移除整段规则区块（含两行标记）+ 删除全部工作区数据；强二次确认（列出规则区块与全部工作区清单）；规则区块损坏 ⇒ 中止且不删数据 |
| 区块损坏（只有 begin 没有 end） | 检测到异常 ⇒ 拒绝自动修改，返回 `E_STORE_CORRUPT` 并提示人工处理（避免误删用户内容） |

- 写文件本身遵循 §4.7 原子写与串行队列。
- 规则区块写入失败不得导致 `compass_init` 失败（降级为「输出可复制文本」）。
- 当前版本规则共 **18 条**（含「需求完成汇总」「整条祖先链一起更新」两条硬规则）。


## 12 迁移与导出/导入

### 12.4 迁移

形态裁决：第 11 个工具 `compass_migrate`（AI 驱动 preview/apply），命令行后补。
目标：把旧的 `status.md` 拆成 **任务树 + 详情 + 需求基线** 三部分（旧稿 human/machine 双目录体系已废止，见设计文档）。

两阶段：

1. `preview(path)`：只读扫描（上限 1MB），按 Markdown 结构产出候选段：
   - 标题 → `headings` 候选（标题行可作基线「最初说法」的 ref）与层级 `heading_path`；无序/有序列表项、任务复选框（`- [x]` / `- [ ]`）→ `items` 候选条目；
   - `kind_hint` 为**机械关键词提示**（插件不做语义判断）：含「已完成/完成/已做/✅/\[x\]」→ `done`；含「进行中/正在/推进中」→ `doing`；含「下一步/待办/TODO/计划」→ `next`；含「废弃/取消/替代/不做」→ `dead`；其余 → `other`；
   - 每项返回 `{ref:"Lx-Ly", text(截断), kind_hint, heading_path}`；AI 据此翻译 `human_line`、决定归属与粒度。
2. `apply(items, archive=true)`：
   1. 最初需求与验收项 → `baseline.md` v1（原话=该段原文**逐字**，pointer 指向 `file:<path>#Lx-Ly` + 文件 mtime）；
   2. 当前执行、子步骤、下一步 → 需求节点 + 任务节点（`human_line` 由 AI 翻译）；
   3. 废弃/替代记录及原因 → `dead_reason` + pointers；
   4. 技术细节 → 对应节点详情（AI 栏）；
   5. 其余过程性内容 → 不迁移，原文件改名 `status-archive-<date>.md` 留档（不覆盖，重名追加序号）。
- 迁移后唯一需要人工校验的是：`baseline.md` 的「最初说法」是否正确。
- 幂等：按 `(parent_id, title)` 去重；重复 apply 返回 existing。
- 整个 apply 在写锁内（B-39）；失败不留半套数据、不改名原文件。

### 12.5 导出 / 导入

包格式（JSON，UTF-8，单文件）：

```json
{
  "format": "dsh-taskboard-bundle",
  "schema": 1,
  "exported_at": "<ISO-8601>",
  "plugin_version": "0.1.0",
  "workspace": { "workspace_id": "<storage 目录名>", "name": "plan", "original_path": "<WORKSPACE_PATH>" },
  "meta": { "…meta.json 快照…": true },
  "tree": { "…tree.json…": true },
  "baseline": { "raw": "<baseline.md 原文>" },
  "details": { "R-001": { "md": "<AI 详情原文>", "note": "<用户备注原文>" } }
}
```

- **导出**：`GET /api/compass/export?cwd=<绝对路径>` ⇒ `200` + `content-type: application/json` + `content-disposition: attachment`；只读、不改数据；`details` 只包含**存在**的详情/备注文件（缺省视为空）。
- **导入**：`POST /api/compass/import` body `{cwd, bundle, confirm:"IMPORT"}`：
  - 校验：`format` 匹配、`schema <= 1`、tree 通过八条不变量、baseline 可解析、需求集合与树一致、`details` 的 id 必须在树中；
  - 目标板必须为空（无 `meta.json`，或树无节点且基线无需求），否则 `E_INVALID_ARG`（**不做合并**，避免半覆盖）；
  - 写入顺序：meta → tree → baseline → details/notes；整段在 `Store.run`（写锁）内；任一失败删除本次新建的工作区数据目录，回到导入前状态；
  - 成功返回 `{imported:{nodes, details, baseline_requirements}}`；失败不留半套数据。
- 安全：bundle 里的 `workspace.original_path` 只作展示，**不用于定位**；导入目标由当前 `cwd` 决定（§4.1）。

---

