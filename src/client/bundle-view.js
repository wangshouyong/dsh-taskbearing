/**
 * 导出包摘要（client 侧纯函数）：导入确认面板展示「从哪来、带什么」。
 * 契约：v1.19 §8.12 / §12.5。不依赖 DOM 与文件系统，可直接单测。
 */

/**
 * @param {any} bundle
 * @returns {{
 *   format: string|null,
 *   schema: number|null,
 *   exported_at: string|null,
 *   plugin_version: string|null,
 *   workspace_name: string|null,
 *   original_path: string|null,
 *   nodes: number,
 *   requirements: number,
 *   details: number
 * }}
 */
export function summarizeBundle(bundle) {
  const workspace = bundle?.workspace ?? {};
  let nodes = 0;
  let requirements = 0;
  const walk = (node) => {
    for (const child of node?.children ?? []) {
      nodes += 1;
      if (child.kind === "requirement") requirements += 1;
      walk(child);
    }
  };
  walk(bundle?.tree?.root);
  return {
    format: typeof bundle?.format === "string" ? bundle.format : null,
    schema: Number.isInteger(bundle?.schema) ? bundle.schema : null,
    exported_at: typeof bundle?.exported_at === "string" ? bundle.exported_at : null,
    plugin_version: typeof bundle?.plugin_version === "string" ? bundle.plugin_version : null,
    workspace_name: typeof workspace.name === "string" ? workspace.name : null,
    original_path: typeof workspace.original_path === "string" ? workspace.original_path : null,
    nodes,
    requirements,
    details: Object.keys(bundle?.details ?? {}).length
  };
}

/**
 * 导入确认文案（含风险提示，不静默）。
 * @param {ReturnType<typeof summarizeBundle>} summary
 */
export function describeBundle(summary) {
  const parts = [
    `来源工作区：${summary.workspace_name ?? "(未命名)"}`,
    `原始路径：${summary.original_path ?? "(未知)"}`,
    `导出时间：${summary.exported_at ?? "(未知)"}`,
    `插件版本：${summary.plugin_version ?? "(未知)"}`,
    `内容：${summary.requirements} 需求 · ${summary.nodes} 节点 · ${summary.details} 个详情/备注`
  ];
  return parts.join("\n");
}
