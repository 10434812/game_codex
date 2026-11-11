# 《锦鲤前程》微信小程序上线合规审查报告

> 分析对象：`/Users/hh/Desktop/日常开发/锦鲤游戏`（微信小程序前端 + `back/` Node.js 后端 + `back/admin-web` 管理后台）
> 分析时间：2026-08-14　|　分析人：上线合规与审核审查
> AppID：`wxd7f500f3f21f15dd`（project.config.json:157、back/.env）　|　compileType：`miniprogram`（普通小程序，非小游戏）
> 说明：本报告仅基于仓库代码与线上实测（TLS、API、服务器 IP），未涉及微信公众平台后台的实际类目/备案/域名配置，相关项需运营方在 MP 后台核对。

---

> **本轮整改状态：** 本报告保留整改前的代码证据和风险分析。当前代码已移除普通支付链路、人民币价格、投资式随机盈亏及外部现实金融数据能力；文中对应高风险条目需以当前代码复核，隐私、账号权利、内容安全、资质和运营闭环仍未完成。

## 〇、总体结论

该产品当前状态**不具备上线条件**。核心问题依次是：**游戏类目资质（版号/虚拟支付）、金币+随机投资玩法带来的涉赌风险、隐私政策与用户协议缺失、海外服务器域名无法备案、防沉迷缺失**。其中前两项直接决定产品形态是否需要调整（去支付化/去随机盈亏），属于上线前必须决策的「产品级」问题；其余为「工程级」可修复项。

风险等级定义：🔴 高（审核必拒或触碰红线，上线前必须解决）｜🟠 中（大概率被驳回或存在实质合规/安全隐患）｜🟡 低（建议修复，影响通过率或后续运营）。

---

## 一、微信审核硬性要求

### 1.1 类目资质：游戏类目 + 虚拟货币 + 支付 —— 🔴 高

**代码证据**

- `project.config.json:155` `"compileType": "miniprogram"` —— 注册为**普通小程序**，不是「小游戏」。
- 产品功能是完整对战游戏：180 秒对局（`utils/constants.js:4 GAME_DURATION_SECONDS = 180`）、2 人一队（`TEAM_SIZE = 2`）、排行榜、胜负结算。
- 内置虚拟货币「锦鲤币」：`utils/shop-store.js:3 const INITIAL_COINS = 8820;`（新用户初始币），`back/sql/001_create_tables.sql:15 coins INT DEFAULT 8820 COMMENT '幸运金币'`。
- 商城直接售卖虚拟商品（皮肤/宠物/头像光环，`utils/shop-store.js GOODS`），并支持微信支付购买：`pages/shop/index.js:12 const COINS_PER_CNY = 100;`（1 元 = 100 锦鲤币，页面按此折算人民币标价）。

**合规要求与风险分析**

1. **普通小程序不能提供虚拟支付**：微信平台规定，虚拟商品/虚拟货币的售卖必须通过「小游戏」类目的**虚拟支付能力**完成，普通小程序用微信支付卖虚拟商品属于违规，审核直接驳回，且商户号有被封禁风险。当前实现是「普通微信支付 JSAPI 直购虚拟道具」（`back/src/services/wechat-pay-service.js createJsapiOrder` → `/v3/pay/transactions/jsapi`），不是虚拟支付能力。
2. **游戏类目需要版号**：微信小程序「游戏」类目要求提供《网络游戏出版物号（ISBN）核发单》（游戏版号）；涉及虚拟货币发行/付费的游戏还涉及《网络文化经营许可证》（文网文）。仓库内没有任何资质材料（全项目无版号/文网文/软著文件）。
3. **小游戏路线**：若改为小游戏（`compileType: "game"`），注册主体必须为企业，开通虚拟支付仍需**版号**；个人主体不可注册小游戏。
4. **当前 AppID 类目未知**：需在 MP 后台核对 `wxd7f500f3f21f15dd` 已选类目；若选择了非游戏类目（如「工具/生活服务」）而上架游戏+支付，属「类目不符」，是审核最常见驳回原因之一，且可能被封禁搜索与支付能力。

**修复建议（三选一，需产品决策）**

- 方案 A（最稳妥）：**去支付化** —— 关闭 `wechat.pay_enabled`、移除微信支付入口，锦鲤币仅由对局结算产出，作为纯娱乐 Demo 游戏按「休闲游戏」定位申请类目（仍需软著，建议补办）；同时删除商品的人民币等价价签（`cashPriceText`/`wechat-price-badge`）。
- 方案 B（合规变现）：注册小游戏 + 取得**游戏版号** + 接入**微信虚拟支付（米大师）**，并将现有普通微信支付代码替换为虚拟支付 API。
- 方案 C：取得版号后以普通小程序「游戏」类目上线，但仍需把支付替换为虚拟支付能力。

### 1.2 小程序备案（ICP 备案）—— 🔴 高

