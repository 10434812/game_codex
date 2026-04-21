# 页面布局硬规则

## 目标
后续任何页面修改，主内容**不得进入头部安全区**，不得与系统胶囊/状态栏重叠。

## 强制结构（所有页面）
每个页面根节点必须遵循以下顺序：
1. `global-bg-image`
2. `app-header`（带 `padding-top: {{nav.statusBarHeight}}px` 与 `padding-right: {{nav.capsuleSpace}}px`）
3. `page-content`（页面主内容容器）

示例：
```xml
<view class="paper-bg xxx-page">
  <image class="global-bg-image" ... />
  <view class="app-header" style="padding-top: {{nav.statusBarHeight}}px; padding-right: {{nav.capsuleSpace}}px;">...</view>
  <view class="page-content">...</view>
</view>
```

## 禁止事项
- 禁止删除 `app-header` 后直接放主内容。
- 禁止给主标题使用负 `margin-top` 或绝对定位顶到页面最上方。
- 禁止把页面第一块业务内容放在 `app-header` 之前。

## 自检清单（提交前）
- iPhone 刘海屏下，主标题首行不与状态栏/胶囊重叠。
- `app-header` 存在且可见。
- 主内容都在 `page-content` 内。
