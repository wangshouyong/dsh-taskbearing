/**
 * 线性 SVG 图标（16px 视图框 24，stroke 1.75，随 currentColor 着色）。
 * 契约：docs/schema-v2.md §8.18（替代 emoji 图标；撞车幽灵标除外）。
 * 全部手绘简单几何，无外部依赖；name 不存在时渲染空占位，不抛错。
 */

import * as React from "react";

const h = React.createElement;

/** 每个图标 = 一组 SVG 子元素（path / circle / rect / line / polyline）。 */
const PATHS = {
  search: [
    ["circle", { cx: 11, cy: 11, r: 7 }],
    ["line", { x1: 16.5, y1: 16.5, x2: 21, y2: 21 }]
  ],
  refresh: [
    ["path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }],
    ["polyline", { points: "21 3 21 9 15 9" }]
  ],
  settings: [
    ["line", { x1: 4, y1: 21, x2: 4, y2: 14 }],
    ["line", { x1: 4, y1: 10, x2: 4, y2: 3 }],
    ["line", { x1: 12, y1: 21, x2: 12, y2: 12 }],
    ["line", { x1: 12, y1: 8, x2: 12, y2: 3 }],
    ["line", { x1: 20, y1: 21, x2: 20, y2: 16 }],
    ["line", { x1: 20, y1: 12, x2: 20, y2: 3 }],
    ["line", { x1: 2, y1: 14, x2: 6, y2: 14 }],
    ["line", { x1: 10, y1: 8, x2: 14, y2: 8 }],
    ["line", { x1: 18, y1: 16, x2: 22, y2: 16 }]
  ],
  history: [
    ["path", { d: "M3 3v5h5" }],
    ["path", { d: "M3.05 13a9 9 0 1 0 .5-5L3 8" }],
    ["polyline", { points: "12 7 12 12 15.5 14" }]
  ],
  close: [
    ["line", { x1: 6, y1: 6, x2: 18, y2: 18 }],
    ["line", { x1: 18, y1: 6, x2: 6, y2: 18 }]
  ],
  chevron: [
    ["polyline", { points: "9 5 16 12 9 19" }]
  ],
  grid: [
    ["rect", { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }],
    ["rect", { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }],
    ["rect", { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }],
    ["rect", { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }]
  ],
  file: [
    ["path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }],
    ["polyline", { points: "14 2 14 8 20 8" }]
  ],
  copy: [
    ["rect", { x: 9, y: 9, width: 12, height: 12, rx: 2 }],
    ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }]
  ],
  check: [
    ["polyline", { points: "4 12.5 9.5 18 20 6.5" }]
  ],
  alert: [
    ["path", { d: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }],
    ["line", { x1: 12, y1: 9, x2: 12, y2: 13 }],
    ["line", { x1: 12, y1: 17, x2: 12.01, y2: 17 }]
  ],
  pin: [
    ["path", { d: "M12 17v5" }],
    ["path", { d: "M9 3h6l1 7 3 3v1H5v-1l3-3z" }]
  ],
  folder: [
    ["path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" }]
  ],
  download: [
    ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ["polyline", { points: "7 10 12 15 17 10" }],
    ["line", { x1: 12, y1: 15, x2: 12, y2: 3 }]
  ],
  upload: [
    ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ["polyline", { points: "7 8 12 3 17 8" }],
    ["line", { x1: 12, y1: 3, x2: 12, y2: 15 }]
  ],
  trash: [
    ["polyline", { points: "3 6 5 6 21 6" }],
    ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]
  ],
  external: [
    ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
    ["polyline", { points: "15 3 21 3 21 9" }],
    ["line", { x1: 10, y1: 14, x2: 21, y2: 3 }]
  ],
  inbox: [
    ["path", { d: "M22 12h-6l-2 3h-4l-2-3H2" }],
    ["path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }]
  ]
};

/**
 * @param {{name: keyof typeof PATHS, size?: number, className?: string, title?: string}} props
 */
export function Icon({ name, size = 16, className = "", title }) {
  const shapes = PATHS[name] ?? [];
  return h(
    "svg",
    {
      className: `icon ${className}`.trim(),
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": title ? undefined : true,
      role: title ? "img" : undefined,
      focusable: "false"
    },
    title ? h("title", null, title) : null,
    shapes.map(([tag, attrs], index) => h(tag, { key: index, ...attrs }))
  );
}

export const ICON_NAMES = Object.keys(PATHS);
