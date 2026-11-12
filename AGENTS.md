# 项目约定（AGENTS.md）

> 给在本仓库工作的 AI 与人类协作者。用户级全局规则见 `$DSH_HOME/AGENTS.md`。

## 这个仓库是什么

DSH 插件 **dsh-taskbearing**（工具前缀 `compass_*`）的实现仓库：工作区级任务记忆与方向恢复。
设计文档是唯一权威：`docs/philosophy.md`（产品行为/状态机）与 `docs/schema-v2.md`（数据结构/API）。**实现与契约不一致时：先改契约（升版本，记入变更记录），再改代码。**

## 结构

- `src/core/`：宿主无关核心层（存储 / 校验 / 状态机 / 基线 / 路径识别与校验），禁止 import 任何 `@deepseek-ai/*` 或宿主 API。
- `src/host/`：DSH 宿主接入（`apply(ctx)`、工具注册、路由、AGENTS.md 规则区块）。只允许这里碰宿主 API。
- `src/client/`：右侧栏 tab（React + 原生 CSS），构建为 `lib/client.js`。
- `test/`：`node --test` 单元测试，纯函数优先，不依赖真实宿主。
- `docs/`：`philosophy.md`（设计哲学/业务规则）、`schema-v2.md`（数据与接口）、`ui-design.md`（UI 实现细则）。

## 命令

```bash
node --test          # 全部单元测试
npm run build:client # 构建 client facet（需 vite；VITE_BIN 可覆盖）
```

## 硬约束

1. **判断权归 AI**：插件不判断「做完没有/覆盖没有/冲突没有」，只做格式、完整性与事实性校验。
2. **原话保真**：用户原话逐字落盘。当前会话可传 `original_text`（插件与当前会话消息逐字比对，不一致 `E_ORIGINAL_MISMATCH`）；跨会话由插件按 refs 取回。历史会话扫描（`compass_import`）只用于新会话溯源或跨会话修复/审计。
3. **detail 路径必须真实**：写 detail 前 `fs.existsSync()` 校验（`E_DETAIL_PATH_NOT_FOUND`）。新增写 detail 入口必须接入 `src/core/detail-path-guard.js`；`import` / `migrate` 除外。
4. **两写者分离**：`<id>.md`（AI 栏）只由工具写；`<id>.note.md`（用户备注）只由 UI 写。
5. **写操作串行 + 原子写**：所有写经 `Store.run` 队列 + 临时文件 rename；禁止直接截断目标文件。
6. **数据留 `$DSH_HOME`**：不得把任务板数据写进工作区目录。
7. **不静默降级**：降级路径必须可见（UI 文案或日志），并登记到契约的待定/风险项。
8. **文档双语镜像**：`docs/philosophy.md` / `docs/schema-v2.md` 的中文版是唯一权威；改动契约先改中文，再同步 `docs/<name>.en.md`，并跑 `node scripts/check-docs-en.mjs`（CI 同款检查）。
9. **中文注释与文案**；错误码用契约 §5.1 的 `E_*` 常量，不新增魔法字符串。