- 自 2023 年 9 月起，新上架小程序**必须完成备案**（在 MP 后台「设置-基本设置-小程序备案」提交主体与小程序信息）。未备案无法发布。
- 仓库中无备案号记录，无法核验；上线前必须在 MP 后台完成并拿到备案号。
- 服务器域名备案问题见 §5.2（海外服务器无法取得中国大陆 ICP 备案，直接影响 request/socket 合法域名配置）。

### 1.3 隐私保护指引与 app.json 配置 —— 🔴 高

**代码证据**

- `app.json` 全文：无 `__usePrivacyCheck__`、无 `requiredPrivateInfos`。
  - `__usePrivacyCheck__`：自基础库 2.32.3 / 2023-09-15 起隐私检查默认强制开启，**不再需要**此字段（所以缺失本身不算错）；真正的缺口是 MP 后台未配置指引（见下）。
  - `requiredPrivateInfos`：仅在使用位置等敏感 API 时才需要声明；本项目未调用 `getLocation` 等敏感 API（全量 `wx.*` 调用清单见 §4.1），**不需要**。此项结论：✅ 通过。
- 头像昵称能力：`pages/profile/index.wxml:41` 使用 `open-type="chooseAvatar"`，`:54` 使用 `input type="nickname"` —— ✅ 已按 2022 年后的新规范实现（旧 `wx.getUserProfile` 已弃用，本项目未调用，符合要求；`AGENTS.md` 中「通过 wx.getUserProfile 获取」的描述已过时，与代码不符）。
- **缺口**：MP 后台必须配置《小程序用户隐私保护指引》，声明收集「微信昵称、头像（头像昵称填写能力）、openid（微信登录）」及用途；代码中没有任何隐私政策页面/协议弹窗：
  - `utils/runtime-config.js:5-6`：
    ```js
    'wechat.login_agreement_url': '',
    'wechat.login_privacy_url': '',
    ```
    用户协议与隐私政策 URL 为空，且全项目无任何页面渲染这两个 URL、无 `wx.requirePrivacyAuthorize`、无登录前的协议勾选/弹窗。
  - `pages/boot/index.js:19-21,94`：启动页**静默自动登录**（`tryAutoLogin()` → `wx.login` 换取 openid），用户在未被告知收集信息的情况下即被采集 openid 并入库（`back/src/services/auth-service.js findOrCreateUser` 自动建号）。

**修复建议**

1. 在 MP 后台完成《用户隐私保护指引》配置（声明昵称/头像/openid 的收集与用途）。
2. 制作《用户协议》《隐私政策》页面（小程序内静态页或 H5，域名需配置为业务域名），将 URL 填入 `wechat.login_agreement_url` / `wechat.login_privacy_url` 并在「登录/进入前」以弹窗或勾选形式展示；用户同意后再执行 `userProfile.login()`。
3. 处理 `wx.requirePrivacyAuthorize` 的回调（隐私授权弹窗拒绝/未授权时给出引导）。

### 1.4 未成年人防沉迷 / 实名认证 —— 🔴 高

**代码证据**

- 全项目无实名认证、无年龄验证、无防沉迷、无未成年人消费限额、无「青少年模式」相关代码（grep：无 `实名`、`防沉迷`、`age`、`未成年` 逻辑）。
- 支付路径 `pages/shop/index.js startWechatPayment()` 无任何年龄/身份前置校验。

**风险分析**

游戏类目 + 付费，按《未成年人保护法》与版署防沉迷规定，必须接入**实名认证与防沉迷系统**（未成年人限时、限额消费，8 周岁以下禁止付费）。微信游戏类目审核对无防沉迷的游戏+支付组合直接驳回；接入微信小游戏则需要对接「健康系统」。

**修复建议**：若保留支付，必须接入实名认证/防沉迷；若去支付化，也建议至少加「适龄提示（如 12+）」与未成年人游戏时长提示，降低驳回风险。

---

## 二、支付合规

### 2.1 虚拟支付 vs 普通微信支付 —— 🔴 高

**代码证据**

- `pages/shop/index.js:85-100 choosePurchaseMethod()`：弹出「锦鲤币购买 / 微信支付 ¥xx.xx」双通道选择。
- `pages/shop/index.js:216-247 startWechatPayment()`：`POST /payments/wechat/jsapi` 创建订单 → `wx.requestPayment` → `POST /payments/wechat/orders/:orderNo/sync` 确认。
- `back/src/services/wechat-pay-service.js createJsapiOrder()`：对商品（皮肤/宠物/光环，纯虚拟道具）创建 JSAPI 支付订单，`description: ${goodsDesc}-${item.name}`。
- `back/src/config/system-config-definitions.js:261` `wechat.pay_enabled`（默认 false），`wechat.pay_goods_desc` 默认值「锦鲤前程锦鲤币充值」（`utils/runtime-config.js:18`）——商品描述按「金币充值」口径。

**风险分析**

