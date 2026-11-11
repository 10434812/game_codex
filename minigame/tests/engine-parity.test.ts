/**
 * 一致性验证：移植到 TypeScript 的规则层必须与小程序端 utils/*.js 行为完全一致。
 *
 * 双侧使用同一种子的 mulberry32 随机源，逐调用对比返回值。
 * 运行：
 *   node --import ./tests/register-hook.mjs --test tests/engine-parity.test.ts
 */

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

import * as constantsTs from '../src/core/Constants';
import * as engineTs from '../src/core/GameEngine';
import * as layoutTs from '../src/core/BoardLayout';
import * as linkTs from '../src/core/TeamLink';
import * as investmentTs from '../src/core/Investment';
import * as emoteTs from '../src/core/Emote';
import type {Opportunity} from '../src/core/Investment';
import type {Player, Team, VisibleScoreState} from '../src/core/GameEngine';
import type {BoardPlayer, DecoratedBoardPlayer, FortuneBag} from '../src/core/BoardLayout';
import {makeRandom, type RandomSource} from './seeded-random';

const requireFromHere = createRequire(import.meta.url);

/**
 * 旧版模块是 CommonJS、无类型声明，且与移植版同形——一致性测试本身就要求两者形状相同，
 * 因此这里把旧模块按移植版的类型断言使用。
 */
function loadLegacy<T>(relativePath: string): T {
  return requireFromHere(relativePath) as unknown as T;
}

const constantsJs = loadLegacy<typeof constantsTs & {NAV_TABS: readonly {key: string}[]}>(
  '../../utils/constants.js'
);

/** 旧版 playRound 保留了从未被读取的 teams 形参，移植版已删除，这里按旧签名声明。 */
type LegacyEngineModule = Omit<typeof engineTs, 'playRound'> & {
  playRound(
    players: readonly Player[],
    teams: readonly Team[] | undefined,
    options?: engineTs.RoundOptions
  ): engineTs.PlayRoundResult;
};

const engineJs = loadLegacy<LegacyEngineModule>('../../utils/game-engine.js');
const engineServer = loadLegacy<LegacyEngineModule>('../../back/src/game-engine/game-engine.js');

test('三端独立玩家持续保持单人结算，其他玩家加减分保持隔离', () => {
  const players = engineTs.createInitialPlayers({count: 8, random: makeRandom(8)});
  players[0].independent = true;
  let js = engineJs.pairPlayers(players);
  let server = engineServer.pairPlayers(players);
  let ts = engineTs.pairPlayers(players);
  const jsRandom = makeRandom(29), serverRandom = makeRandom(29), tsRandom = makeRandom(29);
  for (let i = 0; i < 20; i++) {
    js = engineJs.playRound(js.players, js.teams, {random: jsRandom});
    server = engineServer.playRound(server.players, server.teams, {random: serverRandom});
    ts = engineTs.playRound(ts.players, {random: tsRandom});
    assert.deepEqual(ts, js);
    assert.deepEqual(server, js);
    assert.equal(ts.players.find((p) => p.id === players[0].id)?.teamId, null);
    const before = ts.players.find((p) => p.id === players[0].id)!.score;
    for (const delta of [60, -40]) {
      const next = engineTs.applyRoundEvents(ts.players, ts.teams, [{actorId: players[1].id, delta, teammateId: '', linkedDelta: 0}]);
      assert.equal(next.find((p) => p.id === players[0].id)?.score, before);
    }
  }
});
const layoutJs = loadLegacy<typeof layoutTs>('../../utils/board-layout.js');
const investmentJs = loadLegacy<typeof investmentTs>('../../utils/investment.js');
const emoteJs = loadLegacy<typeof emoteTs>('../../utils/emote.js');

interface LegacyTeamLink {
  id: string;
  pairKey: string;
  fromName: string;
  toName: string;
  style: string;
}

