const {
  buildStageThemeStyle,
  DEFAULT_STAGE,
  resolveStage,
} = require('./constants');

const STAGE_THEME_STORAGE_KEY = 'game_codex_stage_theme_v1';

function createStageThemeData(stage = DEFAULT_STAGE) {
  const resolved = resolveStage(stage || DEFAULT_STAGE);
  return {
    stage: resolved,
    stageName: resolved.name,
    stageImage: resolved.image || DEFAULT_STAGE.image,
    stageVideo: resolved.video || '',
    stageThemeKey: resolved.theme.key,
    stageThemeStyle: buildStageThemeStyle(resolved),
  };
}

function serializeStage(stage) {
  const data = createStageThemeData(stage).stage;
  return {
    id: data.id,
    code: data.code,
    name: data.name,
    hot: data.hot,
    income: data.income,
    online: data.online,
    image: data.image,
    video: data.video || '',
    titleColor: data.titleColor,
    accentColor: data.accentColor,
    theme: data.theme,
  };
}

function readStoredStage() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) {
      return null;
    }
    const stored = wx.getStorageSync(STAGE_THEME_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    return typeof stored === 'string' ? JSON.parse(stored) : stored;
  } catch (error) {
    return null;
  }
}

function loadStageTheme(fallback = DEFAULT_STAGE) {
  return resolveStage(readStoredStage() || fallback || DEFAULT_STAGE);
}

function saveStageTheme(stage = DEFAULT_STAGE) {
  const data = createStageThemeData(stage);
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) {
      wx.setStorageSync(STAGE_THEME_STORAGE_KEY, JSON.stringify(serializeStage(data.stage)));
    }
  } catch (error) {}
  return data;
}

function buildStageThemePatch(stage = DEFAULT_STAGE) {
  const data = createStageThemeData(stage);
  return {
    stageName: data.stageName,
    stageImage: data.stageImage,
    stageVideo: data.stageVideo,
    stageThemeKey: data.stageThemeKey,
    stageThemeStyle: data.stageThemeStyle,
  };
}

function resolveAmbientStage(gameState, fallback = DEFAULT_STAGE) {
  if (gameState && gameState.status && gameState.status !== 'idle' && gameState.stage) {
    return resolveStage(gameState.stage);
  }
  return loadStageTheme((gameState && gameState.stage) || fallback);
}

module.exports = {
  buildStageThemePatch,
  createStageThemeData,
  loadStageTheme,
  resolveAmbientStage,
  saveStageTheme,
  STAGE_THEME_STORAGE_KEY,
};
