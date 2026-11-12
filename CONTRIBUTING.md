# 贡献指南

感谢参与。本仓库是 DSH 插件 **dsh-taskbearing** 的实现仓库，设计契约是唯一权威。

## 文档双语规则

- `docs/philosophy.md`、`docs/schema-v2.md` 的中文版是**唯一权威**，英文镜像 `docs/<name>.en.md` 必须同步；
- 契约变更顺序：先改中文权威版 → 再同步英文镜像 → 跑 `node scripts/check-docs-en.mjs`（CI 会跑同一检查）；
- `docs/ui-design.md` 是历史设计稿，仅中文，行为以 philosophy/schema-v2 为准。

## 开发环境

- Node.js ≥ 20
- 构建 client facet 需要 `vite`（`npm install` 会自动装 devDependency）
- 运行/联调需要 DSH（DeepSeek Harness）宿主

```bash
npm install
node --test          # 单元测试（纯逻辑，不依赖宿主）
npm run build:client # 构建 lib/client.js
```

## 设计优先（硬约束）

- **先改契约，再改代码**：`docs/philosophy.md`（业务规则/状态机）与 `docs/schema-v2.md`（数据结构/API）是设计契约。接口、数据结构、状态语义、UI 行为、验收标准变更时，先升版本并在变更记录 记录，再改实现。实现与文档不一致视为缺陷。
- **判断权归 AI**：插件不判断「做完没有 / 覆盖没有 / 冲突没有」，只做格式、完整性与事实性校验。
- **不静默降级**：降级路径必须在 UI 或日志可见。
- **原话保真**：用户原话逐字落盘；当前会话可由 AI 传入 `original_text`，但插件会与当前会话用户消息逐字比对，不一致直接拒绝。
- **detail 路径必须真实**：`compass_plan` / `compass_update` 写详情前用 `fs.existsSync()` 校验其中所有文件路径；不存在即拒绝（`E_DETAIL_PATH_NOT_FOUND`）。新增写 detail 的入口时必须接入同一校验（`src/core/detail-path-guard.js`）。
- **两写者分离**：`<id>.md`（AI 栏）只由工具写；`<id>.note.md`（用户备注）只由 UI 写。
- **原子写 + 串行**：所有写经 `Store.run` 队列与临时文件 rename，不直接截断目标文件。

## 代码结构

| 目录 | 说明 |
|---|---|
| `src/core/` | 宿主无关核心（存储/校验/状态机/基线/路径识别与校验），禁止 import 宿主 API |
| `src/host/` | DSH 宿主接入（`apply(ctx)`、工具注册、路由、规则区块、会话/轮次） |
| `src/client/` | 右侧栏面板（React + 原生 CSS，构建为 `lib/client.js`） |
| `test/` | `node --test` 单测，纯函数优先 |
| `docs/` | 契约与 UI 设计（随包发布） |

## 提交前检查

1. `node --test` 全绿；
2. 改了 `src/client/` 或 `src/core/file-paths.js` → 跑 `npm run build:client` 并提交 `lib/` 产物；
3. 改了契约 → 同步 `docs/philosophy.md` / `docs/schema-v2.md` 并升文档版本；
4. 不提交本地路径、会话 id、密钥、截图等个人/环境信息；
5. 一个提交只做一件事，提交信息写清楚"为什么"。

## 报告问题

请在 Issue 中给出：DSH 版本、Node 版本、复现步骤、期望行为与实际行为；涉及工具报错请附完整错误码与 `message`。不要贴包含个人路径或密钥的日志。
