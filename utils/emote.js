const QUICK_EMOTES = [
  {key: 'cheer', label: '冲呀', text: '冲呀!'},
  {key: 'ok', label: '收到', text: '收到~'},
  {key: 'laugh', label: '哈哈', text: '哈哈哈'},
  {key: 'cool', label: '稳住', text: '稳住别慌'},
  {key: 'heart', label: '点赞', text: '太棒了'},
  {key: 'help', label: '求带', text: '求带飞'},
];

function randomInt(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

function randomPick(list, random = Math.random) {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  return list[randomInt(0, list.length - 1, random)];
}

function chooseRemoteEmote(players = [], quickEmotes = QUICK_EMOTES, random = Math.random) {
  const options = (players || []).filter((player) => !player.isSelf);
  if (!options.length) {
    return null;
  }
  const target = randomPick(options, random);
  const emote = randomPick(quickEmotes, random);
  if (!target || !emote) {
    return null;
  }
  return {
    playerId: target.id,
    text: emote.text,
  };
}

module.exports = {
  QUICK_EMOTES,
  chooseRemoteEmote,
  randomInt,
  randomPick,
};
