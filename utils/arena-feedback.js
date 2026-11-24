const {pickupEffect, pickupText} = require('./arena-effects');
const signed = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`;

function sprintFeedback(state, self) {
  const sprint = !state.awaitingStart && state.timeLeft > 0 && state.timeLeft <= 15;
  if (!sprint || !self) return {sprint: false, sprintText: ''};
  const ahead = state.players.filter((p) => p.score > self.score).sort((a, b) => a.score - b.score)[0];
  return {sprint: true, sprintText: ahead ? `再得 ${ahead.score - self.score + 1} 分超越上一名` : '保持领先 · 躲雷稳住'};
}

function scoreBursts(world, selfId) {
  return world.effects.filter((e) => world.elapsedMs >= e.at && world.elapsedMs - e.at < 1000).flatMap((e) => {
    if (e.type === 'team') return [{id: `team-${e.id}`, x: e.x, y: e.y, team: true, loss: false, text: '组队成功'}];
    const own = {id: `pickup-${e.id}`, x: e.x, y: e.y, kind: e.kind, team: false, loss: e.delta < 0,
      effect: pickupEffect(e.kind, world.elapsedMs - e.at),
      text: pickupText(e, e.actorId === selfId ? '自己' : '')};
    const mate = world.runners.find((r) => r.id === e.teammateId);
    if (!mate || !e.linkedDelta) return [own];
    const linked = e.appliedLinkedDelta ?? e.linkedDelta;
    return [own, {id: `linked-${e.id}`, x: mate.x, y: mate.y - 75, kind: 'linked', team: false, loss: e.linkedDelta < 0, text: `联动 ${signed(linked)}`}];
  });
}

function performanceFeedback(result) {
  const self = result?.ranking?.find((p) => p.isSelf);
  const stats = self && result.performanceMap?.[self.id];
  if (!stats) return null;
  const title = stats.complete ? '本局表现' : '恢复后的表现';
  const text = stats.contributed > 0 ? `你给队友带来了 ${stats.contributed} 分` :
    stats.bags + stats.gifts > 0 ? `你接住了 ${stats.bags + stats.gifts} 份好运` : '下一局，追上第一份好运';
  return {...stats, title, text};
}

module.exports = {sprintFeedback, scoreBursts, performanceFeedback};
