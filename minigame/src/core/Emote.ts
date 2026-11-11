/**
 * 快捷表情（原 utils/emote.js）。
 */

import {randomPick, type RandomSource} from './Random';

export interface QuickEmote {
  key: string;
  label: string;
  text: string;
}

export interface RemoteEmote {
  playerId: string;
  text: string;
}

export interface EmoteTarget {
  id: string;
  isSelf: boolean;
}

export const QUICK_EMOTES: readonly QuickEmote[] = [
  {key: 'cheer', label: '冲呀', text: '冲呀!'},
  {key: 'ok', label: '收到', text: '收到~'},
  {key: 'laugh', label: '哈哈', text: '哈哈哈'},
  {key: 'cool', label: '稳住', text: '稳住别慌'},
  {key: 'heart', label: '点赞', text: '太棒了'},
  {key: 'help', label: '求带', text: '求带飞'},
];

export function chooseRemoteEmote(
  players: readonly EmoteTarget[] = [],
  quickEmotes: readonly QuickEmote[] = QUICK_EMOTES,
  random: RandomSource = Math.random
): RemoteEmote | null {
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