- 用**普通微信支付**销售虚拟道具/虚拟货币，违反微信《小程序虚拟支付规范》：虚拟支付仅限小游戏类目通过「虚拟支付」能力完成；普通小程序（compileType=miniprogram）无虚拟支付资质，审核与商户侧均违规。即使 `pay_enabled=false`，代码与 UI 中保留了完整支付链路与人民币标价（`wechat-price-badge`），审核员可看到，同样会被质疑。
- 金额换算口径需统一：后端 `amount_cents = Math.round(item.price)`（把「锦鲤币价」直接当「分」），即 1280 锦鲤币 = ¥12.80，与前端 `COINS_PER_CNY=100` 一致（`pages/shop/index.js:12`），换算本身自洽，但「虚拟币价格直接等于人民币」的展示方式（商品卡片右上角挂 ¥ 价签）强化了「虚拟币=人民币」的兑换属性，涉赌/涉支付审核更敏感。

**修复建议**：见 1.1 三方案。若去支付化：删除/隐藏 `choosePurchaseMethod` 微信支付分支与 `wechat-price-badge`；若合规变现：替换为微信虚拟支付（米大师）API。

### 2.2 iOS 限制 —— 🔴 高

**代码证据**：`pages/shop/index.js` 全文无平台判断（无 `wx.getSystemInfoSync().platform` / `getDeviceInfo` 分支），`startWechatPayment` 在 iOS 与 Android 上行为一致。

**风险分析**：微信小游戏虚拟支付在 iOS 端受苹果 IAP 政策限制（历史多次暂停/受限），且普通微信支付不得用于虚拟商品。当前实现未区分平台，iOS 用户可直接为虚拟道具付款，双重违规（微信规则 + 苹果政策），且苹果可能据此要求下架或拒审关联服务。

**修复建议**：至少在 iOS 端隐藏微信支付入口（仅展示锦鲤币购买）；若接入虚拟支付，上线前与微信确认 iOS 端支付可用性并做平台分流。

### 2.3 商户号配置与支付回调安全 —— 🟠 中（实现较完整，但有三处缺口）

**做得对的部分**（`back/src/services/wechat-pay-service.js`）：

- 回调签名校验：`verifyNotificationSignature()`（Wechatpay-Signature 头 + 平台证书序列号校验 + RSA-SHA256 验签，行 101-131）。
- 回调解密：AES-256-GCM（`decryptNotificationResource`，行 244-258）。
- 回调后**主动查单**：`handlePaymentNotify` → `queryWechatOrder`（仅信任微信查单结果，不信任客户端）。
- 幂等与并发：`grantPaidOrder` 使用 `SELECT ... FOR UPDATE` + 事务 + `INSERT IGNORE`（行 168-205）。
- 路由正确保留原始 body：`back/src/app.js:21-25 express.json({verify: (req,_res,buf)=>{req.rawBody=buf;}})`，`routes/payments.js:40-49` 通知路由无需鉴权（微信服务器回调）。

**缺口**

1. **未校验支付金额**：`grantPaidOrder` 只检查 `trade_state === 'SUCCESS'`，未比对微信返回 `amount.total` 与 `payment_orders.amount_cents`。虽因查单对象即本订单、金额由服务端创建，被篡改概率低，但规范上应校验（`transaction.amount.total === order.amount_cents`）。
2. **无时间戳新鲜度窗口**：验签时未校验 `wechatpay-timestamp` 与服务器时间差（微信官方建议 5 分钟内），存在重放窗口（幂等逻辑可兜底大部分风险）。
3. **平台证书静态配置**：`wechat.pay_platform_public_key`/`platform_cert_serial_no` 存于 DB 静态配置（`system-config-definitions.js:294-331`），微信平台证书轮换后需人工更新，建议改为自动下载/缓存平台证书。

**其他配置项**：`wechat.pay_*` 商户号、APIv3Key、商户私钥均通过管理后台存入 `system_config` 表 —— 私钥明文存库（`wechat.pay_private_key`），虽仅管理员可读，建议加密存储或改用证书文件；`notify_url` 需在生产环境配置为 `https://xcx.ukb88.com/api/payments/wechat/notify` 且域名备案。

### 2.4 金币账本不一致（客户端权威）—— 🟠 中

**代码证据**：线上联机对局中，福袋买卖**完全在客户端本地记账**，无任何服务端接口：

- `pages/arena/index.js:805-830 onConfirmOpportunity()`：`shopStore.applyCoinsDelta(-cost, ...)`（本地存储扣币）+ `gameStore.applyPlayerScoreDelta(...)`。
- `pages/arena/index.js:866-875 onSellPosition()`：`settlePosition(position)`（本地 `Math.random()` 结算）→ `shopStore.applyCoinsDelta(...)`。
- 后端路由无任何 invest/fortune 结算端点（grep 确认 `back/src/routes` 无相关接口）；`back/src/socket/arena-handler.js` 的 `fortune_buy` 事件只是原样转发客户端传入的 `opportunity`，不校验、不入账。
- 而服务端金币入账只发生在对局结算（`back/src/services/game-service.js:405-425 coinsEarned = gain*3 → users.coins`）与商城购买/支付。

**风险分析**：金币可通过人民币购买（支付开启时），但福袋随机盈亏在客户端本地结算——账本可被随意篡改（改本地存储即可无限金币买福袋），且「充值后用于随机盈亏」的货币闭环不受服务端约束，涉赌审查中这是加重情节（赌博工具可被操纵）；同时本地/服务器两套账本会漂移。

