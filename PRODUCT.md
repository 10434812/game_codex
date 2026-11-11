# 锦鲤前程

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

微信内参与短时休闲对战的玩家；具体年龄和用户画像尚未确认。

## Product Purpose

在景区主题场景中参加 120 秒跑动接物对战，按个人积分排名，可邀请好友组队或保持独立。

## Operating Context

微信小程序与原生 Canvas2D 小游戏两种客户端。首页选景区、房间准备、对局、结算、复玩；另有商城、资料、每日任务与资产记录。

## Capabilities and Constraints

4–10 人对局；福袋 +10、礼物 +20、踩雷 −10；双方互选且碰面成队，靠近加速，队友联动一半积分。联机由服务端确认规则与奖励；本地体验与账号资产需明确区别。

页面保留微信状态栏、胶囊与底部手势安全区。小程序保持现有页面结构；小游戏保持 Canvas2D 技术栈。

## Brand Commitments

名称“锦鲤前程”。用户于 2026-11-06 明确要求按现有设计风格做设计预览；保留现有国风纸张、暖金色、景区与锦鲤主题。此次先提供预览，不将概念稿视为生产已实现。

## Evidence on Hand

pages/ 与 minigame/src/ 为当前实现；assets/ 与 assets-pkg/ 为既有资源。项目文档见 docs/agents/architecture.md。评估以源码为依据，真机视觉验收另行进行。

## Product Principles

- 对局操作与成绩信息优先。
- 主要操作清晰，次要功能可被找到。
- 保留游戏事实，不用装饰暗示尚不存在的能力或收益。
- 设计预览中的示例数据明确标注。
