const {formatScore} = require('./game-engine');
const {getFortuneBagAsset} = require('./investment');

const BOARD_LAYOUT = {
  centerX: 360,
  centerY: 320,
  radius: 235,
  radiusX: 235,
  radiusY: 235,
  startAngle: -90,
};

const DENSE_BOARD_LAYOUT = {
  centerX: 360,
  centerY: 390,
  radiusX: 270,
  radiusY: 330,
  startAngle: -90,
};

const BAG_SPAWN_BOUNDS = {
  minX: 120,
  maxX: 600,
  minY: 150,
  maxY: 540,
};

const BAG_SAFE_RADIUS = 152;

function getLayoutForPlayerCount(count) {
  if (count >= 8) {
    return DENSE_BOARD_LAYOUT;
  }
  return BOARD_LAYOUT;
}

function resolveNamePosition(x, y, layout, isDense) {
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

function resolveSpeechPosition(x, layout) {
  if (x < layout.centerX - 24) {
    return 'upper-left';
  }
  if (x > layout.centerX + 24) {
    return 'upper-right';
  }
  return 'upper-center';
}

function buildBoardPlayers(players, emoteMap = {}, visibleScoreIdSet = new Set()) {
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

function applySelfDecorations(players, display) {
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

function getNodeCenter(player) {
  return {
    x: Number(player.x) || 0,
    y: (Number(player.y) || 0) + 60,
  };
}

function isBagOverlappingPlayers(x, y, players = []) {
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

function buildFortuneBagByPlayers(idSeed, players = [], opportunity = null) {
  const id = `bag-${idSeed}-${Date.now()}`;
  const asset = opportunity && opportunity.asset
    ? opportunity.asset
    : getFortuneBagAsset(opportunity && opportunity.category);
  const list = Array.isArray(players) ? players.filter(Boolean) : [];
  const fallbackLayout = getLayoutForPlayerCount(list.length);
  const anchor = list.length
    ? list.reduce((result, player) => {
      const center = getNodeCenter(player);
      return {
        x: result.x + center.x,
        y: result.y + center.y,
      };
    }, {x: 0, y: 0})
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

module.exports = {
  BAG_SPAWN_BOUNDS,
  BOARD_LAYOUT,
  applySelfDecorations,
  buildBoardPlayers,
  buildFortuneBagByPlayers,
  getNodeCenter,
  resolveSpeechPosition,
};
