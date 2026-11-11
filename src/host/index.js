/**
 * DSH 宿主入口（host facet）：注册七个 compass_* 工具，注入会话上下文、原话与轮次，初始化时写全局规则区块。
 *
 * 设计契约：docs/schema-v2.md §3、§5、§7、§11。
 * 平台依据（SPIKE 实测）：
 *   - execute(args, exec) 的 exec.agent.session.header = { id, cwd, ... }（SP-1）
 *   - session.deriveMessages() 可读会话原文，user 消息含机器注入块需剥离（SP-8，见 session.js）
 *   - 轮次：订阅 session/event 的 turn/start（SP-1 补充，见 turn.js）
 *   - 全局规则：$DSH_HOME/AGENTS.md 标记区块，新会话生效（SP-4）
 *
 * 测试钩子：环境变量 `DSH_COMPASS_HOME` 覆盖数据根与规则文件所在目录（E2E 用临时目录，避免污染真实 $DSH_HOME）。
 */

import os from "node:os";
import path from "node:path";

import { CODES, CompassError } from "../core/errors.js";
import { Store } from "../core/store.js";
import { createCompass } from "../core/tools.js";
import { hostSessionInfo, readOriginal, verifyOriginalText } from "./session.js";
import { TurnTracker, resolveTurn } from "./turn.js";
import { installRuleBlock } from "./rules.js";
import { registerCompassRoutes } from "./routes.js";
import { computeBoardStatus } from "./board-status.js";
import { createHistoryReader, currentTurnFromLog, sessionsRootOf } from "./history.js";

export const name = "dsh-taskbearing";
export const inject = ["tools"];

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { text: { type: "string" } },
  required: ["text"]
};

const PKG_VERSION = "0.1.0";

