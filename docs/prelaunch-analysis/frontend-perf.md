# 锦鲤前程 · 前端性能与流畅度分析报告（上线前）

> 分析范围：`pages/`、`utils/`、`app.js`、`app.wxss`、`project.config.json`
> 分析方法：逐文件阅读全部 8 个页面与 24 个工具模块的源码，对 CDN（https://xcx.ukb88.com/）上被引用的资源做了可达性、体积、缓存头实测，并用 Node 对 arena 每 tick 的计算量做了基准测量。
> 风险等级：🔴 高 / 🟠 中 / 🟡 低
> 基线：`npm test` 178/178 通过（tests 目录不参与本次分析结论）。

---

## 0. 总结论

整体代码质量中等偏好：定时器清理、setData 防重（签名比较）、CSS 动画为主的实现都是加分项；主包体积约 600KB，远低于 2MB 限制，CDN 静态资源缓存策略（30 天 max-age + ETag + CORS）健康。

**但存在 3 个上线前必须处理的问题（🔴）：**

1. **对局期间每秒 2 次同步存储写入**（game-store 的 `savePersistedState` + arena 页 `saveStageTheme`），叠加每秒 2 次全状态 JSON 深拷贝（局末单次序列化达 78KB），是主线程卡顿的最大来源。
2. **离开对局页后游戏仍在后台跑完**：arena 页切底部导航到首页/房间后，`game-store` 的 1s 定时器继续运行 180 秒（每秒写存储），最后还会静默结算奖励，用户毫无感知。
3. **西湖/鼓浪屿两个景区的背景 PNG 分别为 2.6MB / 3.8MB**，结算页全屏加载；结算页还引用了一个根本不存在于包内的本地图片 `result-koi.png`（锦鲤特效图 404）。

---

## 1. 页面加载性能

### 1.1 🔴 boot-loader 预加载清单不完整：真正的"大图"都没预加载

**位置**：`utils/boot-loader.js:3-23`（清单）、`utils/constants.js:45-236`（景区配置）

**代码证据**：

```js
// utils/boot-loader.js:10-13
const stageImages = [DEFAULT_STAGE, ...STAGES.slice(1)]
  .filter((stage) => stage.image && !stage.video)   // 7 个景区全都有 video → 结果为空
  .map((stage) => stage.image);
```

- 7 个景区**全部同时配置了 image 和 video**（`constants.js:53-54` 等），所以 `getRemoteBootAssets()` 里景区图片**一项都不会预加载**。
- 结果页背景只显示 `stageImage`（`pages/result/index.wxml:21`）。当用户在**西湖夜游（xihu.png，2.63MB）**或**鼓浪屿（gulangyu.png，3.78MB）**结算时，结算页首屏要现拉一张 2.6~3.8MB 的 PNG，弱网下白屏数秒。
- nav 图标是 SVG（`boot-loader.js:32-35` 直接跳过），头像池 12 张（`constants.js:286-289`）、商品图、福袋图（`investment.js:10-14`，每张 300~625KB）均未预加载，全部是"用到才下载"。

**修复建议**：
1. 在 boot 阶段把当前选中景区的**结算背景**按需预加载（或直接换成视频同源截图）；至少把 xihu/gulangyu 两张大图替换为 JPG/WebP（见 1.3）。
2. 头像池 12 张 PNG 体积小（75~91KB），建议加入 boot 队列，避免对局页首次进场的批量加载。
3. 福袋图标（fortune-*.png，见 1.3）应加入预加载或先压缩。

### 1.2 🟠 启动视频 `muted="{{false}}"`：iOS 无法自动播放（启动动画可能不播）

**位置**：`pages/boot/index.wxml:7`

```xml
<video class="boot-video" src="{{bootVideoSrc}}" autoplay muted="{{false}}" ...></video>
```

微信小程序 iOS 端**带声音的视频禁止自动播放**（需用户手势）。当前启动视频是"有声 + autoplay"，在 iPhone 上大概率无法自动起播，整个 Boot 动画（4 个压缩版 MP4，602~850KB）可能静默失败，只剩进度条。

**修复建议**：启动视频改为 `muted`（微信官方规范：启动页视频必须静音才能自动播放）；如需声音，改为用户在页面首次点击后播放，或直接去掉声音。

