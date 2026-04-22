const {getNodeCenter} = require('./board-layout');

function buildLinkStyle(fromPlayer, toPlayer) {
  const from = getNodeCenter(fromPlayer);
  const to = getNodeCenter(toPlayer);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const centerX = (from.x + to.x) / 2;
  const centerY = (from.y + to.y) / 2;
  return `left:${centerX}rpx;top:${centerY}rpx;width:${length}rpx;transform:translate(-50%, -50%) rotate(${angle}deg);`;
}

function buildTeamLinks(players, teams) {
  const playerMap = (players || []).reduce((map, player) => {
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
        style: buildLinkStyle(from, to),
      };
    })
    .filter(Boolean);
}

function findSelfTeamInfo(state) {
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

function findSelfManualLink(selfId, manualMap) {
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

function getMateIdFromPairKey(pairKey, selfId) {
  if (!pairKey || !selfId) {
    return '';
  }
  return (
    String(pairKey)
      .split('::')
      .find((id) => id && id !== selfId) || ''
  );
}

function mergeTeamLinks(stateTeamLinks, manualTeamLinkMap = {}, hiddenStatePairKeys = new Set()) {
  const base = (stateTeamLinks || []).filter((link) => !hiddenStatePairKeys.has(link.pairKey));
  const stateKeys = new Set(base.map((link) => link.pairKey));
  const manual = Object.values(manualTeamLinkMap || {}).filter((link) => !stateKeys.has(link.pairKey));
  return [...base, ...manual];
}

module.exports = {
  buildLinkStyle,
  buildTeamLinks,
  findSelfManualLink,
  findSelfTeamInfo,
  getMateIdFromPairKey,
  mergeTeamLinks,
};
