# 对局碰撞特效 v2

2026-11-09。使用内置 image_gen 生成，保留透明通道。源图经等比例缩小为 768 × 384 PNG（4 列 × 2 行，每帧 192 × 192），未重新描画或修改生成内容。

- 爆炸：`assets-pkg/effects/mine-hit-v2.png`，8 帧，800 ms。
- 福袋和礼物：`assets-pkg/effects/fortune-pickup-v2.png`，8 帧，1000 ms；礼物视觉尺寸大于福袋。
- 图集元数据和播放时序：`minigame/src/render/arena-effects.ts`；codegen 生成 `utils/arena-effects.js`，两端共用同一套时序。
- 小程序启动资源队列预加载；小游戏进入场景时预解码，构建时复制进上传目录。文件合计约 410 KB。
- 播放只消费真实碰撞事件，采用模拟时间，不增设定时器；重复快照不重播，到期自动消失。得分仍显示实际应用值。

## 生成提示词

### bomb

首轮：

```text
Use case: stylized-concept. Asset type: production 2D mobile game VFX animation SPRITE SHEET, transparent PNG. Create ONE perfectly square 1024x1024 sprite sheet containing exactly EIGHT animation frames on a mathematically regular 4-column by 2-row grid (each cell 256x512? NO: square canvas 1024x1024, 4 columns and 2 rows, each cell 256 pixels wide and 512 pixels tall; center artwork in each cell at consistent local center). Actually prefer 4 columns and 4 rows? NO. Use 4 columns x 2 rows, canvas landscape 2048x1024 with EIGHT square 512x512 cells if possible. All eight cells equal square and arranged landscape 2:1, use landscape image. Frames read left to right top to bottom. A mine collision explosion animation for an elegant Chinese auspicious casual game, polished hand-painted 2D game art, clean silhouette, no black outlines, rich orange-red flame, pale warm-white ignition, dark russet smoke, flying sparks and small fragments. Frame 1 compact intense ignition, frame 2 sharp star-shaped energetic blast, frame 3 big irregular fire bloom, frame 4 orange fire petals and expanding smoky silhouette, frame 5 fading russet smoke and separated sparks, frame 6 dissipating warm grey smoke with embers, frame 7 sparse fading smoke wisps, frame 8 a few final tiny embers. Each frame keeps the impact center fixed in exact cell center, same camera and same scale across frames, artwork confined to central 85 percent of its cell, visible gaps between cells. Strong readable at 90px on phone, premium crafted game animation not realistic fire photography. Entire image has genuine transparent alpha background including spaces between frames, no checkerboard baked in. No labels, no text, no frame borders, no grid lines, no UI, no bombs or objects, only VFX. No cut-off particles at cell borders.
```

最终修订（以上一轮图集为参考图，transparent_background=true）：

```text
Edit this production mobile-game explosion sprite sheet. Preserve the hand-painted orange flame and russet smoke style and the eight-frame ignition→blast→smoke→embers sequence. Fix ONLY the layout and padding for clean sprite animation: exact 4 columns × 2 rows of equal square cells in a 2:1 landscape canvas; each cell's effect origin fixed exactly at its center. Scale all artwork uniformly down to occupy at most 70% of a cell's width and height. Leave a broad fully transparent gutter of at least 15% on EVERY side of EVERY cell. Every particle and soft glow must fit completely within its own cell. No artwork may touch adjacent cells or outer canvas edges. No clipping. Eliminate the large diffuse colored halo behind each frame; keep crisp painted flame, smoke, sparks, and natural soft alpha edges. Keep genuine transparent alpha background, no drawn checkerboard. No text, no grid, no labels, no other changes.
```

### gift

首轮：

```text
Use case: stylized-concept. Asset type: production 2D mobile game VFX animation SPRITE SHEET, transparent PNG. Create ONE LANDSCAPE 2:1 sprite sheet 2048x1024 if possible, exactly EIGHT frames, exactly 4 columns by 2 rows of equal SQUARE cells. Perfectly regular aligned grid, frames left to right top to bottom, fixed effect center in exact center of each cell. Animation of collecting a valuable gift in an elegant Chinese auspicious casual game. Polished hand-painted 2D VFX in luminous warm gold, pale ivory highlights, restrained tiny vermilion accents; elegant stylized curved cloud brush strokes and small golden four-point stars, a delicate gold coin glint, joyous and light. Must clearly look like reward collection, not explosion. No physical gift box and no character. Frame 1 compact small golden glint, frame 2 luminous four-point star opens, frame 3 large sweeping crescent of gold light and scattering stars, frame 4 fullest flowing upward spiral with several coin glints and tiny stars, frame 5 golden wisps and stars rise, frame 6 separated rising small stars, frame 7 fewer faint fine stars and wisps, frame 8 two or three final faint sparkles. No literal fish needed, convey Chinese auspicious style with painterly golden cloud curves. Readable at 100px on phone. Consistent visual scale and fixed origin across all cells. Artwork stays within central 85 percent of its square cell, nothing crosses cell boundaries; clear gutters; genuine transparent alpha all around art, no background panel, no checkerboard baked in. No labels, no text, no frame numbers, no borders, no grid lines, no UI. Premium refined game effect, no neon rainbow, no photographic lens flare.
```

最终修订（以上一轮图集为参考图，transparent_background=true）：

```text
Edit this production mobile-game reward-collection sprite sheet. Preserve its refined painterly warm-gold Chinese cloud curves, four-point stars, coin glints, and eight-frame sparkle→crescent→upward flourish→fading stars sequence. Fix ONLY layout and opacity: exactly 4 columns × 2 rows of equal square cells on a 2:1 landscape canvas, effect origin fixed at exact cell center in all eight frames. Scale each frame's artwork to occupy at most 70% of its cell width and height. Leave a broad fully transparent gutter at least 15% on EVERY side of EVERY cell. All rays, particles, wisps and curves must stay entirely inside their own cells. Nothing may touch adjacent cells or canvas edges. Remove the large white oval luminous backgrounds and the diffuse glow halos; individual gold curves and stars must float on actual transparency, clearly visible on both dark blue and beige game backgrounds. Do not add white discs, medallions, checkerboard or solid backdrops. Last frame should be only two tiny fading sparkles at center. No text, grid, labels, borders or UI.
```