### 1.3 🔴 图片资源体积严重超标，全站无 WebP/压缩管线

**实测数据**（本地文件与 CDN 响应体一致，`content-length` 实测）：

| 资源 | 实际尺寸 | 体积 | 使用场景 |
|---|---|---|---|
| `assets/stages/xihu.png` | — | **2.63 MB** | 结果页全屏背景（西湖） |
| `assets/stages/gulangyu.png` | 1074×1800 | **3.78 MB** | 结果页全屏背景（鼓浪屿） |
| `assets/iocns/fudai.png` | 2141×1957 | **4.32 MB** | 当前无代码引用（死资源，见 1.6） |
| `assets/bg/gamebg-compressed.png` | 576×1032 | **691 KB** | arena/room 页全局背景，**每局都加载** |
| `assets/battle/fortune-fangchan.png` | 590×699 | **625 KB** | 福袋图标，显示尺寸约 120rpx |
| `assets/skins/skin-01~21.png` | 640×640 | **570~660 KB/张** | 商城皮肤（15 张 ≈ 9MB） |
| `assets/avatar-rings/avatar_ring_*.png` | — | **655~957 KB/张** | 商城光环（7 张 ≈ 5.6MB） |
| `assets/111/pets/*.png` | — | **285~429 KB/张** | 商城宠物（12 张 ≈ 3.8MB） |
| `assets/iocns/map1.png` | 1420×766 | 1.38 MB | 当前无代码引用（死资源） |
| `assets/bg/screen.png` | 768×1376 | **1.2 MB** | 分享卡片图（runtime-config.js:12） |
| 其他 5 景区 jpg | — | 57~95 KB | ✅ 这 5 张是健康范本 |

对典型低端机（4G 网络 + 中端 Android）的影响：
- **商城页首屏**：皮肤分类 15 张商品图 ≈ **9MB** 全部同时发起（无 lazy-load，见 1.5），首屏可感知卡顿；
- **arena 页**：背景 gamebg-compressed.png 691KB + 舞台视频（334~745KB）+ 10 张头像（75~91KB），开局流量约 2MB；
- CDN 无任何 webp 版本（实测 `.webp` 后缀全部 404），也无图片处理中间件。

**修复建议**：
1. 全部展示图统一转 **WebP（质量 80）**：640×640 的皮肤 PNG 可压到 50~80KB，体积降 80%+；全屏背景转 JPG/WebP（≤300KB）。
2. 福袋图标这类小尺寸展示图压到 ≤50KB。
3. 启动/分享图单独裁剪：分享图按微信建议做 5:4 裁切且 ≤128KB（当前 1.2MB 可能直接被微信平台拒绝展示）。
4. 建议在 `scripts/` 增加一条 `image:compress` 脚本把 `assets/` 批量转 webp 并同步上传 CDN（注意 `constants.js` / `shop-store.js` 中的 URL 要成对改）。

### 1.4 🟡 onLoad/onShow 同步阻塞盘点（getStorageSync 情况总体良好）

**结论**：没有出现"onLoad 里成串 getStorageSync + 大对象解析"的典型问题。各页 onLoad 只做 `getNavLayout()`（含 2 次系统 API）+ setData，符合规范。

需要关注的两点：
- **`shop-store.js` / `player-stats.js` 无内存缓存**：`getStoreState()`（`shop-store.js:530-532`）、`getSummary()`（`player-stats.js:71-78`）、`getEquippedDisplay()`（`shop-store.js:664+`）每次调用都 `wx.getStorageSync` 全量读 + normalize + `JSON.parse(JSON.stringify())` 深拷贝。records 上限 120/200 条，`home` 页每次 onShow 都会触发（`pages/home/index.js:222-232`）。当前数据量下毫秒级，可接受；但记录会随游玩次数累积到上限，建议加"模块内缓存 + 脏标记"。
- **每个页面 onShow/onLoad 都同步写一次 stage theme**：`saveStageTheme()`（`stage-theme.js:57-65`）内含 `wx.setStorageSync(STAGE_THEME_STORAGE_KEY, ...)`，被 home/room/arena/result/shop/profile/income 6 个页面在 onShow 时无条件调用。数据本身约 1KB，频率低，风险小；但建议改为"值变化才写"。