interface LegacyTeamLinkModule {
  buildTeamLinks(players: readonly BoardPlayer[], teams: readonly Team[]): LegacyTeamLink[];
  findSelfTeamInfo(state: {players?: BoardPlayer[]; teams?: Team[]} | null): linkTs.SelfTeamInfo;
  mergeTeamLinks(
    stateTeamLinks: readonly LegacyTeamLink[],
    manualTeamLinkMap: Record<string, LegacyTeamLink>,
    hiddenStatePairKeys: Set<string>
  ): LegacyTeamLink[];
  getMateIdFromPairKey(pairKey: string, selfId: string): string;
  findSelfManualLink(selfId: string, manualMap: Record<string, {pairKey?: string} | null>): {pairKey?: string} | null;
}

const linkJs = loadLegacy<LegacyTeamLinkModule>('../../utils/team-link.js');

/** 用同一个种子分别驱动小程序端与小游戏端，保证随机序列一一对应。 */
function bothSides(seed: number, body: (jsRandom: RandomSource, tsRandom: RandomSource) => void): void {
  body(makeRandom(seed), makeRandom(seed));
}

const SEEDS = [1, 7, 42, 2026, 987654];

test('三端在多组锁定队伍下连续 60 回合保持相同队伍与积分', () => {
  for (const seed of SEEDS) {
    const randoms = [makeRandom(seed), makeRandom(seed), makeRandom(seed)];
    const players = engineJs.createInitialPlayers({count: 8, random: makeRandom(seed)});
    const ids = players.map((player) => player.id);
    const lockedPairs = [[ids[0], ids[3]], [ids[1], ids[5]]];
    let states = randoms.map(() => ({players, teams: [] as Team[]}));
    for (let round = 0; round < 60; round++) {
      states = [engineJs.playRound(states[0].players, states[0].teams, {random: randoms[0], lockedPairs}),
        engineServer.playRound(states[1].players, states[1].teams, {random: randoms[1], lockedPairs}),
        engineTs.playRound(states[2].players, {random: randoms[2], lockedPairs})];
      assert.deepEqual(states[1], states[0]); assert.deepEqual(states[2], states[0]);
      lockedPairs.forEach((pair) => assert.ok(states[0].teams.some((team) => pair.every((id) => team.memberIds.includes(id)))));
    }
  }
});

test('旧版 CommonJS 规则模块可被加载', () => {
  assert.equal(typeof engineJs.playRound, 'function');
  assert.equal(typeof layoutJs.buildBoardPlayers, 'function');
  assert.equal(typeof linkJs.buildTeamLinks, 'function');
  assert.equal(typeof investmentJs.buildOpportunity, 'function');
  assert.equal(typeof emoteJs.chooseRemoteEmote, 'function');
});

test('常量与景区数据逐项一致', () => {
  const tsRecord = constantsTs as unknown as Record<string, unknown>;
  const jsRecord = constantsJs as unknown as Record<string, unknown>;
  // 有意不移植的两项：NAV_TABS 是小程序 tabBar 路由表，buildStageThemeStyle 产出 WXSS 变量串。
  const intentionallyOmitted = new Set(['NAV_TABS', 'buildStageThemeStyle']);
  const sharedKeys = Object.keys(jsRecord).filter(
    (key) => !intentionallyOmitted.has(key) && typeof jsRecord[key] !== 'function'
  );
  assert.ok(sharedKeys.length >= 25, '旧模块导出项过少，检查加载是否成功');
  for (const key of sharedKeys) {
    assert.deepStrictEqual(tsRecord[key], jsRecord[key], `常量 ${key} 与小程序端不一致`);
  }
  for (const key of intentionallyOmitted) {
    assert.equal(tsRecord[key], undefined, `${key} 不应出现在小游戏端`);
    assert.notEqual(jsRecord[key], undefined, `${key} 应存在于小程序端`);
  }
});