**修复建议**：若保留福袋玩法，所有买入/卖出/结算必须迁移到服务端（鉴权 + 服务端随机数 + 服务端记账 + 幂等），客户端仅展示。

---

## 三、内容合规

### 3.1 广告法违禁词 —— 🟡 低

**代码证据**（商品描述中的绝对化用语）：

- `utils/shop-store.js:251`：`'掌管云雨的小神龙，打架最凶却最爱撒娇。'`
- `utils/shop-store.js:273`：`'憨态可掬，平日里最爱在竹林里晒太阳。'`
- `utils/shop-store.js:429`：`'层次最完整的高级款，适合压轴登场。'`（另有 `'更锋利的视觉识别'`、`'极其忠诚'` 等，见 `back/src/services/shop-service.js` 同名文案）

**风险分析**：「最」「极其」属《广告法》第九条绝对化用语，虽然出现在游戏内商品描述中、量级较轻，但审核与后续监管（职业打假）都可能据此投诉。全站扫描未发现「第一/顶级/国家级/100%」等更强违禁词（页面文案整体干净）。

**修复建议**：将三处「最」及「极其」改写为中性描述（如「性格张扬又爱撒娇」「层次丰富的高级款」）。

### 3.2 随机抽取（福袋）概率公示与涉赌风险 —— 🔴 高

**代码证据**

- 随机结算乘数：`utils/investment.js:35-39`
  ```js
  high: {min: 0.18, max: 1.72, label: '高波动'},  // 即 -82% ~ +72%
  mid:  {min: 0.52, max: 1.38, label: '中波动'},
  low:  {min: 0.76, max: 1.14, label: '稳健'},
  ```
- 结算纯随机：`utils/investment.js:118-136 settlePosition()`：`const multiplier = min + (max - min) * random();`（均匀分布，无任何公示）。
- 金币是人民币可购的：`pages/shop/index.js`（`COINS_PER_CNY=100`、微信支付通道），福袋投入与盈亏均以金币结算（`pages/arena/index.js:822,872`）。
- UI 无概率公示、无风险提示：`pages/arena/index.wxml:120-122` 只显示「投入成本」「预计波动：-82% ~ +72%」与「买入后需等待时机卖出，持有时间越长波动越大。」（`utils/investment.js:57`），无「本玩法为娱乐随机玩法，不构成真实投资」等声明；提示文案还出现「等待下一次红包」（`pages/arena/index.js:951`），把随机抽奖称为「红包」。

**风险分析**

「人民币可购的虚拟币 → 投入随机盈亏玩法 → 盈亏影响排行榜/可再购买商品」，构成**变相赌博**特征的闭环（付费博彩式随机），是微信审核与网信/公安监管重点打击形态；微信《小程序运营规范》明确禁止「赌博或以随机抽取等偶然方式诱导用户付费」。即使支付开关默认关闭（`wechat.pay_enabled=false`），「锦鲤币充值」链路与人民币标价仍然存在，审查时无法解释为纯娱乐。

**修复建议**

1. 首选：**福袋盈亏改为确定性/技巧性机制**（如按持有时机与公开市场数据线性结算），或福袋仅产出装扮类道具（不可兑换、不可交易、不与货币互通）。
2. 次选（保留随机）：a) 明确公示每种风险档的概率分布与期望；b) 页面显著位置加「娱乐玩法，虚拟收益不可提现/兑换人民币」声明；c) 删除「红包」「手气」（`share-config.js:50` 分享语「来一起试试手气」）等措辞；d) 福袋结算全部服务端化（见 2.4）。
3. 无论如何：**人民币充值通道与随机盈亏玩法不得同时存在**（二选一）。

### 3.3 金融/投资/虚拟货币内容 —— 🔴 高

**代码证据**

- 玩法内置「股票/房产/比特币」投资机会：`utils/investment.js:1-7`（`新能源龙头`、`芯片指数ETF`、`BTC 波段机会`、`矿企联动仓位`…）。
- 后端抓取**真实证券市场行情**注入玩法：`back/src/services/fortune-reality-service.js` 默认数据源包含沪深300 ETF、科创50 ETF、标普500 SPY、BTC/ETH（CoinGecko）、万科A、保利发展等（行 9-105），每 5 分钟刷新（`back/src/jobs/fortune-reality-job.js:33`），并生成 AI 市场摘要（`fortune_ai_reports` 表，`/api/fortune-bags/public` 已返回 `report` 字段）。
- 页面把结果称为「收益/投资收益」：`pages/home/index.wxml:129 收益 {{item.income}}`、`pages/result/index.wxml:188 投资收益`、`pages/arena/index.wxml:202 买入或卖出机会会影响本局收益`。

**风险分析**

