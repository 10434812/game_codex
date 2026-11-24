# 锦鲤前程

微信账号联机的景区主题跑动接物游戏，包含原生小程序、Canvas2D 小游戏、Node.js 服务端和 Vue 管理后台。对局固定 **120 秒**，积分和账号资产由服务端确认。真人不足四人时由机器人补位；不提供设备体验入口。

首页选景区 → 快速匹配或创建/加入好友房 → 准备与开局 → 跑动接物、互选碰面组队 → 服务端结算 → 原房再来一局。当前规则、品牌与平台约束以 [PRODUCT.md](PRODUCT.md) 为准。

## 本地开发

使用 Node.js 24 和 npm。根目录、服务端、后台和小游戏分别安装/运行，不是 npm workspace。

```sh
npm test
npm --prefix back ci
npm --prefix back test
npm --prefix back/admin-web ci
npm --prefix back/admin-web run build
npm --prefix minigame ci
npm --prefix minigame test
npm --prefix minigame run smoke
```

后端配置参考 `back/.env.example`，不将实际密钥放进源码。准备 MySQL 后运行 `npm --prefix back run migrate -- --dry-run` 检查迁移计划。`release:check -- --database`会只读核对所选客户端登录配置、120秒配置、玩法/奖励字段与唯一索引；`--url`会核对新版接口能力。

已有数据库须先独立核实已执行的 SQL，再使用 `--baseline <已执行的最后一个文件名>`；不要对已有库重跑建表种子文件。

`npm --prefix back run test:integration` 创建并清理隔离 MySQL 8.4 容器，验证真实 HTTP/WebSocket、结算与资产、后台统计与配置审计、埋点、留存查询和迁移。需要 Docker 正在运行。

## 管理后台升级

启动新版后端前运行 `npm --prefix back run migrate`，应用 `019_admin_session_version.sql`。升级后管理员需重新登录。重置或编辑管理员密码成功后，该账号的旧后台令牌立即失效。

配置审计只记录管理员和修改的配置键。后台日志列表和详情已隐藏历史配置值。若此前通过管理后台修改过小游戏 AppSecret，需轮换密钥，并按运维流程处理数据库历史日志及备份中的旧值。

## 留存与双端登录

任务页提供七日循环签到、四项永久成长奖励与全服经验榜。每日任务按北京时间重置，成长进度不每日清空；奖励由服务端锁定账号、写领取凭据与流水并同事务入账，重复请求不重复发奖。需先执行 `018_retention_rewards.sql`。

后台微信配置分别保存小程序的 `wechat.login_app_id` / `wechat.login_secret` 和小游戏的 `wechat.minigame_app_id` / `wechat.minigame_secret`。小游戏登录传 `client: 'minigame'`，未传默认小程序；后台分别显示两端配置就绪，开关开启不等于配置齐全。小游戏密钥缺失时拒绝登录，不使用另一端密钥。JWT携带客户端标识，跨端续期拒绝；两端 OpenID 不自动合并成同一账号。

结算页可主动分享本人战绩卡；卡片只使用服务器确认的名次、得分和锦鲤币，导出失败回退通用分享。真实微信登录、卡片发送与接收展示仍需平台配置和双设备验收。

## 微信工程与构建

小程序在微信开发者工具中打开仓库根目录，小游戏单独打开 `minigame/`。小游戏 `npm run build` 生成压缩的 `dist/main.js`；规则模拟与测试代码保留在源码和验收目录，不进入发布脚本。`npm run smoke` 同时检查压缩包首帧、120 秒规则、菜单与玩法弹层；截图使用测试数据，不能代替双设备验收。

服务端提供 `back/Dockerfile`，包含后台生产构建。生产使用 `NODE_ENV=production` 并配置 `.env.example` 中的必填项；受邀体验账号限制与公开发布门禁分别执行。发版收到 SIGTERM 后阻止新开局，优先等待已有对局结算，再关闭连接。

## 统计与隐私

客户端在隐私确认前只缓存统计事件，确认后批量发送。后台“数据统计”展示活跃、新增、1/3/7 日留存、首次体验漏斗与客户端完局率。原始事件保留 90 天，账号注销删除关联事件；统计接入前的留存不能回填成真实数据。

编码、页面安全区、规则生成和测试约定见 [AGENTS.md](AGENTS.md) 与 [docs/agents/](docs/agents/)。本轮实现及待办见 [实施记录](docs/release/审查改进实施记录-2026-11-14.md)。本地通过、服务端部署、体验版上传、正式发布和真机验收分别记录。