test('景区解析与主题合并一致', () => {
  const cases = [
    undefined,
    null,
    {id: 1},
    {id: 3},
    {id: 7},
    {name: '西湖夜游'},
    {id: 4, income: '+999%'},
    {id: 99},
    {id: 6, theme: {primary: '#000000'}},
  ];
  for (const item of cases) {
    assert.deepStrictEqual(constantsTs.resolveStage(item), constantsJs.resolveStage(item));
    assert.deepStrictEqual(constantsTs.resolveStageTheme(item), constantsJs.resolveStageTheme(item));
  }
});

test('玩家创建与补位一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      for (const count of [1, 4, 5, 8, 10, 14]) {
        assert.deepStrictEqual(
          engineTs.createInitialPlayers({count, random: tsRandom}),
          engineJs.createInitialPlayers({count, random: jsRandom}),
          `count=${count}`
        );
      }
      assert.deepStrictEqual(
        engineTs.createSelfPlayer({seat: 3, score: 123}, {random: tsRandom}),
        engineJs.createSelfPlayer({seat: 3, score: 123}, {random: jsRandom})
      );
      assert.deepStrictEqual(
        engineTs.createRobotPlayer({seat: 2, usedNames: new Set(['龙之传人'])}, {random: tsRandom}),
        engineJs.createRobotPlayer({seat: 2, usedNames: new Set(['龙之传人'])}, {random: jsRandom})
      );
      assert.deepStrictEqual(
        engineTs.createHumanPlayer({seat: 5}, {random: tsRandom}),
        engineJs.createHumanPlayer({seat: 5}, {random: jsRandom})
      );

      const jsFew = engineJs.createInitialPlayers({count: 4, random: jsRandom}).slice(0, 2);
      const tsFew = engineTs.createInitialPlayers({count: 4, random: tsRandom}).slice(0, 2);
      assert.deepStrictEqual(
        engineTs.ensureMinimumPlayers(tsFew, {random: tsRandom}),
        engineJs.ensureMinimumPlayers(jsFew, {random: jsRandom})
      );

      const jsOdd = engineJs.createInitialPlayers({count: 5, random: jsRandom});
      const tsOdd = engineTs.createInitialPlayers({count: 5, random: tsRandom});
      assert.deepStrictEqual(
        engineTs.ensureEvenPlayers(tsOdd, {random: tsRandom}),
        engineJs.ensureEvenPlayers(jsOdd, {random: jsRandom})
      );

      const jsFour = engineJs.createInitialPlayers({count: 4, random: jsRandom});
      const tsFour = engineTs.createInitialPlayers({count: 4, random: tsRandom});
      assert.deepStrictEqual(
        engineTs.addInvitedHuman(tsFour, {random: tsRandom}),
        engineJs.addInvitedHuman(jsFour, {random: jsRandom})
      );

      assert.equal(engineTs.createRoomId({random: tsRandom}), engineJs.createRoomId({random: jsRandom}));
      assert.equal(
        engineTs.chooseRoomPlayerCount({random: tsRandom}),
        engineJs.chooseRoomPlayerCount({random: jsRandom})
      );
      assert.deepStrictEqual(engineTs.normalizeStage({id: 2}), engineJs.normalizeStage({id: 2}));
      assert.deepStrictEqual(engineTs.normalizeStage(null), engineJs.normalizeStage(null));
      assert.deepStrictEqual(
        engineTs.normalizeLockedPair(tsFour, ['player-self', tsFour[1].id]),
        engineJs.normalizeLockedPair(jsFour, ['player-self', jsFour[1].id])
      );
      assert.deepStrictEqual(
        engineTs.normalizeLockedPair(tsFour, ['a', 'a']),
        engineJs.normalizeLockedPair(jsFour, ['a', 'a'])
      );
      assert.deepStrictEqual(engineTs.normalizeLockedPair(tsFour, null), engineJs.normalizeLockedPair(jsFour, null));
    });
  }
});

