import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {createCanvas, GlobalFonts} from '@napi-rs/canvas';
import {renderRulesPanel, rulesPanelLayout} from '../.scratch/smoke/render/rules-panel.js';

const font = ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc'].find(existsSync);
if (font) GlobalFonts.registerFromPath(font, 'sans-serif');
const output = '/tmp/jinli-rules-preview';
mkdirSync(output, {recursive: true});
for (const height of [1080, 1280, 1560]) {
  const viewport = {designWidth: 720, designHeight: height, scale: 0.5, pixelRatio: 2, safeTop: 180, safeBottom: 60};
  const {panel, button} = rulesPanelLayout(viewport);
  assert.ok(panel.y >= viewport.safeTop);
  assert.ok(panel.y + panel.height <= height - viewport.safeBottom);
  assert.ok(button.y + button.height <= panel.y + panel.height);
  for (const firstRun of [true, false]) {
    const canvas = createCanvas(720, height), ctx = canvas.getContext('2d');
    renderRulesPanel(ctx, viewport, firstRun, false);
    const bytes = canvas.toBuffer('image/png');
    assert.ok(bytes.length > 10000);
    writeFileSync(`${output}/${height}-${firstRun ? 'start' : 'help'}.png`, bytes);
  }
}
console.log(`玩法弹层短屏、标准屏、长屏共 6 张预览通过：${output}`);
