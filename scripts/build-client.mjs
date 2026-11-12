/**
 * 打包 client facet：用 vite 构建 lib/client.inner.cjs，再包装成 DSH 的 __ModuleLoader__ 模块。
 * vite 解析顺序：环境变量 VITE_BIN → 仓库本地 node_modules/vite → 报错并提示安装。
 */
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const candidates = [
  process.env.VITE_BIN,
  path.join(root, "node_modules", "vite", "bin", "vite.js")
].filter(Boolean);
const vite = candidates.find((candidate) => existsSync(candidate));

if (!vite) {
  console.error("找不到 vite。请先运行 `npm install`（或 `npm install -D vite`），或设置 VITE_BIN 指向 vite.js。");
  process.exit(1);
}

const result = spawnSync(process.execPath, [vite, "build", "--config", path.join(root, "vite.dsh-client.js")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" }
});
if (result.status !== 0) process.exit(result.status ?? 1);

const inner = await readFile(path.join(root, "lib", "client.inner.cjs"), "utf8");
const wrapped = `window.__ModuleLoader__.load({
	id: "dsh-taskbearing",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${inner}
		return module.exports;
	}
});
`;
// 原子写：页面/宿主可能正在热加载插件；直接 writeFile 会暴露半截 bundle（CSS/JS 截断）。
// 先写临时文件再 rename，读者始终看到完整旧版或完整新版。
const target = path.join(root, "lib", "client.js");
const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
await writeFile(tmp, wrapped, "utf8");
await rename(tmp, target);
console.log("wrote lib/client.js (wrapped, atomic)");