### 1.5 🟠 全站 26 处 `<image>` 无 lazy-load；商城长列表无 scroll-view

**证据**：`grep -rn "lazy-load" pages/` 结果为空。`pages/shop/index.wxml:83` 的商品网格是普通 `view` 列表（34 个商品卡片 + 34 张远程大图），全部随页面一次性渲染/下载。

**修复建议**：
1. 给列表类图片加 `lazy-load="{{true}}"`（商城商品图、income 明细、result 排行头像）。
2. 商城页把商品网格放进 `scroll-view`（页面其他部分不动），或对商品图做"先占位色块、加载完成再显示"。

### 1.6 🟡 死资源与 CDN 目录冗余（不阻塞，但建议清理）

- `fudai.png`（4.32MB）、`map.png`、`map1.png`（1.38MB）、`hongbao1_副本.png` 等**没有任何代码引用**，白白占用 CDN 空间和首屏心智（若未来被引用将直接踩 1.3 的坑）。
- 本地目录拼写为 `assets/iocns`（应为 icons），而 home 页引用的是 `/assets/icons/koi-coin.svg`（`pages/home/index.wxml:74`，CDN 实测 200 OK）。线上同时存在 `iocns` 与 `icons` 两套目录，维护易出错。

### 1.7 🟡 CDN 配置实测健康，但"合法域名"需人工确认

实测结论（curl）：
- 所有被引用资源均 200，`Cache-Control: max-age=2592000`（30 天）+ ETag + Accept-Ranges + `Access-Control-Allow-Origin: *`，nginx 服务，配置健康 ✅。
- 无 gzip/brotli 对 PNG/MP3 收益有限，可忽略。

**上线前必须人工确认**（无法从代码仓库验证）：
- 微信公众平台后台已配置 `request 合法域名` / `downloadFile 合法域名` / `uploadFile 合法域名` = `https://xcx.ukb88.com`；
- `socket 合法域名` = `wss://xcx.ukb88.com`（arena 实时对战用到，`pages/arena/index.js:67-78`）；
- 注意 `project.config.json` 中 `urlCheck: false` **只对开发者工具生效**，线上环境照样校验域名白名单。

---

## 2. 渲染性能

### 2.1 🔴 arena 对局页 1s tick：每秒 2 次同步存储写 + 2 次全状态深拷贝

**位置**：`utils/game-store.js:121-127, 408-476`（tick）+ `pages/arena/index.js:416-418`（syncArena）

**代码证据**：

```js
// game-store.js:121-127 每秒一次
timer = setInterval(() => { tick(); }, 1000);
// game-store.js:473   tick 内每秒一次同步写
savePersistedState();
// game-store.js:100-107 emit → getState → clone（每秒一次全量深拷贝）
const snapshot = getState();  // clone = JSON.parse(JSON.stringify(state))

// arena/index.js:417-418 每秒 tick 到达后：
const stage = resolveStage(state.stage || gameStore.getState().stage || DEFAULT_STAGE); // 又克隆一次全状态
const theme = saveStageTheme(stage);   // 又写一次同步存储（setStorageSync）
```

每秒的完整账单：
1. `savePersistedState()` — `wx.setStorageSync` ×1
2. `saveStageTheme()` — `wx.setStorageSync` ×1
3. `clone(state)` ×2 — 局末 state 含 scoreLog（60 轮 × 10 人 × 2 条 ≈ 1200 条记录），**单次序列化实测 78KB**，即每秒 156KB 的 JSON stringify+parse

Node 基准实测（10 人局、scoreLog 满负荷）：纯计算部分 p95 仅 0.55ms（桌面机），但 `wx.setStorageSync` 在低端 Android 上单次可达 1~5ms，**每秒 2 次同步存储写 + 2 次 78KB 深拷贝才是主线程卡顿主因**，尤其在手机发热/低电量时。

