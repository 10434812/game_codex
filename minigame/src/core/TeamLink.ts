/**
 * 队伍连线（原 utils/team-link.js）。
 *
 * 与小程序版的差异：小程序用 `style: left/top/width/transform: rotate()` 字符串驱动
 * 视图层线段；小游戏端改为返回几何数据（中点/长度/角度），由渲染层直接绘制。
 * 数值语义完全一致，一致性由 tests/engine-parity.test.ts 对照旧 style 字符串校验。
 */

import {getNodeCenter, type NodeAnchor, type Point} from './BoardLayout';
import type {Team} from './GameEngine';

export interface LinkGeometry {
  from: Point;
  to: Point;
  centerX: number;
  centerY: number;
  length: number;
  angle: number;
}

export interface TeamLink {
  id: string;
  pairKey: string;
  fromName: string;
  toName: string;
  geometry: LinkGeometry;
}

/** 参与连线计算的最小节点形状：棋子节点与棋盘节点都满足。 */
export interface LinkNode extends NodeAnchor {
  id: string;
  name: string;
}

/** 识别「自己」所需的最小形状。 */
export interface SelfTeamCandidate {
  id: string;
  isSelf: boolean;
}

export function buildLinkGeometry(fromPlayer: NodeAnchor, toPlayer: NodeAnchor): LinkGeometry {
  const from = getNodeCenter(fromPlayer);
  const to = getNodeCenter(toPlayer);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return {
    from,
    to,
    centerX: (from.x + to.x) / 2,
    centerY: (from.y + to.y) / 2,
    length: Math.sqrt(dx * dx + dy * dy),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

export function buildTeamLinks(
  players: readonly LinkNode[] | null | undefined,
  teams: readonly Team[] | null | undefined
): TeamLink[] {
  const playerMap = (players || []).reduce<Record<string, LinkNode>>((map, player) => {
    map[player.id] = player;
    return map;
  }, {});

  return (teams || [])
    .map((team) => {
      if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
        return null;
      }
      const from = playerMap[team.memberIds[0]];
      const to = playerMap[team.memberIds[1]];
      if (!from || !to) {
        return null;
      }
      return {
        id: team.id,
        pairKey: [from.id, to.id].sort().join('::'),
        fromName: from.name,
        toName: to.name,
        geometry: buildLinkGeometry(from, to),
      };
    })
    .filter((link): link is TeamLink => Boolean(link));
}

export interface SelfTeamInfo {
  selfId: string;
  teammateId: string;
  pairKey: string;
}

export function findSelfTeamInfo(
  state: {players?: readonly SelfTeamCandidate[]; teams?: readonly Team[]} | null | undefined
): SelfTeamInfo {
  const players = (state && state.players) || [];
  const teams = (state && state.teams) || [];
  const self = players.find((player) => player.isSelf);
  if (!self) {
    return {selfId: '', teammateId: '', pairKey: ''};
  }
  const team = teams.find(
    (item) => item && Array.isArray(item.memberIds) && item.memberIds.includes(self.id)
  );
  if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
    return {selfId: self.id, teammateId: '', pairKey: ''};
  }
  const teammateId = team.memberIds.find((id) => id !== self.id) || '';
  return {
    selfId: self.id,
    teammateId,
    pairKey: [self.id, teammateId].sort().join('::'),
  };
}

export function findSelfManualLink(
  selfId: string,
  manualMap: Record<string, {pairKey?: string} | null> | null | undefined
): {pairKey?: string} | null {
  if (!selfId || !manualMap) {
    return null;
  }
  return (
    Object.values(manualMap).find((link) => {
      const key = String(link && link.pairKey ? link.pairKey : '');
      return key.includes(`${selfId}::`) || key.includes(`::${selfId}`);
    }) || null
  );
}

export function getMateIdFromPairKey(pairKey: string, selfId: string): string {
  if (!pairKey || !selfId) {
    return '';
  }
  return (
    String(pairKey)
      .split('::')
      .find((id) => id && id !== selfId) || ''
  );
}

export function mergeTeamLinks(
  stateTeamLinks: readonly TeamLink[] | null | undefined,
  manualTeamLinkMap: Record<string, TeamLink> = {},
  hiddenStatePairKeys: Set<string> = new Set()
): TeamLink[] {
  const base = (stateTeamLinks || []).filter((link) => !hiddenStatePairKeys.has(link.pairKey));
  const stateKeys = new Set(base.map((link) => link.pairKey));
  const manual = Object.values(manualTeamLinkMap || {}).filter((link) => !stateKeys.has(link.pairKey));
  return [...base, ...manual];
}
