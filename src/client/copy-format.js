/**
 * 复制交接格式（契约 §8.6 模板）。
 * 纯函数：给定节点、父链标题、所属需求明面、AI 详情、用户备注 → 交接文本。
 */

/**
 * @param {any} node 任务/需求节点
 * @param {string[]} pathTitles 父链标题（含自身，按从根到当前）
 * @param {{id?: string, surface?: string}|null} [requirement] 所属需求（id + 明面）
 * @param {string} detail AI 栏详情
 * @param {string} note 用户备注
 * @returns {string}
 */
export function formatHandoff(node, pathTitles, requirement, detail, note) {
  const path = pathTitles.join(" › ");
  const verdict = node.verdict_state ?? "无";
  const pointers = (node.pointers ?? [])
    .map((p) => `${p.session} · ${p.at}${p.note ? ` ${p.note}` : ""}`)
    .join("；");
  const reqLine = requirement?.id
    ? `- 所属需求：${requirement.id} 明面——${requirement.surface ?? "（无明面）"}`
    : null;

  const sections = [
    `# 任务交接：${node.id} ${node.title}`,
    `- 任务路径：${path}`,
    `- 执行状态：${node.exec_state}`,
    `- 裁决状态：${verdict}`,
    `- 追溯链：${pointers || "无"}`,
    reqLine,
    "",
    "## 详情（AI 写）",
    detail?.trim() ? detail : "（暂无详情）"
  ];

  if (note?.trim()) {
    sections.push("", "## 用户备注", note);
  }
  return sections.join("\n");
}

/**
 * 由节点 id 推需求 id（R-001 / R-001-T-1 / R-001-T-1-T-1 → R-001）。
 * @param {string} id
 */
export function requirementIdOf(id) {
  const match = /^(R-\d{3,4})/.exec(id ?? "");
  return match ? match[1] : null;
}
