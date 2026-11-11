const test = require('node:test');
const assert = require('node:assert/strict');
const {getReleaseBlockers, assertPublicReleaseReady, assertBackendDeploymentReady} = require('../src/services/release-readiness');

test('发布检查默认使用小程序，小游戏 AppID 独立核验且保留真实业务准入检查', () => {
  const project = require('../../minigame/project.config.json');
  const appid = project.appid;
  try {
    project.appid = '';
    const blockers = getReleaseBlockers();
    assert.equal(blockers.some((item) => item.startsWith('发行渠道：')), false);
    assert.ok(blockers.some((item) => item.startsWith('服务类目：')));
    const gameBlockers = getReleaseBlockers({target: 'minigame'});
    assert.ok(gameBlockers.some((item) => item.startsWith('发行渠道：') && item.includes('AppID')));
    for (const list of [blockers, gameBlockers]) {
      assert.ok(list.some((item) => item.startsWith('实名防沉迷：')));
      assert.ok(list.some((item) => item.startsWith('发行资质：')));
    }
    assert.throws(() => assertPublicReleaseReady(), {code: 'PUBLIC_RELEASE_BLOCKED'});
    assert.throws(() => getReleaseBlockers({target: 'invalid'}), /发布目标/);
  } finally { project.appid = appid; }
});

test('受邀部署与正式发行分别检查，公开发布门禁保持阻断', () => {
  assert.doesNotThrow(() => assertBackendDeploymentReady({channel: 'trial', trialUserIds: [7]}));
  assert.throws(() => assertBackendDeploymentReady({channel: 'public', trialUserIds: [7]}), {code: 'PUBLIC_RELEASE_BLOCKED'});
  assert.throws(() => assertPublicReleaseReady(), {code: 'PUBLIC_RELEASE_BLOCKED'});
  assert.throws(() => assertPublicReleaseReady({audience: 'trial'}), {code: 'PUBLIC_RELEASE_BLOCKED'});
  const legal = require('../src/config/legal-config');
  const previous = legal.legalConfig.configured;
  try {
    legal.legalConfig.configured = false;
    assert.throws(() => assertBackendDeploymentReady({channel: 'trial', trialUserIds: [7]}), {code: 'TRIAL_DEPLOYMENT_BLOCKED'});
  } finally {legal.legalConfig.configured = previous;}
});

