# 最终开发版恢复实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从 2026-05-19 Git 基线与 2026-05-20 至 2026-05-27 Codex 本地会话记录重建丢失的 `game_codex_小程序` 最终开发工作区。

**架构：** 以远程提交 `9a4a419` 为不可变基线，从 JSONL 会话中提取成功的 `apply_patch` 变更和可证实的文件创建/复制操作，按时间与工作区演进顺序重放。每个阶段用 Git 快照和测试结果校验，不改动原项目与 5 月 19 日基线目录。

**技术栈：** Git、Node.js `node:test`、Express、Vue/Vite、JSONL/JQ、unified diff。

---

### 任务 1：建立可审计恢复索引

**文件：**
- 创建：`scripts/recovery/replay-codex-patches.js`
- 创建：`docs/recovery/session-inventory.tsv`
- 创建：`docs/recovery/replay-report.json`

- [ ] **步骤 1：枚举所有相关会话**

读取 `~/.codex` 内引用 `/Users/hh/Desktop/game_codex`、`game_codex_副本` 和 `game_codex_小程序` 的 JSONL，按会话时间去重，并优先使用 5 月 27 日保存的会话备份。

- [ ] **步骤 2：提取成功变更**

只接受 `patch_apply_end.success == true` 且目标在三个项目路径下的变更；保存原始时间、会话 ID、文件路径、变更类型和 diff 哈希。

- [ ] **步骤 3：验证索引**

运行：`node scripts/recovery/replay-codex-patches.js --inventory-only`

预期：报告会话数、唯一补丁数、文件数，且没有越界路径。

### 任务 2：按开发时间线重放源码变更

**文件：**
- 修改：会话中有成功变更记录的项目文件
- 测试：`tests/*.test.js`
- 测试：`back/tests/*.test.js`

- [ ] **步骤 1：重放旧路径后期变更**

先重放 2026-05-20 至目录切换前的 `/Users/hh/Desktop/game_codex` 变更，使基线达到 5 月 22 日的小程序状态。

- [ ] **步骤 2：重放副本和正式晚期目录变更**

再按时间重放 `game_codex_副本` 和 `game_codex_小程序` 的变更，文件路径统一映射到当前恢复分支。

- [ ] **步骤 3：处理无法自动应用的变更**

对 context mismatch 不强行覆盖；用同一会话中的完整文件输出、后续补丁和测试断言交叉恢复，并在 `replay-report.json` 中标记来源。

- [ ] **步骤 4：中间验证**

运行：`npm test`

预期：缺失模块错误清零；若仍有行为断言失败，必须由后续会话补丁或明确历史输出解决。

### 任务 3：恢复非 apply_patch 变更和后端完整性

**文件：**
- 修改：`back/src/**`
- 修改：`back/tests/**`
- 修改：`back/admin-web/src/**`
- 修改：`.gitignore`

- [ ] **步骤 1：对照 5 月 27 日审查记录**

核对当时明确存在的支付验签、价格统一、路由 fail-fast、环境文件忽略与管理端配置字段。

- [ ] **步骤 2：恢复 shell 命令产生的有证变更**

只重做会话输出明确证明成功的文件操作；不恢复 `.env` 中的敏感值，仅保留忽略规则和配置样例。

- [ ] **步骤 3：后端验证**

运行：`cd back && npm test`

预期：`35/35` 测试通过。

### 任务 4：全量验收与恢复证据归档

**文件：**
- 创建：`docs/recovery/verification.md`

- [ ] **步骤 1：小程序测试**

运行：`npm test`

预期：历史验收数量约 `174` 项，`fail 0`。

- [ ] **步骤 2：后端测试**

运行：`cd back && npm test`

预期：`35` 项，`fail 0`。

- [ ] **步骤 3：管理端构建**

运行：`cd back/admin-web && npm run build`

预期：退出码 `0`；允许历史中已知的大 chunk 警告。

- [ ] **步骤 4：页面安全区结构自检**

运行：`rg -L 'app-header' pages/*/index.wxml` 与结构检查脚本。

预期：所有页面按 `global-bg-image` → `app-header` → `page-content` 顺序组织，主内容不进入头部安全区。

- [ ] **步骤 5：记录限制与来源**

在 `verification.md` 记录 Git 基线、会话时间范围、重放成功/人工恢复数量、验证命令与退出码，以及无法证实的遗留缺口。