1. **比特币/加密货币内容**：微信平台明确禁止虚拟货币交易与炒作相关内容，「BTC 波段机会」+真实 BTC 行情 + 买入卖出玩法属于红线内容。
2. **金融投资引导**：用真实证券标的做「投资机会」随机盈亏，可能被认定为变相「猜涨跌」赌博或违规荐股/金融信息发布（无证券咨询资质），且 AI 生成的行情摘要若展示给用户，还需按《互联网信息服务深度合成管理规定》进行 AI 生成内容标识（当前前端未展示 report，但接口已公开返回，展示前必须加标识）。
3. 「收益 +150%」等数值（`utils/constants.js` STAGES 各景区 `income: '+150%'` 等）暗示现金回报，与游戏内实际结算无对应关系，属误导性宣传。

**修复建议**：删除「比特币/加密货币」品类；把「股票/房产」改为虚构题材（如「灵石/灵田」）或与真实行情完全解耦；「收益」改称「积分加成」并与实际数值一致；移除或隐藏 AI 摘要，展示则必须标注「AI 生成」。

### 3.4 景区名称：真实地名 + 虚假数据 —— 🟡 低~🟠 中

**代码证据**

- `utils/constants.js:98-273 STAGES`：`万里长城`、`富士山`、`巴黎铁塔`、`大峡谷`、`泰姬陵`、`西湖夜游`、`鼓浪屿` —— 均为真实知名景区，且「西湖」「鼓浪屿」在国内为旅游景区注册商标（杭州/厦门相关主体持有旅游类商标）。
- 每个景区配了虚构的 `income: '+150%'` 与 `online: '4.2k'` 等「收益/在线人数」数据并在首页展示（`pages/home/index.wxml:122-130`：「众 {{item.online}}」＋「收益 {{item.income}}」），这些数字在代码中为静态写死（无任何实时来源）。

**风险分析**：用真实景区名做「收益」类游戏主题，存在商标侵权与误导风险（景区方维权、用户投诉「景区名义金融化」）；虚构在线人数/收益属虚假宣传，审核员与竞对均可据此投诉。此外资产文件名错位（如长城主题配 `mount-fuji-bg.mp4`，`constants.js:121`）表明素材命名混乱，上线前应核对素材版权来源（大量实景视频/图片需确认可商用授权）。

**修复建议**：优先改为虚构地名（如「龙脊关」「樱雪山」）；保留真实地名则需取得景区授权并删除「收益/在线人数」虚构数据；核对全部素材（图片/视频/音频/BGM）商用授权链。

---

## 四、用户隐私与数据

### 4.1 收集的信息清单（全量 wx.* API 盘点）

| API | 用途 | 涉及信息 |
|---|---|---|
| `wx.login`（boot 静默、`utils/user-profile.js:66`） | 登录 | openid（后端 jscode2session） |
| `chooseAvatar` 按钮 + `input type=nickname`（`pages/profile/index.wxml:41,54`） | 资料编辑 | 微信昵称、头像（用户主动填写） |
| `wx.uploadFile`（`utils/user-profile.js uploadAvatar` → `POST /user/avatar`） | 头像上传 | 头像文件（服务端 `back/uploads/avatars` 公开静态目录） |
| `wx.request/connectSocket` | 业务/对局 | openid 派生的 JWT |
| `wx.setStorageSync/getStorageSync` | 本地缓存 | 昵称/头像/JWT/金币/流水（key：`wx_user_profile_v1`、`game_codex_api_token_v1`、`game_codex_shop_store_v1` 等） |
| `wx.getSystemInfoSync/getWindowInfo/getMenuButtonBoundingClientRect` | 布局 | 设备屏幕信息（不收集到服务器） |

未收集：手机号、位置、相册、通讯录、生物特征。✅ 最小化程度尚可。

### 4.2 隐私政策与用户协议 —— 🔴 高（见 1.3）

无任何用户协议/隐私政策页面或弹窗；`wechat.login_agreement_url`/`wechat.login_privacy_url` 为空；启动页静默登录未获同意。必须在 MP 后台配置隐私保护指引 + 小程序内提供协议/政策入口并前置同意。

### 4.3 本地存储 —— 🟡 低

- JWT（`game_codex_api_token_v1`）、昵称/头像明文存于本地 Storage（`utils/api-client.js:4-7`、`utils/user-profile.js`）。JWT 本地明文存储是微信生态通行做法（风险可控）；但**分享路径携带昵称明文**（`utils/share-config.js:41-42 buildInviteQuery` 把 `inviteName=<昵称>` 拼入分享 path query），昵称随分享链接传播，建议改为不携带或服务端加密短参。

### 4.4 UGC 内容安全与用户保护机制 —— 🟠 中

**代码证据**

- 昵称自由输入（`pages/profile/index.wxml:53-54`），后端仅做「非空 + ≤32 字符」校验（`back/src/routes/user.js:64-71`），**无敏感词过滤、无 `msgSecCheck` 文本安全检测**；头像上传仅校验扩展名与 2MB 大小（`back/src/routes/user.js:20-30`），**无 `imgSecCheck` 图片安全检测**。
- 全项目无举报/投诉入口、无拉黑机制（有 `is_banned` 字段与后台封禁，但用户侧无投诉通道）。
- 房间联机允许陌生人同局（`rooms` API + 表情/队伍互动）。

