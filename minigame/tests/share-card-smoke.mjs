import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resultCard, renderResultCard} from '../.scratch/smoke/render/result-share-card.js';
const font = ['/System/Library/Fonts/PingFang.ttc','/System/Library/Fonts/STHeiti Light.ttc'].find(existsSync);
if (font) GlobalFonts.registerFromPath(font, 'sans-serif');
const output = '/tmp/jinli-result-share'; mkdirSync(output,{recursive:true});
const playerNames = ['锦鲤玩家', '云端漫步者', '浮生若梦', '同行旅人'];
const playerScores = [320, 242, 240, 220];
const podiumAvatars = await Promise.all(['02', '01', '04'].map((id) =>
  loadImage(fileURLToPath(new URL(`../../assets/bg/avatars/avatar_${id}.png`, import.meta.url)))));
for (const rank of [1,4]) {
  const card = resultCard({coins:60,ranking:Array.from({length:4},(_,index)=>({name:playerNames[index],rank:index+1,score:playerScores[index],isSelf:index===rank-1}))},'万里长城');
  assert.ok(card); const canvas=createCanvas(500,400); renderResultCard(canvas.getContext('2d'),card,[...podiumAvatars, rank === 1 ? podiumAvatars[1] : null]);
  const png=canvas.toBuffer('image/png'); assert.ok(png.length>5000);writeFileSync(`${output}/rank-${rank}.png`,png);
}
console.log(`战绩分享卡渲染通过：${output}（测试数据）`);
