/**
 * 主题与面板高度（参照 dsh-im 的做法，不引入宿主内部 API）。
 * 主题：读宿主在 document.documentElement 上的明暗信号，跟随自动切换。
 * 高度：宿主给的容器高度可能是 auto，必须自己量出像素高度，否则内部 overflow 不触发。
 */

import { useEffect, useLayoutEffect, useState } from "react";

/** @returns {"light" | "dark"} */
export function currentPanelTheme(doc = document) {
  const el = doc?.documentElement;
  if (!el) return "light";
  const attr = (el.getAttribute("data-theme") || el.getAttribute("data-color-scheme") || el.getAttribute("data-mode") || "").toLowerCase();
  if (attr.includes("dark")) return "dark";
  const cls = (el.className || "").toLowerCase();
  if (cls.includes("dark")) return "dark";
  return "light";
}

/**
 * 监听宿主主题变化（class / data-* 属性）。
 * @param {(theme: "light" | "dark") => void} apply
 */
export function watchPanelTheme(apply, doc = document) {
  const notify = () => apply(currentPanelTheme(doc));
  notify();
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes") notify();
    }
  });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-color-scheme", "data-mode"] });
  return () => observer.disconnect();
}

/** @returns {"light" | "dark"} */
export function usePanelTheme() {
  const [theme, setTheme] = useState(() => currentPanelTheme());
  useEffect(() => watchPanelTheme(setTheme), []);
  return theme;
}

/**
 * 计算面板像素高度：窗口底部 - 元素顶部，最小 minHeight。
 * @param {number} top 元素顶边（clientY）
 * @param {number} viewportHeight window.innerHeight
 * @param {number} [minHeight]
 */
export function availablePanelHeight(top, viewportHeight, minHeight = 320) {
  const height = viewportHeight - Math.max(0, top);
  if (!Number.isFinite(height) || height <= 0) return 0;
  return Math.max(minHeight, Math.floor(height));
}

/**
 * 给面板根节点持续校准像素高度（含动画期间多次重算）。
 * @param {import("react").RefObject<HTMLElement>} rootRef
 */
export function usePanelHeight(rootRef) {
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      const height = availablePanelHeight(rect.top, window.innerHeight);
      if (height > 0) el.style.height = `${height}px`;
    };
    apply();
    const timers = [50, 120, 250, 500, 900, 1600, 2600].map((ms) => window.setTimeout(apply, ms));
    const onMotion = () => apply();
    document.addEventListener("transitionend", onMotion, true);
    document.addEventListener("animationend", onMotion, true);
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    const observer = new ResizeObserver(apply);
    observer.observe(document.documentElement);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => {
      for (const t of timers) window.clearTimeout(t);
      document.removeEventListener("transitionend", onMotion, true);
      document.removeEventListener("animationend", onMotion, true);
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      observer.disconnect();
    };
  }, [rootRef]);
}
