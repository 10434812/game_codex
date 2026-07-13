const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const wechatPayService = require('../src/services/wechat-pay-service');

test('wechat payment schema and routes are wired', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/006_wechat_payment_orders.sql'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/payments.js'), 'utf8');
  const routeIndex = fs.readFileSync(path.join(__dirname, '../src/routes/index.js'), 'utf8');
  const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS payment_orders/);
  assert.match(sql, /order_no\s+VARCHAR\(32\)/);
  assert.match(routes, /\/wechat\/jsapi/);
  assert.match(routes, /\/wechat\/orders\/:orderNo\/sync/);
  assert.match(routes, /\/wechat\/notify/);
  assert.match(routeIndex, /mount\('\/payments', '\.\/payments'\)/);
  assert.match(compose, /006_wechat_payment_orders\.sql/);
});

test('decryptNotificationResource decrypts WeChat API v3 notification payloads', () => {
  const apiV3Key = '12345678901234567890123456789012';
  const resource = {
    nonce: 'nonce12345678',
    associated_data: 'transaction',
  };
  const plainText = JSON.stringify({
    out_trade_no: 'GCORDER1',
    trade_state: 'SUCCESS',
  });

  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(resource.nonce));
  cipher.setAAD(Buffer.from(resource.associated_data));
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  resource.ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');

  const decrypted = wechatPayService.__private.decryptNotificationResource(resource, apiV3Key);
  assert.equal(decrypted.out_trade_no, 'GCORDER1');
  assert.equal(decrypted.trade_state, 'SUCCESS');
});

test('verifyNotificationSignature accepts valid WeChat Pay notification signatures', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const timestamp = '1710000000';
  const nonce = 'nonce-for-test';
  const rawBody = JSON.stringify({ id: 'notify-id', resource: { ciphertext: 'cipher' } });
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');

  const result = wechatPayService.__private.verifyNotificationSignature(
    {
      platformPublicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      platformCertSerialNo: 'SERIAL1',
    },
    {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-serial': 'SERIAL1',
      'wechatpay-signature': signature,
    },
    Buffer.from(rawBody)
  );

  assert.equal(result, true);
});

test('verifyNotificationSignature rejects invalid WeChat Pay notification signatures', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const timestamp = '1710000000';
  const nonce = 'nonce-for-test';
  const rawBody = JSON.stringify({ id: 'notify-id' });
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`), privateKey)
    .toString('base64');

  assert.throws(
    () => wechatPayService.__private.verifyNotificationSignature(
      {
        platformPublicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        platformCertSerialNo: 'SERIAL1',
      },
      {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-serial': 'SERIAL1',
        'wechatpay-signature': signature,
      },
      Buffer.from(JSON.stringify({ id: 'tampered' }))
    ),
    /签名校验失败/
  );
});
