const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');
const privacy = require('../utils/privacy-consent');
const runtime = require('../utils/runtime-config');
const user = require('../utils/user-profile');
const store = require('../utils/game-store');
const shop = require('../utils/shop-store');
function setup(t) {
  const storage = new Map(), navigation = [];
  global.wx = {getStorageSync: k => storage.get(k),setStorageSync: (k,v) => storage.set(k,v),removeStorageSync: k => storage.delete(k),showToast() {},
    navigateTo: p => navigation.push(p.url),redirectTo: p => navigation.push(p.url)};
  t.mock.method(privacy,'canEnter',()=>true);
  t.mock.method(privacy,'assertAllowed',()=>{});
  t.mock.method(runtime,'fetchRemoteConfig',async()=>({}));
  t.mock.method(runtime,'isApiSupported',()=>true);
  t.after(()=>{delete global.wx;delete global.Page;delete global.getCurrentPages;});
  return navigation;
}
function page(file) {
  let def; global.Page=x=>{def=x;};delete require.cache[require.resolve(file)];require(file);
  return {...def,data:structuredClone(def.data),setData(p){Object.assign(this.data,p);}};
}
test('开始游戏只创建服务端房间，登录失败或服务不可用均不启动设备对局',async t=>{
  const nav=setup(t);t.mock.method(user,'ensureLogin',async()=>api.setToken('account'));
  t.mock.method(api,'get',async()=>null);
  const post=t.mock.method(api,'post',async(url,body)=>{assert.equal(url,'/rooms');assert.ok(body.stageId);return {room:{id:88}};});
  t.mock.method(store,'createRoomFromStage',()=>assert.fail('不得创建设备房间'));
  t.mock.method(store,'startGame',()=>assert.fail('不得启动设备对局'));
  const p=page('../pages/home/index');await p.enterGame();
  assert.deepEqual(nav,['/pages/room/index?backendRoomId=88']);assert.equal(post.mock.callCount(),1);
  t.mock.method(runtime,'isApiSupported',()=>false);
  await assert.rejects(p.enterGame(),/不可用/);assert.equal(post.mock.callCount(),1);
});
test('好友房进入后只读取账号成员，不订阅旧设备房间',async t=>{
  setup(t);api.setToken('account');
  t.mock.method(store,'subscribe',()=>assert.fail('不应订阅设备房间'));
  t.mock.method(store,'ensureRoom',()=>assert.fail('不应恢复设备房间'));
  t.mock.method(api,'post',async()=>({room:{id:88,stage_id:1},players:[{nick_name:'好友',is_self:true,is_host:true}]}));
  const p=page('../pages/room/index');p.inviteRoomId='88';p.inviteBackendRoomId='88';p.pollRoom=()=>{};
  await p.initRoom();assert.equal(p.data.slots[0].name,'好友');assert.equal(p.data.modeText,'联网对战');
});
test('无服务端场次进入战场时返回房间，不恢复设备对局',t=>{
  const nav=setup(t);const p=page('../pages/arena/index');
  t.mock.method(store,'subscribe',()=>assert.fail('不得读取旧设备对局'));
  p.onLoad();p.onShow();assert.deepEqual(nav,['/pages/room/index']);
});
test('未登录商城和流水均只提供登录，不展示或操作游客资产',async t=>{
  setup(t);
  t.mock.method(shop,'purchaseItem',()=>assert.fail('不得购买游客商品'));
  t.mock.method(shop,'getCoinRecords',()=>assert.fail('不得展示游客流水'));
  t.mock.method(user,'ensureLogin',async()=>{throw new Error('请微信登录');});
  const s=page('../pages/shop/index');s.syncPage();assert.equal(s.data.balanceText,'--');assert.equal(s.data.loginRequired,true);
  await s.onTapAction({currentTarget:{dataset:{category:'skin',itemId:'skin-monk-bell',action:'buy'}}});
  const ledger=page('../pages/income/index');await ledger.syncRecords();assert.equal(ledger.data.recordsLoginRequired,true);assert.deepEqual(ledger.data.records,[]);
});
test('历史入口只打开服务端记录，不用设备上的上一局',async t=>{
  const nav=setup(t);api.setToken('account');
  t.mock.method(api,'get',async()=>({records:[{sessionId:99}]}));
  const p=page('../pages/home/index');await p.switchTab({currentTarget:{dataset:{page:'/pages/result/index'}}});
  assert.deepEqual(nav,['/pages/result/index?sessionId=99']);
});
