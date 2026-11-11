# 掉落道具素材 v2

2026-11-09，使用内置 image_gen 生成透明 PNG，再等比例缩小至 256 × 256 供客户端使用。未修改规则、分值或碰撞半径。

| 类型 | 项目文件 | 分值 |
|---|---|---|
| 雷 | assets-pkg/items/mine-v2.png | −10 |
| 福袋 | assets-pkg/items/fortune-bag-v2.png | +10 |
| 礼盒 | assets-pkg/items/gift-box-v2.png | +20 |

资源映射在 `minigame/src/render/arena-effects.ts` 中，codegen 生成 `utils/arena-effects.js`。小程序启动时预加载，小游戏场景预解码并随构建复制进上传包。本次仅替换对局掉落物，投资等其他入口的图片保持原样。

## 生成提示词（transparent_background=true）

### bomb

```text
Use case: stylized-concept. Asset type: ONE isolated collectible hazard sprite for a Chinese casual mobile game, square transparent PNG. Subject: a polished hand-painted 2.5D round charcoal-black cartoon bomb, not a real-world military mine. Short curved braided fuse rising from a small burnished copper cap, lively bright orange and warm ivory ignition spark at fuse tip, two or three tiny sparks only. Clearly recognizable danger silhouette at 40 pixels, dark graphite round body with broad readable warm steel highlights and a restrained deep-red accent near the cap. Body has pleasing weight and volume. Elegant premium illustrated game asset matching warm Chinese parchment and gold game art, crisp edges, uncluttered large shapes, no thick black cartoon outlines. Center the whole bomb INCLUDING fuse and spark, occupy around 76% of square canvas; at least 12% truly transparent margin on all sides, nothing clipped. Soft shading stays inside object, no cast shadow on a floor. True transparent alpha background. No scene, no pedestal, no disc background, no checkerboard, no glow cloud, no text, no numbers, no face, no watermark, no border. One sprite only, not a sprite sheet.
```

### bag

```text
Use case: stylized-concept. Asset type: ONE isolated reward sprite for a Chinese auspicious casual mobile game, square transparent PNG. Subject: a plump elegant ruby-red silk fortune pouch, cinched with a thick warm-gold braided drawstring bow and two short gold tassels; a single large handsome gold Chinese character 福 centered on the bag. Luxurious soft satin folds and a simple restrained gold cloud trim around the base, subtle warm highlights. Polished hand-painted 2.5D game illustration, crisp sculpted silhouette and broad clear shapes readable at 40 pixels, designed for a warm Chinese parchment-and-gold UI. Red dominates, gold is an accent; no scattered coins or other props. Center entire pouch, bow and tassels, occupy 76% of square canvas with at least 12% truly transparent margin on EVERY side, nothing clipped. No floor shadow. True transparent alpha background, no scene, no halo backdrop, no platform, no checkerboard, no sticker outline, no frame, no watermark. Only the character 福, no other text. One sprite only, not a sprite sheet.
```

### gift

```text
Use case: stylized-concept. Asset type: ONE isolated valuable gift sprite for a Chinese casual mobile game, square transparent PNG. Subject: a refined small warm-ivory and champagne-gold square gift box in gentle three-quarter isometric view, tied with rich vermilion-red satin ribbon and a large sculpted red bow; a tiny decorative gold seal at bow center. Polished hand-painted 2.5D game illustration, sculpted volume, soft warm light, subtle Chinese cloud relief on side panels. Cohesive with a ruby silk fortune pouch and charcoal cartoon bomb, warm Chinese parchment-and-gold art direction. Clear chunky silhouette readable at 40 pixels. Box remains closed, no flying objects, no particles, no backdrop glow. Center whole box and bow, occupy around 76% of square canvas with at least 12% truly transparent margin on all sides, nothing clipped, no floor shadow. True transparent alpha background. No scene, no pedestal, no checkerboard, no letters, no words, no numbers, no watermark, no border. One sprite only, not a sprite sheet.
```