test('建房状态一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      for (const roomSize of [4, 6, 10]) {
        assert.deepStrictEqual(
          engineTs.createRoomState(null, {roomSize, random: tsRandom}),
          engineJs.createRoomState(null, {roomSize, random: jsRandom}),
          `roomSize=${roomSize}`
        );
      }
      assert.deepStrictEqual(
        engineTs.createRoomState({id: 5}, {roomSize: 8, random: tsRandom, selfName: '测试', selfScore: 150}),
        engineJs.createRoomState({id: 5}, {roomSize: 8, random: jsRandom, selfName: '测试', selfScore: 150})
      );
    });
  }
});

test('配对与连续回合结算逐回合一致', () => {
  for (const seed of SEEDS) {
    for (const count of [4, 5, 6, 7, 8, 9, 10]) {
      bothSides(seed, (jsRandom, tsRandom) => {
        let jsPlayers = engineJs.createInitialPlayers({count, random: jsRandom});
        let tsPlayers = engineTs.createInitialPlayers({count, random: tsRandom});
        assert.deepStrictEqual(tsPlayers, jsPlayers);

        const jsPaired = engineJs.pairPlayers(jsPlayers, {random: jsRandom});
        const tsPaired = engineTs.pairPlayers(tsPlayers, {random: tsRandom});
        assert.deepStrictEqual(tsPaired, jsPaired, `pairPlayers count=${count} seed=${seed}`);

        for (let round = 0; round < 25; round += 1) {
          const jsRound = engineJs.playRound(jsPlayers, undefined, {random: jsRandom});
          const tsRound = engineTs.playRound(tsPlayers, {random: tsRandom});
          assert.deepStrictEqual(tsRound, jsRound, `playRound count=${count} seed=${seed} round=${round}`);
          jsPlayers = jsRound.players;
          tsPlayers = tsRound.players;
        }
      });
    }
  }
});

test('锁定队伍在重排中不被拆散，且与小程序端一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      const jsPlayers = engineJs.createInitialPlayers({count: 6, random: jsRandom});
      const tsPlayers = engineTs.createInitialPlayers({count: 6, random: tsRandom});
      const jsLocked = [jsPlayers[0].id, jsPlayers[3].id];
      const tsLocked = [tsPlayers[0].id, tsPlayers[3].id];

      for (let round = 0; round < 20; round += 1) {
        const jsRound = engineJs.playRound(jsPlayers, undefined, {random: jsRandom, lockedPair: jsLocked});
        const tsRound = engineTs.playRound(tsPlayers, {random: tsRandom, lockedPair: tsLocked});
        assert.deepStrictEqual(tsRound, jsRound, `lockedPair round=${round}`);
        const jsTeam = jsRound.teams.find((team) => team.memberIds.includes(jsLocked[0]));
        const tsTeam = tsRound.teams.find((team) => team.memberIds.includes(tsLocked[0]));
        assert.deepStrictEqual(tsTeam, jsTeam);
        assert.ok(tsTeam, `第 ${round} 回合找不到锁定队伍`);
        assert.deepStrictEqual([...tsTeam.memberIds].sort(), [...tsLocked].sort(), `第 ${round} 回合锁定队伍被拆散`);
      }
    });
  }
});

test('可见分数阶段推进一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      const jsPlayers = engineJs.createInitialPlayers({count: 8, random: jsRandom});
      const tsPlayers = engineTs.createInitialPlayers({count: 8, random: tsRandom});
      let jsPrevious: VisibleScoreState | null = null;
      let tsPrevious: VisibleScoreState | null = null;
      for (const timeLeft of [180, 179, 150, 149, 120, 119, 90, 60, 30, 0]) {
        const jsNext = engineJs.buildVisibleScoreState(jsPlayers, timeLeft, 180, jsPrevious, {random: jsRandom});
        const tsNext = engineTs.buildVisibleScoreState(tsPlayers, timeLeft, 180, tsPrevious, {random: tsRandom});
        assert.deepStrictEqual(tsNext, jsNext, `timeLeft=${timeLeft}`);
        jsPrevious = jsNext;
        tsPrevious = tsNext;
      }
      assert.deepStrictEqual(
        engineTs.buildVisibleScoreState([], 180, 180, null, {random: tsRandom}),
        engineJs.buildVisibleScoreState([], 180, 180, null, {random: jsRandom})
      );
    });
  }
});

