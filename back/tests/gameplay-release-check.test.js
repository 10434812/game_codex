const test = require('node:test');
const assert = require('node:assert/strict');
const {checkGameplaySchema, checkLoginSettings, checkApiCapabilities} = require('../scripts/check-gameplay-release');

test('小游戏发布不能借用小程序密钥，AppID不匹配与非120秒配置均阻断', () => {
  const settings = new Map([['wechat.login_app_id','native'],['wechat.login_secret','native-test-secret'],['game.round_duration','120']]);
  let blockers = [];
  checkLoginSettings(settings, {target:'minigame',expectedAppId:'game',nativeFallback:{appId:'native',secret:'fallback-test-secret'}},blockers);
  assert.ok(blockers.some((item) => /小游戏.*凭证缺失/.test(item)));
  settings.set('wechat.minigame_app_id','wrong-game'); settings.set('wechat.minigame_secret','game-test-secret'); settings.set('game.round_duration','100');
  blockers = []; checkLoginSettings(settings,{target:'minigame',expectedAppId:'game'},blockers);
  assert.ok(blockers.some((item) => item.includes('AppID'))); assert.ok(blockers.some((item) => item.includes('120秒')));
  assert.equal(JSON.stringify(blockers).includes('game-test-secret'),false);
  settings.set('wechat.minigame_app_id','game'); settings.set('game.round_duration','120');
  blockers = []; checkLoginSettings(settings,{target:'minigame',expectedAppId:'game'},blockers); assert.deepEqual(blockers,[]);
});

test('原生小程序保持环境配置兼容，但关闭登录仍阻断', () => {
  const settings=new Map([['game.round_duration','120']]),options={target:'miniprogram',expectedAppId:'native',nativeFallback:{appId:'native',secret:'native-test-secret'}};
  const blockers=[]; checkLoginSettings(settings,options,blockers); assert.deepEqual(blockers,[]);
  settings.set('wechat.login_enabled','false'); checkLoginSettings(settings,options,blockers); assert.ok(blockers.some((item)=>item.includes('开关已关闭')));
});

test('旧后端或错误类型的能力标志不能被认为支持新版匹配和留存', () => {
  const blockers=[]; checkApiCapabilities({api:{onlineArena:true,authRefresh:true,roomRematch:true,quickMatch:'true'}},blockers);
  assert.equal(blockers.length,2); assert.ok(blockers.some((item)=>item.includes('retention')));
  const good=[]; checkApiCapabilities({api:{onlineArena:true,authRefresh:true,roomRematch:true,quickMatch:true,retention:true}},good); assert.deepEqual(good,[]);
});

test('只读结构检查识别缺字段与缺唯一索引，不执行DDL或配置写入', async () => {
  const sql=[];
  const connection={execute:async (query)=>{sql.push(query); return [[]];}};
  const blockers=[]; await checkGameplaySchema(connection,blockers);
  assert.equal(sql.length,2); assert.ok(sql.every((query)=>query.startsWith('SELECT')));
  assert.ok(blockers.some((item)=>item.includes('rooms缺少字段')));
  assert.ok(blockers.some((item)=>item.includes('daily_checkins缺少唯一索引')));
});
