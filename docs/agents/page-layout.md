# 页面布局硬规则

> 适用范围：任何涉及页面（pages/）修改的任务，动手前必读。

## 目标

主内容**不得进入头部安全区**，不得与系统胶囊/状态栏重叠。
Boot 页面（启动页）除外：不受本规则约束，可含 app-header。

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

## 导航安全区（必须遵守）

每个页面的 `onLoad` 中必须调用 `getNavLayout()` 并将结果写入 `data.nav`：

```js
onLoad() {
  try {
    this.setData({nav: getNavLayout()});
  } catch (error) {}
}
```

WXML 中使用 `{{nav.statusBarHeight}}` 和 `{{nav.capsuleSpace}}` 给 `app-header` 做内边距。

`getNavLayout()` 返回：`{statusBarHeight, navHeight, capsuleSpace}`。

## 禁止事项

- 禁止删除 `app-header` 后直接放主内容。
- 禁止给主标题使用负 `margin-top` 或绝对定位顶到页面最上方。
- 禁止把页面第一块业务内容放在 `app-header` 之前。

## 自检清单（提交前）

- iPhone 刘海屏下，主标题首行不与状态栏/胶囊重叠。
- `app-header` 存在且可见。
- 主内容都在 `page-content` 内。
