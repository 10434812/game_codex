# game_codex

一个纯前端微信小程序对战 Demo，包含完整的单局流程：

- 首页选景区 -> 房间组人 -> 对局结算 -> 战绩展示
- 房间支持 4-10 人（不足自动补机器人）
- 对局固定 180 秒，按 2 人一队进行分数联动
- 本地商城（皮肤/宠物）与装备回显（仅作用于“我”的节点）

## 技术栈

- 微信小程序原生（`wxml` / `wxss` / `js`）
- Node.js 内置测试框架（`node:test`）
- 本地存储：`wx.setStorageSync` / `wx.getStorageSync`

## 页面路由

- `pages/home/index`：首页与景区选择
- `pages/room/index`：房间组队与邀请
- `pages/arena/index`：对局主战场
- `pages/result/index`：结算与排行
- `pages/profile/index`：头像昵称资料
- `pages/shop/index`：幸运金币商城

## 本地开发

1. 使用微信开发者工具打开项目根目录：
   - `/Users/hh/Desktop/game_codex`
2. 小程序 AppID 使用你自己的测试号或现有配置。
3. 编译后从首页进入完整流程。

## 测试

安装依赖后执行：

```bash
npm test
```

当前仓库测试覆盖：

- `tests/game-engine.test.js`
- `tests/game-store.test.js`
- `tests/shop-store.test.js`

## 目录结构

```text
.
├─ pages/                 # 各业务页面
├─ utils/                 # 游戏规则、状态管理、导航、音频、用户资料
├─ assets/                # 图片/音频等静态资源
├─ tests/                 # Node 单测
├─ docs/superpowers/      # 设计与实现文档
├─ app.json               # 小程序全局配置
├─ app.js                 # 小程序入口
└─ app.wxss               # 全局样式
```

## 核心模块说明

- `utils/constants.js`：规则常量（人数、时长、积分范围、景区、头像池等）
- `utils/game-engine.js`：纯规则层（创建玩家、补机器人、组队、回合结算、排行计算）
- `utils/game-store.js`：全局状态层（创建房间、开局、tick、结算、重开）
- `utils/shop-store.js`：商城状态与商品逻辑（购买、装备、持久化）
- `utils/user-profile.js`：用户资料缓存与更新
- `utils/nav.js`：状态栏/胶囊布局安全区计算

## 页面布局硬规则（必须遵守）

任何页面修改都必须确保主内容不进入头部安全区，不与状态栏/胶囊重叠。

每个页面根节点固定顺序：

1. `global-bg-image`
2. `app-header`（必须带 `padding-top: {{nav.statusBarHeight}}px; padding-right: {{nav.capsuleSpace}}px;`）
3. `page-content`（所有业务主内容必须在这里）

示例：

```xml
<view class="paper-bg xxx-page">
  <image class="global-bg-image" ... />
  <view
    class="app-header"
    style="padding-top: {{nav.statusBarHeight}}px; padding-right: {{nav.capsuleSpace}}px;"
  >
    ...
  </view>
  <view class="page-content">...</view>
</view>
```

禁止事项：

- 删除 `app-header` 后直接放主内容
- 主标题使用负 `margin-top` 或绝对定位顶到最上方
- 把第一块业务内容放在 `app-header` 之前

提交前自检：

- iPhone 刘海屏下主标题不与状态栏/胶囊重叠
- `app-header` 存在且可见
- 主内容都在 `page-content` 容器内
