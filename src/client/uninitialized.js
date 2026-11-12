/**
 * 旧会话「暂无数据」空态（B-63 / v1.32）：判定输入 → 文案 + 动作描述 + 固定回填指令。
 *
 * 设计立场：插件不做语义判断。是否回填、回填什么由用户与 AI 决定；
 * 这里只负责「把状态说清楚 + 给出可点动作 + 提供一条不给 AI 留代笔口子的指令」。
 * 纯函数，便于单测（UI 只渲染 describeUninitialized 的结果）。
 *
 * 契约：docs/schema-v2.md §8.8 / §8.21。
 */

/** 回填指令（固定文本常量）：先初始化，再 preview → apply，原话只许 refs 引用。 */
export const BACKFILL_PROMPT = [
  "请对本工作区执行历史会话回填（B-29）：",
  "1) 先 compass_status 看板面；未初始化则先 compass_init；",
  '2) 用 compass_import(mode="preview") 读取本工作区全部历史会话用户消息；',
  '3) 按规则用 compass_import(mode="apply") 回填需求/任务：原话只允许用 refs 引用 preview 结果（禁止代写），状态按历史语义落位，挂载与顺序按历史时间；',
  "4) 完成后 compass_status 复核，并告诉我回填了什么、哪些没回填及原因。"
].join("\n");

/** 初始化空板指令（无历史会话时用）。 */
export const INIT_PROMPT =
  "请调用 compass_init 初始化当前工作区的任务板（空板即可），完成后告诉我初始化结果。";

/**
 * 历史会话摘要的展示口径：`latest_at` 是会话日志 mtime（ISO），非法/缺失返回空串。
 * @param {string|null|undefined} latestAt
 * @returns {string}
 */
export function formatLatestAt(latestAt) {
  const text = typeof latestAt === "string" ? latestAt.trim() : "";
  if (!text) return "";
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * @typedef {{id: string, label: string, primary?: boolean, disabled?: boolean}} UninitializedAction
 * @typedef {{sessions: number, latest_at?: string|null, truncated?: boolean, available?: boolean}} HistorySummary
 * @typedef {{status: "idle"|"sending"|"sent"|"fallback", reason?: string|null, copied?: boolean}} BackfillState
 */

/**
 * 暂无数据空态的完整描述（标题/正文/提示/动作）。
 * @param {{history?: HistorySummary|null, dismissed?: boolean, backfill?: BackfillState}} input
 * @returns {{title: string, message: string, hint: string|null, actions: UninitializedAction[]}}
 */
export function describeUninitialized(input = {}) {
  const history = input.history ?? null;
  const dismissed = input.dismissed === true;
  const backfill = input.backfill ?? { status: "idle" };
  const status = backfill.status ?? "idle";

  const count = Number.isFinite(history?.sessions) ? Math.max(0, Number(history.sessions)) : null;
  const hasHistory = count !== null && count > 0;
  const latest = formatLatestAt(history?.latest_at);
  const when = latest ? `（最近 ${latest}）` : "";

  const backfillActions = (buttonLabel = "回填历史会话") => [
    { id: "backfill", label: buttonLabel, primary: true },
    { id: "dismiss", label: "暂不回填" }
  ];
  const initActions = () => [
    { id: "init", label: "让 AI 初始化任务板", primary: true },
    { id: "copy-init", label: "复制提示" }
  ];

  // 1) 正在发送回填指令
  if (status === "sending") {
    return {
      title: "任务板暂无数据",
      message: "正在把回填指令发进当前会话…",
      hint: "发送完成后 AI 会自动开始回填；期间任务板保持暂无数据是正常的。",
      actions: [
        { id: "backfill", label: "发送中…", primary: true, disabled: true },
        { id: "dismiss", label: "暂不回填", disabled: true }
      ]
    };
  }

  // 2) 已发送：等 AI 回填 + 轮询自愈
  if (status === "sent") {
    return {
      title: "任务板暂无数据",
      message: "已发送回填指令，AI 处理完成后本面板会自动刷新。",
      hint: "回填期间可以继续本会话对话；若长时间没有变化，可点状态条「手动刷新」，或让 AI 重新执行回填。",
      actions: [
        { id: "refresh", label: "刷新", primary: true },
        { id: "copy", label: "复制回填指令" }
      ]
    };
  }

  // 3) 自动发送不可用：复制降级（必须可见，不得假装已发送）
  if (status === "fallback") {
    const reason = typeof backfill.reason === "string" && backfill.reason.trim() ? backfill.reason.trim() : "自动发送不可用";
    const copyText = backfill.copied === true
      ? "回填指令已复制到剪贴板，请粘贴到输入框发送。"
      : "自动复制失败，请手动复制回填指令后在输入框发送。";
    return {
      title: "任务板暂无数据",
      message: hasHistory
        ? `任务板暂无数据。检测到本工作区 ${count} 个历史会话${when}；回填与否由你决定。`
        : "任务板暂无数据。本工作区还没有可回填的历史会话。",
      hint: `${reason}：${copyText}`,
      actions: [
        { id: "copy", label: "复制回填指令", primary: true },
        { id: "dismiss", label: "暂不回填" }
      ]
    };
  }

  // 4) 用户已选择暂不回填
  if (dismissed) {
    return {
      title: "任务板暂无数据",
      message: "已跳过回填。需要时再点「回填历史会话」。",
      hint: "任务板仍是空的；AI 在本工作区第一次使用任务板时会自动初始化。",
      actions: [
        { id: "backfill", label: "回填历史会话" },
        { id: "refresh", label: "刷新" }
      ]
    };
  }

  // 5) 有历史会话：用户决定是否回填
  if (hasHistory) {
    return {
      title: "任务板暂无数据",
      message: `任务板暂无数据。检测到本工作区 ${count} 个历史会话${when}。可以把历史会话回填成需求/任务；回填与否由你决定。`,
      hint: history?.truncated === true
        ? "历史会话数量超过统计上限（2000），这里只反映前 2000 个；回填仍以 AI 实际预览结果为准。"
        : "回填时 AI 会先初始化任务板，再用 compass_import 读取历史会话；原话由插件逐字取回，AI 不代写。",
      actions: backfillActions()
    };
  }

  // 6) 无历史会话：只提供初始化入口
  if (count === 0) {
    return {
      title: "任务板尚未初始化",
      message: "任务板尚未初始化。本工作区还没有任务板数据，也没有可回填的历史会话。",
      hint: "让 AI 初始化任务板后即可开始记录需求与任务。",
      actions: initActions()
    };
  }

  // 7) 历史摘要不可用（旧宿主缺路由 / 网络失败）：不阻塞，给两条路
  return {
    title: "任务板暂无数据",
    message: "任务板暂无数据。",
    hint: "无法读取历史会话摘要（宿主可能较旧）。可以直接回填历史会话，或先让 AI 初始化空板。",
    actions: [...backfillActions(), { id: "init", label: "让 AI 初始化任务板" }]
  };
}
