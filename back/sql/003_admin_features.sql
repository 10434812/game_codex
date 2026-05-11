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
('system.maintenance_mode', '0', '维护模式(0=关闭,1=开启)'),
('system.maintenance_message', '', '维护提示消息')
ON DUPLICATE KEY UPDATE config_value = config_value;