**修复建议**（按性价比排序）：
1. `saveStageTheme` 移出 tick：在 `syncArena` 中**只在 stage 变化时调用**（或直接删掉，arena 页根本不需要回写主题，是 room/home 需要的）。
2. `savePersistedState` 从"每秒"降为"每 5~10s 一次 + `onHide`/`onUnload` 强制写一次"；或改用 `wx.setStorage`（异步版）。
3. `syncArena` 里 `state.stage || gameStore.getState().stage` 改成 `state.stage || this.lastStage || DEFAULT_STAGE`，去掉第二次全状态克隆。
4. 若继续保留"每 tick 全量克隆"，可只序列化 `players/teams/round/timeLeft/scoreLog` 的轻量投影，或让 `emit` 传引用 + 页面自己按需深拷贝。

### 2.2 🟢 setData 频率与数据量：防重机制做得好，值得肯定

- `pages/arena/index.js:454-488`：tick 每秒只 patch `timeText`（1 个字段），players/teamLinks 用 `JSON.stringify` 签名比较**只在变化时 setData**（每 3s 一轮，players ≈ 3.3KB / 10 人）。✅ 这是正确的写法。
- `pages/room/index.js:344-349`：轮询结果也用 `JSON.stringify` 比较后才 setData。✅
- 问题点：
  - **🟡 `setPlayerEmote` 全量重设 players**（`arena/index.js:563-577`）：每个表情出现/消失（2.2s 后）都会把 10 人数组整体 setData 一次，远程表情每 8~14s 触发一次。建议只 patch 对应 `players[i].emoteText`。
  - **🟡 result 页数字滚动用 JS setInterval 驱动 setData**（见 2.4）。
  - **🟡 arena `onHide` 里对已隐藏页面 setData**（`arena/index.js:203-211, 630-634`），纯浪费，可去掉。

### 2.3 🟠 arena 背景视频叠加全屏 blur 滤镜：GPU/电池压力

**位置**：`pages/arena/index.wxss:10-15`、`pages/arena/index.wxml:21-34`

```css
.arena-page .scene-backdrop-video {
  transform: scale(1.08);
  filter: blur(9rpx) saturate(0.96) brightness(0.86);  /* 全屏视频每帧做 blur */
}
```

对局 180 秒内，全屏循环视频（334~745KB mp4）+ 每帧 `filter: blur` + `backdrop-filter` 遮罩（`arena-scene-mask`）同时在渲染。中低端机长时间运行会掉帧/发热。同样问题存在于 room 页（`room/index.wxss` 同类背景层）。

**修复建议**：把模糊效果"烘焙"进视频本身（导出时加模糊），运行时去掉 `filter: blur`；`backdrop-filter` 在低端机型上考虑降级为纯半透明遮罩（用 `@supports` 或平台判断）。

### 2.4 🟠 result 页数字滚动：40ms/50ms 双 setInterval 驱动 setData

**位置**：`pages/result/index.js:332-359, 468-469, 505-506`

```js
const stepTime = duration / steps;          // 1200/30=40ms，1500/30=50ms
const timer = setInterval(() => { ... this.setData({ [stateKey]: formatFn(v) }); }, stepTime);
```

收益与经验两个数字**同时**滚动：1.5 秒内约 60 次 setData（每次 40/50ms），且 `easeOutExpo` 在 JS 里算。功能没问题，但属于"JS 驱动动画"的反面教材。

**修复建议**：
1. 步数 30 → 10~12（人眼对 40ms 与 120ms 步进的数字滚动几乎无感）；
2. 或改用 WXS 响应式动画 / CSS `transition` 数字翻牌组件；
3. `onShow` 重入时（从 profile 返回）会再次从 0 滚动，建议记住 `lastPlayedResultId` 的同时跳过重复滚动动画。

### 2.5 🟢 WXML 表达式复杂度：总体可控

- 大量 `{{ a ? b : c }}`、`{{a || b}}`、字符串拼接（如 `arena/index.wxml:71-91`）属于轻量表达式，可接受。
- **🟡 `wx:key="index"` 两处误用**：`pages/room/index.wxml:52`（slots）与 `pages/result/index.wxml:139`（烟花粒子）——`wx:key="index"` 会被解析为"取 item 的 index 属性"，实际回退为用索引做 key，更新时可能整组重渲染。建议分别改为 `wx:key="name"`/`wx:key="*this"` 或显式 `wx:for-index`。
- `data-player="{{top3.second}}"`（result/index.wxml:34）每次点击把整个对象塞进 dataset 序列化，玩家对象小、无碍，属可接受写法。

