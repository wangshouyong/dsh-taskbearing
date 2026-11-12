/**
 * 面板样式安装（B-63 补 / v1.32）：**样式必须显式声明归属**。
 *
 * 背景（DSH 0.2.0-rc.2 client-modules 的真实行为）：
 *   `materialize()` 在模块 factory 返回后调用 `claimStyles(ownerId)`，把当时所有
 *   `style:not([data-plugin])`（无主 <style>）认领给「当前正在物化的插件」；该插件
 *   重载/卸载时 `removeOwnedStyles(ownerId)` 会删掉这些 style。
 *   本插件的 <style> 是在 apply() 里注入的（晚于本模块物化），天生「无主」⇒ 可能被
 *   后物化的其它插件（如 cdp 浏览器插件）认领，那个插件一重载就把它连带删除，
 *   表现为「任务板样式整块消失、布局裸奔」。
 *
 * 修法：创建时立即打上 `data-plugin="dsh-taskbearing"`（+ data-plugin-css），
 *   让 claimStyles 的 `:not([data-plugin])` 跳过它；同时把历史上已存在但无归属的
 *   本插件 style 补上归属。所有函数都是幂等的，可在面板每次轮询时自愈。
 *
 * 纯函数（接收 document），便于用假 DOM 单测。
 */

export const STYLE_ID = "dsh-taskbearing-css";
/** 插件模块 id（与 entry.js 里 __ModuleLoader__.load({ id }) 保持一致）。 */
export const PLUGIN_ID = "dsh-taskbearing";
/** 本插件自用的样式标记（辅助识别，防止误认领别人的 <style>）。 */
export const STYLE_ATTR = "data-dsh-compass-style";

/**
 * 确保样式已安装且带归属标记；已存在则更新内容并补归属，不重复插入。
 * @param {Document|any} doc
 * @param {string} css
 * @returns {boolean} 是否已就绪
 */
export function ensureStyles(doc, css) {
  if (!doc || typeof doc.createElement !== "function") return false;
  const text = typeof css === "string" ? css : "";
  if (!text) return false;

  /** @type {Array<any>} */
  const ours = [];
  try {
    const all = typeof doc.querySelectorAll === "function" ? doc.querySelectorAll("style") : [];
    for (const el of all) {
      if (!el) continue;
      const id = typeof el.id === "string" ? el.id : "";
      const marked = typeof el.getAttribute === "function" ? el.getAttribute(STYLE_ATTR) : null;
      if (id === STYLE_ID || marked === "1") ours.push(el);
    }
  } catch {
    // querySelectorAll 异常时退化为「没找到」，下面会新建
  }

  if (ours.length === 0) {
    const el = doc.createElement("style");
    el.id = STYLE_ID;
    el.setAttribute?.(STYLE_ATTR, "1");
    // 关键：显式归属，阻止 client-modules 的 claimStyles 认领本 style
    el.setAttribute?.("data-plugin", PLUGIN_ID);
    el.setAttribute?.("data-plugin-css", PLUGIN_ID);
    el.textContent = text;
    (doc.head ?? doc.documentElement)?.appendChild?.(el);
    return Boolean(el.isConnected === undefined || el.isConnected || doc.head || doc.documentElement);
  }

  for (const el of ours) {
    // 旧版本注入的 style 可能没有归属（会被别的插件认领删除）→ 补上
    el.setAttribute?.(STYLE_ATTR, "1");
    el.setAttribute?.("data-plugin", PLUGIN_ID);
    el.setAttribute?.("data-plugin-css", PLUGIN_ID);
    if (el.textContent !== text) el.textContent = text;
  }
  return true;
}

/**
 * 安装样式并返回 disposer。语义：样式是页面级共享资源，dispose 时**不删除**
 * （删除会让「旧实例 cleanup 晚于新实例 apply」时整块样式消失）；页面刷新/插件
 * 卸载由宿主或下一次 ensureStyles 接管；client-modules 若按 data-plugin 清理也安全。
 * @param {Document|any} doc
 * @param {string} css
 * @returns {() => void}
 */
export function installStyles(doc, css) {
  ensureStyles(doc, css);
  return () => {};
}