test('排行、结算与分数格式化一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      for (const count of [4, 7, 10]) {
        const jsPlayers = engineJs.createInitialPlayers({count, random: jsRandom});
        const tsPlayers = engineTs.createInitialPlayers({count, random: tsRandom});
        assert.deepStrictEqual(engineTs.buildRanking(tsPlayers), engineJs.buildRanking(jsPlayers));
        assert.deepStrictEqual(engineTs.buildResult(tsPlayers), engineJs.buildResult(jsPlayers));
      }
      assert.deepStrictEqual(engineTs.buildResult([]), engineJs.buildResult([]));
      for (const score of [0, 1, 999, 1234, 1234567, undefined, null, '88']) {
        assert.equal(engineTs.formatScore(score), engineJs.formatScore(score));
      }
      assert.equal(engineTs.getLinkedDelta(37), engineJs.getLinkedDelta(37));
      assert.equal(engineTs.getLinkedDelta(-37, 0.8), engineJs.getLinkedDelta(-37, 0.8));
    });
  }
});

test('棋盘坐标、名牌位置与可见分一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      for (const count of [4, 6, 8, 10]) {
        const jsPlayers = engineJs.createInitialPlayers({count, random: jsRandom});
        const tsPlayers = engineTs.createInitialPlayers({count, random: tsRandom});
        const visible = new Set([jsPlayers[jsPlayers.length - 1].id]);
        const tsVisible = new Set([tsPlayers[tsPlayers.length - 1].id]);
        const emoteMap: Record<string, string> = {[jsPlayers[1].id]: '冲呀!'};
        const tsEmoteMap: Record<string, string> = {[tsPlayers[1].id]: '冲呀!'};
        const jsBoard = layoutJs.buildBoardPlayers(jsPlayers, emoteMap, visible);
        const tsBoard = layoutTs.buildBoardPlayers(tsPlayers, tsEmoteMap, tsVisible);
        assert.deepStrictEqual(tsBoard, jsBoard, `buildBoardPlayers count=${count} seed=${seed}`);
        assert.deepStrictEqual(layoutTs.buildBoardPlayers([]), layoutJs.buildBoardPlayers([]));
      }
      assert.deepStrictEqual(layoutTs.BAG_SPAWN_BOUNDS, layoutJs.BAG_SPAWN_BOUNDS);
      assert.deepStrictEqual(layoutTs.getNodeCenter({x: 12, y: 34}), layoutJs.getNodeCenter({x: 12, y: 34}));
      assert.deepStrictEqual(layoutTs.getNodeCenter({}), layoutJs.getNodeCenter({}));
    });
  }
});

test('自身装扮回显一致', () => {
  bothSides(5, (jsRandom, tsRandom) => {
    const jsBoard = layoutJs.buildBoardPlayers(engineJs.createInitialPlayers({count: 5, random: jsRandom}));
    const tsBoard = layoutTs.buildBoardPlayers(engineTs.createInitialPlayers({count: 5, random: tsRandom}));
    const display = {
      skinImage: 'https://example.test/skin.png',
      skinClass: 'skin-gold',
      skinName: '鎏金',
      ringName: '光环',
      ringImage: 'https://example.test/ring.png',
      ringAccent: '#ffcc00',
      petIcon: '🐟',
      petLabel: '锦鲤',
      petImage: 'https://example.test/pet.png',
      petAccent: '#00ccff',
    };
    assert.deepStrictEqual<DecoratedBoardPlayer[]>(
      layoutTs.applySelfDecorations(tsBoard, display),
      layoutJs.applySelfDecorations(jsBoard, display)
    );
    assert.deepStrictEqual(
      layoutTs.applySelfDecorations(tsBoard, null),
      layoutJs.applySelfDecorations(jsBoard, null)
    );
    assert.deepStrictEqual(layoutTs.applySelfDecorations(tsBoard), layoutJs.applySelfDecorations(jsBoard));
  });
});