### 2.6 🟡 对局页节点量与常驻动画

- 节点量：10 玩家 ×（玩家节点 + 名字层）≈ 20 个循环节点 + 5 条队伍连线 + 福袋（出现时 10+ 子节点）。总量不大，**无 scroll-view/虚拟列表需求**，✅。
- 常驻 CSS 动画：arena 页 11 个 `infinite` 动画（`bagHaloPulse`、`bagRipple`×2、`bagSpark*`×3、`self-avatar-pulse`、`petFloat` 等），其中 9 个属于福袋节点——福袋 `wx:if` 收起后不再渲染，问题不大；`self-avatar-pulse` + `petFloat` 全 180 秒常驻。🟡 建议低端机（`wx.getSystemInfoSync().benchmarkLevel < 20`）下关掉装饰性动画。
- 烟花粒子一次生成 4 组 × 8~13 粒子 ≈ 40~50 个 CSS 动画节点，一次性 1~3 波，量可接受 ✅。

---

## 3. 内存与定时器

### 3.1 🔴 离开对局页后 game-store 定时器继续跑完 180 秒

**位置**：`utils/game-store.js:21, 117-127`（模块级 timer）+ `pages/arena/index.js:1158-1177`（switchTab）

**代码证据**：`pages/arena/index.js:1176`：

```js
wx.redirectTo({url: page});   // 切到 home/room 时，没有 finishGame/stopTimer
```

`timer` 是模块级变量，只在 `createRoomFromStage/startGame/finishGame/resetToHome` 中 stop（`game-store.js:250, 311, 339, 567`）。用户在 arena 点底部"探索/社交"切走 → arena 页 onUnload 清的是**页面自己的**定时器，game-store 的 1s tick **继续运行**：每秒写存储、每 3s 结算一轮、180 秒后 `finishGame()` 静默发金币 + 记录战绩。用户以为自己退出了，后台却在"代打"。

**修复建议**：在 arena 页 `switchTab`（非 result 目标）与 `onUnload` 时调用 `gameStore.finishGame()` 或新增 `gameStore.pauseGame()`（停止 timer 并持久化，回场时恢复）；同时在 `app.js` 加 `wx.onAppHide` 停止 tick、`onAppShow` 恢复。

### 3.2 🟠 BGM 不随小程序退后台暂停；无 app 级音频生命周期管理

**位置**：`app.js:1-23`（只有 onLaunch/onShow，无 onHide/onAppHide）、`utils/audio.js:146-158`

- 小程序切后台时 BGM（InnerAudioContext, `loop=true`）可能继续播放（Android 尤其明显），iOS 由系统挂起。`stopBgm()` 全项目只在 `pages/result/index.js:234` 被调用。
- `duckBgmForVoice` 里 2600ms 恢复定时器（`audio.js:215-220`）在 `destroy()` 时未清理，属微小泄漏。

**修复建议**：`app.js` 增加 `onHide(){ audio.stopBgm(); }` / `onShow(){ ...恢复 }`；`audio.destroy()` 中维护并清理 duck timer。

### 3.3 🟡 audio 错误后静默失效（sharedAudio 引用未重置）

**位置**：`utils/audio.js:121-131, 138-144`

```js
audio.onError(() => { audio.stop(); audio.destroy(); });  // 销毁了实例
...
if (!sharedAudio) sharedAudio = createAudio();            // 但 sharedAudio 仍指向已销毁对象
```

`sharedAudio` 被销毁后变量仍非空，后续 `playCue` 会操作已 destroy 的 context（被 try/catch 吞掉），**点击音效从此静默失效直到重启小程序**。属健壮性问题：应在 onError 中把对应引用置空。

### 3.4 🟢 arena/room 页面定时器清理盘点：整体合格 ✅

