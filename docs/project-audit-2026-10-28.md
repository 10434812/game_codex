# 锦鲤游戏项目审查 — 2026-10-28

> 后续修复已完成，524 项测试通过；当前状态及发布前验收项见 [修复与验证报告](project-fixes-2026-10-28.md)。下文保留首次审查时的发现。

**建议先修复：联机开局等待卡住、旧本地对局截走好友邀请。**

审查对象是当前工作区，包含未提交和未跟踪文件；基准提交为 `d98ed768598ab2f845547d328ca814e397caa90b`。本次没有修改业务代码或发布配置，只新增本报告。以下结论来自源码、现有测试和只读复现，不代表真机或生产环境验收。

## Standards：工程与客户端问题

### S1 · [P2] 小游戏两个景区引用了包外图片

- 位置：[Constants.ts:233](/Users/hh/Desktop/日常开发/锦鲤游戏/minigame/src/core/Constants.ts:233)、[Constants.ts:262](/Users/hh/Desktop/日常开发/锦鲤游戏/minigame/src/core/Constants.ts:262)。
- 西湖、鼓浪屿使用 `/assets-pkg/stages/xihu.jpg`、`/assets-pkg/stages/gulangyu.jpg`。图片位于仓库根目录，而小游戏工程根目录 `minigame/` 中没有该目录；构建脚本也没有复制图片。当前 `dist` 仍包含这两个路径。
- 影响：小游戏中这两个景区的封面及对战背景会请求不存在的本地资源。已核对源码、产物和文件存在性，未跑真机。
- 修复方向：使用小游戏可访问的资源地址，或把图片正确纳入小游戏包。项目资源规范见 [architecture.md:11](/Users/hh/Desktop/日常开发/锦鲤游戏/docs/agents/architecture.md:11)。

### S2 · [P2] 小游戏打开失效邀请，会丢失当前联机连接

- 位置：[GameApplication.ts:85](/Users/hh/Desktop/日常开发/锦鲤游戏/minigame/src/GameApplication.ts:85)、[OnlineGame.ts:110](/Users/hh/Desktop/日常开发/锦鲤游戏/minigame/src/core/OnlineGame.ts:110)。
- 自动处理新邀请时，`joinRoom()` 在查询目标房间之前调用 `adopt()`；后者关闭旧连接，并清空当前房间、对局 ID 和状态。新邀请返回 404 时，旧连接已无法恢复，服务器上的原房间仍占位。
- 只读 Node mock 已复现：当前房间为 7 → 新邀请返回 404 → 客户端变为 `room:null / sessionId:'' / status:'idle'`，原房间仍在。
- 修复方向：有当前房间时先返回该房间，或在加入目标成功后再替换当前连接。菜单创建／加入房间已有类似限制，可以统一行为。

### S3 · [P2] CI 的 Node 版本无法启动小游戏测试

- 位置：[ci.yml:21](/Users/hh/Desktop/日常开发/锦鲤游戏/.github/workflows/ci.yml:21)、[register-hook.mjs:6](/Users/hh/Desktop/日常开发/锦鲤游戏/minigame/tests/register-hook.mjs:6)。
- CI 固定使用 Node 20；小游戏测试加载器导入 `node:module` 的 `registerHooks`。使用 Node 20.20.2 实际加载该文件，立即报错：`SyntaxError: The requested module 'node:module' does not provide an export named 'registerHooks'`。
- 复现命令：在 `minigame/` 执行 `npx --yes --package=node@20 -- node --import ./tests/register-hook.mjs -e 'console.log(process.version)'`，退出码为 1。
- 影响：即使修好前端测试和依赖门禁，CI 仍会在小游戏测试开始前失败。本机通过的测试运行在 Node 26.11.0。
- 修复方向：统一 CI 与本地使用的受支持 Node 版本，并明确项目运行版本要求；或者调整测试加载方式以兼容 CI 的版本。

## Spec：玩法与流程问题

### F1 · [P1] 有玩家未完成开局确认，整房不会自行继续或结束

- 位置：[game-service.js:296](/Users/hh/Desktop/日常开发/锦鲤游戏/back/src/services/game-service.js:296)、[game-service.js:359](/Users/hh/Desktop/日常开发/锦鲤游戏/back/src/services/game-service.js:359)。
- 需求依据：[玩法与100秒对局:8](/Users/hh/Desktop/日常开发/锦鲤游戏/docs/release/玩法与100秒对局-2026-10-22.md:8)：“联机对局等待所有真人确认后统一计时”。
- 开局把全部真人写入 `awaitingStartIds`；有人未确认时，`tick()` 在推进时间之前直接返回。只有该玩家主动发送 `ready` 才移除等待项，断线、页面退出和 HTTP 退房均不处理等待项，也没有等待超时。
- 复现：两人进入联机局，A 确认玩法，B 在确认前退出。只读调用生产导出执行 3,600 次一秒 tick 后，仍为 `playing / timeLeft:100 / round:0 / awaitingStartIds:['2']`。
- 影响：A 无法开始这局，也等不到对局自动结算。缺席玩家返回确认或管理员介入才能解除等待。
- 修复方向：明确确认阶段的退出处理和等待期限，并给仍在线的玩家提供取消或重新开局路径。

### F2 · [P1] 旧本地对局会截走好友邀请

