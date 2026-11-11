/**
 * 数据路由封装（client → host）。只做传输与错误统一，不做语义判断。
 * 路由见 src/host/routes.js（只读 tree/details、只写 note/ui-state/prefs）。
 */

export class ApiError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, info);
  }
}

/**
 * 旧宿主降级（B-55，v1.24）：宿主进程未升级时新接口会返回未知路由（E_NOT_FOUND / HTTP 404）。
 * 转成用户可读的提示，避免裸错误码与「无限加载」。
 * @param {{code?: string, message?: string}} error
 * @param {number} status
 */
export function describeApiError(error, status) {
  const code = error?.code ?? "";
  if (code === "E_NOT_FOUND" || status === 404) {
    return {
      code: "E_HOST_OUTDATED",
      message: "当前 DSH 是旧版宿主，缺少该接口；重启 DSH 后即可使用。",
      details: error?.details
    };
  }
  return {
    code: code || `HTTP_${status}`,
    message: code ? `${code}: ${error?.message ?? `HTTP ${status}`}` : `HTTP ${status}`,
    details: error?.details
  };
}

/** @param {string} url @param {RequestInit} [init] */
async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const described = describeApiError(data?.error ?? {}, response.status);
    throw new ApiError(described.message, { code: described.code, details: described.details });
  }
  return data;
}

/** @param {string} cwd */
function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}

export const CompassApi = {
  current: (params) => fetchJson(`/api/compass/current${qs(params ?? {})}`),
  baseline: (cwd, id) => fetchJson(`/api/compass/baseline${qs({ cwd, id })}`),
  status: (cwd, sessionId) => fetchJson(`/api/compass/status${qs({ cwd, sessionId })}`),
  /** 会话日志存在性核验（v1.30 / B-61）：覆盖客户端快照的「会话不可用」假阴性。 */
  sessionLinks: (cwd, ids) => fetchJson(`/api/compass/session-links${qs({ cwd, ids: Array.isArray(ids) ? ids.join(",") : "" })}`),
  /** 追溯跳转前核验/还原真实轮次（v1.30 / B-61）：日志不可读或轮次不存在时明确返回。 */
  sessionTurn: (cwd, params) =>
    fetchJson(
      `/api/compass/session-turn${qs({ cwd, session: params?.session, turn: params?.turn, at: params?.at })}`
    ),
  tree: (cwd, ifmtime) => fetchJson(`/api/compass/tree${qs({ cwd, ifmtime })}`),
  detail: (cwd, id) => fetchJson(`/api/compass/detail${qs({ cwd, id })}`),
  saveNote: (cwd, id, content, sessionId) =>
    fetchJson("/api/compass/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, id, content, sessionId })
    }),
  /** 文件锚点存在性检测（v1.25 / B-56）：只读批量 stat。 */
  fileExists: (cwd, paths) =>
    fetchJson("/api/compass/file-exists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, paths })
    }),
  getUiState: (cwd) => fetchJson(`/api/compass/ui-state${qs({ cwd })}`),
  putUiState: (cwd, state) =>
    fetchJson("/api/compass/ui-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, ...state })
    }),
  getPrefs: () => fetchJson("/api/compass/prefs"),
  workspaces: (cwd) => fetchJson(`/api/compass/workspaces${qs({ cwd })}`),
  removeWorkspace: (workspaceId) =>
    fetchJson("/api/compass/workspaces/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, confirm: "DELETE" })
    }),
  removeRules: () =>
    fetchJson("/api/compass/rules/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    }),
  uninstall: () =>
    fetchJson("/api/compass/uninstall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "UNINSTALL" })
    }),
  putPrefs: (prefs) =>
    fetchJson("/api/compass/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prefs)
    }),
  /** 导出任务板（A15/B-41）：返回原始 JSON 文本与下载文件名（文件名取 content-disposition）。 */
  exportBoard: async (cwd) => {
    const response = await fetch(`/api/compass/export${qs({ cwd })}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = data?.error ?? {};
      throw new ApiError(
        error.code ? `${error.code}: ${error.message ?? `HTTP ${response.status}`}` : `HTTP ${response.status}`,
        { code: error.code ?? `HTTP_${response.status}`, details: error.details }
      );
    }
    const text = await response.text();
    const disposition = response.headers.get("content-disposition") ?? "";
    const matched = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    let filename = "taskboard.json";
    if (matched) {
      try {
        filename = decodeURIComponent(matched[1]);
      } catch {
        filename = "taskboard.json";
      }
    }
    return { json: text, filename };
  },
  /** 导入任务板（A15/B-41）：目标板必须为空，强确认 IMPORT。 */
  importBoard: (cwd, bundle) =>
    fetchJson("/api/compass/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, bundle, confirm: "IMPORT" })
    })
};
