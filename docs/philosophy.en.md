# dsh-taskbearing — Design Philosophy & User Guide

[中文](philosophy.md) | **English**

> **Canonical version: Chinese.** This is a mirror translation of [`philosophy.md`](philosophy.md) and may lag behind it; in case of conflict the Chinese document wins. When the contract changes, change the Chinese document first and then sync this mirror.

> For **users** and **developers**: why this plugin is designed this way, how to use the task board, how status flows, and what it does not do.
> Data structures, field formats, tool APIs, and migration/exchange formats are in [schema-v2.en.md](schema-v2.en.md).

Path placeholders used in this document: `<DSH_HOME>` = DSH user data root; `<WORKSPACE_PATH>` = current workspace root.

---

## 1. What it is

**dsh-taskbearing** is a **workspace-scoped task memory & context-recovery plugin** for DSH (DeepSeek Harness). It does four things:

- **Store**: persist the agent's task tree, each node's dual status lines, details, user notes and traceability chain per workspace.
- **Show**: render a task list in the right sidebar by view — humans only see plain language; open the detail panel to see the dense, agent-oriented content.
- **Prompt**: use DSH's global rules file to make the agent maintain the board proactively (the plugin does not inject per-turn reminders).
- **Hand off**: one-click copy of a handoff document to drop into a new session, without re-reading history.

It solves four real pain points:

| Pain | Symptom | How the plugin addresses it |
|---|---|---|
| Loss of direction | After dozens of turns, nobody remembers the original goal or how far you got | Requirement tree + dual status lines + the requirement's original words pinned in the baseline |
| Unreadable status | The agent's progress notes are full of function names | `human_line` one-liner for humans + detail panel for the agent |
| Broken handoff | A new session cannot pick up sub-step-level progress | Copy handoff + the new session reads the board with tools |
| Facts by memory | The agent invents file paths and drifts the original wording | Hard path check on detail writes + verbatim original-text comparison |

**What it is not**: not a rules engine, not a code generator, not project-management software — **judgement stays with the AI; the plugin only enforces format, completeness and factual checks**.

---

## 2. Design philosophy

### 2.1 Judgement belongs to the AI; the plugin only stores, never judges

The plugin **does not judge** "is it done / is it covered / is it conflicting / is it worth splitting". It answers only two kinds of questions:

- **Is the format valid**: field types, enums, hierarchy invariants, whether a status transition is legal;
- **Is the fact true**: whether the original text matches the session verbatim, whether file paths in details really exist.

Judging "should this be marked done" or "does this change affect the original requirement" is always the AI's job.

### 2.2 Facts must be checkable, not "trusted"

Three anchors make things checkable after the fact:

1. **Original words**: the original text in a requirement baseline must match the user message **verbatim** (in the current session the AI passes it and the plugin compares character by character; cross-session it is read back from the session log by the plugin);
2. **Paths**: file paths written in details must really exist on disk, otherwise **the write is rejected**;
3. **Changes**: every status/content change appends a traceability record with session, time, turn and note.

If any link cannot be obtained, prefer marking it "pending lock / pending confirmation" and making that visible, rather than silently filling in an approximate value.

### 2.3 No silent degradation

Every degraded path must be visible: unreadable original text shows "original pending lock"; when the host cannot open files the path is copied with a hint; an outdated host shows "old host, restart to enable"; anchor detection failures produce an explicit hint. **Failures are never dressed up as successes.**

### 2.4 Separation of human and AI writers

Each file has exactly one writer:

- `<id>.md` (AI detail) is written only by tools;
- `<id>.note.md` (user note) is written only by the panel;
- the panel and the tools never touch each other's files.

This gives concurrency safety and clear responsibility: the AI cannot corrupt your notes, and you cannot overwrite the AI's details.

### 2.5 Data is local and isolated per workspace

All data lives in `<DSH_HOME>/storages/compass/<workspace-name>-<hash>/`; one session maps to one workspace; nothing is reported to the network.
**There is no "workspace switching" feature**: the panel always shows the current session's workspace; other board data is only handled by disk cleanup in the settings page (see §8).

### 2.6 Sessions are the real source; features that leave the stage should be deleted

- **Global timeline / change log** was removed: a single task's traceability chain already covers "what changed just now"; a global stream only adds noise.
- **Multi-workspace parallel board** was removed: under workspace isolation, switching boards would make the panel's and the tools' scopes disagree — over-design.
- **The settings page is not a board switcher**: it is only a disk-cleanup tool for local board data.

