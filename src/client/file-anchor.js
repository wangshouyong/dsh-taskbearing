/**
 * 详情文件锚点（B-47 / A31 / B-56）：UI 侧薄封装。
 * 识别与地址构造的实现已下沉到 `src/core/file-paths.js`（与工具层写 detail 的强校验共用同一套规则）。
 */

export {
  FILE_EXTENSIONS,
  isAbsoluteWorkspacePath,
  sessionFileAddress,
  fileAddressFor,
  extractFileAnchors
} from "../core/file-paths.js";
