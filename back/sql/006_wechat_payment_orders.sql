-- ============================================================
-- 微信支付订单表
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_orders (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '支付订单ID',
    order_no       VARCHAR(32)     NOT NULL                    COMMENT '商户订单号',
    user_id        INT UNSIGNED    NOT NULL                    COMMENT '用户ID',
    item_id        VARCHAR(64)     NOT NULL                    COMMENT '商品ID',
    category       ENUM('skin','pet','ring') NOT NULL          COMMENT '商品分类',
    amount_cents   INT UNSIGNED    NOT NULL                    COMMENT '支付金额(分)',
    status         VARCHAR(24)     NOT NULL DEFAULT 'pending'  COMMENT '订单状态',
    prepay_id      VARCHAR(128)    DEFAULT ''                  COMMENT '微信预支付ID',
    transaction_id VARCHAR(64)     DEFAULT ''                  COMMENT '微信支付单号',
    paid_at        DATETIME        NULL                        COMMENT '支付完成时间',
    created_at     DATETIME        DEFAULT CURRENT_TIMESTAMP   COMMENT '创建时间',
    updated_at     DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY uk_order_no (order_no),
    INDEX idx_user_status (user_id, status),
    INDEX idx_item_user (user_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信支付订单表';