### 2.7 Contract first (for developers)

When implementation and documentation disagree: **change the contract first, then the code**. Data formats, status semantics and UI behaviour are defined by the documents; a new capability is specified in the docs before it is implemented.

---

## 3. How to use the task board

Open the right sidebar of any session → the "Task board" card.

- **Three views**: current only (default) / active only / full history.
- **Requirement rows**: show mechanical child-task counts (e.g. `12 tasks · 2 in progress · 1 blocked`).
- **Pinned area**: nodes that need a ruling or are in conflict are pinned across levels, so you see at a glance what needs your decision.
- **Detail dialog**: AI detail on the left (read-only), your notes on the right (auto-saved); traceability chain and file anchors below.
- **Search**: filter within the current view; matching nodes auto-expand their ancestor chain.
- **Copy handoff**: one click at the bottom of the detail panel copies "task id / path / dual status / traceability / requirement surface / detail / notes".
- **Refresh**: the panel polls every 2 seconds; editing notes is not interrupted; manual refresh is available when updates exist.
- **Theme and width**: follows the host's light/dark theme; the panel remains usable down to 340px with no horizontal scrolling (long text truncates or wraps).

### Handoff flow (user SOP)

1. Find the node to hand off on the board → open detail → "Copy handoff content";
2. Paste it as the first message of the new session;
3. The new session's AI verifies with `compass_read` before continuing, and updates status with tools when needed.

The plugin **never** injects context into a session automatically — whether and what to hand off is your decision.

---

## 4. Dual status lines and the state machine

Every node (requirement/task) has **two independent status lines**:

### 4.1 Execution line

| State | Meaning | Who decides |
|---|---|---|
| Not started | Nothing has happened yet | AI |
| In progress | Being worked on | AI |
| **Blocked** | Waiting for a third party / confirmation, or stuck; needs human intervention | AI |
| Done | Finished | AI |

### 4.2 Verdict line

| State | Meaning |
|---|---|
| (empty) | No verdict issue |
| Needs ruling | The user must decide (collision with an old requirement, scope change, etc.) |
| Conflict | Two requirements/sessions contradict each other; not settled yet |
| Abandoned | This node is void (a reason is mandatory) |
| Superseded | Replaced by another node (a reason is mandatory) |

### 4.3 Transition rules (user view)

- The four execution states **can switch freely** (the AI decides), and every change must carry a `pointer_note` explanation.
- The verdict line **cannot abandon out of nowhere**: it must go `needs ruling/conflict → abandoned/superseded` and record a `dead_reason`; this is what makes "why it was dropped" auditable.
- Abandoning/superseding a parent node must **cover the entire subtree** (or explicitly state which children are not being dropped) to avoid dangling sub-tasks.
- "Confirmed continue" is instantaneous: the AI passes it to mean "the user confirmed continuing"; when persisted it is normalized back to "no verdict".

### 4.4 Requirement-level status is aggregated mechanically

A requirement row's `exec_state` is no longer written by the AI; it is a derived value the plugin **mechanically aggregates** from child tasks: all done → done; any blocked → blocked; any in progress or mixed → in progress; all not started → not started (ignoring abandoned/superseded subtrees). Writing a requirement status directly is rejected — the AI only updates child tasks and the requirement row recomputes itself. This keeps "status" a summary of facts that never drifts.

### 4.5 Pin-to-top and visual dominance

- **Needs ruling / conflict** are visible in every view and enter the pinned area;
- **Abandoned / superseded** appear only in "full history";
- When the execution and verdict lines disagree, **the verdict line decides visibility**: a task judged abandoned does not reappear in the default view just because it is "done".

---

## 5. Traceability chain and evidence

Every node creation, status change, verdict change, merge, move, and note write appends a traceability record:

```json
{ "session": "<session id>", "at": "<ISO time>", "turn": 12, "note": "why this change happened" }
```

- `session` / `at` are filled in by the plugin; the AI cannot fabricate them;
- `turn` comes first from the host's `turn/start` event; when the plugin was loaded mid-turn it is restored from the **current session log** (same numbering scheme); if neither is available it stays empty (**never guessed** — the old "count user messages" approximation could record turn 3 as turn 38);
- `note` is the AI's one-line reason.