**风险分析**：昵称/头像属于 UGC，微信要求提供内容安全能力（`security.msgSecCheck`/`mediaCheckAsync`）与用户投诉处理机制；社交类功能（联机房间）无举报入口大概率被驳回或要求整改。昵称还展示在排行榜（`leaderboard`）与分享语中。

**修复建议**：a) 昵称写入前调用 `msgSecCheck`（或接入微信内容安全 2.0），头像调用 `mediaCheckAsync` 异步审核，失败则拒绝/降级为默认头像；b) 增加「举报」入口（`button open-type="feedback"` 或自建举报 API）与黑名单；c) 后台 `users` 管理已有封禁能力（`routes/admin/users.js PUT /:id/ban`），补上前端投诉闭环即可。

---

## 五、服务器与域名要求

### 5.1 域名清单与协议 —— 🟠 中（协议达标，备案待核）

**代码证据**

- 全项目仅使用一个主域：`utils/api-client.js:6 DEFAULT_BASE_URL = 'https://xcx.ukb88.com/api'`；WebSocket：`pages/arena/index.js:63-66` 将 `https://` 替换为 `wss://`，连接 `wss://xcx.ukb88.com/ws/arena`。✅ 协议正确（HTTPS/WSS）。
- 图片/视频/音频全部走 `https://xcx.ukb88.com/assets/...`（`utils/constants.js`、`utils/audio.js`、`utils/boot-loader.js`）——媒体类 URL 不需要配置合法域名，✅ 无碍。
- 线上实测：`xcx.ukb88.com:443` TLSv1.3、证书 CN=xcx.ukb88.com、链验证 OK；`GET /api/health` 返回 `{"code":0,...}`（后端已在生产运行）；站点根路径返回 403（nginx 默认拒绝，无碍）。

**要求**：`xcx.ukb88.com` 必须在 MP 后台配置为 **request 合法域名 + uploadFile 合法域名 + socket 合法域名**，且域名需已完成**中国大陆 ICP 备案**。这三项后台配置仓库无法体现，上线前必须核对。

### 5.2 ICP 备案与海外服务器 —— 🔴 高

**实测证据**：`xcx.ukb88.com` 解析到 `198.0.19.87`（GeoIP：US）。服务器托管在美国，**无法取得中国大陆 ICP 备案**（备案要求境内接入商+境内服务器）。微信 request/uploadFile/socket 合法域名要求域名已备案（境内域名），海外服务器域名无法通过域名校验，正式版小程序所有网络请求（登录、房间、支付）将直接失败——**这是硬阻塞**。

同时注意：海外直连的跨境数据传输（用户 openid/昵称出境）在隐私保护指引中必须披露。

**修复建议**：将后端（Express/MySQL/Socket）与静态资源迁移至中国大陆云厂商（阿里云/腾讯云等），域名完成 ICP 备案与公安备案后再配置合法域名；或（不推荐）小程序端全部改为「本地模拟模式」不发起任何网络请求。

### 5.3 `urlCheck: false` 的上线风险 —— 🟡 低（已正确理解，补充说明）

**代码证据**：`project.config.json:130 "urlCheck": false`（开发者工具内关闭域名校验，仅影响本地调试）。

**说明**：该配置**不影响线上包**——正式版始终强制校验 request/socket 合法域名。风险不在「关校验上线的包」，而在「开发期靠关校验联调，从未在真机开启校验验证域名配置」，导致 5.1/5.2 的问题直到提审才暴露。建议：开发阶段就用开启域名校验的体验版验证一遍全部网络能力。

### 5.4 资源托管与包体 —— 🟢 通过

`project.config.json packOptions.ignore` 已排除 `assets/素材/back/docs/tests` 等大目录，主包只含页面与工具代码（体量小）；全部资源走远程 CDN。✅ 但需确认远程素材（尤其音频 wav、视频 mp4/mov）的**可商用授权**（见 3.4）。

---

## 六、其他审核风险

### 6.1 诱导分享 —— 🟡 低

- 分享未与奖励挂钩（✅ 未发现「分享得金币」类逻辑），`enableShareMenu` 仅在 `wechat.share_enabled` 时启用（`utils/share-config.js:105-121`）。
- 但房间页文案「**去群里邀请好友**，凑齐队伍更快开局」（`pages/room/index.wxml:76`）有诱导向群分享的嫌疑；结果页分享语「来一起试试**手气**」（`share-config.js:50`）涉赌措辞（见 3.2）。建议改为「邀请好友一起开局」并去掉「手气」。

### 6.2 强制授权 —— 🟠 中

启动页静默 `wx.login`（`pages/boot/index.js:19-21`）未经用户同意即采集 openid 并服务端建号（`auth-service.js findOrCreateUser` 自动 INSERT）。虽然 `wx.login` 不需要用户弹窗授权，但「收集个人信息前未告知」违反个保法告知-同意原则，需在隐私指引+前置协议同意后再登录（见 1.3 修复建议）。头像昵称编辑为用户主动触发，✅ 无强制授权问题。

