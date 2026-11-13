# dsh-taskbearing — Data & API Contract (schema-v2)

[中文](schema-v2.md) | **English**

> **Canonical version: Chinese.** This is a mirror translation of [`schema-v2.md`](schema-v2.md) and may lag behind it; in case of conflict the Chinese document wins. When the contract changes, change the Chinese document first and then sync this mirror.
> Applies to version `0.1.1`. Internal iteration tags such as "v1.2x" only indicate when a rule was introduced; they are not public version numbers.
> For secondary development: data structures, field formats, tool APIs, status enums, migration/exchange formats.
> For product behaviour, design philosophy and usage, see [philosophy.en.md](philosophy.en.md).
> Current data formats: `meta.json` / `tree.json` schema `1`, `baseline.md` schema `2` (multi-line original-text escaping).

Path placeholders used in this document: `<DSH_HOME>` = DSH user data root; `<WORKSPACE_PATH>` = current workspace root.

## 3 Architecture

### 3.1 Layers

```text
┌──────────────────────────────────────────────────────────┐
│                    UI layer (client facet)               │
│  Sidebar: requirement → task → step (3 views / folding / │
│  detail). Rendering and user input only; no judgement.   │
└───────────────────────┬──────────────────────────────────┘
                        │ data channel (host-provided: HTTP routes / IPC)
┌───────────────────────▼──────────────────────────────────┐
│                   Tool layer (host facet)                │
│  init / require / plan / update / read / change / merge  │
│  move / import / status / migrate (11 tools)             │
│  format & completeness checks, patch semantics, queue    │
└───────────────────────┬──────────────────────────────────┘
                        │ file I/O (in-process serialisation + atomic write)
┌───────────────────────▼──────────────────────────────────┐
│                      Storage layer                       │
│  $DSH_HOME/storages/compass/<workspace-name>-<hash>/     │
│    meta.json / baseline.md / tasks/tree.json / details/  │
└───────────────────────┬──────────────────────────────────┘
                        │ rules marked block
┌───────────────────────▼──────────────────────────────────┐
│                       Rules layer                        │
│  install / upgrade / clean the marked block in           │
│  $DSH_HOME/AGENTS.md                                     │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Component responsibilities and boundaries

| Layer | Responsibility | Explicitly not doing | Carrier |
|---|---|---|---|
| UI layer | list rendering, view switching, folding, detail panel, note editing, copy | no judgement, no summaries, no writes to the AI column | client facet (web panel) |
| Tool layer | input validation, patch merging, structure checks, original-text retrieval, serialised writes, error codes for the eleven tools | no semantic judgement, no deciding statuses for the AI | host facet (cordis plugin) |
| Storage layer | file I/O, atomic writes, schema checks and migration, directory resolution | no inference from caches, no silent repair | host-side store module |
| Rules layer | install/upgrade/uninstall-clean the rules block, idempotently | changes nothing outside the marked block | host facet |

### 3.3 Data channel

- The UI (client facet) **does not assume** filesystem access; all data access goes through capabilities provided by the host (HTTP routes, IPC, or a host fs service) — the concrete form depends on the host (see [philosophy.en.md](philosophy.en.md)).
- **Read-only**: `tree.json`, `details/*`, `baseline.md`, `meta.json`.
- **Write-only (UI)**: `details/<id>.note.md`, UI state files (view preference / expanded paths).
- `tree.json`, `baseline.md` and `details/<id>.md` **may only be written by the tool layer**; the UI must not write them.

### 3.4 Runtime and concurrency

- Every host-side write goes through an **in-process FIFO serial queue**; each operation is "read all → modify in memory → atomic write back". The AI does not perceive concurrency and never needs to "read the latest first".
- **Cross-process write lock**: read-modify-write of the same workspace holds a lock file in the data directory (`locks/write.lock`, liveness by mtime heartbeat, expired locks can be taken over) inside `Store.run`; when the lock cannot be acquired it backs off and retries, returning `E_LOCK_BUSY` on timeout. The lock is a **mutual-exclusion optimisation**; correctness is guaranteed by the next item.
- **Optimistic version check (correctness backstop)**: before writing back, compare the target file's `mtime+size` with what was read; if another writer changed it, this operation returns `E_CONFLICT` and the tool layer redoes the whole operation (≤3 times); if retries are exhausted it reports the conflict honestly and **never silently overwrites**.
- UI note writes and AI detail writes are **different files**; they do not share locks and do not block each other. UI note writes do not participate in the tree write lock.
- Multiple DSH windows / hosts on the same workspace: concurrent writes lose no updates (lock + version check + retry). The UI is designed for a single main view; when the same note is edited in two windows, the last writer wins (notes are user drafts, not task data).

### 3.5 Data flow

1. The AI calls `compass_plan` to create tasks and `compass_update` to change status / write details with patch semantics.
2. The plugin serialises read-modify-write internally; the AI does not perceive concurrency.
3. The UI silently polls file mtime every 2 seconds (only while the panel is visible) and re-renders on change; detail editing happens in a separate panel, decoupled from list rendering.
4. The user clicks "copy detail" on a task and pastes it into a new session manually.
5. The new session's AI calls `compass_read` as needed to read the tree, upstream details and baseline, rebuilding its context.

---


### 3.6 Traceability & session-verification read-only endpoints

The host facet exposes three read-only HTTP routes so the UI can verify facts (they write no data):

| Endpoint | Method | Description |
|---|---|---|
| `/api/compass/session-links?cwd=&ids=a,b,c` | GET | Verify session existence from session logs; returns `{sessions:[{session, exists, origin, openable, target_session}]}`; ≤ 50 ids per call. `origin="subagent"` marks a subagent session (not directly openable; `target_session` gives the parent session) |
| `/api/compass/session-turn?cwd=&session=&turn=&at=` | GET | Verify / restore the real turn before a jump; returns `{exists, log_available, turn_count, requested_turn, turn, source, origin, target_session}`; `source ∈ exact / by-at / exact-no-at / parent-at` |
| `/api/compass/history-summary?cwd=` | GET | Used by the panel's "no data yet" state: returns a history-session summary for the workspace `{available, sessions, latest_at, truncated}`. Scans session directories + `stat` only — no log decompression, no writes; `sessions>0` means this is an old workspace whose sessions predate the plugin |

Rules:

1. Read-only; session ids accept `session-<…>` (main sessions) and bare UUIDs (subagent sessions).
2. `at` is authoritative: when `at` locates a turn, that turn wins (a legacy wrong `turn` is restored and marked `by-at`); when `at` is missing or cannot locate a turn, the `turn` is accepted only if it really exists in the log.
3. Log unreadable ⇒ `log_available=false`; the UI must degrade explicitly and never guess a turn.
4. Subagent session: return the parent session's `target_session` and the corresponding parent turn; when the parent log is missing, `turn=null`.
5. `history-summary` does not depend on the board being initialized; when the host does not expose a session-log root it returns `available=false`, and the client degrades to "history summary unavailable" without blocking the empty state.

### 3.7 Recycle bin (v1.33: panel-side cleanup)

One-off questions also become tasks, so the board needs a way to throw them away and pick them back up. The recycle bin is a **user cleanup action on the panel** and is a different thing from the verdict "已废弃 (abandoned)":

| | Verdict "已废弃" | Recycle-bin marker `trashedAt` |
|---|---|---|
| Who writes it | AI tools (`compass_update`) | Panel only (user click) |
| Reason required | Yes (`dead_reason` + `pointer_note`) | No |
| Changes state | Changes `verdict_state` | Changes no state at all |
| Enters trace chain | Yes (pointers) | No |
| Reversible | Revival must go back to `待裁决` first | One-click restore, original state intact |

**Three write-only routes** (all writes go through `Store.run` with the same lock, version check, and transaction path as AI writes):

| Endpoint | Method | Body | Behaviour |
|---|---|---|---|
| `/api/compass/discard` | POST | `{cwd, ids:[...]}` | Marks nodes as discarded. Nodes already in the bin (or under a binned ancestor) go into `skipped`; idempotent. Returns `{discarded, skipped, at, trash_count}` |
| `/api/compass/restore` | POST | `{cwd, ids:[...]}` | Clears the marker. If an ancestor is still binned ⇒ `E_TRASH_NOT_FOUND` with `details.trashed_ancestor`; restore the ancestor first. Returns `{restored, skipped, trash_count}` |
| `/api/compass/purge` | POST | `{cwd, id, confirm:"DELETE"}` | **Purge.** Tasks/steps only; requirements ⇒ `E_PURGE_FORBIDDEN`; referenced by another node's `merged_into` ⇒ `E_PURGE_FORBIDDEN`; not binned ⇒ `E_TRASH_NOT_FOUND`; missing `confirm` ⇒ `E_INVALID_ARG`. Writes a full backup to `data/trash/<time>-<id>.json` (kept 30 days) before removing the subtree and its detail/note files; aborts if the backup fails. Returns `{purged, descendants, backup, trash_count}` |

Rules:

1. **The marker only sits on the discarded node itself**; the subtree is derived-hidden from the ancestor — so restore never has to clear children, and a child binned earlier is not un-binned by accident.
2. Recycled nodes disappear from **every visible surface**: the three views, pinned list, search, mechanical counts, requirement aggregation, and board health checks; `compass_read(tree/tree-lite)` does not return them either (invisible to the AI).
3. AI writes to a recycled node (`update/plan/move/merge/change`) ⇒ `E_TRASH_NOT_FOUND`, telling the user to restore it in the panel first.
4. Export/import **preserves `trashedAt`** (moving machines does not lose the bin).
5. Backup files are outside the schema (`data/trash/`), auto-cleaned after 30 days; once purged, the UI cannot restore it — only the backup file can.

## 4 Storage design

### 4.1 Data root and workspace resolution

- **Data root**: `$DSH_HOME/storages/compass/` (DSH user data root; documents uniformly use `$DSH_HOME`).
- **Workspace directory name**: `<workspace-name>-<hash>`.
  - Workspace name: `basename` of the workspace directory; `compass_init` accepts `workspace_name` to override; illegal characters (`\ / : * ? " < > |`) are replaced with `_`, length ≤ 40.
  - hash: SHA-256 of the workspace's **normalised absolute path**, first 8 lowercase hex characters.
- **Only the hash is used for resolution**: data is fixed under `$DSH_HOME`, decoupled from the workspace's physical location; `meta.json`'s original path is **for display and conflict checks only**, never for resolution.
- **Path normalisation**: resolve symlinks/junctions (realpath) → normalise to forward slashes → uppercase the Windows drive letter → strip trailing separators → on case-insensitive platforms (Windows/macOS) lowercase before hashing, so one directory never produces two data copies due to letter case.
- **Hash collision handling**: if the directory already exists, read `meta.json`; if `original_path` differs from the current normalised path, treat it as a hash collision, return `E_WORKSPACE_MISMATCH` and ask for manual handling (no automatic merge, no overwrite).

### 4.2 Directory layout

```text
$DSH_HOME/storages/compass/<workspace-name>-<hash>/
├── meta.json              # workspace name, hash, original path, schema version, created at
├── baseline.md            # requirement baseline: AI surface + folded originals
├── ui-state.json          # UI state: per-workspace expanded paths (UI-owned write)
├── locks/write.lock       # cross-process write lock (temporary; absent after normal release)
└── tasks/
    ├── tree.json          # task tree: hierarchy, status, traceability, merges, dead reasons
    └── details/
        ├── <task-id>.md       # AI column: technical notes for the AI
        └── <task-id>.note.md  # user note column: written directly by the UI, physically separate
```

- **Two writers separated**: the AI writes `<id>.md`, the UI writes `<id>.note.md`; they never overwrite each other. Reads concatenate them; copies merge them (order: AI column → user notes).
- **Frequent reads, small size**: `tree.json` stays small and is fully loaded when the panel opens; `details/` is read on demand and never floods the AI context.
- **View preferences are not here**: global preferences live in plugin config (one copy across workspaces); expanded paths are recorded per workspace (see §4.9).

### 4.3 meta.json

| Field | Type | Required | Description |
|---|---|---|---|
| `schema` | int | yes | meta structure version, currently `1` |
| `plugin` | string | yes | fixed `"dsh-compass"` |
| `workspace_name` | string | yes | workspace name (for display) |
| `original_path` | string | yes | normalised absolute workspace path (display + conflict check) |
| `path_hash` | string | yes | path hash (8 lowercase hex) |
| `created_at` | string | yes | ISO-8601 with timezone, e.g. `2026-11-11T11:25:56+08:00` |
| `plugin_version` | string | yes | plugin version that first wrote this file (diagnostics) |

Example:

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

The tree has three levels: **project (implicit root) → requirement → task (steps may nest further)**. Requirements are the first visible unit.

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

(Example values above keep the original Chinese strings, as data is stored verbatim; only field documentation is translated.)

**Node kinds and levels**

| kind | Position | Fields | Description |
|---|---|---|---|
| `project` | root node only (`id` fixed as `ROOT`) | `id`, `kind`, `children` | implicit container; not rendered as a list row; the panel title shows the workspace name |
| `requirement` | **direct child of root only** | all fields | requirement level, the first visible unit; `exec_state` is aggregated mechanically by the plugin |
| `task` | under a requirement or under a task (multi-level) | all fields | task/step; the finest level is one or two sentences of "what to do, how far it reaches" |

**Field reference**

| Field | Type | Description |
|---|---|---|
| `schema` | int | tree structure version, currently `1` |
| `root` | object | the single root node, `kind=project`; `children: []` when uninitialised |
| `id` | string | see "ID rules" below |
| `kind` | enum | `project` / `requirement` / `task` |
| `title` | string | canonical name for the AI and traceability; non-empty |
| `human_line` | string | one-line plain language for humans; non-empty, single line |
| `exec_state` | enum | `未开始` (not started) / `进行中` (in progress) / `已执行` (done) |
| `verdict_state` | enum \| null | `null` / `待裁决` (needs ruling) / `冲突` (conflict) / `已废弃` (abandoned) / `已替代` (superseded) / `已确认继续` (confirmed continue; persisted as `null`); `冲突` is non-terminal |
| `dead_reason` | string \| null | only for abandoned/superseded: one plain sentence (AI-condensed, quoting the user's ruling); cleared on revival |
| `merged_into` | string \| null | merge target id, written by `compass_merge`; may cross requirements |
| `pointers` | array | traceability chain; each item `{session, at, turn, note}`; append-only; `session`/`at` required, `turn` optional |
| `trashedAt` | string \| null | recycle-bin marker (v1.33): ISO-8601 timestamp, only on the node the user actually discarded; **fully decoupled from the exec/verdict state** — no trace entry, no reason required; missing/null = not discarded. When an ancestor is marked, the whole subtree is treated as hidden (children are NOT cascaded) |
| `children` | array | child nodes, in creation order |

**Invariants** (validated before every write; violation rejects the write)

1. `root` is unique and `kind=project`; the project node only has `id`/`kind`/`children`, no status or traceability.
2. `requirement` nodes must be direct children of `root`; a `task`'s parent must be a `requirement` or a `task`.
3. `id` is globally unique in the tree; `kind` is valid.
4. `exec_state` and `verdict_state` may only take the enums above (`verdict_state` includes `冲突`, non-terminal).
5. `verdict_state` is `已废弃` or `已替代` ⇒ `dead_reason` must be a non-empty string; `null` / `待裁决` / `冲突` ⇒ `dead_reason` must be `null`.
6. When `merged_into` is non-empty it must point to an id that exists in the tree and is not itself.
7. `pointers` are append-only; each item has non-empty `note`, non-empty `session`, and an ISO-8601 `at` (with timezone); `turn` is optional and, when present, a non-negative integer.
8. `children` order is creation order and is never rewritten by the UI or by time-based sorting.
9. `trashedAt`, when present, must be an ISO-8601 timestamp; the project root must not carry it; **recycled nodes do not participate in visibility, mechanical counts, or requirement aggregation** (§3.7).

**ID rules**

- The root node is fixed as `ROOT` (does not consume a requirement/task sequence number).
- Requirement nodes: `R-<3-digit number>`, starting at `R-001`, incremented from the current maximum (naturally grows past 999, never truncated).
- Task nodes: `<parentId>-T-<number>`, incremented from 1 within the parent.
- Sequence numbers are never recycled (the plugin provides no deletion).
- `id` allows only `[A-Za-z0-9-]`, length ≤ 64.

**Requirement-task ownership**

- A task **belongs to exactly one requirement**: its ancestor requirement node. There is no "belongs to multiple requirements" field — multiple ownership would make requirement-level status impossible to summarise.
- If two places really do the same thing, create both nodes and use `compass_merge` to point the secondary node at the primary one (`merged_into`); the UI merges the display. Do not duplicate nodes or attach to multiple parents.
- Requirement-level `exec_state` is a derived value **mechanically aggregated by the plugin** (v1.28); rules in §6.7. The AI cannot write it (`compass_update` with a requirement `exec_state` ⇒ `E_INVALID_ARG`). The UI's mechanical counts (`n tasks: x in progress / y done`) are consistent with the aggregated status.

**Display order vs. ID numbers**

- The `children` array order **is** the only display order; insertion position is decided by `after` / `before` of `compass_plan` (see §5.4).
- The number in an `id` (`2` in `R-001-T-2`) only reflects **creation order**, not display position; after a middle insertion a newer node's number may be greater than its display position (e.g. `-T-4` displayed 2nd) — normal, like a database auto-increment key.
- **Never** renumber ids to keep numbers contiguous: it would break `pointers` traceability and external references; hard-forbidden.
- The UI list **does not show id numbers** (only `human_line` / `title`); ids are used only by tools, handoff copies and traceability.

### 4.5 Detail files

**`<task-id>.md` (AI column)**

```markdown
# R-001-T-1 曲线能拖控制点

- 当前改动：editor/shape-path.ts 的 bezier 控制点持久化
- 已过测试：path.test.ts 1-4
- 未过：path.test.ts 第 5 条（松手弹回）
- 关键决策：走 SVG→DrawingML 路线；否决 LLM 直吐坐标（会话 s-8f3a 第 8 轮）
- 接手提示：坐标系转换是坑，查第 31 轮讨论
```

**`<task-id>.note.md` (user note column)**

```markdown
# 备注

顺手把上次那个弹回问题也带上。
```

Rules:

- Encoding UTF-8 without BOM, LF newlines; missing files are treated as empty content, not an error.
- The AI column is written by `compass_plan(detail)` / `compass_update(detail)` as a **full replacement**; the UI reads it only.
- The note column is written by the UI as a **whole-file replacement**; the tool layer only reads it.
- Detail length is unlimited and controlled by the AI; the plugin does not cap it.
- Before reading a detail, the id must match `^[A-Za-z0-9-]{1,64}$` to prevent path traversal; an illegal id returns `E_PATH_INVALID`.
- Read/copy concatenation order: AI column → user notes, separated by a blank line (copy template in [philosophy.en.md](philosophy.en.md)).

**Parent detail follow-up**

The AI detail on a parent task/requirement node is a **rolling summary** for the AI: current progress, blockers, child status overview. After a child's status or detail changes, the AI should check and update the parent's detail (especially grouping nodes such as "acceptance items under an acceptance task"). The plugin **does not aggregate automatically** (consistent with the non-goals), and the AI decides which parents need updates.

### 4.6 baseline.md

The baseline only answers "what the requirement is + what the original words were + how many versions it went through"; it **stores no status**: progress lives only in the task tree (requirement `exec_state` + child statuses).

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

(Format markers such as `# 需求基线`, `**明面**`, `**版本**`, `原话已锁` stay in Chinese because the parser reads them literally.)

Rules:

- **Surface** is always the latest AI-condensed version and never copies the user's wording directly.
- **Original text is stored verbatim**: it must match the user message character by character, each with the session and message time; transcription, rewriting or "helpful polishing" is forbidden.
- **Current-session original text**: for words the user just said in this session, the AI may pass `original_text`; the plugin compares verbatim against **current-session** user messages and records `原话已锁` (original locked) only on an exact match, otherwise returns `E_ORIGINAL_MISMATCH` and writes nothing. This satisfies both "do not re-fetch information already in the current context" and fidelity (the AI cannot lock a paraphrase into the baseline). Escaping and injection-block stripping are handled by the plugin.
- **Cross-session original text**: still retrieved by the plugin via `original_refs` (`compass_import` backfill or explicit refs); that channel is only for "new session with insufficient handoff needs tracing" and "cross-session data repair/audit" — never for re-fetching information already present in the current context.
- **Stripping machine-injected blocks**: DSH injects `<system-reminder>…</system-reminder>`, runtime snapshots (`Time sampled while preparing turn …`, `Browser time zone for this request:`, `Elapsed since the preceding …`), skill catalogs etc. as the user role; both channels must strip/exclude these and keep only what the user really typed.
- **Authoritative source**: prefer `session/event` `user/message` with `data.source.kind="user"` — `deriveMessages()` loses `source` and cannot distinguish real user text from machine injection; only the degraded path uses deriveMessages heuristics (strip injections + exclude runtime-context / instruction-baseline signatures + exclude very long instruction files). If both fail, record "original pending lock".
- **History backfill originals**: the v1 original of a backfilled requirement is read verbatim by `compass_import` from historical session logs (`refs` points to preview results); the AI never passes the text. The historical `pointer.session` points at the historical session, `at` uses the message time, and `turn` stays empty when unreliable.
- **Original locking**: a successful retrieval records `原话已锁`; a failure records `原话待锁` and the user must paste it in the UI to lock it.
- **Changes append versions with `compass_change`**; never overwrite. Every appended version re-locks that version's original.
- Parser constraints: first heading is fixed as `# 需求基线`; the file header carries `<!-- dsh-compass:baseline-schema N -->`; each requirement starts with `## R-<3 digits> <title>`; the body contains `**明面**：` and `**版本**：`; a version entry looks like `- v<N>（<at>｜原话已锁|原话待锁）：` followed by `- 精简：`, optional `- 原因：` (`compass_change`'s reason) and `- 原话（会话 <id> · <at>）：「<verbatim text>」` (or `- 原话（待锁）：「」` when unlocked). On parse failure, `compass_read(scope=baseline)` returns `E_STORE_CORRUPT` with the line number.
- **Multi-line originals (schema 2, B-44)**: originals may come from multi-line document excerpts (migration). The baseline is a line-oriented format, so newlines are written as the literal `\n` and backslashes as `\\`; parsing restores them based on the header schema number (`schema >= 2` unescape, `schema = 1` old files read as-is); writes upgrade to schema 2. "Verbatim" for migration means the **restored text** matches the source excerpt byte by byte.
- `requirement_id` is generated by `compass_require` (`R-<3 digits>` starting from `R-001`); `compass_change` only references existing ids.
- The baseline has no status fields; the UI reads `exec_state` from the requirement node in the tree instead of storing another copy.

### 4.7 Write protocol

1. **Single writer**: each file has exactly one writer at a time (tool layer writes `tree.json`/`baseline.md`/`<id>.md`; UI writes `<id>.note.md`/`ui-state.json`). Writers never mix on one file.
2. **Read-modify-write**: each tool call reads the full `tree.json` from disk → modifies in memory → validates → writes back; it never relies on in-memory caches surviving across calls. The whole "read-modify-write" must complete inside one `Store.run`, never split into multiple runs.
3. **Atomic write**: write a temp file in the same directory (`<file>.tmp-<pid>-<rand>`), `fsync`, then `rename` over the target; on failure keep the original and return `E_WRITE_FAILED`. Never truncate the target directly.
4. **Serial queue (in-process)**: the host keeps a FIFO queue with at most one write in flight; when the queue exceeds its limit (e.g. 32) new writes are rejected with `E_BUSY`.
5. **Cross-process write lock**: `locks/write.lock` under the data directory.
   - Acquire: atomic `open(..., "wx")` with `{pid, hostname, token, acquired_at}`; if it exists, judge liveness by mtime (10s without heartbeat = expired); an expired lock is `rename`d to `write.lock.stale-<ts>-<rand>` and creation retried (the successful renamer wins the takeover, avoiding double takeover).
   - Heartbeat: every 2s `utimes` the lock file while holding it; on release verify the `token` before deleting, so a taken-over lock is never deleted by mistake.
   - Back off and retry for up to 5s, then return `E_LOCK_BUSY` (retryable; the message says so).
   - The lock only reduces collision probability; correctness is guaranteed by item 6.
6. **Optimistic version check**: `readTree`/`readBaseline` record the file's `mtime+size`; `writeTree`/`writeBaseline` verify the version is unchanged before renaming, returning `E_CONFLICT` otherwise. The tool layer catches `E_CONFLICT` and redoes the whole operation (up to 3 times), reporting an error when exhausted; **never** swallow another writer's update with last-write-wins.
7. **Corruption handling**: JSON parse failures on read return `E_STORE_CORRUPT` and suggest recovery from the latest `.bak`; **no silent rebuild**, no user data loss.
8. **Change event log retired**: the old `events.jsonl` note events and `GET /api/compass/changelog` were removed together with the global timeline (v1.24). Saving a note no longer appends events; existing `events.jsonl` files stay on disk and are no longer read or written.

### 4.8 Schema versions and migration

- `meta.json.schema` and `tree.json.schema` both carry version numbers.
- On read: `schema < current` ⇒ back up first (`*.schema-<old>.bak`) then migrate; `schema > current` ⇒ return `E_SCHEMA_VERSION` and suggest upgrading the plugin.
- Migration runs on first read / `compass_init`; on failure it rolls back from the backup and reports an error.
- Migration functions must be repeatable on old data (idempotent).

### 4.9 UI state

| State | Scope | Stored in | Writer | Description |
|---|---|---|---|---|
| Current view (current only / active only / full history) | one global copy across workspaces | plugin config (preferred); degraded option see below | UI | defaults to "current only" |
| Expanded path set | per workspace | `<ws>/ui-state.json` | UI | records expanded node ids and paths only; no scroll position |
| Detail panel open state | per session/temporary | memory | UI | not persisted |

- "Remember expanded paths" is **optional** and off by default; when enabled it persists per workspace, and disabling clears the record for that workspace.
- View preference and expansion state **never affect** task data; deleting them loses no task information.

### 4.10 Capacity and performance assumptions

- Task node scale: **hundreds** (design target ≤ 500). At that scale `tree.json` is expected to stay < 200KB and can be loaded in one go.
- Detail files are read on demand; a single file may reach tens of KB with no limit.
- First panel frame ≤ 200ms (local file read + one render); polling overhead only occurs while the panel is visible.
- No sharding, indexing or database is designed for this; see "Anti-bloat" in [philosophy.en.md](philosophy.en.md).

---

## 5 Tool API

### 5.1 General conventions

**Parameters and returns**

- Parameters are always JSON objects; field names are `snake_case`; fields not listed are ignored (but illegal values are never silently corrected).
- Success: the result object is returned directly (no envelope), so the AI can read it directly.
- Failure: throw a structured error with `code` (error code), `message` (one sentence explaining what happened and how to fix it) and `details` (optional structured info such as missing ids). The exact throwing mechanism follows the host's tool system.

**Error codes**

| Error code | Meaning | Tools |
|---|---|---|
| `E_INVALID_ARG` | missing / wrong type / illegal value | all |
| `E_NOT_INITIALIZED` | workspace not initialised (no `meta.json`). **A state, not a failure**: when `/tree` returns HTTP 404 with this code, the client must treat it as the "no data yet" empty state and must not show "old host" | require/plan/update/read/change/merge, routes |
| `E_NOT_FOUND` | unknown route (the only signal that the host predates the client). Only this code is mapped by the client to "old host, missing endpoint" | route layer |
| `E_PARENT_REQUIRED` | task created without `parent_id` (use `compass_require` for requirements) | plan |
| `E_ORIGINAL_UNRESOLVED` | original text could not be retrieved (**warning**: write succeeded, original pending lock) | require/change |
| `E_ORIGINAL_MISMATCH` | `original_text` does not match current-session user messages verbatim (**error**: nothing written; suggests using refs) | require/change |
| `E_DETAIL_PATH_NOT_FOUND` | a file path recognised in the detail does not exist on disk (**error**: whole write rejected; `details.missing_paths` lists them) | plan/update |
| `E_DETAIL_REQUIRED` | single node marked done without a completion note and no qualified old detail to inherit (**error**: nothing written) | update |
| `E_BATCH_DETAIL_REQUIRED` | batch mark-done where some task lacks a completion note and no qualified old detail to inherit (**error**: whole batch rejected; `details.missing` lists ids) | update |
| `E_DETAIL_CONTENT_INVALID` | completion note fails the content standard: missing sections, or labels not at line start / empty section content (build: core files / contract / pitfalls; research: findings / sources / next steps) (**error**: whole write rejected) | update |
| `E_REQUIREMENT_DETAIL_REQUIRED` | requirement is about to be aggregated to "done" but its detail lacks acceptance scope / conclusion / remaining risks (**error**: rejected before writing the tree) | update / tree writes |
| `E_ANCESTOR_DETAIL_REQUIRED` | writing a node detail (including completion notes) while some ancestor (parent task / grandparent / requirement) lacks a summary or has a section missing (**error**: nothing written; `details.missing_ancestors` lists ids) | update |
| `E_WORKSPACE_MISMATCH` | `meta.original_path` disagrees with the current workspace (hash collision) | all |
| `E_PARENT_NOT_FOUND` | `parent_id` does not exist | plan |
| `E_SIBLING_NOT_FOUND` | `after`/`before` sibling does not exist or is not under the same parent | plan/import |
| `E_POSITION_CONFLICT` | `after` and `before` given together (mutually exclusive) | plan/import |
| `E_TASK_NOT_FOUND` | `task_ids` / `source_id` / `target_id` contains an unknown id | update/merge/read(detail) |
| `E_POINTER_NOTE_REQUIRED` | status/verdict/merge change without a non-empty `pointer_note` | update/merge |
| `E_INVALID_TRANSITION` | status transition not allowed by the §6.2 matrix | update |
| `E_SUBTREE_INCOMPLETE` | abandon/supersede does not cover the whole subtree; `details.missing` lists ids | update |
| `E_DEAD_REASON_REQUIRED` | abandoning/superseding without `dead_reason` | update |
| `E_TRASH_NOT_FOUND` | restore/purge target is not in the recycle bin (or its parent is still binned — `details.trashed_ancestor`); also used when the AI writes to a recycled node | routes discard/restore/purge, update/plan/move/merge/change |
| `E_PURGE_FORBIDDEN` | purge forbidden: requirements (baseline originals and trace chains are audit assets) or nodes referenced by another node's `merged_into` (would break the chain) | route purge |
| `E_SELF_MERGE` | `source_id === target_id` | merge |
| `E_REQUIREMENT_NOT_FOUND` | `requirement_id` does not exist (use `compass_require` to create one) | change |
| `E_PATH_INVALID` | illegal task id (path traversal risk) / illegal workspace name | read(detail)/init |
| `E_SCHEMA_VERSION` | data schema is newer than this plugin supports | all reads |
| `E_STORE_CORRUPT` | store file failed to parse / structure invalid | all reads |
| `E_WRITE_FAILED` | atomic write failed (disk/permissions) | all writes |
| `E_BUSY` | write queue over limit | all writes |
| `E_LOCK_BUSY` | cross-process write lock not acquired within 5s (retryable) | all writes |
| `E_CONFLICT` | target file changed by another writer before write-back (visible error after retries) | all writes |
| `E_MIGRATE_SOURCE` | migration source missing/unreadable/over 1MB | migrate |
| `E_MIGRATE_REF` | migration `ref` line range illegal/out of range/not from preview | migrate |
| `E_MIGRATE_ITEM_INVALID` | migration `items` field invalid (type/parent/terminal constraints) | migrate |
| `E_MIGRATE_ARCHIVE` | archiving/renaming the source failed after a successful import (data already imported) | migrate |

**Context (session / at / turn / workspace root)**

- Tools must be able to locate the "current workspace root", otherwise `compass_init`/`compass_read` cannot work.
- `session`: filled automatically by the plugin from the host context; never passed or fabricated by the AI.
- `at`: the plugin writes a **standard timestamp** (ISO-8601 with timezone) when appending pointers; it does not depend on the AI.
- `turn`: three-level source — ① the host facet subscribes to `session/event`'s `turn/start` (authoritative); ② when the plugin was loaded mid-turn, the host restores the current turn from the **current session log** (same numbering as `turn/start`/`turn/end`); ③ otherwise leave it empty. **Never** estimate a turn from "the number of user messages" (DSH injects many pseudo user messages, inflating the count). The field is optional and there is no "AI fills it" path (source in §6.4).
- To express "turn 31" in traceability, the AI writes it in the free text of `pointer_note` (e.g. "decided in main session turn 31"); that text is not authoritative — `at` is.

**Idempotency**

| Tool | Idempotency |
|---|---|
| `compass_init` | idempotent: repeated calls do not rebuild or overwrite; returns `created: false` |
| `compass_require` | not idempotent: each call creates a requirement and writes baseline v1 |
| `compass_plan` | not idempotent: each call creates a node; `after`/`before` only affect position |
| `compass_update` | same target state is treated as success (no empty note appended), but a state change without `pointer_note` is still rejected |
| `compass_change` | not idempotent: each call appends a version |
| `compass_merge` | repeating the same source→target pair is idempotent success (no data moved twice; one note appended to `pointers`) |
| `compass_read` | pure read |
| `compass_status` | pure read |
| `compass_move` | moving to the same parent/position again is success (no empty note); ID unchanged |
| `compass_import` | idempotent: repeat apply dedupes by `(parent_id, title)`, existing entries return `existing` |

### 5.2 compass_init

| Parameter | Type | Required | Description |
|---|---|---|---|
| `workspace_name` | string | no | overrides the directory display name; defaults to the workspace directory name |
| `root_path` | string | no | overrides the workspace root; defaults to the current session workspace root |

- **Behaviour**: resolve and normalise the path → compute hash → create directories, `meta.json`, an empty `tree.json` (`{"schema":1,"root":{"id":"ROOT","kind":"project","children":[]}}`) and an empty `baseline.md` (with schema comment) → install/upgrade the global rules block (§7).
- **Idempotency**: when the directory and `meta.json` exist: same path ⇒ `created:false` plus a rules-block upgrade check; different path ⇒ `E_WORKSPACE_MISMATCH`.
- **Returns**: `{ "workspace_id": "<dir name>", "data_dir": "<absolute path>", "created": true|false, "rule_block": "installed"|"updated"|"unchanged" }`.
- **Errors**: `E_INVALID_ARG` (illegal workspace name), `E_PATH_INVALID`, `E_WRITE_FAILED`.
- If writing the rules block fails (permissions etc.), initialisation **must not** fail: `rule_block` returns `"failed"` with the copyable rule text.

### 5.3 compass_require

Creates a requirement (requirement-level node) and writes baseline v1; the original text may be passed by the AI (verified verbatim in the current session) or retrieved by the plugin via refs.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | canonical name, non-empty, single line |
| `human_line` | string | yes | one-line plain language, non-empty, single line |
| `surface` | string | yes | baseline "surface": the AI-condensed one-liner |
| `original_text` | string | no | **v1.24+**: the user's exact words from the current session (verbatim). The plugin compares against current-session user messages and locks only on an exact match; otherwise `E_ORIGINAL_MISMATCH` (nothing written). Mutually exclusive with `original_refs`; both ⇒ `E_INVALID_ARG` |
| `original_refs` | array \| string | no | cross-session source: `[{"session":"s-xxx","turn":3}]` or `"current"`; defaults to `"current"`. Only for new-session tracing / cross-session repair (§5.9 boundaries) |
| `pointer_note` | string | no | one line for the requirement creation; defaults to "建需求" |

- **Behaviour**: creates `R-<n>` appended to `root.children` → writes the baseline entry (surface + v1) → original text: with `original_text`, verifies verbatim in the current session (success records `原话已锁` with the matched message's session and time); otherwise retrieves **verbatim** from session records via `original_refs` (prefer `session/event` `source.kind="user"`; degrade to stripped injections, see §4.6): success records `原话已锁`, failure records `原话待锁` (empty original).
- **Returns**: `{ "requirement_id": "R-002", "version": "v1", "original_locked": true|false, "warnings": [...] }`; since v1.29 it also mechanically checks duplicates against active nodes and returns `POSSIBLE_DUPLICATE` candidates (hint only, non-blocking).
- **Constraints**: the AI may only call it after the user confirms a requirement (the plugin does no semantic check); `original_text` must be verbatim — **no paraphrasing** — the verbatim check rejects mismatches; cross-session originals must not be passed by the AI.
- **Errors**: `E_INVALID_ARG`, `E_NOT_INITIALIZED`, `E_WRITE_FAILED`, `E_ORIGINAL_MISMATCH` (error), `E_ORIGINAL_UNRESOLVED` (warning; write still succeeds).

### 5.4 compass_plan

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parent_id` | string | yes | parent node id: `R-<n>` (requirement) or a task id; **no longer accepts `null`** — use `compass_require` for requirements |
| `title` | string | yes | canonical name, non-empty, single line |
| `human_line` | string | yes | one-line plain language, non-empty, single line |
| `detail` | string | no | initial AI-column content (written as `<id>.md`) |
| `after` | string | no | insert **after** this sibling under the same parent; mutually exclusive with `before` |
| `before` | string | no | insert **before** this sibling under the same parent; mutually exclusive with `after` |
| `pointer_note` | string | no | one line for node creation; defaults to "建任务" |

- **Behaviour**: generate the id per the ID rules → resolve the insertion position (`after` → after that sibling; `before` → before it; neither → append) → `parent.children.splice(index, 0, newNode)` → write `tree.json` → write `<id>.md` when `detail` is given.
- **Detail path check**: before writing `<id>.md`, mechanically recognise file paths and verify them with `fs.existsSync()` (relative paths resolve against the workspace root); any missing ⇒ `E_DETAIL_PATH_NOT_FOUND` and **nothing is written** (no node either).
- **Constraints**: missing/empty `parent_id` ⇒ `E_PARENT_REQUIRED` (suggests `compass_require`); unknown parent ⇒ `E_PARENT_NOT_FOUND`, **no silent creation**; both `after` and `before` ⇒ `E_POSITION_CONFLICT`; missing sibling or not under `parent` ⇒ `E_SIBLING_NOT_FOUND` (**no silent fallback to append**). Timing is the AI's judgement (call only after the user confirms the work; the plugin does no semantic check).
- **Returns**: `{ "task_id": "<new id>", "warnings": [...] }`; since v1.29 it mechanically checks duplicates and returns `POSSIBLE_DUPLICATE` candidates (hint only).
- **Notes**: insertion position only affects `children` order; the id number only reflects creation order, not position (§4.4).

### 5.5 compass_update

| Parameter | Type | Required | Description |
|---|---|---|---|
| `task_ids` | string[] | yes | nodes to update (tasks or requirements); one shared payload per batch; length ≥ 1 |
| `exec_state` | enum | no | `未开始` (not started) / `进行中` (in progress) / `已执行` (done) |
| `verdict_state` | enum | no | `待裁决` / `冲突` / `已废弃` / `已替代` / `已确认继续` |
| `dead_reason` | string | no | required when abandoning/superseding |
| `detail` | string | no | full replacement of `<id>.md`; **single node only**; validated as a completion note when marking done |
| `details` | object | no | dual-purpose: ① tasks marked done this call → completion notes `{ "<task-id>": "note" \| {kind:"build"\|"research", text} }` (full replacement); ② **ancestor chain** of updated nodes → summaries `{ "<ancestor-id>": "acceptance scope…/conclusion…/remaining risks…" }`. Keys may only be current `task_ids` or ancestors of updated nodes; may be passed together with `detail` |
| `pointer_note` | string | no | one line for traceability; **required** for status/verdict changes |

- **Patch semantics**: only provided fields change; the plugin does read-modify-write internally, so the AI does not perceive concurrency and never needs to "read the latest first".
- **Shared batch payload**: `task_ids` + one set of field values; used for "abandon a parent and mark its subtree". Shared payload only — no per-id payload, no batch detail. The whole batch is **atomic**: any validation failure writes nothing.
- **Pointer append**: each affected node gets one `{session, at, turn?, note}`; `session`/`at` are filled by the plugin, `turn` only when available, `note` from the same `pointer_note`.
- **Requirement nodes**: `task_ids` may include requirements (write detail, change verdict); requirement-level `exec_state` is **mechanically aggregated by the plugin** — passing it ⇒ `E_INVALID_ARG` (§6.7); when abandoning/superseding a requirement, `task_ids` must cover its whole subtree.
- **Batch "abandon with parent" exception**: within one `task_ids` batch, descendants of an abandoned/superseded node may go from `null` straight to `已废弃`/`已替代` (treated as disposed with the parent, exempt from the single-node transition matrix); `dead_reason` and full subtree coverage are still required.
- **Validation (in order)**:
  1. Existence: all ids must exist, otherwise `E_TASK_NOT_FOUND` (lists missing ids).
  2. At least one writable field (`exec_state`/`verdict_state`/`dead_reason`/`detail`/`details`).
  3. Status or verdict change ⇒ non-empty `pointer_note`, otherwise `E_POINTER_NOTE_REQUIRED`.
  4. Transition legality per §6.2, otherwise `E_INVALID_TRANSITION`.
  5. Abandon/supersede: non-empty `dead_reason` (otherwise `E_DEAD_REASON_REQUIRED`); `task_ids` must cover **the node's whole subtree** (itself and all descendants, including already-abandoned/superseded), otherwise `E_SUBTREE_INCOMPLETE` with `details.missing`.
  6. `verdict_state = 已确认继续`: accepted as input, **persisted as `null`**, `pointer_note` required (§6.6).
  7. `dead_reason` may only be given when abandoning/superseding, or be cleared by revival.
  8. **Detail path existence**: with `detail`, paths are mechanically recognised and checked with `fs.existsSync()` (relative to the workspace root); any missing ⇒ `E_DETAIL_PATH_NOT_FOUND` (`details.missing_paths` lists them), **the whole write is rejected** (status/verdict/detail all unchanged).
  9. **Completion notes (when marking done)**: single node via `detail`, batch via `details`; each task needs a new note or may inherit an **old detail that satisfies the content standard**, otherwise `E_BATCH_DETAIL_REQUIRED` / `E_DETAIL_REQUIRED`.
  10. **Content standard (structured sections)**: the three sections must **each start on their own line, with the label at line start and non-empty content** (labels merely appearing inside a sentence do not count). Build-type: core files / contract (or contract/docs) / pitfalls, with paths really existing; research-type: findings / sources / next steps, paths optional and existence checks skipped; when kind is not declared, either standard may match. Missing sections ⇒ `E_DETAIL_CONTENT_INVALID`.
  11. **Entire ancestor chain (v1.31)**: nodes whose detail is written this call (`detail` or completion note; **marking done counts even when inheriting an old detail**) must have **all ancestors** summarised in the same `details` batch (summary standard, see §5.15); any missing ancestor ⇒ `E_ANCESTOR_DETAIL_REQUIRED`, nothing written.
  12. **Requirement completion summary (v1.31)**: if this batch makes a requirement aggregate to "done", the requirement detail must already satisfy the summary standard, otherwise `E_REQUIREMENT_DETAIL_REQUIRED` (update pre-checks on an in-memory copy before writing, keeping the batch atomic).
  13. `details` keys must be current `task_ids` or ancestors of updated nodes, otherwise `E_INVALID_ARG`; a key that is a task id but not part of an "executed" batch must be an ancestor of the node (i.e. a summary only), otherwise `E_INVALID_ARG`.
  14. **Idempotent re-marking**: re-marking an already-done node is not a status change and does not force a new completion note (only nodes actually transitioning to done are checked).
- **Returns**: `{ "updated": [...], "rollups": [...], "verdict_normalized": [...], "unchanged": [...], "warnings": [...] }` (`updated` includes ancestors written together; `rollups` lists ancestor-summary ids written this call; `verdict_normalized` lists "confirmed continue" nodes persisted as `null`; on marking done/abandoned a mechanical duplicate check may return `POSSIBLE_DUPLICATE` candidates, hint only).
- **Detail error message**:

```text
[Error] detail write rejected.
Reason: the detail contains a file path that does not exist: "src/api/user.ts".
Suggested action: verify the real workspace structure with terminal or file tools, and resubmit using real absolute or relative paths. Never invent paths.
```
- **Example (batch-abandon a requirement's whole subtree)**:

```json
{
  "task_ids": ["R-002", "R-002-T-1", "R-002-T-1-T-1", "R-002-T-2"],
  "verdict_state": "已废弃",
  "dead_reason": "用户第 31 轮拍板：该需求整体改由 R-003 覆盖",
  "pointer_note": "主会话第 31 轮拍板废弃 R-002 整棵子树，原因见 dead_reason"
}
```

### 5.6 compass_read

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | string | yes | `tree` / `tree-lite` / `detail:<id>` / `baseline` |

| scope | Returns |
|---|---|
| `tree` | full `tree.json` content (including implicit `ROOT`) |
| `tree-lite` | array of nodes with only `id / kind / title / human_line / exec_state / verdict_state`; **no** `pointers`, **no** details. Hierarchy is expressed by id prefixes, without repeating parent chains |
| `detail:<id>` | `{ "id", "detail": "<AI column>", "note": "<user note>" }`; missing files give empty strings |
| `baseline` | `{ "raw": "<baseline.md raw>", "requirements": [{ "id", "title", "surface", "versions": [{ "version", "at", "original", "original_lock", "summary" }] }] }` |

- `tree-lite` exists to **save AI context**, not to guard size; `kind` lets the AI distinguish requirement level from task level.
- Reads are not permission-filtered: a new session's AI may read any node (the plugin does not limit read scope).

### 5.7 compass_change

| Parameter | Type | Required | Description |
|---|---|---|---|
| `requirement_id` | string | yes | existing requirement id, e.g. `R-001` |
| `new_text` | string | yes | new "surface" one-liner |
| `reason` | string | yes | why it changed (one sentence) |
| `original_text` | string | no | **v1.24+**: the user's exact words from the current session (verbatim); same verification as `compass_require`; mutually exclusive with `original_refs` |
| `original_refs` | array \| string | no | cross-session source for this version's original; same as `compass_require`; defaults to `"current"` |

- **Behaviour**: **append** a version (`vN`, N = current max + 1) under the requirement in `baseline.md`, recording `new_text`, `reason` and the verbatim original (with `original_text` verify the current session first; otherwise retrieve via refs; on failure record original pending lock).
- **Returns**: `{ "appended": "v3", "original_locked": true|false }`.
- **No impact hints**: impact analysis is the AI's job via `tree-lite`.
- **Constraints**: only for existing `requirement_id` (otherwise `E_REQUIREMENT_NOT_FOUND`); `original_text` must be verbatim, otherwise `E_ORIGINAL_MISMATCH` (nothing written); cross-session originals must not be passed by the AI.

### 5.8 compass_merge

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source_id` | string | yes | node being merged |
| `target_id` | string | yes | merge target (may cross requirements) |
| `pointer_note` | string | yes | merge reason (one sentence) |

- **Behaviour**: only writes `source.merged_into = target_id` plus a traceability entry; **no moving children, no deletion**; the UI merges the display.
- **Validation**: both ids exist (otherwise `E_TASK_NOT_FOUND`); `source_id !== target_id` (otherwise `E_SELF_MERGE`); non-empty `pointer_note` (otherwise `E_POINTER_NOTE_REQUIRED`).
- **Returns**: `{ "merged_into": "<target_id>" }`.

### 5.9 compass_import

**Purpose**: backfill board records from sessions that happened before the plugin was installed, keeping original text verbatim and traceable. Semantic judging stays with the AI (which requirements/tasks to backfill, where to attach them, what status).

**Mode 1: `preview` (read-only)**

- Parameters: `limit?` (default 200, max 500).
- Returns: `{ sessions: [{ session, cwd, messages: [{ index, at, turn?, text }] }] }`; `index` is the per-session user-message sequence (1-based), `text` is the verbatim original.
- Constraints: read-only over historical session logs; writes nothing.

**Mode 2: `apply` (write the board)**

- Parameters: `items: [{ type: "requirement"|"task", parent_id?, title, human_line, surface?, exec_state?, verdict_state?, dead_reason?, detail?, refs: [{session, index}], note?, after?, before? }]`, at most 50 items. `after`/`before` are only allowed for `type=task`, semantics/validation as in §5.4 (backfill is placed in historical order).
- `refs` must come from `preview` results and really exist; the plugin re-reads the original from the log by ref — **it never accepts original text from the AI**.
- `type=requirement`: creates the requirement + baseline v1 (original = verbatim text of `refs[0]`, `原话已锁`), `pointer` = `{session: ref.session, at: ref.at, note: "历史回填：" + note}`.
- `type=task`: `parent_id` required; creates the task with the same pointer form. **Backfilled `exec_state=已执行` nodes must carry a qualified completion note** (`items[].detail`, same content standard as §5.15; path existence check skipped for cross-workspace backfill), otherwise `E_BATCH_DETAIL_REQUIRED`; if the backfill makes a requirement aggregate to "done", the requirement item's `detail` must already contain the completion summary (`E_REQUIREMENT_DETAIL_REQUIRED`).
- Deduplication: existing `(parent_id, title)` → skipped and returned under `existing` (idempotent).
- Returns: `{ created: [{id, type, refs}], existed: [{id, title}], warnings: [] }`.

**Error codes**: `E_HISTORY_NOT_FOUND` (session missing/log unreadable), `E_HISTORY_REF_INVALID` (ref not from preview or out of range), `E_IMPORT_LIMIT` (over 50 items), `E_IMPORT_ITEM_INVALID` (invalid item structure).

**Relationship to other tools**: does not change the other tools; `compass_import` is only for "backfilling history" — daily work still uses `require` / `plan` / `update`.

**Usage boundaries**: `compass_import` (including `preview`) is a **cross-session history scan** and expensive; only two scenarios are allowed:

1. **New session + insufficient handoff**: the handoff document does not contain enough information, so earlier history must be traced;
2. **Cross-session data repair/audit**: fixing historical data errors or auditing original-text fidelity (explain purpose and scope to the user first).

- **Forbidden**: when the user's request/original words are already fully present in the current context, do not re-fetch with `compass_import`; use the current context directly (original text goes through `original_text` verbatim verification).
- Calls that violate the boundary are over-collection, a process defect (recorded at the same level as data defects).

### 5.10 compass_status

**Purpose**: read-only self-check tool. Turns "is the board fresh" into mechanical counts for the AI to check before ending each turn and for the UI to display; no semantic judgement, writes no files.

**Parameters**: none (workspace/session/turn are injected by the host).

**Returns**:

| Field | Description |
|---|---|
| `board_updated_at` | last write time of `tree.json` (ISO); `null` when uninitialised |
| `current_turn` | current turn (only when the platform provides it, otherwise `null`) |
| `turns_since_board_update` | turns started **after** the last board write in this session (only counted after the plugin instance started; historical turns before that count as 0, explained by `note`) |
| `tool_calls_since_board_update` | tool calls observed in the same window (including reads, only as an "activity" signal; **excludes `compass_status` itself** to avoid self-counting) |
| `suggest` | `"self_check"` (activity in the window) / `"fresh"` (no activity) |
| `health` | mechanical board self-check (facts, not judgement): `{duplicate_pairs:[{a,b,score}], open_task_count, threshold, missing_detail:{tasks,tasks_total,requirements,requirements_total}, stale_chains:{count,items}}`; `null` when uninitialised |
| `note` | explanation of the counting rules (including "turns before start are not counted") and of health |

**Constraints**: read-only (`tree` mtime plus turn/tool-call counters from `session/event`); does not change polling and writes no files.

### 5.11 compass_move

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source_id` | string | yes | node to move (task/step; requirements are fixed under root and cannot move) |
| `parent_id` | string | yes | new parent id (requirement or task; not the project root) |
| `after` / `before` | string | no | position under the new parent (same-parent sibling id, semantics as §5.4, mutually exclusive) |
| `pointer_note` | string | no | defaults to "移动节点"; appended to traceability |

- **Behaviour**: detach from the old parent → insert at the position under the new parent (append by default) → append traceability → write `tree.json`. **ID unchanged** (id is identity, not position).
- **Constraints**: missing source ⇒ `E_TASK_NOT_FOUND`; missing parent / project root ⇒ `E_PARENT_NOT_FOUND` / `E_INVALID_ARG`; source is requirement or project ⇒ `E_INVALID_ARG`; **cannot move into its own subtree** (cycle) ⇒ `E_INVALID_ARG` (details give source/parent); `after`/`before` validation as in §5.4.
- **Returns**: `{ "moved": "<id>", "from": "<old parent>", "to": "<new parent>" }`.
- **Idempotency**: same parent and position again is success without an empty note.
- **Global id uniqueness**: after a move the id no longer relates to its parent by prefix (id is identity); when creating nodes, generate ids by deduplicating against existing tree ids and skip sequence numbers occupied by moved nodes.

### 5.12 Validation rules summary

| # | Rule | Strength | Error |
|---|---|---|---|
| V1 | all `task_ids` exist | hard | `E_TASK_NOT_FOUND` |
| V2 | `parent_id` exists and is non-empty (use `compass_require` for requirements) | hard | `E_PARENT_REQUIRED` / `E_PARENT_NOT_FOUND` |
| V3 | status/verdict/merge changes must carry `pointer_note` | hard | `E_POINTER_NOTE_REQUIRED` |
| V4 | transition must be in the §6.2 matrix | hard | `E_INVALID_TRANSITION` |
| V5 | abandon/supersede covers the whole subtree | hard | `E_SUBTREE_INCOMPLETE` |
| V6 | abandon/supersede must carry `dead_reason` | hard | `E_DEAD_REASON_REQUIRED` |
| V7 | `task_ids` non-empty; `detail` single node only | hard | `E_INVALID_ARG` |
| V8 | batch updates are atomic | hard | any failure writes nothing |
| V9 | id / workspace-name format valid | hard | `E_PATH_INVALID` |
| V10 | human_line single line, non-empty | soft (hint) | not rejected; warning returned |
| V11 | parent content changes must state subtree impact in the note | rules layer (AI self-check) | not checked by the program (§6.5) |
| V12 | node `kind` and level valid (requirement only under root; task only under requirement/task) | hard | `E_INVALID_ARG` |
| V13 | `after`/`before` mutually exclusive; sibling exists and is under the same parent | hard | `E_POSITION_CONFLICT` / `E_SIBLING_NOT_FOUND` |
| V14 | marking done requires a qualified completion note (new or inherited qualified detail) | hard | `E_BATCH_DETAIL_REQUIRED` / `E_DETAIL_REQUIRED` |
| V15 | completion notes / summaries are validated as structured sections (label at line start + non-empty content) | hard | `E_DETAIL_CONTENT_INVALID` |
| V16 | writing a detail requires updating the entire ancestor chain summary in the same batch | hard | `E_ANCESTOR_DETAIL_REQUIRED` |
| V17 | a requirement aggregated to done must already have a requirement completion summary | hard | `E_REQUIREMENT_DETAIL_REQUIRED` |
| V18 | backfilled "done" nodes must carry a qualified completion note | hard | `E_BATCH_DETAIL_REQUIRED` |

> The "soft check" in V10 marks the boundary of "format and completeness checks only": the plugin may hint, but never decides content for the AI.

### 5.13 Tool-to-file mapping

| Tool | `meta.json` | `tree.json` | `details/*.md` | `details/*.note.md` | `baseline.md` | Rules block |
|---|---|---|---|---|---|---|
| `compass_init` | write | create empty | — | — | create empty | write |
| `compass_require` | — | write | — | — | write | — |
| `compass_plan` | — | write | write (optional) | — | — | — |
| `compass_update` | — | write | write (optional) | — | — | — |
| `compass_read` | read | read | read | read | read | — |
| `compass_change` | — | — | — | — | write | — |
| `compass_merge` | — | write | — | — | — | — |
| `compass_import` | — | write | write (optional) | — | write (requirement) | — |
| `compass_status` | — | read | — | — | — | — |
| `compass_move` | — | write | — | — | — | — |
| `compass_migrate` | — | write | write (optional) | — | write (requirement) | — |
| UI note editing | — | — | — | write | — | — |
| UI copy / polling | read | read | read | read | read | — |
| UI export / import | read/write (import) | read/write (import) | read/write (import) | read/write (import) | read/write (import) | — |
| UI local data list (settings) | read | read | read | read | read | — |
| UI file existence check | read | read | read | read | read | — |

### 5.14 compass_migrate (V3 migration)

| Parameter | Type | Required | Description |
|---|---|---|---|
| mode | string | yes | `preview` / `apply` |
| path | string | both | absolute path of the legacy `status.md` (preview and apply must use the same file; apply verifies mtime against the preview record and demands a new preview if it changed) |
| file_mtime | string | suggested for apply | the `file_mtime` returned by preview; mismatch ⇒ `E_MIGRATE_REF` (re-preview) |
| archive | boolean | no | archive the source after success (default true) |
| items | array | apply | `[{type:"requirement"|"task", parent_id?, title, human_line, surface?, exec_state?, verdict_state?, dead_reason?, detail?, ref:"Lx-Ly", note?, after?, before?}]` |

- **preview**: read-only scan (max 1MB), produces candidates from the Markdown structure without changing data:
  - headings → `headings` candidates (the heading line itself can be the ref for the baseline's "original words") with `heading_path`; list items / checkboxes → `items` candidates; each item returns `{ref:"Lx-Ly", text(truncated), kind_hint, heading_path}`;
  - `kind_hint` is a **mechanical keyword hint** (no semantic judgement): `done` / `doing` / `next` / `dead` / `other`;
  - returns `{mode:"preview", source, file_mtime, items:[...], headings:[...], hint}`.
- **apply**: `ref` must come from preview `items` or `headings` and the line range must be inside the file; the plugin reads that excerpt **verbatim** as the requirement's v1 original (§4.6), pointer as `{session:"file:<path>#Lx-Ly", at:file mtime, note:"迁移：<note|title>"}`; `human_line`/`surface` come from the AI; nodes are created in item order (requirements at root, tasks under `parent_id`, `after`/`before` supported).
- The whole apply runs inside `Store.run` (B-39); failures leave no half-written data.
- On success with `archive !== false`, the source file is renamed to `status-archive-<YYYY-MM-DD>.md` (same directory, no overwrite: duplicates get `-2`…), returning `{archived_to}`; a rename failure returns `E_MIGRATE_ARCHIVE` (data already imported, no rollback).
- Idempotency: dedupe by `(parent_id, title)`, existing entries returned (same as `compass_import`).
- The only thing needing manual verification after migration: whether the "original words" in `baseline.md` are correct.

### 5.15 Completion notes and ancestor-chain checks

**Content standard (structured sections)**

| kind | Applies to | Sections (each on its own line, label at line start, non-empty content) |
|---|---|---|
| build | build/change-type tasks marked done this call | core files / contract (or contract/docs) / pitfalls; paths must really exist |
| research | research-type tasks marked done this call | findings / sources / next steps; paths optional (cross-workspace import skips path checks) |
| summary | ancestor-chain summaries: requirement, parent task, grandparent… | acceptance scope / conclusion / remaining risks |

**Hard gates**

1. Marking "done": write a completion note or inherit an existing detail that already satisfies the standard; idempotent re-marking (no state change) does not force a rewrite.
2. Any node whose detail is written this call (including "mark done", even when inheriting an old detail) ⇒ its **entire ancestor chain** must be summarised in the same `details` batch; missing any ancestor ⇒ `E_ANCESTOR_DETAIL_REQUIRED` (nothing written).
3. A requirement about to aggregate to "done" ⇒ its detail must already satisfy the summary standard; otherwise `E_REQUIREMENT_DETAIL_REQUIRED`.
4. `update` returns `rollups` (ancestor-summary ids written this call); `updated` includes ancestors.
5. **"Inheriting an old detail" does not exempt the ancestor chain (enforced in code since v0.1.1)**: marking "done" without writing a detail this call (inheriting a qualifying old detail) still counts as a completion action, so the ancestor-chain summaries must be provided in the same batch; otherwise `E_ANCESTOR_DETAIL_REQUIRED`. This applies per task in batch calls too — inheritance must not become a backdoor around parent-chain summaries.

**Backlog self-check (`compass_status.health`)**

| Field | Mechanical rule | Purpose |
|---|---|---|
| `missing_detail.tasks` / `.requirements` | `exec_state="已执行"` and the detail file is empty | expose "done but no handoff document" |
| `stale_chains.count` / `.items` | a node's detail file is newer than one of its ancestors (or the ancestor is empty) | expose chains where "the child was updated but the parent chain did not follow" |

**Exemptions**: `compass_migrate` (historical document migration) and whole-board bundle restore (`POST /api/compass/import`) skip the ancestor-chain check; `compass_import` (history backfill) follows §5.9. Exempt items are still surfaced by `health`.

## 6 Status model

### 6.1 Dual-line definition

| Line | Field | Values | Semantics |
|---|---|---|---|
| Execution line | `exec_state` | `未开始` / `进行中` / `已阻塞` / `已执行` | how far the work has got; the AI decides and the user may verbally ask to roll it back. `已阻塞` (blocked) = the AI is waiting for a third party / confirmation / another bug, needing human intervention (non-terminal; freely interchangeable) |
| Verdict line | `verdict_state` | null / `待裁决` / `冲突` / `已废弃` / `已替代` / `已确认继续` | whether this thing was abandoned/superseded/needs a ruling/conflicts with another requirement; decided by the main session |

The two lines are **physically separate and never overwrite each other**: one task can be "done + needs ruling" or "in progress + abandoned" at the same time. Difference between `冲突` and `待裁决`: conflict = collides with other/new requirements, not yet characterised; needs ruling = the user must decide (not necessarily a conflict).

### 6.2 State transition matrix

| From → To | Legal | Extra conditions / notes |
|---|---|---|
| `null` → `待裁决` | ✅ | the working AI raises a ruling request; `pointer_note` required |
| `null` → `冲突` | ✅ | collides with other/new requirements, not yet characterised; `pointer_note` required |
| `冲突` ↔ `待裁决` | ✅ | conflict escalated to a ruling request, or a ruling request judged to be a conflict; `pointer_note` required |
| `冲突` → `已废弃` / `已替代` | ✅ | ruling conclusion; `dead_reason` required; must cover the whole subtree |
| `冲突` → `已确认继续` | ✅ | persisted back to `null`, conclusion written into `pointer_note` |
| `冲突` → `null` | ⚠️ | only "withdraw the conflict marker"; `pointer_note` must state why |
| `冲突` → `冲突` | ✅ | idempotent (a new note is treated as an addendum) |
| `null` → `已废弃` / `已替代` | ❌ | must go through `待裁决` first; direct abandonment is not allowed |
| `null` → `已确认继续` | ❌ | instantaneous value; never a persisted target |
| `待裁决` → `已废弃` / `已替代` | ✅ | the main agent rules; `dead_reason` required; must cover the whole subtree |
| `待裁决` → `已确认继续` | ✅ | persisted back to `null`, conclusion written into `pointer_note` |
| `待裁决` → `null` | ⚠️ | only "withdraw the request"; `pointer_note` must state why |
| `待裁决` → `待裁决` | ✅ | idempotent (no empty note; a new note is an addendum) |
| `已废弃` / `已替代` → `待裁决` | ✅ | revival for re-discussion; `pointer_note` must state why the earlier conclusion is overturned; `dead_reason` cleared, reason goes to `pointers` |
| `已废弃` ↔ `已替代` | ✅ | conclusion corrected; `pointer_note` required; `dead_reason` updated per the new conclusion |
| `已废弃` / `已替代` → `null` | ❌ | revival must first go to `待裁决` |
| `已确认继续` → any | ❌ | instantaneous value; never a starting point |

**Batch "abandon with parent" exception**: within one `task_ids` batch, descendants of an abandoned/superseded node may go from `null` straight to `已废弃`/`已替代` (treated as disposed with the parent, exempt from the single-node matrix); `dead_reason` and full subtree coverage are still required.

**Execution-line rules**: the four `exec_state` values are freely interchangeable (including "done → in progress" rollback and in progress ↔ blocked), and a `pointer_note` is required; the plugin imposes no cross-line constraint (an abandoned task can still change `exec_state`; display dominance is decided by §6.3). The blocking reason is written on the first line of the detail (a rules-layer convention; the plugin does not parse semantics).

**Illegal transitions**: return `E_INVALID_TRANSITION`, with `message` stating the allowed target states; no field is written.

### 6.3 Display dominance

| Node state | List row | Visible views | Ordering |
|---|---|---|---|
| `verdict=null` | execution badge | current only, active only, full history | tree order |
| `verdict=null` and `exec=已阻塞` | yellow "blocked" badge (pause icon); hover shows the first line of detail | current only, active only, full history | tree order (status bar counts "blocked N") |
| `verdict=待裁决` | execution badge + red "needs ruling" badge | **any view** | **pinned area** (global top) |
| `verdict=冲突` | execution badge + orange "conflict" badge | **any view** | **pinned area** (global top) |
| `verdict=已废弃` | grey + strikethrough; execution state demoted to secondary text; `dead_reason` shown inline | full history only | tree order |
| `verdict=已替代` | grey; execution state demoted to secondary text; `dead_reason` shown inline | full history only | tree order |
| `merged_into ≠ null` | extra grey badge "merged into `<target>`" | same as its verdict rule | tree order |

Rules:

- **Needs ruling / conflict** depend only on `verdict_state`, not `exec_state`: even a "done" node is pinned to the top.
- **Abandoned / superseded take visual dominance**: the row's visual lead is the verdict result; the execution state becomes secondary information.
- **Confirmed continue** is not persisted and not displayed (persisted as `null`).
- **Blocked does not take verdict dominance**: needs-ruling/conflict nodes stay pinned per the verdict rules even when blocked; blocked is shown only as an execution badge (yellow pause) and counted in the status bar.
- The pinned area is a **cross-level aggregate** block at the very top of the list, so deep needs-ruling nodes are not hidden by collapsed parents.

### 6.4 Traceability chain

| Field | Type | Description |
|---|---|---|
| `session` | string | session identifier; filled by the plugin; the AI cannot write it |
| `at` | string | time of the board change, ISO-8601 with timezone; required (plugin-filled) |
| `turn` | int \| missing | turn within the session; source see "turn sources" below; may be omitted when unavailable |
| `note` | string | free text: who did what, on what basis; non-empty; may mention "turn N" but carries no authority |

When pointers are appended:

| Action | Pointer appended? | Note requirement |
|---|---|---|
| `compass_plan` | yes (override the default "建任务" with `pointer_note`) | one sentence |
| `compass_update` changing `exec_state` / `verdict_state` / `dead_reason` | yes (required) | state the change and the basis; abandon/supersede must quote the key points of the user's ruling |
| `compass_update` changing only `detail` | no (optional) | a "detail updated" sentence is suggested |
| `compass_merge` | yes (required) | merge reason |
| `compass_change` | no (the version is recorded in the baseline) | — |

The chain is append-only; never modified or deleted; it forms a chain in natural time order. `at` is the authoritative time; "turn N" wording in `note` is for humans and is not validated.

**Turn sources**

| Priority | Source | Accuracy | Description |
|---|---|---|---|
| 1 | `session/event`'s `turn/start` (`event.data.turn`) | authoritative | the host facet subscribes to the event stream and keeps a per-session tracker; `turn/end` closes it |
| 2 | current session-log restore (`turn/start` / `turn/end` intervals) | authoritative, same numbering | only when the plugin was loaded mid-turn (tracker has no current turn and has never seen one); cached per session for 60s; once the tracker has an authoritative turn, no fallback is used |
| 3 | leave empty | — | when the session log is unreadable (e.g. persistence disabled); `at` is authoritative and `note` may freely mention "turn N" |

- **Never** estimate turns from "the number of user messages": DSH injects runtime-context / skill catalogs / agent messages / subagent results / tool notifications / time snapshots as the user role, inflating the count (internally observed: turn 3 recorded as turn 38/48), which makes traceability jumps fail.
- **Read-only access** to session logs (`<DSH_HOME>/sessions/<workspace-key>/<session-id>/session.v4.jsonl.zstd`) is allowed for turn restore and jump verification — it is a persistence format, not the deprecated host API (`eventAt` / `snapshotEvents` remain forbidden).
- **Verify before jumping**: the UI calls `/session-turn` (§3.6) before a jump and restores the real turn from `at`; subagent sessions jump to the parent session. Failure messages must distinguish "log missing / turn missing / not rendered" and must never present a failed locate as success.
- `turn` stores only a number, not its source, and is not validated.

### 6.5 Evidence requirements

- When writing an abandonment reason, the AI **must** be able to trace it to the traceability chain (which session, what time; turn wording may go in `note`); without evidence, "abandoned" must not be written.
- The plugin **does not validate** evidence strength (impossible to judge programmatically); it only displays `pointers` fully in the UI for the user to check.
- `dead_reason` is condensed by the AI and must quote the key points of the user's ruling; the user may add their own judgement in the note column.

### 6.6 Instantaneous semantics of "confirmed continue"

- Legal **as an input**: only `待裁决` → `已确认继续`.
- **Not persisted**: written back as `null`, with a pointer appended containing the conclusion (required).
- Empty `pointer_note` ⇒ `E_POINTER_NOTE_REQUIRED` (otherwise the conclusion is lost and the chain breaks).
- Reads never return `已确认继续`; historical conclusions are found only in `pointers`.

---

### 6.7 Requirement-level status (mechanical aggregation, v1.28)

- Requirement and task nodes share `exec_state` / `verdict_state` semantics; requirement-level `exec_state` is a **derived value mechanically aggregated from child tasks** (v1.28), not written by the AI.
- Aggregation rule (ignoring abandoned/superseded subtrees; nested tasks count): no active tasks ⇒ not started; any blocked ⇒ blocked; any in progress ⇒ in progress; all done ⇒ done; all not started ⇒ not started; otherwise mixed ⇒ in progress.
- The plugin synchronises all requirement statuses before every tree write (`plan` / `update` / `move` / `import` / `migrate`); passing a requirement `exec_state` from the AI ⇒ `E_INVALID_ARG`; legacy data is corrected on the next write or a manual sync.
- The UI requirement row also shows mechanical counts (`n tasks: x in progress / y done / z needs ruling`), consistent with the aggregated status.
- When a requirement is abandoned/superseded, `compass_update`'s `task_ids` must cover its whole subtree (§5.5 structural check).
- **Completion summary gate (v1.31)**: when a requirement is about to aggregate to "done", the plugin validates before writing the tree that the requirement detail satisfies the summary standard (acceptance scope / conclusion / remaining risks, each on its own line); missing ⇒ `E_REQUIREMENT_DETAIL_REQUIRED` and nothing is written. In other words: before marking the last child task done, write the requirement completion summary first.

### 6.8 Traceability of history backfill

- Backfilled nodes may have `pointers[].session` pointing at a **non-current session**; `at` is required and uses the historical message time; `turn` is `null` when no reliable value exists (never fabricated).
- The backfilled `pointer.note` must start with `历史回填：` followed by one sentence (e.g. `历史回填：方案评审阶段`).
- The baseline v1 original of a backfilled requirement must match the historical message verbatim, with `msg.session/at` pointing at that message; if it cannot be retrieved the backfill is rejected (`E_HISTORY_NOT_FOUND`) rather than degraded to AI-written text.
- Backfill does not change status semantics: historically completed tasks get `已执行`, abandoned ones get `已废弃` + `dead_reason`.
- Backfill is append-only: it never rewrites, deletes or modifies historical sessions or existing nodes.


## 7 Rules block: install / upgrade / uninstall

| Scenario | Behaviour |
|---|---|
| First install | create the file if missing; otherwise **append** the block (preceded by a blank line) |
| Repeated init | block exists and content identical ⇒ `unchanged`, not appended again |
| Plugin upgrade | **replace** the block content with the current version; no stacking, no old version left, nothing outside the block touched |
| Uninstall | **one-click uninstall**: the UI's "uninstall plugin" button removes the whole rules block (including the two marker lines) + deletes all workspace data; strong double confirmation (lists the rules block and all workspaces); if the rules block is corrupt ⇒ abort and delete nothing |
| Block corrupt (only begin, no end) | anomaly detected ⇒ refuse automatic modification, return `E_STORE_CORRUPT` and ask for manual handling (avoid deleting user content) |

- File writing itself follows §4.7 atomic write and the serial queue.
- A failed rules-block write must not make `compass_init` fail (degrade to "print copyable text").
- The current rules block has **18 rules** (including the two hard rules "requirement completion summary" and "update the whole ancestor chain").


## 12 Migration and export/import

### 12.4 Migration

Form decided: an 11th tool `compass_migrate` (AI-driven preview/apply); a CLI may come later.
Goal: split a legacy `status.md` into **task tree + details + requirement baseline** (the old human/machine dual-directory layout is retired).

Two phases:

1. `preview(path)`: read-only scan (max 1MB), producing candidate segments from the Markdown structure:
   - headings → `headings` candidates (the heading line can be the ref for the baseline's "original words") with `heading_path`; unordered/ordered list items and task checkboxes (`- [x]` / `- [ ]`) → `items` candidates;
   - `kind_hint` is a **mechanical keyword hint** (no semantic judgement): contains "已完成/完成/已做/✅/[x]" → `done`; contains "进行中/正在/推进中" → `doing`; contains "下一步/待办/TODO/计划" → `next`; contains "废弃/取消/替代/不做" → `dead`; otherwise → `other`;
   - each item returns `{ref:"Lx-Ly", text(truncated), kind_hint, heading_path}`; the AI uses this to translate `human_line` and decide ownership and granularity.
2. `apply(items, archive=true)`:
   1. initial requirements and acceptance items → `baseline.md` v1 (original = that excerpt **verbatim**, pointer to `file:<path>#Lx-Ly` + file mtime);
   2. current work, sub-steps, next steps → requirement nodes + task nodes (`human_line` translated by the AI);
   3. abandoned/superseded records and reasons → `dead_reason` + pointers;
   4. technical details → the corresponding node details (AI column);
   5. other process content → not migrated; the original file is renamed `status-archive-<date>.md` for the record (no overwrite; duplicates get a numeric suffix).
- The only thing needing manual verification after migration: whether the "original words" in `baseline.md` are correct.
- Idempotency: dedupe by `(parent_id, title)`; repeated apply returns `existing`.
- The whole apply runs inside the write lock (B-39); a failure leaves no half-written data and does not rename the original file.

### 12.5 Export / import

Bundle format (JSON, UTF-8, single file):

```json
{
  "format": "dsh-taskboard-bundle",
  "schema": 1,
  "exported_at": "<ISO-8601>",
  "plugin_version": "0.1.0",
  "workspace": { "workspace_id": "<storage dir name>", "name": "demo", "original_path": "<WORKSPACE_PATH>" },
  "meta": { "…meta.json snapshot…": true },
  "tree": { "…tree.json…": true },
  "baseline": { "raw": "<baseline.md raw text>" },
  "details": { "R-001": { "md": "<AI detail raw>", "note": "<user note raw>" } }
}
```

- **Export**: `GET /api/compass/export?cwd=<absolute path>` ⇒ `200` + `content-type: application/json` + `content-disposition: attachment`; read-only, changes nothing; `details` contains only details/notes that **exist** (missing treated as empty).
- **Import**: `POST /api/compass/import` body `{cwd, bundle, confirm:"IMPORT"}`:
  - validate: `format` matches, `schema <= 1`, the tree passes the eight invariants, the baseline parses, the requirement set matches the tree, and every `details` id exists in the tree;
  - the target board must be empty (no `meta.json`, or a tree with no nodes and a baseline with no requirements), otherwise `E_INVALID_ARG` (**no merging**, avoiding partial overwrite);
  - write order: meta → tree → baseline → details/notes; the whole thing runs inside `Store.run` (write lock); any failure deletes the workspace data directory created by this import, returning to the pre-import state;
  - success returns `{imported:{nodes, details, baseline_requirements}}`; failure leaves no half-written data.
- Security: `workspace.original_path` in the bundle is display-only and **never used for resolution**; the import target is decided by the current `cwd` (§4.1).

---

