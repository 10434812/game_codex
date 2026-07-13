const crypto = require('crypto');
const https = require('https');
const db = require('../models/db');
const configService = require('./admin-config-service');
const shopService = require('./shop-service');

const WECHAT_PAY_HOST = 'api.mch.weixin.qq.com';
const ORDER_STATUS_PENDING = 'pending';
const ORDER_STATUS_PAID = 'paid';
const ORDER_STATUS_CLOSED = 'closed';

async function ensurePaymentOrdersTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '支付订单ID',
      order_no VARCHAR(32) NOT NULL COMMENT '商户订单号',
      user_id INT UNSIGNED NOT NULL COMMENT '用户ID',
      item_id VARCHAR(64) NOT NULL COMMENT '商品ID',
      category ENUM('skin','pet','ring') NOT NULL COMMENT '商品分类',
      amount_cents INT UNSIGNED NOT NULL COMMENT '支付金额(分)',
      status VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT '订单状态',
      prepay_id VARCHAR(128) DEFAULT '' COMMENT '微信预支付ID',
      transaction_id VARCHAR(64) DEFAULT '' COMMENT '微信支付单号',
      paid_at DATETIME NULL COMMENT '支付完成时间',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_order_no (order_no),
      INDEX idx_user_status (user_id, status),
      INDEX idx_item_user (user_id, item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信支付订单表'
  `);
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

async function getPaySettings() {
  const keys = [
    'wechat.pay_enabled',
    'wechat.pay_app_id',
    'wechat.login_app_id',
    'wechat.pay_mch_id',
    'wechat.pay_api_v3_key',
    'wechat.pay_private_key',
    'wechat.pay_cert_serial_no',
    'wechat.pay_notify_url',
    'wechat.pay_platform_public_key',
    'wechat.pay_platform_cert_serial_no',
    'wechat.pay_currency',
    'wechat.pay_goods_desc',
  ];
  const configMap = await configService.getConfigMap(keys);
  return {
    enabled: normalizeBoolean(configMap['wechat.pay_enabled'], false),
    appId: String(configMap['wechat.pay_app_id'] || configMap['wechat.login_app_id'] || '').trim(),
    mchId: String(configMap['wechat.pay_mch_id'] || '').trim(),
    apiV3Key: String(configMap['wechat.pay_api_v3_key'] || '').trim(),
    privateKey: String(configMap['wechat.pay_private_key'] || '').replace(/\\n/g, '\n').trim(),
    certSerialNo: String(configMap['wechat.pay_cert_serial_no'] || '').trim(),
    notifyUrl: String(configMap['wechat.pay_notify_url'] || '').trim(),
    platformPublicKey: String(configMap['wechat.pay_platform_public_key'] || '').replace(/\\n/g, '\n').trim(),
    platformCertSerialNo: String(configMap['wechat.pay_platform_cert_serial_no'] || '').trim(),
    currency: String(configMap['wechat.pay_currency'] || 'CNY').trim() || 'CNY',
    goodsDesc: String(configMap['wechat.pay_goods_desc'] || '锦鲤前程幸运金币充值').trim(),
  };
}

function assertPayReady(settings) {
  if (!settings.enabled) {
    throw Object.assign(new Error('微信支付未开启'), { status: 400 });
  }
  const missing = [];
  for (const key of ['appId', 'mchId', 'apiV3Key', 'privateKey', 'certSerialNo', 'notifyUrl', 'platformPublicKey', 'platformCertSerialNo']) {
    if (!settings[key]) missing.push(key);
  }
  if (missing.length > 0) {
    throw Object.assign(new Error(`微信支付配置缺失: ${missing.join(', ')}`), { status: 500 });
  }
}

function getHeader(headers, name) {
  if (!headers) return '';
  return String(headers[name] || headers[name.toLowerCase()] || '').trim();
}

function getVerificationKey(publicKeyPem) {
  if (publicKeyPem.includes('BEGIN CERTIFICATE')) {
    return new crypto.X509Certificate(publicKeyPem).publicKey;
  }
  return publicKeyPem;
}

function verifyNotificationSignature(settings, headers, rawBody) {
  const timestamp = getHeader(headers, 'wechatpay-timestamp');
  const nonce = getHeader(headers, 'wechatpay-nonce');
  const serial = getHeader(headers, 'wechatpay-serial');
  const signature = getHeader(headers, 'wechatpay-signature');
  if (!timestamp || !nonce || !serial || !signature) {
    throw Object.assign(new Error('微信支付通知缺少签名头'), { status: 400 });
  }
  if (settings.platformCertSerialNo && serial !== settings.platformCertSerialNo) {
    throw Object.assign(new Error('微信支付平台证书序列号不匹配'), { status: 400 });
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    getVerificationKey(settings.platformPublicKey),
    Buffer.from(signature, 'base64')
  );
  if (!verified) {
    throw Object.assign(new Error('微信支付通知签名校验失败'), { status: 400 });
  }
  return true;
}

function createOrderNo() {
  return `GC${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getItem(itemId) {
  return shopService.GOODS.find((item) => item.id === itemId) || null;
}

function sign(privateKey, message) {
  return crypto.createSign('RSA-SHA256').update(message).end().sign(privateKey, 'base64');
}

function createAuthorization(settings, method, path, body = '') {
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = sign(settings.privateKey, message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${settings.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${settings.certSerialNo}"`;
}

function requestWechatPay(settings, method, path, payload = null) {
  const body = payload ? JSON.stringify(payload) : '';
  const headers = {
    Accept: 'application/json',
    Authorization: createAuthorization(settings, method, path, body),
    'Content-Type': 'application/json',
    'User-Agent': 'game-codex-wechat-pay/1.0',
  };

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: WECHAT_PAY_HOST,
      method,
      path,
      headers,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (_err) {
            data = { raw };
          }
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data || {});
          return;
        }
        const message = (data && (data.message || data.code)) || `微信支付请求失败(${res.statusCode})`;
        const err = Object.assign(new Error(message), {
          status: 502,
          wechatStatusCode: res.statusCode,
          wechatBody: data,
        });
        reject(err);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildPaymentParams(settings, prepayId) {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageValue = `prepay_id=${prepayId}`;
  const paySign = sign(settings.privateKey, `${settings.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign,
  };
}

async function createJsapiOrder(user, itemId) {
  await ensurePaymentOrdersTable();
  const settings = await getPaySettings();
  assertPayReady(settings);

  const item = getItem(itemId);
  if (!item) {
    throw Object.assign(new Error('商品不存在'), { status: 404 });
  }
  if (item.price <= 0) {
    throw Object.assign(new Error('免费商品不需要微信支付'), { status: 400 });
  }

  const existing = await db.queryOne(
    'SELECT id FROM user_items WHERE user_id = ? AND item_id = ?',
    [user.userId, itemId]
  );
  if (existing) {
    throw Object.assign(new Error('已拥有该物品'), { status: 400 });
  }

  const orderNo = createOrderNo();
  const amountCents = Math.max(1, Math.round(Number(item.price) || 0));
  await db.execute(
    `INSERT INTO payment_orders (order_no, user_id, item_id, category, amount_cents, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orderNo, user.userId, item.id, item.category, amountCents, ORDER_STATUS_PENDING]
  );

  const payload = {
    appid: settings.appId,
    mchid: settings.mchId,
    description: `${settings.goodsDesc || '锦鲤前程幸运金币充值'}-${item.name}`.slice(0, 127),
    out_trade_no: orderNo,
    notify_url: settings.notifyUrl,
    amount: {
      total: amountCents,
      currency: settings.currency,
    },
    payer: {
      openid: user.openid,
    },
    attach: JSON.stringify({ itemId: item.id }),
  };

  const response = await requestWechatPay(settings, 'POST', '/v3/pay/transactions/jsapi', payload);
  if (!response.prepay_id) {
    throw Object.assign(new Error('微信支付未返回 prepay_id'), { status: 502 });
  }

  await db.execute(
    'UPDATE payment_orders SET prepay_id = ? WHERE order_no = ?',
    [response.prepay_id, orderNo]
  );

  return {
    orderNo,
    item: {
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
    },
    amountCents,
    payment: buildPaymentParams(settings, response.prepay_id),
  };
}

async function queryWechatOrder(orderNo) {
  const settings = await getPaySettings();
  assertPayReady(settings);
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(settings.mchId)}`;
  return requestWechatPay(settings, 'GET', path);
}

async function grantPaidOrder(orderNo, transaction = null) {
  await ensurePaymentOrdersTable();
  const order = await db.queryOne('SELECT * FROM payment_orders WHERE order_no = ?', [orderNo]);
  if (!order) {
    throw Object.assign(new Error('支付订单不存在'), { status: 404 });
  }
  if (order.status === ORDER_STATUS_PAID) {
    return { alreadyPaid: true, orderNo, itemId: order.item_id };
  }

  const tradeState = transaction && transaction.trade_state;
  if (tradeState !== 'SUCCESS') {
    if (tradeState && ['CLOSED', 'REVOKED', 'PAYERROR'].includes(tradeState)) {
      await db.execute('UPDATE payment_orders SET status = ? WHERE order_no = ?', [ORDER_STATUS_CLOSED, orderNo]);
    }
    throw Object.assign(new Error('订单尚未支付成功'), { status: 400 });
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[currentRows]] = await conn.execute('SELECT status FROM payment_orders WHERE order_no = ? FOR UPDATE', [orderNo]);
    if (!currentRows || currentRows.status === ORDER_STATUS_PAID) {
      await conn.commit();
      return { alreadyPaid: true, orderNo, itemId: order.item_id };
    }
    await conn.execute(
      'INSERT IGNORE INTO user_items (user_id, item_id, category) VALUES (?, ?, ?)',
      [order.user_id, order.item_id, order.category]
    );
    await conn.execute(
      `UPDATE payment_orders
       SET status = ?, transaction_id = ?, paid_at = NOW()
       WHERE order_no = ?`,
      [ORDER_STATUS_PAID, transaction.transaction_id || '', orderNo]
    );
    await conn.commit();
    return { alreadyPaid: false, orderNo, itemId: order.item_id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function syncPaidOrder(orderNo, userId = null) {
  await ensurePaymentOrdersTable();
  const order = await db.queryOne('SELECT user_id FROM payment_orders WHERE order_no = ?', [orderNo]);
  if (!order) {
    throw Object.assign(new Error('支付订单不存在'), { status: 404 });
  }
  if (userId && Number(order.user_id) !== Number(userId)) {
    throw Object.assign(new Error('无权确认该支付订单'), { status: 403 });
  }
  const transaction = await queryWechatOrder(orderNo);
  return grantPaidOrder(orderNo, transaction);
}

function decryptNotificationResource(resource, apiV3Key) {
  const key = Buffer.from(apiV3Key, 'utf8');
  const ciphertext = Buffer.from(resource.ciphertext, 'base64');
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
  }
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

async function handlePaymentNotify(payload, headers = {}, rawBody = '') {
  const settings = await getPaySettings();
  assertPayReady(settings);
  verifyNotificationSignature(settings, headers, rawBody || JSON.stringify(payload || {}));
  if (!payload || !payload.resource) {
    throw Object.assign(new Error('微信支付通知缺少 resource'), { status: 400 });
  }
  const decrypted = decryptNotificationResource(payload.resource, settings.apiV3Key);
  if (!decrypted.out_trade_no) {
    throw Object.assign(new Error('微信支付通知缺少商户订单号'), { status: 400 });
  }
  const transaction = await queryWechatOrder(decrypted.out_trade_no);
  await grantPaidOrder(decrypted.out_trade_no, transaction);
  return { code: 'SUCCESS', message: '成功' };
}

module.exports = {
  ensurePaymentOrdersTable,
  createJsapiOrder,
  syncPaidOrder,
  handlePaymentNotify,
  __private: {
    getPaySettings,
    createAuthorization,
    buildPaymentParams,
    decryptNotificationResource,
    verifyNotificationSignature,
  },
};
