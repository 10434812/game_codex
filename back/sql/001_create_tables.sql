-- ============================================================
-- 锦鲤前程 - 数据库表结构
-- MySQL 8.0, InnoDB, utf8mb4
-- ============================================================

-- 1. users: 微信小程序用户
CREATE TABLE IF NOT EXISTS users (
    id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '用户ID',
    openid      VARCHAR(64)     NOT NULL                    COMMENT '微信openid',
    nick_name   VARCHAR(64)     DEFAULT '微信用户'           COMMENT '昵称',
    avatar_url  VARCHAR(512)    DEFAULT ''                  COMMENT '头像URL',
    level       INT UNSIGNED    DEFAULT 1                   COMMENT '等级',
    total_exp   INT UNSIGNED    DEFAULT 0                   COMMENT '总经验值',
    total_income INT UNSIGNED   DEFAULT 0                   COMMENT '总收益',
    coins       INT UNSIGNED    DEFAULT 8820                COMMENT '幸运金币',
    game_count  INT UNSIGNED    DEFAULT 0                   COMMENT '对局次数',
    win_count   INT UNSIGNED    DEFAULT 0                   COMMENT '胜利次数',
    is_banned   TINYINT(1)      DEFAULT 0                   COMMENT '是否封禁',
    banned_reason VARCHAR(255)  DEFAULT ''                  COMMENT '封禁原因',
    created_at  DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    updated_at  DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY uk_openid (openid),
    INDEX idx_openid (openid),
    INDEX idx_created_at_desc (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';


-- 2. admins: 后台管理员
CREATE TABLE IF NOT EXISTS admins (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '管理员ID',
    username        VARCHAR(64)     NOT NULL                    COMMENT '用户名',
    password_hash   VARCHAR(255)    NOT NULL                    COMMENT '密码bcrypt哈希',
    role            ENUM('super','normal') DEFAULT 'normal'     COMMENT '角色: super=超级管理员, normal=普通管理员',
    is_active       TINYINT(1)      DEFAULT 1                   COMMENT '是否启用',
    last_login_at   DATETIME        NULL                        COMMENT '最后登录时间',
    created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员表';


-- 3. rooms: 游戏房间
CREATE TABLE IF NOT EXISTS rooms (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '房间ID',
    room_code       VARCHAR(10)     NOT NULL                    COMMENT '房间码(6位)',
    stage_id        INT UNSIGNED    NOT NULL                    COMMENT '景区ID',
    status          ENUM('waiting','playing','finished') DEFAULT 'waiting' COMMENT '房间状态',
    host_user_id    INT UNSIGNED    NOT NULL                    COMMENT '房主用户ID',
    max_players     TINYINT UNSIGNED DEFAULT 10                 COMMENT '最大玩家数',
    current_players TINYINT UNSIGNED DEFAULT 1                  COMMENT '当前玩家数',
    created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    finished_at     DATETIME        NULL                        COMMENT '结束时间',
    UNIQUE KEY uk_room_code (room_code),
    INDEX idx_status (status),
    INDEX idx_room_code (room_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='房间表';


-- 4. room_players: 房间玩家关联
CREATE TABLE IF NOT EXISTS room_players (
    id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '记录ID',
    room_id     INT UNSIGNED    NOT NULL                    COMMENT '房间ID',
    user_id     INT UNSIGNED    NOT NULL                    COMMENT '用户ID',
    seat        TINYINT UNSIGNED NOT NULL                   COMMENT '座位号(0-9)',
    is_ready    TINYINT(1)      DEFAULT 0                   COMMENT '是否准备',
    is_host     TINYINT(1)      DEFAULT 0                   COMMENT '是否为房主',
    joined_at   DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '加入时间',
    UNIQUE KEY uk_room_user (room_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='房间玩家表';


-- 5. game_sessions: 游戏对局
CREATE TABLE IF NOT EXISTS game_sessions (
    id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '对局ID',
    room_id     INT UNSIGNED    NOT NULL                    COMMENT '房间ID',
    stage_id    INT UNSIGNED    NOT NULL                    COMMENT '景区ID',
    status      ENUM('playing','finished') DEFAULT 'playing' COMMENT '对局状态',
    duration    INT UNSIGNED    DEFAULT 180                 COMMENT '对局时长(秒)',
    round_count INT UNSIGNED    DEFAULT 0                   COMMENT '回合数',
    started_at  DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '开始时间',
    finished_at DATETIME        NULL                        COMMENT '结束时间',
    INDEX idx_room_id (room_id),
    INDEX idx_status (status),
    INDEX idx_started_at_desc (started_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对局表';


-- 6. game_players: 对局玩家
CREATE TABLE IF NOT EXISTS game_players (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '记录ID',
    session_id      INT UNSIGNED    NOT NULL                    COMMENT '对局ID',
    user_id         INT UNSIGNED    NOT NULL                    COMMENT '用户ID',
    seat            TINYINT UNSIGNED NOT NULL                   COMMENT '座位号',
    team_id         VARCHAR(20)     NULL                        COMMENT '队伍标识',
    initial_score   INT UNSIGNED    DEFAULT 0                   COMMENT '初始积分',
    final_score     INT UNSIGNED    DEFAULT 0                   COMMENT '最终积分',
    `rank`          TINYINT UNSIGNED NULL                       COMMENT '排名',
    coins_earned    INT UNSIGNED    DEFAULT 0                   COMMENT '获得金币',
    UNIQUE KEY uk_session_user (session_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对局玩家表';


-- 7. game_rounds: 对局回合数据
CREATE TABLE IF NOT EXISTS game_rounds (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY  COMMENT '回合ID',
    session_id  INT UNSIGNED    NOT NULL                    COMMENT '对局ID',
    round_num   INT UNSIGNED    NOT NULL                    COMMENT '回合序号',
    events_json JSON            NOT NULL                    COMMENT '回合事件(JSON)',
    created_at  DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    INDEX idx_session_round (session_id, round_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对局回合表';


-- 8. game_results: 对局结果
CREATE TABLE IF NOT EXISTS game_results (
    id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '结果ID',
    session_id  INT UNSIGNED    NOT NULL                    COMMENT '对局ID',
    result_json JSON            NOT NULL                    COMMENT '结果数据(JSON)',
    created_at  DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    UNIQUE KEY uk_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对局结果表';


-- 9. user_items: 用户已购物品(皮肤/宠物/头像光环)
CREATE TABLE IF NOT EXISTS user_items (
    id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY  COMMENT '记录ID',
    user_id     INT UNSIGNED    NOT NULL                    COMMENT '用户ID',
    item_id     VARCHAR(64)     NOT NULL                    COMMENT '物品ID',
    category    ENUM('skin','pet','ring') NOT NULL          COMMENT '物品分类',
    is_equipped TINYINT(1)      DEFAULT 0                   COMMENT '是否装备',
    acquired_at DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '获得时间',
    UNIQUE KEY uk_user_item (user_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户物品表';


-- 10. coin_records: 金币流水
CREATE TABLE IF NOT EXISTS coin_records (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY  COMMENT '流水ID',
    user_id       INT UNSIGNED    NOT NULL                    COMMENT '用户ID',
    amount        INT             NOT NULL                    COMMENT '变动金额(正=收入,负=支出)',
    balance_after INT UNSIGNED    NOT NULL                    COMMENT '变动后余额',
    type          VARCHAR(32)     NOT NULL                    COMMENT '变动类型',
    title         VARCHAR(128)    DEFAULT ''                  COMMENT '标题/备注',
    created_at    DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    INDEX idx_user_time (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='金币流水表';