/** 数据根：默认 $DSH_HOME，测试可用 DSH_COMPASS_HOME 覆盖。 */
export function compassHome() {
  return process.env.DSH_COMPASS_HOME || process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

/** 真实 DSH 数据根（历史会话永远在真实 $DSH_HOME 下，不受 DSH_COMPASS_HOME 测试钩子影响）。 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

/** 规则文件路径（$DSH_HOME/AGENTS.md）。 */
export function rulesFilePath() {
  return path.join(compassHome(), "AGENTS.md");
}

/** 数据根（$DSH_HOME/storages/compass）。 */
export function storageRoot() {
  return path.join(compassHome(), "storages", "compass");
}

/** @param {unknown} value */
function renderJson(value) {
  return [{ type: "text", text: JSON.stringify(value ?? null, null, 2) }];
}

/** @param {unknown} err */
function toToolError(err) {
  if (err instanceof CompassError) {
    const wrapped = new Error(`${err.code}: ${err.message}`);
    wrapped.name = "CompassError";
    wrapped.code = err.code;
    if (err.details !== undefined) wrapped.details = err.details;
    return wrapped;
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * 由 cwd 构造（并缓存）Store；同一工作区共享写队列。
 * @param {Map<string, Store>} cache
 * @param {string} cwd
 */
function storeFor(cache, cwd) {
  const normalized = path.resolve(cwd);
  const existing = cache.get(normalized);
  if (existing) return existing;
  const store = Store.forWorkspace({ storageRoot: storageRoot(), workspacePath: normalized, pluginVersion: PKG_VERSION });
  cache.set(normalized, store);
  return store;
}

/**
 * 退化轮次还原（v1.30 / B-61）：仅在 TurnTracker 既没有当前轮、也没见过任何轮次时
 * （= 插件在本轮中途加载）才读会话日志还原，避免把注入消息计成轮次。
 * 结果按会话缓存 60s：同一加载轮内不重复解码日志；一旦 tracker 拿到权威轮次就绕开。
 * @param {{turns?: TurnTracker, sessionsRoot?: string, fallbackTurns?: Map<string, {turn: number|null, at: number}>}} deps
 * @param {{sessionId: string|null, cwd: string|null}} info
 * @returns {Promise<number|null>}
 */
const FALLBACK_TURN_TTL_MS = 60_000;

export async function resolveFallbackTurn(deps, info) {
  const sessionId = info?.sessionId ?? null;
  const cwd = info?.cwd ?? null;
  if (!sessionId || !cwd || !deps?.sessionsRoot || !(deps.fallbackTurns instanceof Map)) return null;
  if (deps.turns?.current(sessionId) !== null && deps.turns?.current(sessionId) !== undefined) return null;
  // tracker 已观察到过轮次事件 ⇒ 有权威来源，不再用日志退化
  if (deps.turns?.last(sessionId) !== null && deps.turns?.last(sessionId) !== undefined) return null;
  const cached = deps.fallbackTurns.get(sessionId);
  if (cached && Date.now() - cached.at < FALLBACK_TURN_TTL_MS) return cached.turn;
  let resolved = null;
  try {
    resolved = await currentTurnFromLog({ sessionsRoot: deps.sessionsRoot, workspacePath: cwd, sessionId });
  } catch {
    resolved = null;
  }
  const turn = resolved?.turn ?? null;
  deps.fallbackTurns.set(sessionId, { turn, at: Date.now() });
  return turn;
}

/**
 * 从 exec 组出 compass 实例。
 * @param {any} exec
 * @param {{turns: TurnTracker, stores: Map<string, Store>}} deps
 * @param {{fallbackTurn?: number|null}} [options] fallbackTurn：会话日志还原的当前轮（退化来源）
 */
export function compassFromExec(exec, deps, options = {}) {
  const { sessionId, cwd } = hostSessionInfo(exec);
  if (!cwd) {
    const err = new Error(`${CODES.INVALID_ARG}: 无法从宿主上下文取得工作区目录（exec.agent.session.header.cwd）`);
    err.code = CODES.INVALID_ARG;
    throw err;
  }
  const session = exec?.agent?.session;
  const messages = typeof session?.deriveMessages === "function" ? session.deriveMessages() : null;
  const { turn } = resolveTurn({ sessionId, tracker: deps.turns, logTurn: options?.fallbackTurn ?? null, messages });
  const store = storeFor(deps.stores, cwd);
  const compass = createCompass({
    store,
    sessionId,
    turn,
    captureOriginal: (refs) => {
      // 首选：session/event 里 source.kind === "user" 的真实用户消息（权威，不含机器注入）
      const isCurrent = refs === undefined || refs === null || refs === "current";
      const tracked = deps.turns.lastUser(sessionId);
      if (isCurrent && tracked) {
        return { text: tracked.text, session: sessionId ?? "unknown-session", at: tracked.at };
      }
      // 退化：deriveMessages 启发式（排除 runtime-context / 技能清单 / 指令基线）
      return readOriginal(refs, { exec });
    },
    // v1.24 / B-53：AI 传入的当前会话原话在插件侧逐字校验（只读当前会话，不扫描历史）
    verifyOriginal: (text) => {
      const matched = verifyOriginalText(text, { exec });
      if (!matched.ok) return matched;
      return { ...matched, session: sessionId ?? "unknown-session" };
    },
    history: createHistoryReader({ sessionsRoot: sessionsRootOf(dshHome()), workspacePath: cwd }),
    pluginVersion: PKG_VERSION
  });
  return { compass, store, sessionId, cwd, turn };
}

/**
 * 七个工具的模型可见定义（供 apply 注册，也供单测直接调用）。
 * @param {{turns: TurnTracker, stores: Map<string, Store>, rulesPath?: string, sessionsRoot?: string, fallbackTurns?: Map<string, {turn: number|null, at: number}>}} deps
 */
export function createToolDefinitions(deps) {
  const rulesPath = deps.rulesPath ?? rulesFilePath();

  /**
   * @param {(ctx: ReturnType<typeof compassFromExec>, args: any) => Promise<any>} body
   */
  const wrap = (body) => async (args, exec) => {
    try {
      const info = hostSessionInfo(exec);
      const fallbackTurn = await resolveFallbackTurn(deps, info);
      const ctx = compassFromExec(exec, deps, { fallbackTurn });
      return { text: JSON.stringify(await body(ctx, args ?? {}), null, 2) };
    } catch (err) {
      throw toToolError(err);
    }
  };

  /** @type {Record<string, any>} */
  const tools = {
    compass_init: {
      description:
        "初始化当前工作区的任务板（幂等）：建数据目录、空任务树、需求基线，并安装 DSH 全局规则区块。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspace_name: { type: "string", description: "覆盖数据目录展示名（缺省取工作区目录名）" }
        }
      },
      execute: wrap(async ({ compass }) => {
        const result = await compass.init();
        let ruleBlock = "unchanged";
        try {
          const installed = await installRuleBlock(rulesPath);
          ruleBlock = installed.status;
        } catch (err) {
          ruleBlock = "failed";
          result.rule_block_error = err instanceof Error ? err.message : String(err);
        }
        return { ...result, rule_block: ruleBlock };
      })
    },

    compass_require: {
      description:
        "新建一条需求（需求层节点）并写基线 v1。当前会话原话传 original_text（插件逐字校验）；跨会话才用 original_refs 由插件取回。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "human_line", "surface"],
        properties: {
          title: { type: "string", description: "需求规范名" },
          human_line: { type: "string", description: "一句话人话（给用户看）" },
          surface: { type: "string", description: "基线「明面」：AI 精简后的一句话" },
          original_text: {
            type: "string",
            description: "当前会话中用户刚说过的原话（逐字照抄）；插件与当前会话用户消息逐字比对，不一致拒绝"
          },
          original_refs: { type: "string", description: "跨会话原话来源：\"current\"（缺省，当前会话最后一条用户消息）" },
          pointer_note: { type: "string", description: "建需求的一句话（默认「建需求」）" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.require(args))
    },

    compass_plan: {
      description:
        "建任务节点（挂在需求或任务下）。parent_id 必填；建需求请用 compass_require。返回新节点 id。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["parent_id", "title", "human_line"],
        properties: {
          parent_id: { type: "string", description: "父节点 id：R-<n> 或任务 id" },
          title: { type: "string" },
          human_line: { type: "string" },
          detail: { type: "string", description: "AI 栏初始内容（可选，整段写入详情文件）" },
          after: { type: "string", description: "插到同父兄弟节点之后（与 before 互斥）" },
          before: { type: "string", description: "插到同父兄弟节点之前（与 after 互斥）" },
          pointer_note: { type: "string" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.plan(args))
    },

    compass_update: {
      description:
        "以 patch 语义更新任务/需求：改执行态、裁决态、废弃原因或详情；状态变更必须带 pointer_note（追溯链）。task_ids 可批量。" +
        "批量标记「已执行」时必须为每个任务提供完成说明：批量用 details（id→说明），单节点用 detail；也可继承已满足内容标准的旧详情。" +
        "完成说明标准：修改/构建型含「核心文件/契约/避坑指南」，查询/调研型含「查询结论/数据来源/后续建议」。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["task_ids"],
        properties: {
          task_ids: { type: "array", items: { type: "string" } },
          exec_state: { type: "string", enum: ["未开始", "进行中", "已执行"] },
          verdict_state: {
            type: "string",
            enum: ["待裁决", "已废弃", "已替代", "已确认继续"],
            description: "「已确认继续」是瞬时值，落板回 null"
          },
          dead_reason: { type: "string", description: "落已废弃/已替代时必填，引用用户裁决原话要点" },
          detail: { type: "string", description: "整段覆盖详情（仅允许单节点）；标记已执行时作为完成说明校验内容标准" },
          details: {
            type: "object",
            additionalProperties: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["text"],
                  properties: {
                    kind: { type: "string", enum: ["build", "research"] },
                    text: { type: "string" }
                  }
                }
              ]
            },
            description:
              "批量/单节点详情映射，两类用途：①标记完成的任务 → 完成说明（build：核心文件/契约/避坑指南；research：查询结论/数据来源/后续建议）；②本次更新节点的**祖先链**（父任务、父级的父级、需求）→ 完成汇总（验收范围/完成结论/遗留风险，各起一行）。写任何详情时整条祖先链必须一起更新，缺则 E_ANCESTOR_DETAIL_REQUIRED"
          },
          pointer_note: { type: "string", description: "状态/裁决变更必填" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.update(args))
    },

    compass_read: {
      description:
        "读取任务板：scope=tree（整棵树）/ tree-lite（省上下文的扁平节点）/ detail:<id>（详情+备注）/ baseline（需求基线）。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["scope"],
        properties: {
          scope: { type: "string", description: "tree / tree-lite / detail:<id> / baseline" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.read({ scope: args.scope }))
    },

    compass_change: {
      description:
        "需求变更：向基线追加一个版本。当前会话原话传 original_text（插件逐字校验）；跨会话才用 original_refs。返回 {appended: vN}。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["requirement_id", "new_text", "reason"],
        properties: {
          requirement_id: { type: "string", description: "形如 R-001" },
          new_text: { type: "string", description: "新的明面（一句人话）" },
          reason: { type: "string", description: "为什么改（一句话）" },
          original_text: {
            type: "string",
            description: "当前会话中用户刚说过的原话（逐字照抄）；插件逐字校验，不一致拒绝"
          },
          original_refs: { type: "string", description: "跨会话原话来源：\"current\"（缺省）" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.change(args))
    },

    compass_merge: {
      description: "标记合并关系：只写 merged_into + 追溯链，不挪子节点、不删数据。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["source_id", "target_id", "pointer_note"],
        properties: {
          source_id: { type: "string" },
          target_id: { type: "string" },
          pointer_note: { type: "string", description: "合并原因（一句话）" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.merge(args))
    },

    compass_import: {
      description:
        "历史回填（B-29）：mode=preview 只读列出当前工作区历史会话的逐字用户消息（超长会截断，含 chars/truncated）；mode=apply 按 items 回填需求/任务，refs 必须来自 preview，原话由插件从历史日志读取（AI 不传正文）。重复 apply 按 (parent,title) 幂等去重。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["mode"],
        properties: {
          mode: { type: "string", enum: ["preview", "apply"] },
          limit: { type: "integer", description: "preview 返回的消息条数上限（1-500，默认 200）" },
          items: {
            type: "array",
            description:
              "apply 用：{type: requirement|task, parent_id?, title, human_line, surface?, exec_state?, verdict_state?, dead_reason?, detail?, refs:[{session,index}], note?, after?, before?}（after/before 仅 task 允许）",
            items: { type: "object", additionalProperties: true }
          }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.import(args))
    },

    compass_move: {
      description:
        "移动已有节点到新父节点（B-34）：ID 不变、追溯链追加；可用 after/before 定位。禁止移动需求、禁止移进自己的子树。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["source_id", "parent_id"],
        properties: {
          source_id: { type: "string", description: "要移动的节点 id（任务/步骤）" },
          parent_id: { type: "string", description: "新父节点 id（需求或任务）" },
          after: { type: "string", description: "新父节点下插到该兄弟之后（与 before 互斥）" },
          before: { type: "string", description: "新父节点下插到该兄弟之前（与 after 互斥）" },
          pointer_note: { type: "string", description: "移动原因（一句话）" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.move(args))
    },

    compass_status: {
      description:
        "只读自查（B-32）：返回板面最后写入时间、本会话在那之后开始的轮次数与观察到的工具调用数（纯机械计数）。turns_since_board_update>0 说明板面可能落后，按规则落板/补录。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {}
      },
      execute: wrap(async ({ store, sessionId }) => computeBoardStatus({ store, turns: deps.turns, sessionId }))
    },

    compass_migrate: {
      description:
        "旧 status.md 迁移（V3/B-44）：mode=preview 只读解析候选条目（行号段/关键词机械提示/标题路径）；mode=apply 按 items（AI 填 human_line/归属/ref）建树+详情+基线 v1——原话由插件按行段从文件逐字取出（AI 不传正文），成功后源文件归档改名 status-archive-<date>.md。apply 建议传 preview 返回的 file_mtime，文件变了会要求重新 preview。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "path"],
        properties: {
          mode: { type: "string", enum: ["preview", "apply"] },
          path: { type: "string", description: "旧 status.md 的绝对路径" },
          file_mtime: { type: "string", description: "preview 返回的 file_mtime（apply 时校验源文件未变）" },
          items: {
            type: "array",
            description:
              "apply 用：{type: requirement|task, parent_id?, title, human_line, surface?, exec_state?, verdict_state?, dead_reason?, detail?, ref: \"Lx-Ly\", note?, after?, before?}；ref 必须来自 preview",
            items: { type: "object", additionalProperties: true }
          },
          archive: { type: "boolean", description: "成功后归档源文件（默认 true）" }
        }
      },
      execute: wrap(async ({ compass }, args) => compass.migrate(args))
    }
  };

  // 统一输出形态：所有工具返回 { text: <JSON 字符串> }，由 render 转成文本内容
  for (const definition of Object.values(tools)) {
    definition.output = {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: "text", text: typeof value?.text === "string" ? value.text : "" }];
      }
    };
  }

  return tools;
}

