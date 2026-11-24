/**
 * 受邀体验：服务端 403 带体验编号时，客户端能识别并取出编号。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {readTrialUserId} from '../src/core/UserProfile';

test('受邀体验拒绝登录时读取体验编号，其他错误返回 0', () => {
  assert.equal(readTrialUserId({statusCode: 403, responseBody: {code: 403, data: {code: 'TRIAL_ACCESS_REQUIRED', trialUserId: 42}}}), 42);
  assert.equal(readTrialUserId({responseBody: {data: {code: 'OTHER', trialUserId: 42}}}), 0);
  assert.equal(readTrialUserId({responseBody: {data: {code: 'TRIAL_ACCESS_REQUIRED', trialUserId: 'x'}}}), 0);
  assert.equal(readTrialUserId(new Error('网络不可用')), 0);
  assert.equal(readTrialUserId(null), 0);
});