test('福袋锚点与资源一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      const jsBoard = layoutJs.buildBoardPlayers(engineJs.createInitialPlayers({count: 6, random: jsRandom}));
      const tsBoard = layoutTs.buildBoardPlayers(engineTs.createInitialPlayers({count: 6, random: tsRandom}));
      const jsBag: FortuneBag = layoutJs.buildFortuneBagByPlayers('seed', jsBoard, null);
      const tsBag: FortuneBag = layoutTs.buildFortuneBagByPlayers('seed', tsBoard, null);
      assert.equal(tsBag.x, jsBag.x);
      assert.equal(tsBag.y, jsBag.y);
      assert.equal(tsBag.asset, jsBag.asset);
      assert.equal(tsBag.category, jsBag.category);
      assert.equal(tsBag.opportunity, null);

      const opportunity: Opportunity = investmentJs.buildOpportunity(100, makeRandom(seed));
      const jsRich = layoutJs.buildFortuneBagByPlayers('seed', jsBoard, opportunity);
      const tsRich = layoutTs.buildFortuneBagByPlayers('seed', tsBoard, opportunity);
      assert.equal(tsRich.x, jsRich.x);
      assert.equal(tsRich.y, jsRich.y);
      assert.equal(tsRich.asset, jsRich.asset);
      assert.equal(tsRich.category, jsRich.category);
      assert.deepStrictEqual(tsRich.opportunity, jsRich.opportunity);
    });
  }
});

test('连线几何与小程序 style 字符串数值一致', () => {
  const stylePattern =
    /^left:(-?[\d.]+)rpx;top:(-?[\d.]+)rpx;width:([\d.]+)rpx;transform:translate\(-50%, -50%\) rotate\((-?[\d.]+)deg\);$/;
  for (const seed of SEEDS) {
    for (const count of [4, 8, 10]) {
      bothSides(seed, (jsRandom, tsRandom) => {
        const jsBoard = layoutJs.buildBoardPlayers(engineJs.createInitialPlayers({count, random: jsRandom}));
        const tsBoard = layoutTs.buildBoardPlayers(engineTs.createInitialPlayers({count, random: tsRandom}));
        const jsTeams = engineJs.pairPlayers(jsBoard, {random: jsRandom}).teams;
        const tsTeams = engineTs.pairPlayers(tsBoard, {random: tsRandom}).teams;
        assert.deepStrictEqual(tsTeams, jsTeams);

        const jsLinks = linkJs.buildTeamLinks(jsBoard, jsTeams);
        const tsLinks = linkTs.buildTeamLinks(tsBoard, tsTeams);
        assert.equal(tsLinks.length, jsLinks.length);
        assert.ok(tsLinks.length > 0, '样本应至少产生一条队伍连线');

        jsLinks.forEach((jsLink, index) => {
          const match = stylePattern.exec(jsLink.style);
          assert.ok(match, `无法解析小程序连线样式: ${jsLink.style}`);
          const tsLink = tsLinks[index];
          assert.equal(tsLink.id, jsLink.id);
          assert.equal(tsLink.pairKey, jsLink.pairKey);
          assert.equal(tsLink.fromName, jsLink.fromName);
          assert.equal(tsLink.toName, jsLink.toName);
          assert.equal(tsLink.geometry.centerX, Number(match[1]));
          assert.equal(tsLink.geometry.centerY, Number(match[2]));
          assert.equal(tsLink.geometry.length, Number(match[3]));
          assert.equal(tsLink.geometry.angle, Number(match[4]));
        });
      });
    }
  }
});