/**
 * 注册工具并订阅会话事件。
 * @param {any} ctx dsh/cordis 插件上下文
 */
export function apply(ctx) {
  const deps = {
    turns: new TurnTracker(),
    stores: new Map(),
    rulesPath: rulesFilePath(),
    // v1.30 / B-61：会话日志根（轮次退化还原 + 追溯跳转核验共用）
    sessionsRoot: sessionsRootOf(dshHome()),
    fallbackTurns: new Map()
  };

  // 轮次来源 1：会话事件流（权威）；与 dsh-session-persistence-jsonl 同款订阅
  ctx.on("session/event", (session, event) => deps.turns.record(session, event));
  if (typeof ctx.on === "function") {
    ctx.on("session/disposed", (session) => deps.turns.forget(session));
  }

  const tools = createToolDefinitions(deps);
  for (const [toolName, definition] of Object.entries(tools)) {
    ctx.tools.register({ name: toolName, ...definition });
  }

  // UI 数据路由：只读 tree/details、只写 note/ui-state/prefs（C-4 白名单）。
  // webServer / sessions 服务缺失时优雅跳过（headless 可能没有 webServer）。
  let sessionsService = null;
  ctx.inject?.(["sessions"], (sub) => {
    sessionsService = sub.sessions ?? null;
  });
  ctx.inject?.(["webServer"], (sub) => {
    if (typeof sub.webServer?.register === "function") {
      registerCompassRoutes(sub.webServer, {
        storageRoot: storageRoot(),
        pluginVersion: PKG_VERSION,
        rulesPath: rulesFilePath(),
        sessionsRoot: deps.sessionsRoot,
        turns: deps.turns,
        getSessionCwd: (sessionId) => sessionsService?.get?.(sessionId)?.header?.cwd ?? null
      });
    }
  });
}
