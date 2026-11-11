# 工作流约定

## 音频管理

- 通过 `utils/audio.js` 管理，暴露 `playCue`, `playStageBgm`, `stopBgm`, `playVibrate`
- 音频源全部为远程 URL（`https://xcx.ukb88.com/assets/audio/...`）
- 全局 BGM 在 `app.js` 的 `onLaunch`/`onShow` 中自动播放

## 用户资料

- 使用新版头像昵称填写能力：`open-type="chooseAvatar"` + `input type="nickname"`（**不要用**已废弃的 `wx.getUserProfile`）
- 缓存于 `wx_user_profile_v1` key

## CSS 设计风格

- 东方纸张主题：主色橘黄 `#e57c1f`，米纸黄背景 `#f6ebd1`
- 使用 CSS 变量（`--bg-base`, `--red-primary` 等），定义在 `app.wxss`
- 头像外框通过 `--avatar-ring-*` 变量统一定义

## Git 与工作区

- `.gitignore` 忽略 `node_modules/`、`.DS_Store`、`back/.env`（含密钥，禁止提交；模板 `back/.env.example`）
- AppID: `wxd7f500f3f21f15dd`
- libVersion: `3.4.0`
- `project.config.json` 中 `compileType: "miniprogram"`
- `project.config.json` 的 `packOptions.ignore` 排除了 `tests/`、`docs/`、`back/`、大部分 `assets/` 子目录
- 仓库结构：小程序根目录 + `back/`（后端+管理后台）在同一仓库