The traceability chain in the detail panel supports **jumping back to the original session** and **locating and highlighting turn N**. It is the evidence chain for reviewing "why was this decided at the time".

**Jumps are verified, not trusted**: before jumping, the plugin checks whether that "turn N" really exists in the session log. Legacy data with a wrong turn is restored from the record's time (`at`, authoritative); records from **subagent sessions** cannot be opened directly and jump to the corresponding turn of the **parent session** instead. Historical sessions missing from the session list are verified via the session log instead of being falsely reported as "session unavailable"; when verification fails the plugin says why (log missing / turn missing / not rendered) instead of pretending the jump succeeded.

### Cross-session collision hint

A task shows a tiny ghost marker when **it is in progress/blocked** + **has a non-terminal verdict** + **was touched by another session within the last 30 minutes**. Historical changes are not flagged, avoiding a wall of red. The marker means "another session is working on this".

---

## 6. Original-text baseline: why verbatim

Each requirement stores two things in the baseline:

- **Surface**: a one-line summary written by the AI, for humans;
- **Original**: the user's **verbatim wording**, for verification.

How the original text is written (since v1.24):

| Scenario | Who provides | What the plugin does |
|---|---|---|
| Current session, just heard | The AI passes `original_text` | Compares **verbatim** against current-session user messages; locks only on exact match, otherwise rejects (`E_ORIGINAL_MISMATCH`) |
| Cross-session / history backfill | The plugin reads it back via `refs` from the session log | The AI does not pass the text; the plugin reads it verbatim and strips machine-injected blocks |
| Unobtainable | — | Records "original pending lock" and lets the user paste it in the UI (fallback, not silent) |

> **Why not let the AI write it directly?** Because the AI "helpfully optimizes" wording, and original-text drift is impossible to detect later. The relaxation in the current session is "the AI may pass it, but it must be verbatim and is verified by the plugin" — saving a history scan without giving up fidelity.

Runtime snapshots (`Time sampled while preparing turn…`, `Browser time zone for this request:`, etc.) are machine-injected content and are **never** treated as the user's original words.

Requirement changes use `compass_change` to **append versions**, never overwriting; each version re-locks that version's original text.

---

## 7. Path facts: anchors and hard checks on writes

### 7.1 File anchors (read side)

File paths appearing in details and notes are mechanically recognised as clickable anchors. When the detail panel opens, the plugin first runs an **existence check**:

- **Exists** → blue and clickable, opens the DSH file preview;
- **Missing** → dimmed with a dashed border; clicking = copy the path + hint "path missing, copied", **no** "file not found" pop-up;
- **Check failed** (old host missing the API) → stays clickable with "cannot verify (old host)" hint.

### 7.2 Hard check on writes (write side, anti-hallucination)

Before `compass_plan` / `compass_update` writes a detail, the plugin checks **every** recognised file path with `fs.existsSync()`; **if any path is missing the whole write is rejected**:

```text
[Error] detail write rejected.
Reason: the detail contains a file path that does not exist: "src/api/user.ts".
Suggested action: verify the real workspace structure with terminal or file tools, and resubmit using real absolute or relative paths. Never invent paths.
```

When rejected, the task tree, statuses, traceability and details **all remain unchanged**. The AI should check the real directory and rewrite, not switch entry points to bypass the check.

**Two usage conventions**:

1. Reference other repositories with **absolute paths** (relative paths resolve against the current workspace);
2. Do not write anchors (backticked paths) for files that do not exist yet — describe them in plain words ("planning to add …"). This is the price of "no lying".