### 6.3 「测试/demo」字样 —— ✅ 通过

全量扫描 `pages/`：用户可见文案无「测试/demo/示例」字样（`project.config.json:2 "description": "game prototype"` 为开发者工具内部描述，不随包展示）。✅ 但商城支付横幅文案暴露内部信息：「当前使用锦鲤币完成购买，**后续可在后台开启微信支付联调**」（`pages/shop/index.js:130,165`）——「联调」字样与「微信支付未开启」状态文案在提审时非常扎眼，建议改为消费者视角文案（如「当前仅支持锦鲤币购买」）或直接隐藏整条横幅。

### 6.4 客服/退款渠道 —— 🟡 低

含支付能力的小程序审核通常要求提供客服/反馈渠道与退款说明。全项目无 `open-type="contact"` 客服按钮、无退款规则页面、无虚拟币退款政策。建议：商城/设置页加客服按钮（可配置为后台 `wechat.*` 客服链接），协议中写明虚拟道具充值退款规则。

### 6.5 sitemap —— 🟡 低

`sitemap.json` 为 `"allow" "*"`（全部页面允许被索引）。游戏类页面一般建议 disallow（游戏页面无搜索收录价值且会展示涉赌文案给搜索流量）。建议改为仅 allow 首页或全 disallow。

### 6.6 后端安全（附带发现，影响支付/用户体系）—— 🟠 中

1. **`.env` 已提交 git**（🔴 单独列）：`back/.env` 被 `git ls-files` 跟踪，含 `WX_SECRET`（AppSecret）、`JWT_SECRET`、MySQL 密码、管理员账号密码等真实值；远端仓库 `github.com:10434812/game_codex`。AppSecret 泄露 = 任何人可伪造登录。必须立即：轮换 WX_SECRET/JWT_SECRET/DB/管理员密码 + `git rm --cached back/.env` + 加入 `.gitignore` + 检查仓库历史（考虑 purge）。
2. **AppID 文档不一致**：`.env.example:17` 与 `AGENTS.md` 中 AppID 为 `wx72a4b552a87b44cf`，实际为 `wxd7f500f3f21f15dd`（`project.config.json:157`、`back/.env`）。若按文档配置 AppSecret 会登录失败（jscode2session appid/secret 不匹配）。需统一文档。
3. **管理后台登录无频率限制**：`back/src/routes/admin/auth.js:31-66` 无 rate-limit/验证码，可被暴力破解；`ADMIN_PASSWORD` 生产环境缺失会抛错（`config/index.js:23-30` 有兜底 ✅），但 `.env.example` 建议的默认密码 `admin123` 过弱。建议加 `express-rate-limit` + 登录失败锁定 + 强密码策略。
4. **WebSocket 权限**：`back/src/socket/arena-realtime.js:11-24` token 走 URL query（日志/代理可泄露）；且连接后**不校验用户是否属于该对局**——任何已登录用户可订阅任意 `sessionId` 的对局状态广播（IDOR 信息泄露）。建议 token 改 header/首帧鉴权、连接时校验 session 成员关系。
5. **JWT 兜底密钥**：`back/src/config/index.js:33 jwt.secret: requireProductionEnv('JWT_SECRET', 'dev-jwt-secret')`——开发环境弱密钥可接受，但上线须确认 `NODE_ENV=production`（线上 `/api/health` 正常返回，但无法从仓库确认线上环境变量，需运维核对）。
6. **CORS**：生产默认 `false`（`config/index.js:44-60`）✅ 正确。
7. **上传目录公开**：`/uploads/avatars` 静态公开（`app.js:26`），头像本应公开可接受；但注意 multer 无文件名注入风险（服务端生成随机名 ✅）。

### 6.7 其他文案与数据问题 —— 🟡 低

- 「统一资金账户」（`pages/home/index.wxml:72`）是金融账户术语，建议改为「锦鲤币账户」。
- 首页余额绑定字段缺失：`pages/home/index.wxml:76` 使用 `{{balanceAmountText}}`，而 `home/index.js` 只 setData 了 `balanceText`（同样问题见 `income/index.wxml:43`）——上线前 UI 自查时一并修复（非合规项，但审核员看到空白资产卡会质疑页面质量）。
- 景区素材文件名错位（长城配富士山视频，`constants.js:117,121` 等）——内容审核时若抽查到「名实不符」会降低可信度。

---

## 七、风险清单汇总（按优先级）

