const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findSelfTeamInfo,
  getMateIdFromPairKey,
  mergeTeamLinks,
  buildTeamLinks,
  buildLinkStyle,
  findSelfManualLink,
} = require('../utils/team-link');

test('findSelfTeamInfo 没有自己玩家时返回空字符串', () => {
  const state = {
    players: [
      {id: 'p1', isSelf: false},
      {id: 'p2', isSelf: false},
    ],
    teams: [{id: 't1', memberIds: ['p1', 'p2']}],
  };
  const result = findSelfTeamInfo(state);
  assert.equal(result.selfId, '');
  assert.equal(result.teammateId, '');
  assert.equal(result.pairKey, '');
});

test('findSelfTeamInfo 找到自己并返回队友信息', () => {
  const state = {
    players: [
      {id: 'self', isSelf: true},
      {id: 'mate', isSelf: false},
    ],
    teams: [{id: 't1', memberIds: ['self', 'mate']}],
  };
  const result = findSelfTeamInfo(state);
  assert.equal(result.selfId, 'self');
  assert.equal(result.teammateId, 'mate');
  assert.equal(result.pairKey, 'mate::self');
});

test('findSelfTeamInfo 找到自己但不在完整队伍中', () => {
  const state = {
    players: [
      {id: 'self', isSelf: true},
      {id: 'mate', isSelf: false},
    ],
    teams: [{id: 't1', memberIds: ['self']}],
  };
  const result = findSelfTeamInfo(state);
  assert.equal(result.selfId, 'self');
  assert.equal(result.teammateId, '');
  assert.equal(result.pairKey, '');
});

test('findSelfTeamInfo 对空状态安全返回默认值', () => {
  const result = findSelfTeamInfo(null);
  assert.equal(result.selfId, '');
  assert.equal(result.teammateId, '');
  assert.equal(result.pairKey, '');
});

test('getMateIdFromPairKey 正确解析队友 ID', () => {
  assert.equal(getMateIdFromPairKey('a::b', 'a'), 'b');
  assert.equal(getMateIdFromPairKey('a::b', 'b'), 'a');
});

test('getMateIdFromPairKey 对空值返回空字符串', () => {
  assert.equal(getMateIdFromPairKey('', 'a'), '');
  assert.equal(getMateIdFromPairKey('a::b', ''), '');
  assert.equal(getMateIdFromPairKey(null, 'a'), '');
});

test('getMateIdFromPairKey 返回 pairKey 中不等于 selfId 的项', () => {
  assert.equal(getMateIdFromPairKey('a::b', 'c'), 'a');
});

test('mergeTeamLinks 合并 state 和 manual 链接', () => {
  const stateLinks = [
    {id: 'l1', pairKey: 'a::b'},
    {id: 'l2', pairKey: 'c::d'},
  ];
  const manualMap = {
    m1: {id: 'm1', pairKey: 'e::f'},
  };
  const result = mergeTeamLinks(stateLinks, manualMap);
  assert.equal(result.length, 3);
  assert.ok(result.some((l) => l.pairKey === 'a::b'));
  assert.ok(result.some((l) => l.pairKey === 'e::f'));
});

test('mergeTeamLinks 去重相同 pairKey 的 manual 链接', () => {
  const stateLinks = [{id: 'l1', pairKey: 'a::b'}];
  const manualMap = {
    m1: {id: 'm1', pairKey: 'a::b'},
  };
  const result = mergeTeamLinks(stateLinks, manualMap);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'l1');
});

test('mergeTeamLinks 排除 hiddenStatePairKeys 中的 state 链接', () => {
  const stateLinks = [
    {id: 'l1', pairKey: 'a::b'},
    {id: 'l2', pairKey: 'c::d'},
  ];
  const hidden = new Set(['a::b']);
  const result = mergeTeamLinks(stateLinks, {}, hidden);
  assert.equal(result.length, 1);
  assert.equal(result[0].pairKey, 'c::d');
});

test('mergeTeamLinks 对空参数返回空数组', () => {
  const result = mergeTeamLinks();
  assert.equal(result.length, 0);
});

test('buildTeamLinks 根据 players 和 teams 生成链接', () => {
  const players = [
    {id: 'p1', name: 'Alice', x: 100, y: 100},
    {id: 'p2', name: 'Bob', x: 200, y: 200},
  ];
  const teams = [{id: 't1', memberIds: ['p1', 'p2']}];
  const result = buildTeamLinks(players, teams);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 't1');
  assert.equal(result[0].fromName, 'Alice');
  assert.equal(result[0].toName, 'Bob');
  assert.ok(result[0].style.includes('rpx'));
});

test('buildTeamLinks 对缺失玩家返回空', () => {
  const players = [{id: 'p1', name: 'Alice', x: 100, y: 100}];
  const teams = [{id: 't1', memberIds: ['p1', 'p2']}];
  const result = buildTeamLinks(players, teams);
  assert.equal(result.length, 0);
});

test('buildTeamLinks 对非法队伍返回空', () => {
  const players = [
    {id: 'p1', name: 'Alice', x: 100, y: 100},
    {id: 'p2', name: 'Bob', x: 200, y: 200},
  ];
  const teams = [{id: 't1', memberIds: ['p1']}];
  const result = buildTeamLinks(players, teams);
  assert.equal(result.length, 0);
});

test('buildLinkStyle 返回包含旋转和位置的 CSS 字符串', () => {
  const from = {x: 100, y: 100};
  const to = {x: 200, y: 200};
  const style = buildLinkStyle(from, to);
  assert.ok(style.includes('left:'));
  assert.ok(style.includes('top:'));
  assert.ok(style.includes('width:'));
  assert.ok(style.includes('rotate('));
});

test('findSelfManualLink 从 manualMap 中找到包含自己的链接', () => {
  const manualMap = {
    m1: {pairKey: 'self::mate'},
  };
  const result = findSelfManualLink('self', manualMap);
  assert.equal(result.pairKey, 'self::mate');
});

test('findSelfManualLink 对空参数返回 null', () => {
  assert.equal(findSelfManualLink('', {}), null);
  assert.equal(findSelfManualLink('self', null), null);
});