**Exemptions**: `compass_import` (importing another workspace's data) and `compass_migrate` (migrating historical document text) skip the check — they are not current facts invented by the AI.

---

## 8. Lifecycle and data management

- One data directory per workspace: `<DSH_HOME>/storages/compass/<workspace-name>-<hash>/`;
- If a project is deleted/moved, its data remains (marked "path no longer valid") and is not auto-deleted;
- **Settings → local board data**: lists all local boards (name/path/node count/updated at/status); stale items can be cleaned manually (deletes only the data directory, not the project); the current board can also be deleted (the board becomes empty);
- **Migration and backup**: export as a JSON bundle (tree + details + notes + baseline originals) and import it into another workspace (the target board must be empty);
- **One-click uninstall**: removes the `<DSH_HOME>/AGENTS.md` rules block + deletes all workspace data (strong double confirmation; aborts if the rules block is corrupt, deleting nothing).

---

## 9. How the AI maintains the board (rules layer)

The plugin installs a marked block in `<DSH_HOME>/AGENTS.md` (installed idempotently by `compass_init`), effective for new sessions. Key rules:

1. **Plan before starting**: after the user confirms the work, create the complete task tree (including not-started nodes) and advance states as you go;
2. **Organise by ownership**: attach sub-tasks to the corresponding parent task; put acceptance/optimisation items under the acceptance task; do not flatten everything onto the requirement level;
3. **Write details as a handoff document**: three anchors are required — core files / contract or docs / pitfalls (written as "none" when absent); each on its own line with the label at the start of the line;
4. **Blocked has a required form**: mark "blocked" and put "blocked: waiting for what / who can resolve / next step" on the first line;
5. **Update the whole parent chain (hard check)**: writing any detail (including completion notes) requires updating the **entire ancestor chain** (parent task, grandparent, requirement) summaries in the same call; missing one rejects the write (`E_ANCESTOR_DETAIL_REQUIRED`). Before a requirement is aggregated to "done", a requirement completion summary must already exist (`E_REQUIREMENT_DETAIL_REQUIRED`). The plugin only does mechanical checks and stale detection (`health.stale_chains`); it never writes summaries for the AI;
6. **History boundary**: session-history scanning (`compass_import`) is only for "new session with insufficient handoff needs tracing" and "cross-session repair/audit (explain first)"; information already in the current context must not be re-fetched from history;
7. **Self-check every turn**: call `compass_status` first; if you changed the board, record it; otherwise confirm nothing changed;
8. **Completion notes are mandatory when marking done**: single node via `detail`, batch via `details` (per task). Build-type: core files / contract / pitfalls (paths must exist). Research-type: findings / sources / next steps (paths optional). The three sections must each start on their own line, with the label at line start and non-empty content — the plugin validates the structure and rejects one-sentence bluffs;
9. **Duplicate tasks must be closed**: when `compass_plan` / `compass_require` / `compass_update` returns a possible-duplicate warning, or `compass_status.health.duplicate_pairs` hits, confirm whether it is the same issue; if so mark the old task "superseded" and state in `dead_reason` what replaced it — do not leave a same-topic not-started task around (the plugin only gives mechanical duplicate hints; judgement stays with the AI/user);
10. **Use health for backlog self-check**: `health.missing_detail` (executed but no detail) and `health.stale_chains` (child detail newer than ancestors) are mechanical facts, not suggestions — fix them when they show up; do not leave them red forever.

---

## 10. Anti-bloat

The biggest risk of a board is not missing features but **growing, slowing and cluttering over time**. Four mechanisms:

1. **Keep the tree small**: `tree.json` stores only hierarchy, status, traceability and merge/abandon info; details, notes and baseline originals are split into separate files, so opening the panel reads only the small tree.
2. **Details on demand**: content in `details/` is read only when the panel opens or the AI calls `compass_read(detail:<id>)`; the whole workspace's details are never stuffed into the AI's context.
3. **Display de-noising**: the default "current only" view hides abandoned/superseded; only "needs ruling/conflict" pins to the top; empty states, search and folding all exist to reduce noise.
4. **Rule constraints**: the AI writes plain language per the `AGENTS.md` rules instead of a log; details follow the three-anchor handoff format and do not accept "dump a pile of logs".

The plugin never auto-summarises (that is the AI's judgement) and never "compresses history" — archiving is decided by the user via export or cleanup.

---

## 11. Boundaries and non-goals

- Does not judge completeness, coverage or whether a conflict is real — judgement belongs to the AI/user;
- Does not send per-turn reminders or auto-inject context into sessions;
- Does not do real-time multi-user collaboration or diff merging (notes are last-writer-wins);
- Does not do a global timeline, workspace switching, drag-and-drop ordering or task deletion;
- Does not generate semantic summaries ("one-line plain language" is written by the AI);
- Does not do cloud sync: data stays in the local `<DSH_HOME>`.

---

## 12. Known limitations

- **Platform**: requires the DSH host (tool registration, right-sidebar tab, webServer routes); the UI cannot run in a standalone Node process;
- **Path recognition**: requires an extension whitelist and no spaces/CJK characters (e.g. `某 技术方案 v1.2.md` gets truncated) — an existing boundary of the recognition layer;
- **Windows first**: path normalisation and file opening follow Windows semantics (POSIX also runs, but is not fully regression-tested);
- **Task quality depends on the AI**: the plugin only does mechanical validation; if the AI does not maintain the board per the rules, it will become stale (`compass_status` can mechanically hint "board N turns behind");
- **Old host**: after upgrading the plugin, restart DSH to load the new host-side logic (the panel shows "old host" instead of an error);
- **Turn may be missing**: turn navigation depends on session logs (`<DSH_HOME>/sessions`); without a persisted log only "open the original session" is possible, and the plugin says so explicitly instead of inventing a turn;
- **Scope of the ancestor-chain check**: the hard check applies to "write detail / mark done"; plain status transitions (not started → in progress) are not blocked — stale parent chains are surfaced by `compass_status.health.stale_chains`; `compass_migrate` and whole-board restore are exempt;
- **Subagent sessions**: a subagent's session records cannot be opened in the chat area like a main session; traceability can only jump to the corresponding turn of the parent session.

---

## 13. Glossary

| Term | Plain explanation |
|---|---|
| **Task board** | The tree in the right sidebar: requirement → task → step, with status and details. |
| **Requirement tree** | A hierarchy organised as "what the user wants → which tasks → how each task is done". |
| **Dual status lines** | Each task has two statuses at once: **how it is going** (execution line) and **whether you need to rule on it** (verdict line); they never overwrite each other. |
| **Execution line** | Not started / in progress / blocked / done — used by the AI to express progress. |
| **Verdict line** | Empty / needs ruling / conflict / abandoned / superseded — records needing your decision or already voided. |
| **Blocked** | Not "slow" but "stuck waiting for an external condition", needing human intervention; the panel highlights it in yellow and counts it. |
| **Needs ruling / conflict** | Things that need your decision; both are pinned to the top of the panel and visible in every view. |
| **Pinning** | Keeping needs-ruling/conflict nodes at the top of the list regardless of their original depth. |
| **Traceability chain** | A task's history of changes (who, which session, which turn, why), clickable back to the original session. |
| **Original-text baseline** | The user's first wording for a requirement, stored verbatim and not rewritable; every change appends a version instead of overwriting. |
| **Surface** | The AI's one-line condensation of the original text, stored alongside it for humans. |
| **Verbatim check** | The original text must match what the user sent character by character; a single extra punctuation mark is rejected. |
| **Handoff content** | The one-click copy summary (status, paths, traceability, detail, notes) to paste into a new session. |
| **Collision hint** | The small ghost marker on a task touched by another session within the last 30 minutes; historical changes are not flagged. |
| **File anchor** | A path in the detail rendered as a clickable tag; clicking previews the file in the sidebar. |
| **Tri-state anchor** | The three anchor states: exists (clickable) / missing (dimmed, copy on click) / check failed (old-host hint). |
| **Anchor check (hard write check)** | Before writing a detail, check that every file path in it really exists; reject the write if any is missing — anti-hallucination. |
| **Write lock / optimistic version check** | Protection when two windows write the same data: queued writes and version checks before writing, so updates are not lost. |
| **Workspace data directory** | One board per project, stored under `<DSH_HOME>/storages/compass/`, distinguished by a path hash. |
| **Orphan data / stale path** | Board data remains after the project directory is deleted/moved; the panel marks it so you can decide whether to clean it up. |
| **Rules block** | A block the plugin writes into `<DSH_HOME>/AGENTS.md` teaching the AI how to maintain the board; reinstall/upgrade with `compass_init`. |
| **Visible degradation** | When something fails, say what is unavailable and what to do — never pretend success. |
| **schema** | The data-format version; compatible migration happens on plugin upgrade (currently `schema = 2`). |
| **Completion note** | The handoff note required when marking a task done: build-type (core files/contract/pitfalls) or research-type (findings/sources/next steps). |
| **Requirement completion summary** | The three sections that must exist before a requirement is mechanically aggregated to "done": acceptance scope / conclusion / remaining risks. |
| **Ancestor-chain summary** | When writing any detail, the parent task, grandparent and requirement must be updated with the same three-section summary in the same call (missing one rejects the write). |
| **Stale chain** | The mechanical fact that a child's detail is newer than its ancestors, i.e. the parent chain did not follow; `compass_status.health` lists them. |
| **Subagent session** | A subagent's session (bare UUID); traceability can jump to the corresponding turn of its parent session, but it cannot be opened directly in the chat area. |
