/**
 * 对局棋盘布局（原 utils/board-layout.js）。
 * 坐标系与小程序版一致：设计宽度 720 单位，由渲染层换算到实际画布尺寸。
 */

import {getFortuneBagAsset, type Opportunity} from './Investment';
import {formatScore, type Player} from './GameEngine';

export interface BoardLayoutSpec {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  startAngle: number;
}

export const BOARD_LAYOUT: BoardLayoutSpec = {
  centerX: 360,
  centerY: 320,
  radiusX: 235,
  radiusY: 235,
  startAngle: -90,
};

export const DENSE_BOARD_LAYOUT: BoardLayoutSpec = {
  centerX: 360,
  centerY: 390,
  radiusX: 270,
  radiusY: 330,
  startAngle: -90,
};

export const BAG_SPAWN_BOUNDS = {
  minX: 120,
  maxX: 600,
  minY: 150,
  maxY: 540,
};

export const BAG_SAFE_RADIUS = 152;

export interface BoardPlayer extends Omit<Player, 'score'> {
  x: number;
  y: number;
  namePos: string;
  chatPos: string;
  emoteText: string;
  score: string;
  revealHpPercent: number;
  showScore: boolean;
  scoreLabel: string;
}

export interface SelfDecorationDisplay {
  skinImage?: string;
  skinClass?: string;
  skinName?: string;
  ringName?: string;
  ringImage?: string;
  ringAccent?: string;
  petIcon?: string;
  petLabel?: string;
  petImage?: string;
  petAccent?: string;
}

export interface DecoratedBoardPlayer extends BoardPlayer {
  skinClass: string;
  petIcon: string;
  petLabel: string;
  petImage: string;
  petAccent: string;
  // 以下四项只有「自己」的节点会写入；非自身节点保持缺失，与小程序端一致。
  skinName?: string;
  ringName?: string;
  ringImage?: string;
  ringAccent?: string;
}

export interface FortuneBag {
  id: string;
  x: number;
  y: number;
  asset: string;
  category: string;
  opportunity: Opportunity | null;
}

export interface Point {
  x: number;
  y: number;
}

/** 节点锚点：只要带 x/y 就能参与连线与福袋锚定，不要求完整 Player。 */
export interface NodeAnchor {
  x?: number;
  y?: number;
}

export function getLayoutForPlayerCount(count: number): BoardLayoutSpec {
  if (count >= 8) {
    return DENSE_BOARD_LAYOUT;
  }
  return BOARD_LAYOUT;
}

export function resolveNamePosition(x: number, y: number, layout: BoardLayoutSpec, isDense: boolean): string {
  if (isDense && y > layout.centerY - 40) {
    if (x < layout.centerX - 72) {
      return 'lower-left';
    }
    if (x > layout.centerX + 72) {
      return 'lower-right';
    }
    return 'lower-center';
  }

  if (x < 150) {
    return 'right';
  }
  if (x > 570) {
    return 'left';
  }
  return 'center';
}

export function resolveSpeechPosition(x: number, layout: BoardLayoutSpec): string {
  if (x < layout.centerX - 24) {
    return 'upper-left';
  }
  if (x > layout.centerX + 24) {
    return 'upper-right';
  }
  return 'upper-center';
}

export function buildBoardPlayers(
  players: readonly Player[] | null | undefined,
  emoteMap: Record<string, string> = {},
  visibleScoreIdSet: Set<string> = new Set()
): BoardPlayer[] {
  const list = players || [];
  if (!list.length) {
    return [];
  }

  const layout = getLayoutForPlayerCount(list.length);
  const isDense = list.length >= 8;
  const step = 360 / list.length;
  const maxScore = Math.max(
    ...list.map((player) => {
      const score = Number(player.score);
      return Number.isFinite(score) ? score : 0;
    }),
    1
  );

  return list.map((player, index) => {
    const angle = ((layout.startAngle + step * index) * Math.PI) / 180;
    const x = layout.centerX + layout.radiusX * Math.cos(angle);
    const y = layout.centerY + layout.radiusY * Math.sin(angle);
    const namePos = resolveNamePosition(x, y, layout, isDense);
    const chatPos = resolveSpeechPosition(x, layout);
    const showScore = !!player.isSelf || visibleScoreIdSet.has(player.id);
    const safeScore = Number(player.score) || 0;
    return {
      ...player,
      x: Math.round(x),
      y: Math.round(y),
      namePos,
      chatPos,
      emoteText: emoteMap[player.id] || '',
      score: formatScore(player.score),
      revealHpPercent: Math.max(18, Math.min(100, Math.round((safeScore / maxScore) * 100))),
      showScore,
      scoreLabel: showScore ? `${player.name} · ${formatScore(player.score)}` : player.name,
    };
  });
}

export function applySelfDecorations(
  players: readonly BoardPlayer[] | null | undefined,
  display?: SelfDecorationDisplay | null
): DecoratedBoardPlayer[] {
  return (players || []).map((player) => {
    if (!player.isSelf) {
      return {
        ...player,
        skinClass: '',
        petIcon: '',
        petLabel: '',
        petImage: '',
        petAccent: '',
      };
    }
    return {
      ...player,
      avatar: display && display.skinImage ? display.skinImage : player.avatar,
      skinClass: display && display.skinClass ? display.skinClass : 'skin-default',
      skinName: display && display.skinName ? display.skinName : '',
      ringName: display && display.ringName ? display.ringName : '',
      ringImage: display && display.ringImage ? display.ringImage : '',
      ringAccent: display && display.ringAccent ? display.ringAccent : '',
      petIcon: display && display.petIcon ? display.petIcon : '',
      petLabel: display && display.petLabel ? display.petLabel : '',
      petImage: display && display.petImage ? display.petImage : '',
      petAccent: display && display.petAccent ? display.petAccent : '',
    };
  });
}

export function getNodeCenter(player: NodeAnchor): Point {
  return {
    x: Number(player.x) || 0,
    y: (Number(player.y) || 0) + 60,
  };
}

export function isBagOverlappingPlayers(x: number, y: number, players: readonly NodeAnchor[] = []): boolean {
  if (!Array.isArray(players) || !players.length) {
    return false;
  }
  return players.some((player) => {
    const center = getNodeCenter(player);
    const dx = x - center.x;
    const dy = y - center.y;
    return Math.sqrt(dx * dx + dy * dy) < BAG_SAFE_RADIUS;
  });
}

export function buildFortuneBagByPlayers(
  idSeed: string | number,
  players: readonly NodeAnchor[] = [],
  opportunity: Opportunity | null = null
): FortuneBag {
  const id = `bag-${idSeed}-${Date.now()}`;
  const asset = opportunity && opportunity.asset ? opportunity.asset : getFortuneBagAsset(opportunity?.category);
  const list = Array.isArray(players) ? players.filter(Boolean) : [];
  const fallbackLayout = getLayoutForPlayerCount(list.length);
  const anchor = list.length
    ? list.reduce(
        (result, player) => {
          const center = getNodeCenter(player);
          return {
            x: result.x + center.x,
            y: result.y + center.y,
          };
        },
        {x: 0, y: 0}
      )
    : {
        x: fallbackLayout.centerX,
        y: fallbackLayout.centerY + 60,
      };
  const x = list.length ? Math.round(anchor.x / list.length) : fallbackLayout.centerX;
  const y = list.length ? Math.round(anchor.y / list.length) : fallbackLayout.centerY + 60;
  return {
    id,
    x,
    y,
    asset,
    category: opportunity && opportunity.category ? opportunity.category : '',
    opportunity: opportunity || null,
  };
}