逐项核对 `pages/arena/index.js:196-223`（onHide/onUnload）：`arenaPollTimer`、`arenaRealtimeFallbackTimer`、`inviteTimer/successTimer`、`bagSpawnTimer/bagExpireTimer/bagCountdownTimer`、`fortunePanelPhaseTimer/CloseTimer`、`emoteTimerMap`、`remoteEmoteTimer` 均有清理，且轮询带 `_pollSeq` 防串台（`room/index.js:333-336`）✅。仅 `arena/index.js:1143-1146` 引用了一个从未被赋值的 `this.unsubscribe`（死代码，实际订阅挂在 `storeUnsubscribe` 上），建议删除防混淆。

### 3.5 🟡 对局中切后台：计时"冻结"但不销毁，回场继续

JS 被系统挂起后 `setInterval` 暂停，恢复后从原地继续——`timeLeft` 实际不会在后台流失。这是可接受行为（变相防挂机扣时），但恢复时**没有时间补偿机制**，若产品预期"后台也计时"则需要 `onAppShow` 时用时间戳校正。当前实现不校正，请在 PRD 层面确认意图。

---

## 4. 包体积

### 4.1 🟢 主包现状健康，但无分包规划

- `app.json` 无 `subpackages` 字段：8 个页面全在主包。实测主包内容（`pages/` 332KB + `utils/` 168KB + app.* ≈ **520KB**，加 packOptions include 的 72KB ≈ **600KB**），远低于 2MB ✅。
- 由于 `packOptions.ignore` 把 `assets/` 整目录排除，**大图/音频全部走 CDN，不进包** —— 这是本报告唯一"完全没有问题"的模块 ✅。
- 建议：预留 `"lazyCodeLoading": "requiredComponents"` 减少启动期 JS 注入；若后续页面增长，把 shop/income/profile 拆到分包。

### 4.2 🔴 结算页锦鲤特效引用不存在的包内图片（上线即 404）

**位置**：`pages/result/index.wxml:151-152` vs `project.config.json` packOptions.include

```xml
<image class="koi-fish ..." src="/assets/iocns/result-koi.png" mode="aspectFit"></image>
```

- `packOptions.include` 声明要打包 `assets/iocns/result-koi.png`，但**该文件在磁盘上根本不存在**（全仓库检索无结果，仅有 `2657.png_300.png`）。
- 结果：锦鲤第一名特效里的两条鱼（koi-fish-left/right）**渲染为空/404**。虽是"第一名"分支，但这是产品的最高光时刻。

**修复建议**：补一张小尺寸锦鲤 PNG（建议直接远程 CDN 化，或压到 ≤20KB 放包内），并修正 `packOptions.include`。

### 4.3 🟡 包内垃圾：未引用的图片与残留配置文件

- `assets/iocns/2657.png_300.png`（72KB，260×260）通过 include 进包，但**无任何代码引用** → 纯死重。建议从 include 中移除。
- `pages/project.config.json`（1.8KB）+ `pages/project.private.config.json`（322B）残留在 pages/ 目录内，会被一起上传进包。建议删除或加入 ignore。
- `project.config.json` 中 `"uploadWithSourceMap": true`：线上包附带 sourcemap（体积 + 源码泄露）。建议置 false。
- `packOptions.ignore` 中 `assets/stages/gulangyu.mov`、`xihhu.mov` 等条目指向不存在的文件（实际是 .png/.mp4），属无效配置，建议清理以免误判。

---

## 5. 交互流畅度

### 5.1 🟢 动画实现方式以 CSS 为主 ✅

arena/result/home/room 的入场、连线、福袋、烟花、光环均为 WXSS `animation/@keyframes`（arena 30 个 keyframes、result 21 个），走合成器、不阻塞 JS —— 实现方式正确。唯一的 JS 驱动动画是 result 数字滚动（见 2.4）。

### 5.2 🟡 震动频率偏高

`playVibrate` 几乎绑定在每个点击上（tab 切换、头像、商品、表情），result 页一次结算还有 `heavy`（烟花）+ `heavy`（锦鲤）+ `medium`（再来一局）连续触发（`result/index.js:369, 420, 511`）。Android 部分机型马达执行 `heavy` 有明显顿挫。

**修复建议**：`audio.js` 的 `playVibrate` 内加 300~500ms 全局节流；`heavy` 仅在锦鲤/冠军场景保留一次。

### 5.3 🟠 音效与语音叠加密度（对局页）

