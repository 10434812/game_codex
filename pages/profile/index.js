const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_AVATAR} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const {getCachedProfile, hasValidProfile, updateProfile, requestUpdate, uploadAvatar} = require('../../utils/user-profile');
const {playCue, playVibrate} = require('../../utils/audio');
const {createStageThemeData, resolveAmbientStage, saveStageTheme} = require('../../utils/stage-theme');

const DEFAULT_STAGE_THEME_DATA = createStageThemeData();

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    draft: getCachedProfile(),
    canSave: false,
    defaultAvatar: DEFAULT_AVATAR,
    profileUpdating: false,
    stageName: DEFAULT_STAGE_THEME_DATA.stageName,
    stageImage: DEFAULT_STAGE_THEME_DATA.stageImage,
    stageVideo: DEFAULT_STAGE_THEME_DATA.stageVideo,
    stageThemeKey: DEFAULT_STAGE_THEME_DATA.stageThemeKey,
    stageThemeStyle: DEFAULT_STAGE_THEME_DATA.stageThemeStyle,
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    this.syncDraft();
  },
  onShow() {
    this.syncDraft();
  },
  syncDraft() {
    const draft = getCachedProfile();
    const gameState = gameStore.getState();
    const theme = saveStageTheme(resolveAmbientStage(gameState));
    this.setData({
      draft,
      canSave: hasValidProfile(draft),
      stageName: theme.stageName,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
    });
  },
  async onChooseAvatar(e) {
    if (this.data.profileUpdating) {
      return;
    }
    playCue('tap', {volume: 0.7});
    playVibrate('light');

    const avatarUrl = e && e.detail ? e.detail.avatarUrl : '';
    if (!avatarUrl) {
      wx.showToast({title: '未选择头像', icon: 'none'});
      return;
    }

    const updated = updateProfile({ avatarUrl });
    this.setData({draft: updated, canSave: hasValidProfile(updated), profileUpdating: true});
    try {
      const profile = await uploadAvatar(avatarUrl);
      this.setData({draft: profile, canSave: hasValidProfile(profile)});
    } finally {
      this.setData({profileUpdating: false});
    }
  },
  onNicknameInput(e) {
    const value = String((e.detail && e.detail.value) || '').trim();
    const draft = {
      ...this.data.draft,
      nickName: value,
    };
    this.setData({
      draft,
      canSave: hasValidProfile(draft),
    });
  },
  async onSaveProfile() {
    if (!this.data.canSave) {
      playCue('actionFail', {volume: 0.7});
      playVibrate('light');
      wx.showToast({title: '请先完善头像和昵称', icon: 'none'});
      return;
    }
    const profile = updateProfile(this.data.draft);
    this.setData({draft: profile, canSave: hasValidProfile(profile)});
    // Server save (async, don't wait)
    try {
      await requestUpdate({ nickName: profile.nickName, avatarUrl: profile.avatarUrl });
    } catch (err) {
      console.warn('[profile] server save error:', err);
    }
    playCue('pairSelf', {volume: 0.8});
    playVibrate('medium');
    wx.showToast({title: '资料保存成功', icon: 'none'});
    setTimeout(() => {
      wx.navigateBack({delta: 1});
    }, 300);
  },
});
