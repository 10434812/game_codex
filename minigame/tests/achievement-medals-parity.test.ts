/**
 * 成就勋章一致性验证：TS 移植版必须与小程序端 utils/achievement-medals.js 完全一致。
 */

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

import * as medalsTs from '../src/core/AchievementMedals';

const requireFromHere = createRequire(import.meta.url);
const medalsJs = requireFromHere('../../utils/achievement-medals.js') as {
  buildAchievement(stage: unknown): string;
  buildAchievementMedal(options: unknown): Record<string, unknown>;
};

const STAGES = ['万里长城', '富士山', '巴黎铁塔', '大峡谷', '泰姬陵', '西湖夜游', '鼓浪屿'];

test('成就名与勋章逐项一致', () => {
  const stageInputs: unknown[] = [
    ...STAGES,
    ...STAGES.map((name) => ({name})),
    {name: '未登记景区'},
    '',
    null,
    undefined,
    {name: ''},
  ];
  for (const stage of stageInputs) {
    assert.equal(medalsTs.buildAchievement(stage as never), medalsJs.buildAchievement(stage), `buildAchievement(${String(stage)})`);
  }

  const gains = [0, 1, 179, 180, 299, 300, 1000, undefined, null, -5];
  const ranks = [0, 1, 2, 3, 4, 10, undefined, null];
  for (const stage of STAGES) {
    for (const gain of gains) {
      for (const rank of ranks) {
        assert.deepStrictEqual(
          medalsTs.buildAchievementMedal({stage, gain, rank}),
          medalsJs.buildAchievementMedal({stage, gain, rank}),
          `${stage} gain=${gain} rank=${rank}`
        );
      }
    }
  }

  assert.deepStrictEqual(
    medalsTs.buildAchievementMedal({stageName: '鼓浪屿', achievement: '自定义成就', gain: 200, rank: 2}),
    medalsJs.buildAchievementMedal({stageName: '鼓浪屿', achievement: '自定义成就', gain: 200, rank: 2})
  );
  assert.deepStrictEqual(medalsTs.buildAchievementMedal(), medalsJs.buildAchievementMedal({}));
  assert.deepStrictEqual(medalsTs.buildAchievementMedal({stage: {name: '未登记景区'}, gain: 10, rank: 9}),
    medalsJs.buildAchievementMedal({stage: {name: '未登记景区'}, gain: 10, rank: 9}));
});

test('勋章档位与景区配置表一致', () => {
  const gains: [number, number][] = [
    [0, 5],
    [0, 3],
    [0, 1],
    [300, 5],
    [180, 5],
  ];
  for (const [gain, rank] of gains) {
    assert.deepStrictEqual(medalsTs.getTier(gain, rank), {
      key: medalsJs.buildAchievementMedal({stage: '万里长城', gain, rank}).tierKey,
      label: medalsJs.buildAchievementMedal({stage: '万里长城', gain, rank}).tierLabel,
      rim: medalsJs.buildAchievementMedal({stage: '万里长城', gain, rank}).rim,
      plate: medalsJs.buildAchievementMedal({stage: '万里长城', gain, rank}).plate,
    });
  }
  assert.equal(Object.keys(medalsTs.STAGE_MEDAL_MAP).length, STAGES.length);
});