| # | 问题 | 等级 | 位置 | 处置 |
|---|---|---|---|---|
| 1 | 游戏类目资质：普通小程序卖虚拟道具/金币，无版号/文网文，支付必须走虚拟支付 | 🔴 | project.config.json:155；shop/index.js:12；wechat-pay-service.js | 产品决策：去支付化 or 小游戏+版号+虚拟支付 |
| 2 | 服务器在海外（US IP），域名无法 ICP 备案，request/socket 合法域名必失败 | 🔴 | 线上实测 198.0.19.87 | 迁移大陆云+备案 |
| 3 | 福袋=付费金币随机盈亏（-82%~+72%），无概率公示，涉赌 | 🔴 | investment.js:35-39,118-136；arena/index.js:822,872 | 改确定性结算或去支付化+概率公示+风险声明 |
| 4 | 比特币/真实证券行情做「投资」玩法（虚拟货币红线+金融违规） | 🔴 | investment.js:1-7；fortune-reality-service.js:9-105 | 删除加密币品类，改虚构题材 |
| 5 | 无隐私政策/用户协议页面与弹窗，静默登录无告知同意，MP 隐私指引待配置 | 🔴 | runtime-config.js:5-6；boot/index.js:19-21 | 建协议页+前置同意+MP 后台配置 |
| 6 | 无实名认证/防沉迷/未成年人保护（游戏+付费硬性要求） | 🔴 | 全项目缺失 | 接入实名/防沉迷或去付费+适龄提示 |
| 7 | iOS 无支付分流，虚拟道具付款双违规 | 🔴 | shop/index.js（无 platform 判断） | iOS 隐藏支付入口 |
| 8 | `back/.env`（AppSecret/JWT/DB/管理员密码）已提交 git | 🔴 | back/.env（git 跟踪） | 轮换全部密钥+移除+清历史 |
| 9 | 昵称/头像 UGC 无 msgSecCheck/imgSecCheck，无举报投诉机制 | 🟠 | user.js:64-71；routes/user.js:20-30 | 接内容安全 API+举报入口 |
| 10 | 福袋在联机对局中客户端本地记账，金币账本可篡改 | 🟠 | arena/index.js:822-875 | 服务端化结算 |
| 11 | 支付回调未校验金额/时间戳新鲜度；平台证书静态配置 | 🟠 | wechat-pay-service.js grantPaidOrder/verifyNotificationSignature | 补齐校验+证书自动轮换 |
| 12 | WS token 走 query 且不校验对局成员身份（IDOR） | 🟠 | arena-realtime.js:11-24 | header 鉴权+成员校验 |
| 13 | 管理后台登录无频率限制、示例默认密码过弱 | 🟠 | admin/auth.js:31-66；.env.example:22 | rate-limit+强密码 |
| 14 | 广告法绝对化用语（「最凶/最完整/极其」） | 🟡 | shop-store.js:251,273,429 | 改写文案 |
| 15 | 真实景区名+虚构「收益+150%/在线4.2k」数据 | 🟡 | constants.js STAGES；home/index.wxml:122-130 | 改虚构地名/删虚构数据 |
| 16 | 「去群里邀请」「试试手气」「红包」等措辞 | 🟡 | room/index.wxml:76；share-config.js:50；arena/index.js:951 | 改写 |
| 17 | 支付横幅暴露「微信支付未开启/联调」内部信息 | 🟡 | shop/index.js:127-130,162-165 | 改消费者文案/隐藏 |
| 18 | 无客服/退款渠道；sitemap 全 allow；AppID 文档不一致 | 🟡 | 多处 | 见 6.4/6.5/6.6.2 |
| 19 | 分享路径携带昵称明文 | 🟡 | share-config.js:41-42 | 去昵称参数 |
| 20 | AI 行情摘要未标识 AI 生成（接口已返回 report） | 🟡 | fortune-reality-service.js:735-755 | 展示前加「AI 生成」标识 |

---

## 八、上线前检查清单（Checklist）

**资质与备案（MP 后台）**
- [ ] 确定类目路线（去支付化 / 小游戏+版号+虚拟支付），取得版号/软著/文网文
- [ ] 小程序备案完成并取得备案号
- [ ] 服务器迁至中国大陆并完成域名 ICP 备案；配置 request/uploadFile/socket 合法域名（xcx.ukb88.com，HTTPS/WSS）
- [ ] 配置《用户隐私保护指引》并声明昵称/头像/openid
- [ ] 接入实名认证/防沉迷（若保留付费）

**产品与内容**
- [ ] 福袋玩法合规改造（确定性结算 或 概率公示+去支付化+风险声明）
- [ ] 删除比特币/加密货币与真实证券标的；「收益」改「积分加成」
- [ ] 商品文案去绝对化用语；删除「红包/手气/去群里」措辞；隐藏支付横幅内部信息
- [ ] 景区改名或取得授权；删除虚构收益/在线数据；核对素材版权

**工程与安全**
- [ ] 轮换并移除 `back/.env` 中的全部密钥，仓库历史清理
- [ ] 昵称/头像接入 msgSecCheck/mediaCheckAsync，加举报入口
- [ ] 福袋结算服务端化；WS 鉴权改造；支付回调金额/时间戳校验；admin 登录限流
- [ ] 用户协议/隐私政策页面上线并在登录前展示
- [ ] 真机开启域名校验的体验版全流程回归（登录→房间→对局→支付→结算）
- [ ] 核对线上 `NODE_ENV=production`、JWT_SECRET 为强随机值、pay_enabled 初始 false

> 本报告由代码静态审查 + 线上实测生成，供上线前整改参考；涉及平台后台的实际配置项（类目、备案、域名白名单、隐私指引）请以微信公众平台后台为准。