一轮事件触发链：`playCue`（wav）+ `playVoice`（mp3，带 BGM ducking）同时放；倒计时 3s 每秒 cue+voice 双发（`room/index.js:216-225`）。多 InnerAudioContext 并发在低端机会有抢声道/延迟。当前实现有 `debounceMs` 防重（`audio.js:256-261`）✅，但 cue 无防重。建议 cue 加 200ms 级 debounce。

### 5.4 🟡 长列表实现（可接受，给出建议）

- income 明细（最多 50 条）、result 排行（10 条）、shop 商品（34 条）均为普通 `view` 平铺 + 页面级滚动。**数据量小，可接受**；不建议为 50 条引入虚拟列表（复杂度不划算），但建议：
  1. 全部图片加 `lazy-load`（见 1.5）；
  2. income 页若后台 limit 放开到 200+，再考虑 `scroll-view` + 分页加载。

---

## 6. 修复优先级清单（上线前）

| # | 问题 | 风险 | 工作量 | 建议时间 |
|---|---|---|---|---|
| 1 | arena tick 每秒 2 次同步存储写（savePersistedState + saveStageTheme）+ 2 次全状态克隆 | 🔴 | 小（改 3 处） | 上线前 |
| 2 | 切底部导航离开 arena 后游戏后台跑完并静默结算 | 🔴 | 小（switchTab/onUnload 挂钩） | 上线前 |
| 3 | xihu/gulangyu 结算背景 2.6/3.8MB PNG → 压缩/转 WebP | 🔴 | 中（出图+改 URL） | 上线前 |
| 4 | result-koi.png 不存在（锦鲤特效 404） | 🔴 | 小（补图） | 上线前 |
| 5 | 启动视频 muted=false 导致 iOS 不自动播放 | 🟠 | 小 | 上线前 |
| 6 | 商城 9MB 商品图首屏无 lazy-load | 🟠 | 小 | 上线前 |
| 7 | 分享图 screen.png 1.2MB（微信可能拒展示） | 🟠 | 小（裁切 5:4） | 上线前 |
| 8 | BGM 退后台不暂停（app.js 无 onHide） | 🟠 | 小 | 上线前 |
| 9 | audio onError 后 sharedAudio 静默失效 | 🟡 | 小 | 上线前 |
| 10 | result 数字滚动 40ms setInterval ×2 | 🟠 | 小 | 上线后快速迭代 |
| 11 | 全站图片转 WebP 管线（福袋图/皮肤/光环/宠物） | 🟠 | 中 | 上线后 1 周内 |
| 12 | emote 全量 players setData / onHide setData | 🟡 | 小 | 随迭代 |
| 13 | wx:key="index" 误用、包内死重（2657.png、pages/project.config.json）、sourcemap 上传 | 🟡 | 小 | 随迭代 |
| 14 | 微信后台合法域名（request/downloadFile/uploadFile/socket）配置确认 | 🔴 | 0（人工确认） | 上线前 |
| 15 | app.json 加 lazyCodeLoading、分包规划 | 🟡 | 小 | 随迭代 |

---

## 附录 A：顺带发现的功能性缺陷（非性能，但影响上线体验）

1. **首页金币数永远不显示**：`pages/home/index.wxml:76` 绑定 `{{balanceAmountText}}`，而 JS 里 setData 的是 `balanceText`（`pages/home/index.js:47, 227`）——key 不匹配，金额恒为空。
2. **锦鲤特效图 404**（同 4.2）。
3. **崩溃恢复态不完整**：`game-store.js:65-75` 只恢复 roomId/stage/status/timeLeft/round，players/teams 为空；对局中强杀小程序后重启，arena 页会渲染空棋盘。
4. `pages/arena/index.js:1143-1146` 引用了从未赋值的 `this.unsubscribe`（死代码）。

## 附录 B：实测数据记录

- 全部引用资源 CDN 200；`Cache-Control: max-age=2592000`；CORS `*` ✅
- 10 人局 scoreLog 满载时单次 state 序列化 **78KB**；tick 纯计算 p95 0.55ms（桌面 Node，真机约 2~5×）
- 主包约 600KB（pages 332KB + utils 168KB + 杂项 + include 72KB）
- 图片格式统计：PNG 101 / SVG 28 / JPG 5，**WebP 0**