test('自身队伍识别与连线合并一致', () => {
  bothSides(17, (jsRandom, tsRandom) => {
    const jsPlayers = engineJs.createInitialPlayers({count: 6, random: jsRandom});
    const tsPlayers = engineTs.createInitialPlayers({count: 6, random: tsRandom});
    const jsTeams = engineJs.pairPlayers(jsPlayers, {random: jsRandom}).teams;
    const tsTeams = engineTs.pairPlayers(tsPlayers, {random: tsRandom}).teams;
    const jsBoard: BoardPlayer[] = layoutJs.buildBoardPlayers(jsPlayers);
    const tsBoard: BoardPlayer[] = layoutTs.buildBoardPlayers(tsPlayers);

    assert.deepStrictEqual(
      linkTs.findSelfTeamInfo({players: tsBoard, teams: tsTeams}),
      linkJs.findSelfTeamInfo({players: jsBoard, teams: jsTeams})
    );
    assert.deepStrictEqual(linkTs.findSelfTeamInfo(null), linkJs.findSelfTeamInfo(null));

    const jsLinks = linkJs.buildTeamLinks(jsBoard, jsTeams);
    const tsLinks = linkTs.buildTeamLinks(tsBoard, tsTeams);
    const hidden = new Set([jsLinks[0].pairKey]);
    assert.deepStrictEqual(
      linkTs.mergeTeamLinks(tsLinks, {}, hidden).map((link) => link.pairKey),
      linkJs.mergeTeamLinks(jsLinks, {}, hidden).map((link) => link.pairKey)
    );

    const pairKey = jsLinks[0].pairKey;
    assert.equal(
      linkTs.getMateIdFromPairKey(pairKey, jsBoard[0].id),
      linkJs.getMateIdFromPairKey(pairKey, jsBoard[0].id)
    );
    assert.equal(linkTs.getMateIdFromPairKey('', 'x'), linkJs.getMateIdFromPairKey('', 'x'));
    assert.deepStrictEqual(
      linkTs.findSelfManualLink(jsBoard[0].id, {a: {pairKey}}),
      linkJs.findSelfManualLink(jsBoard[0].id, {a: {pairKey}})
    );
    assert.equal(linkTs.findSelfManualLink('', {a: {pairKey}}), linkJs.findSelfManualLink('', {a: {pairKey}}));
  });
});

test('机缘福袋机会一致', () => {
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      for (let index = 0; index < 30; index += 1) {
        assert.deepStrictEqual(
          investmentTs.buildOpportunity(100, tsRandom),
          investmentJs.buildOpportunity(100, jsRandom)
        );
      }
    });
  }
  for (const category of ['秘境', '奇遇', '祥瑞', undefined, null, '不存在']) {
    assert.equal(investmentTs.getFortuneBagAsset(category), investmentJs.getFortuneBagAsset(category));
  }
  assert.deepStrictEqual(investmentTs.FORTUNE_POOL, investmentJs.FORTUNE_POOL);
  assert.deepStrictEqual(investmentTs.FORTUNE_BAG_ASSETS, investmentJs.FORTUNE_BAG_ASSETS);
});

test('快捷表情一致', () => {
  const players: Player[] = [
    engineTs.createSelfPlayer({id: 'self'}),
    engineTs.createRobotPlayer({id: 'b', seat: 2}),
    engineTs.createRobotPlayer({id: 'c', seat: 3}),
  ];
  for (const seed of SEEDS) {
    bothSides(seed, (jsRandom, tsRandom) => {
      for (let index = 0; index < 30; index += 1) {
        assert.deepStrictEqual(
          emoteTs.chooseRemoteEmote(players, undefined, tsRandom),
          emoteJs.chooseRemoteEmote(players, undefined, jsRandom)
        );
      }
    });
  }
  assert.deepStrictEqual(emoteTs.QUICK_EMOTES, emoteJs.QUICK_EMOTES);
  assert.equal(
    emoteTs.chooseRemoteEmote([engineTs.createSelfPlayer({id: 'self'})]),
    emoteJs.chooseRemoteEmote([engineJs.createSelfPlayer({id: 'self'})])
  );
  assert.equal(emoteTs.chooseRemoteEmote([]), emoteJs.chooseRemoteEmote([]));
});
