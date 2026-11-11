# 维护模式（Maintenance Mode）接线说明

> 后端配置接口已可用；小程序端消费由前端代理负责（见任务 6「与前端代理 C 配合」）。

## 配置项

维护模式由 `system_configs` 表中的两个 key 控制（管理后台「系统配置」页可直接修改）：

| config_key | 类型 | 说明 |
|---|---|---|
| `system.maintenance_mode` | boolean (`0`/`1`) | `1` = 开启维护模式 |
| `system.maintenance_message` | text | 维护提示文案（如「系统维护中，预计 2 小时后恢复」） |

默认值由 `back/sql/003_admin_features.sql` 种子数据提供（`0` / 空）。

## 公开配置接口

小程序/前端通过 **`GET /api/configs/public`**（无需登录）读取维护状态，
实现位置：`back/src/routes/configs.js` → `admin-config-service.getPublicConfigs()`。

返回结构（节选）：

```json
{
  "code": 0,
  "data": {
    "configs": { "...": "..." },
    "features": {
      "maintenance": {
        "enabled": false,
        "message": ""
      },
      "wechat": { "loginEnabled": true, "shareEnabled": true, "payEnabled": false },
      "fortune": { "realityEnabled": true, "signalLimit": 6 }
    }
  }
}
```

小程序端已封装：`utils/runtime-config.js` 的 `fetchRemoteConfig()` 会拉取该接口，
`getFeatures().maintenance` 即为维护状态对象。

## 建议的消费行为（前端代理实现）

1. `app.js onLaunch` / `onShow` 拉取 `fetchRemoteConfig()`，读取 `features.maintenance.enabled`；
2. 为 `true` 时：全屏展示 `maintenance.message`（为空则用默认文案），阻断业务请求/页面跳转；
3. 恢复 `false` 后自动回到正常流程。

## 后端现状（本次已确认可用，未做额外修改）

- 接口已存在且返回维护状态：`GET /api/configs/public` ✅
- 管理后台可编辑：系统配置页 `system.maintenance_mode` / `system.maintenance_message` ✅
- 注意：后端目前不在业务接口上强制 503（除白名单外的统一拦截属安全/网关层决策，见分析报告 2.8 建议）。
