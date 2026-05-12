-- ============================================================
-- 锦鲤前程 - 后台管理功能扩展表
-- MySQL 8.0, InnoDB, utf8mb4
-- ============================================================

-- 1. operation_logs: 后台操作审计日志
CREATE TABLE IF NOT EXISTS operation_logs (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '日志ID',
    admin_id        INT UNSIGNED    NOT NULL                    COMMENT '操作管理员ID',
    admin_name      VARCHAR(64)     NOT NULL                    COMMENT '管理员用户名',
    action          VARCHAR(64)     NOT NULL                    COMMENT '操作类型: create/update/delete/ban/login/etc',
    target_type     VARCHAR(64)     NOT NULL                    COMMENT '目标类型: user/item/game/room/admin/config/announcement',
    target_id       VARCHAR(64)     DEFAULT ''                  COMMENT '目标ID',
    detail          TEXT                                        COMMENT '操作详情(JSON格式)',
    ip_address      VARCHAR(45)     DEFAULT ''                  COMMENT '操作IP地址',
    created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '操作时间',
    INDEX idx_admin_id (admin_id),
    INDEX idx_action (action),
    INDEX idx_target_type (target_type),
    INDEX idx_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作日志表';


-- 2. announcements: 游戏公告
CREATE TABLE IF NOT EXISTS announcements (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '公告ID',
    title           VARCHAR(255)    NOT NULL                    COMMENT '公告标题',
    content         TEXT            NOT NULL                    COMMENT '公告内容',
    type            ENUM('system','event','maintenance','reward') DEFAULT 'system' COMMENT '公告类型',
    status          ENUM('draft','published','archived')        DEFAULT 'draft'    COMMENT '发布状态',
    priority        ENUM('low','normal','high','urgent')        DEFAULT 'normal'   COMMENT '优先级',
    created_by      INT UNSIGNED    NOT NULL                    COMMENT '创建人ID',
    published_at    DATETIME        NULL                        COMMENT '发布时间',
    created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    updated_at      DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_status (status),
    INDEX idx_type (type),
    INDEX idx_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公告表';


-- 3. system_configs: 系统配置(键值对)
CREATE TABLE IF NOT EXISTS system_configs (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '配置ID',
    config_key      VARCHAR(128)    NOT NULL                    COMMENT '配置键',
    config_value    TEXT            NOT NULL                    COMMENT '配置值',
    description     VARCHAR(255)    DEFAULT ''                  COMMENT '配置说明',
    updated_by      INT UNSIGNED    DEFAULT 0                   COMMENT '最后修改人ID',
    updated_at      DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY uk_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';


-- 4. shop_items: 商城道具管理(替代前端静态数据)
CREATE TABLE IF NOT EXISTS shop_items (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '商品ID',
    item_id         VARCHAR(64)     NOT NULL                    COMMENT '前端商品标识',
    name            VARCHAR(128)    NOT NULL                    COMMENT '商品名称',
    category        ENUM('skin','pet','effect','avatar_frame','title','lucky_bag') NOT NULL COMMENT '商品类别',
    price           INT UNSIGNED    NOT NULL DEFAULT 0          COMMENT '价格(金币)',
    rarity          ENUM('base','common','rare','epic','legendary') DEFAULT 'common' COMMENT '稀有度',
    theme           VARCHAR(64)     DEFAULT ''                  COMMENT '主题风格',
    description     TEXT                                        COMMENT '商品描述',
    image_url       VARCHAR(512)    DEFAULT ''                  COMMENT '图片URL',
    is_active       TINYINT(1)      DEFAULT 1                   COMMENT '是否上架',
    sort_order      INT             DEFAULT 0                   COMMENT '排序号',
    created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    updated_at      DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY uk_item_id (item_id),
    INDEX idx_category (category),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商城道具表';


-- ============================================================
-- 种子数据: 系统默认配置
-- ============================================================
INSERT INTO system_configs (config_key, config_value, description) VALUES
('game.round_duration', '180', '每局游戏时长(秒)'),
('game.min_players', '4', '最少开局人数'),
('game.max_players', '10', '最多玩家数'),
('game.team_size', '2', '每队人数'),
('game.initial_coins', '8820', '新用户初始金币'),
('game.daily_signin_coins', '200', '每日签到金币奖励'),
('shop.refresh_interval', '86400', '商城刷新间隔(秒)'),
('wechat.login_enabled', 'true', '是否开启微信登录'),
('wechat.login_app_id', 'wx72a4b552a87b44cf', '小程序 AppID（服务端登录校验使用）'),
('wechat.login_secret', '', '小程序 AppSecret（仅后台保存，不对前端公开）'),
('wechat.login_token_ttl', '604800', '登录态默认有效期（秒）'),
('wechat.login_agreement_url', 'https://xcx.ukb88.com/legal/user-agreement.html', '用户协议链接'),
('wechat.login_privacy_url', 'https://xcx.ukb88.com/legal/privacy-policy.html', '隐私政策链接'),
('wechat.share_enabled', 'true', '是否开启分享给好友 / 朋友圈'),
('wechat.share_title', '锦鲤前程邀你一起组队闯世界', '发送给好友默认标题'),
('wechat.share_desc', '选景区、组战队、拼手气，一起冲上好运榜。', '发送给好友默认描述'),
('wechat.share_path', '/pages/home/index', '发送给好友默认落地页路径'),
('wechat.share_query', 'from=admin_share', '发送给好友附加参数（不含 ?）'),
('wechat.share_image_url', 'https://xcx.ukb88.com/assets/bg/screen.png', '分享卡片图片 URL'),
('wechat.share_timeline_title', '锦鲤前程开启好运局，来和我一起冲榜', '分享到朋友圈标题'),
('wechat.share_timeline_image_url', 'https://xcx.ukb88.com/assets/bg/screen.png', '分享到朋友圈图片 URL'),
('wechat.pay_enabled', 'false', '是否开启微信支付能力'),
('wechat.pay_mch_id', '', '微信支付商户号 MchId'),
('wechat.pay_api_v3_key', '', '微信支付 APIv3 Key'),
('wechat.pay_cert_serial_no', '', '微信支付商户证书序列号'),
('wechat.pay_notify_url', '', '微信支付异步通知地址'),
('wechat.pay_success_path', '/pages/shop/index', '支付成功后的小程序回跳页面'),
('wechat.pay_currency', 'CNY', '支付默认币种'),
('wechat.pay_goods_desc', '锦鲤前程幸运金币充值', '微信支付下单默认商品描述'),
('wechat.pay_sandbox_mode', 'true', '是否启用微信支付沙箱模式'),
('system.maintenance_mode', '0', '维护模式(0=关闭,1=开启)'),
('system.maintenance_message', '', '维护提示消息')
ON DUPLICATE KEY UPDATE config_value = config_value;