- 位置：[room/index.js:97](/Users/hh/Desktop/日常开发/锦鲤游戏/pages/room/index.js:97)、[room/index.js:136](/Users/hh/Desktop/日常开发/锦鲤游戏/pages/room/index.js:136)。
- 收到好友房间参数后，`onLoad()` 仍无条件调用 `refreshRoom()`。它读取旧的本地状态：`playing` 就跳本地对局，`finished` 就跳旧结算，早于联网房间初始化。`onShow()` 中针对邀请的保护来不及生效。
- VM 已复现：让本地 `getState()` 返回 `playing`，执行 `onLoad({backendRoomId:'456'})`，立即触发 `redirectTo('/pages/arena/index')`，跳转中没有好友房间或联机对局参数。
- 影响：玩过本地局后打开好友链接，可能进入旧本地局或旧结算，无法按邀请加入。这里以已有的好友分享／加入功能为验收依据，未找到单独的邀请需求文档。
- 修复方向：存在邀请参数时优先走联网加入流程，避免旧本地状态触发导航。

### F3 · [P2] 联机对局主动离开后，没有继续入口

- 位置：[arena/index.js:265](/Users/hh/Desktop/日常开发/锦鲤游戏/pages/arena/index.js:265)、[room-service.js:190](/Users/hh/Desktop/日常开发/锦鲤游戏/back/src/services/room-service.js:190)。
- 界面明确提示“联机对局继续计时，返回后可继续游玩”，但确认离开后用 `redirectTo()` 销毁对局页，没有保存联机 `sessionId`。
- 首页没有查询或恢复当前联机局的入口；再次点击开始会创建本地房间。重新打开原邀请也不能恢复，因为后端在识别现有成员之前，就以房间不是 `waiting` 为由拒绝加入。
- 影响：玩家主动返回首页后，无法通过正常界面回到仍在进行的联机局。该结论已交叉检查首页、对局页及后端加入流程，未做双设备验收。
- 修复方向：保存并恢复当前联机会话，为已在进行中房间的原成员提供返回路径；同步核对离开提示。

## 验证结果

| 检查 | 本次结果 | 说明 |
|---|---|---|
| 小程序前端测试 | 291 / 294 通过 | 3 项失败均在房间页断言，见下文 |
| 后端 `npm test` | 通过，退出码 0 | 不等于真实数据库及多设备联调通过 |
| 小游戏测试及类型检查 | 68 / 68 通过；类型检查通过 | 直接运行现有测试加载器，未执行会写文件的 codegen；RunArena 与渲染器生成文件已逐字比对一致 |
| 管理后台生产构建 | 通过 | 输出到临时目录，未覆盖现有 `dist`，未部署 |
| CI Node 20 兼容性 | 失败 | 测试加载器在测试开始前报错，见 S3 |

### 1. 前端 3 项旧断言阻断测试

这些失败不能直接当成功能损坏；当前断言与新的文案或模板表达式不一致。

| 位置 | 失败原因 |
|---|---|
| [page-ui.test.js:328](/Users/hh/Desktop/日常开发/锦鲤游戏/tests/page-ui.test.js:328) | 仍要求“准备好后，游戏将在两分钟内开始”，当前提示已更改 |
| [page-ui.test.js:359](/Users/hh/Desktop/日常开发/锦鲤游戏/tests/page-ui.test.js:359) | 精确匹配旧 `disabled` 表达式，新表达式增加了 `creatingOnlineRoom` 条件 |
| [page-ui.test.js:594](/Users/hh/Desktop/日常开发/锦鲤游戏/tests/page-ui.test.js:594) | 仍匹配旧邀请提示，当前已区分本地体验与联网邀请 |

应按当前产品行为更新断言，并保留“非房主不能开局”等行为验证，不应为了匹配旧正则删掉有效限制。

### 2. 依赖安全门禁也会失败

本次实际执行 `npm audit --omit=dev --json`：

| 目录 | 扫描结果 |
|---|---|
| `back/` | 2 项 high：锁定的 `body-parser 1.20.8`、`multer 2.4.0` |
| `back/admin-web/` | 8 项 high、2 项 moderate |
| `minigame/` | 0 项 |

后端命中公告：[body-parser GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[multer GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)。锁定版本见 [package-lock.json:692](/Users/hh/Desktop/日常开发/锦鲤游戏/back/package-lock.json:692)、[package-lock.json:1680](/Users/hh/Desktop/日常开发/锦鲤游戏/back/package-lock.json:1680)。

CI 明确执行后端 `npm audit --omit=dev --audit-level=high`，因此这两项会阻断流水线。扫描命中不代表本应用所有相关攻击路径均可利用；本次没有进行漏洞利用测试。修复时应更新相应依赖及锁文件，再验证测试和审计结果。

### 3. 本地发布检查尚未通过

`check-release.js --target miniprogram` 报告 6 项阻断；`--target minigame` 报告 5 项阻断。

- 当前本机未配置 `WX_CONTENT_SAFETY_TOKEN`、`WX_CONTENT_SAFETY_AES_KEY`、`WX_CONTENT_SAFETY_BASE_URL`。这不是生产环境配置缺失的证明。
- 类目、实名防沉迷、发行材料是检查脚本固定加入的人工核验项，本次未登录微信后台，不能据此判定实际平台审批状态。代码位置见 [release-readiness.js:17](/Users/hh/Desktop/日常开发/锦鲤游戏/back/src/services/release-readiness.js:17)。
- 检查同时提示本地管理后台 `dist` 早于源码；本次仅在临时目录验证了新构建。
- 数据库迁移、线上服务、CDN 对应文件和双设备联机未在本次审查中验收。

## 修复顺序

1. 处理 F1 的开局等待退出路径，并验证一人确认、另一人退出的双人场景。
2. 修复 F2、F3 的好友加入及联机返回流程。
3. 修复 S1、S2 的小游戏资源与邀请切换。
4. 统一 CI 运行版本，更新 3 项旧断言，清理依赖门禁。
5. 配齐目标环境配置后，再执行目标库、线上资源和双设备验收。

两条审查轴分别确认：Standards 3 项，主要问题是失效邀请会清空现有联机连接；Spec 3 项，最严重的是未确认玩家退出后整房不能自行继续或结束。
