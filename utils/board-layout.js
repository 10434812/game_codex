const {formatScore} = require('./game-engine');

const BOARD_LAYOUT = {
  centerX: 360,
  centerY: 370,
  radius: 270,
  startAngle: -90,
};

const BAG_SPAWN_BOUNDS = {
  minX: 120,
  maxX: 600,
  minY: 170,
  maxY: 610,
};

const BAG_SAFE_RADIUS = 152;

function randomInt(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

function buildBoardPlayers(players, emoteMap = {}, visibleScoreIdSet = new Set()) {
  const list = players || [];
  if (!list.length) {
    return [];
  }

  const step = 360 / list.length;
  const maxScore = Math.max(
    ...list.map((player) => {
      const score = Number(player.score);
      return Number.isFinite(score) ? score : 0;
    }),
    1
  );

  return list.map((player, index) => {
    const x = BOARD_LAYOUT.centerX + BOARD_LAYOUT.radius * Math.cos(((BOARD_LAYOUT.startAngle + step * index) * Math.PI) / 180);
    const y = BOARD_LAYOUT.centerY + BOARD_LAYOUT.radius * Math.sin(((BOARD_LAYOUT.startAngle + step * index) * Math.PI) / 180);
    let namePos = 'center';
    if (x < 150) {
      namePos = 'right';
    } else if (x > 570) {
      namePos = 'left';
    }
    const showScore = !!player.isSelf || visibleScoreIdSet.has(player.id);
    const safeScore = Number(player.score) || 0;
    return {
      ...player,
      x: Math.round(x),
      y: Math.round(y),
      namePos,
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
      };
    }
    return {
      ...player,
      skinClass: display && display.skinClass ? display.skinClass : 'skin-default',
      petIcon: display && display.petIcon ? display.petIcon : '',
      petLabel: display && display.petLabel ? display.petLabel : '',
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

function buildFortuneBagByPlayers(idSeed, players = [], assets = [], random = Math.random) {
  const id = `bag-${idSeed}-${Date.now()}`;
  const pickAsset = Array.isArray(assets) && assets.length ? assets[randomInt(0, assets.length - 1, random)] : '';
  const maxTry = 24;
  for (let i = 0; i < maxTry; i += 1) {
    const x = randomInt(BAG_SPAWN_BOUNDS.minX, BAG_SPAWN_BOUNDS.maxX, random);
    const y = randomInt(BAG_SPAWN_BOUNDS.minY, BAG_SPAWN_BOUNDS.maxY, random);
    if (!isBagOverlappingPlayers(x, y, players)) {
      return {id, x, y, asset: pickAsset};
    }
  }
  return {
    id,
    x: BOARD_LAYOUT.centerX,
    y: BOARD_LAYOUT.centerY + 38,
    asset: pickAsset,
  };
}

module.exports = {
  BAG_SPAWN_BOUNDS,
  BOARD_LAYOUT,
  applySelfDecorations,
  buildBoardPlayers,
  buildFortuneBagByPlayers,
  getNodeCenter,
};
