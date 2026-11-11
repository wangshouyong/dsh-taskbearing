/**
 * 视口级弹窗基件（契约 v1.23 §8.18，B-51）。
 *
 * - createPortal 到 document.body 下的 `.dsh-compass-portal` 宿主节点（带 data-theme，
 *   与面板共用设计令牌），弹窗不再受侧栏宽度/overflow 约束；
 * - variant="center"：居中模态（详情/设置）；variant="drawer"：右侧全高抽屉（时间线）；
 * - Esc 关闭、遮罩 mousedown 关闭（卡片内部不关闭）、Tab/Shift+Tab 焦点圈定；
 * - 打开时焦点落入弹窗，关闭后焦点还给触发元素（若仍在文档中）；
 * - 进入动效在 CSS（.modal-overlay/.modal-card），prefers-reduced-motion 自动禁用。
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { usePanelTheme } from "./theme.js";
import { Icon } from "./icons.js";

const h = React.createElement;
const { useEffect, useMemo, useRef } = React;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

/**
 * @param {{
 *   variant?: "center" | "drawer",
 *   onClose: () => void,
 *   label: string,
 *   className?: string,
 *   children: any
 * }} props
 */
export function PortalDialog({ variant = "center", onClose, label, className = "", children }) {
  const theme = usePanelTheme();
  const host = useMemo(() => {
    const el = document.createElement("div");
    el.className = "dsh-compass-portal";
    return el;
  }, []);
  const cardRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    host.setAttribute("data-theme", theme);
  }, [host, theme]);

  useEffect(() => {
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);

  // 焦点管理：进弹窗 + 关闭后还原
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const previous = document.activeElement;
    const target = card.querySelector("[data-autofocus]") ?? card.querySelector(FOCUSABLE) ?? card;
    try {
      target.focus({ preventScroll: true });
    } catch {
      // 某些宿主元素不可聚焦时退化为卡片聚焦
      card.focus?.({ preventScroll: true });
    }
    return () => {
      if (previous && document.contains(previous) && typeof previous.focus === "function") {
        try {
          previous.focus({ preventScroll: true });
        } catch {
          // 还原焦点失败不影响关闭
        }
      }
    };
  }, []);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      closeRef.current?.();
      return;
    }
    if (event.key !== "Tab") return;
    const card = cardRef.current;
    if (!card) return;
    const items = [...card.querySelectorAll(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0 && el.getAttribute("aria-hidden") !== "true"
    );
    if (items.length === 0) {
      event.preventDefault();
      card.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === card)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || active === card)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  return createPortal(
    h(
      "div",
      {
        className: `modal-overlay ${variant === "drawer" ? "drawer" : "center"}`,
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) closeRef.current?.();
        },
        onKeyDown
      },
      h(
        "div",
        {
          className: `modal-card ${variant === "drawer" ? "drawer-card" : ""} ${className}`.trim(),
          role: "dialog",
          "aria-modal": "true",
          "aria-label": label,
          tabIndex: -1,
          ref: cardRef
        },
        children
      )
    ),
    host
  );
}

/** 通用弹窗头部：标题区 + 关闭按钮（data-autofocus 使打开时焦点先落在关闭上）。 */
export function DialogHead({ title, subtitle, onClose, closeLabel = "关闭", children }) {
  return h(
    "div",
    { className: "modal-head" },
    h(
      "div",
      { className: "modal-head-text" },
      h("div", { className: "modal-title" }, title),
      subtitle ? h("div", { className: "modal-subtitle" }, subtitle) : null,
      children
    ),
    h(
      "button",
      {
        type: "button",
        className: "icon-btn modal-close",
        onClick: onClose,
        "aria-label": closeLabel,
        "data-autofocus": true
      },
      h(Icon, { name: "close" })
    )
  );
}
