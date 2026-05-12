const test = require('node:test');
const assert = require('node:assert/strict');

const {applySelfDecorations, buildBoardPlayers, buildFortuneBagByPlayers} = require('../utils/board-layout');
const {buildOpportunity, getFortuneBagAsset} = require('../utils/investment');

function makePlayers(count) {
  return Array.from({length: count}, (_, index) => ({
    id: `player-${index + 1}`,
    name: `玩家${index + 1}`,
    score: 100 + index,
    isSelf: index === 0,
  }));
}

test('多人棋盘使用更舒展的椭圆站位', () => {
  const players = buildBoardPlayers(makePlayers(10));
  const xs = players.map((player) => player.x);
  const ys = players.map((player) => player.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);

  assert.ok(ySpan > xSpan + 70);
  assert.ok(ySpan >= 620);
  assert.ok(Math.max(...ys) <= 730);
  assert.ok(Math.min(...xs) >= 98);
  assert.ok(Math.max(...xs) <= 622);
});

test('多人棋盘下半圈玩家标签会向下外扩避让', () => {
  const players = buildBoardPlayers(makePlayers(10));
  const lowerPlayers = players.filter((player) => player.y > 380);

  assert.ok(lowerPlayers.length >= 5);
  assert.ok(
    lowerPlayers.every((player) => {
      if (player.x < 288) {
        return player.namePos === 'lower-left';
      }
      if (player.x > 432) {
        return player.namePos === 'lower-right';
      }
      return player.namePos === 'lower-center';
    })
  );
});

test('自己节点的宠物装饰会携带图像与主题色，其他玩家不会误带上', () => {
  const decorated = applySelfDecorations(makePlayers(3), {
    skinImage: 'https://xcx.ukb88.com/assets/skins/skin-06.png',
    skinClass: 'skin-storm',
    petIcon: '🦊',
    petLabel: '灵狐',
    petImage: 'https://xcx.ukb88.com/assets/111/pets/linghu.png',
    petAccent: '#de6a45',
  });

  assert.equal(decorated[0].petLabel, '灵狐');
  assert.equal(decorated[0].petImage, 'https://xcx.ukb88.com/assets/111/pets/linghu.png');
  assert.equal(decorated[0].petAccent, '#de6a45');
  assert.equal(decorated[1].petLabel, '');
  assert.equal(decorated[1].petImage, '');
});

test('聊天气泡会按左右侧锚定到头像上方的外侧', () => {
  const players = buildBoardPlayers(makePlayers(4));
  const leftPlayer = players.find((player) => player.x < 360);
  const rightPlayer = players.find((player) => player.x > 360);

  assert.ok(leftPlayer);
  assert.ok(rightPlayer);
  assert.equal(leftPlayer.chatPos, 'upper-left');
  assert.equal(rightPlayer.chatPos, 'upper-right');
});

test('福袋会按机会类别携带对应图标', () => {
  const opportunity = buildOpportunity(300, () => 0);
  const bag = buildFortuneBagByPlayers('case', makePlayers(2), opportunity);

  assert.equal(bag.category, opportunity.category);
  assert.equal(bag.asset, getFortuneBagAsset(opportunity.category));
  assert.equal(bag.opportunity.name, opportunity.name);
});

test('福袋会落在当前棋盘布局的正中间', () => {
  const opportunity = buildOpportunity(300, () => 0);
  const bag = buildFortuneBagByPlayers('case', buildBoardPlayers(makePlayers(10)), opportunity);

  assert.equal(bag.x, 360);
  assert.equal(bag.y, 450);
});

test('福袋尺寸调整不会改变其居中锚点规则', () => {
  const opportunity = buildOpportunity(300, () => 0);
  const bag = buildFortuneBagByPlayers('case', buildBoardPlayers(makePlayers(4)), opportunity);

  assert.equal(bag.x, 360);
  assert.equal(bag.y, 380);
});
