const test = require('node:test');
const assert = require('node:assert/strict');
const {loadArenaPage, makeArenaFrames} = require('./helpers/arena-view-fixture');
const {appendArenaViewPatch} = require('../utils/arena-view-patch');
const {applyViewPatch} = require('./helpers/arena-view-fixture');

test('长距离拖动后回拨手指可转向，斜向操作不受场地比例影响', () => {
  const page = loadArenaPage(), sent = [];
  page.sendDirection = () => sent.push({...page.direction});
  const move = (x, y) => page.onRunTouchMove({touches: [{clientX: x, clientY: y}]});
  page.onRunTouchStart({touches: [{clientX: 80, clientY: 150}]});
  move(250, 150); move(210, 150);
  assert.ok(sent.at(-1).dx < 0, '回拨 40px 应朝左，不必回到最初按下的位置');
  page.onRunTouchCancel();
  assert.equal(sent.at(-1).dx, 0);
  page.onRunTouchStart({touches: [{clientX: 80, clientY: 150}]});
  move(100, 170);
  const direction = sent.at(-1);
  assert.ok(Math.abs(direction.dx * page.fieldRect.width / 1000 - direction.dy * page.fieldRect.height / 1200) < .001, '屏幕上 45 度拖动保持 45 度');
});

test('字段更新保留装备、表情和积分，并正确处理成员增删与重排', () => {
  const data = {players: [{id: 'self', x: 10, score: 10, avatar: 'a', ringImage: 'r', emoteText: ''}], drops: []};
  const next = {players: [{...data.players[0], x: 20, score: 15, emoteText: '冲呀'}], drops: [{id: 'd1', y: 5}]};
  const patch = appendArenaViewPatch(data, next);
  assert.equal(patch['players[0].x'], 20);
  assert.equal(patch.players, undefined);
  applyViewPatch(data, patch); assert.deepEqual(data, next);
  for (const players of [[...next.players, {...next.players[0], id: 'mate'}], [{...next.players[0], id: 'mate'}, ...next.players], []]) {
    const view = {players, drops: []};
    applyViewPatch(data, appendArenaViewPatch(data, view)); assert.deepEqual(data, view);
  }
});

test('10 人连续跑动时按变化字段更新，保持每帧刷新并减少跨桥数据', () => {
  const page = loadArenaPage(), frames = makeArenaFrames();
  let bytes = 0, rendered = 0;
  for (const snapshot of frames) {
    page.snapshot = snapshot; page.patches.length = 0; page.draw();
    for (const patch of page.patches) bytes += Buffer.byteLength(JSON.stringify(patch));
    if (page.patches.length) rendered++;
  }
  assert.equal(rendered, frames.length);
  assert.ok(bytes < 900000, '240 帧传输预算为 900KB，实际 ' + bytes);
  page.snapshot = frames.at(-1); page.patches.length = 0; page.draw();
  assert.equal(page.patches.length, 0, '相同快照保持当前视图');
});

test('实时状态把时间、名次和人物更新合并为一次页面提交', () => {
  const page = loadArenaPage(), frame = makeArenaFrames(1)[0];
  Object.assign(page, {active: true, sessionId: '', stageId: 1, effectId: Infinity});
  page.acceptState({...frame, status: 'playing', timeLeft: 99, stage: {id: 1}});
  assert.equal(page.patches.length, 1);
  assert.equal(page.data.timeText, '99s');
  assert.equal(page.data.players.length, 10);
  assert.equal(page.data.players[0].score, frame.players[0].score);
});

test('视图慢帧期间只保留最新状态，同一时刻仅提交一帧', () => {
  const page = loadArenaPage(), frames = makeArenaFrames(4), callbacks = [];
  page.active = true;
  page.setData = function(patch, callback) {this.patches.push(patch); applyViewPatch(this.data, patch); callbacks.push(callback);};
  page.snapshot = frames[0]; page.draw({timeText: '99s'});
  page.snapshot = frames[1]; page.draw({timeText: '98s'});
  page.snapshot = frames[2]; page.draw({timeText: '97s'});
  assert.equal(page.patches.length, 1, '前一帧尚未绘制完成时合并后续状态');
  callbacks.shift()();
  assert.equal(page.patches.length, 2); assert.equal(page.data.timeText, '97s');
  assert.ok(Math.abs(page.data.players[0].x - (9 + frames[2].runWorld.runners[0].x / 1000 * 82)) < .001);
  callbacks.shift()();
  page.snapshot = frames[3]; page.draw();
  assert.equal(page.patches.length, 3);
});

test('慢帧中名次先变化再恢复，最终 HUD 与最新人物状态一致', () => {
  const page = loadArenaPage(), frame = makeArenaFrames(1)[0], callbacks = [];
  Object.assign(page, {active: true, sessionId: '', stageId: 1, effectId: Infinity});
  page.setData = function(patch, callback) {this.patches.push(patch); applyViewPatch(this.data, patch); callbacks.push(callback);};
  const state = {...frame, status: 'playing', timeLeft: 99, stage: {id: 1}};
  page.acceptState(state);
  const rank = page.data.rankText;
  page.acceptState({...state, players: state.players.map((p) => p.isSelf ? {...p, score: 1} : p)});
  page.acceptState(state);
  callbacks.shift()();
  assert.equal(page.data.rankText, rank);
  assert.equal(page.data.players[0].score, state.players[0].score);
});

test('人物和掉落物的合成层坐标与场地位置一致', () => {
  const page = loadArenaPage(), frames = makeArenaFrames(40);
  for (const snapshot of frames) {
    page.snapshot = snapshot; page.draw();
    for (const p of [...page.data.players, ...page.data.drops]) {
      assert.ok(Math.abs(p.px - p.x * (page.fieldRect.width / .82) / 100) < .01);
      assert.ok(Math.abs(p.py - p.y * (page.fieldRect.height / .76) / 100) < .01);
    }
  }
});

test('十人相互靠近与交错时，名字固定跟随本人头像', () => {
  const page = loadArenaPage(), frame = makeArenaFrames(1)[0];
  const offsets = [];
  for (let i = 0; i < 40; i++) {
    page.snapshot = {...frame, runWorld: {...frame.runWorld, runners: frame.runWorld.runners.map((r, j) => ({...r,
      x: 400 + (j % 4) * (70 - i), y: 500 + Math.floor(j / 4) * (60 - i)}))}};
    page.draw();
    const now = page.data.players.map((p) => ({id: p.id, dx: Math.round((p.labelX - p.px) * 100) / 100,
      dy: Math.round((p.labelY - p.py) * 100) / 100}));
    if (!i) offsets.push(...now);
    else for (const offset of now) {
      const original = offsets.find((p) => p.id === offset.id);
      assert.ok(Math.abs(offset.dx - original.dx) < .02, '名字横向始终跟随本人');
      assert.ok(Math.abs(offset.dy - original.dy) < .02, '名字纵向始终跟随本人');
    }
  }
});
