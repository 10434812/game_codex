const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_AVATAR} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const {getCachedProfile, hasValidProfile, requestUpdate, uploadAvatar, fetchProfile, deleteAccount, logout, clearLocalData: clearProfileData} = require('../../utils/user-profile');
const playerStats = require('../../utils/player-stats');
const {playCue, playVibrate} = require('../../utils/audio');
const {createStageThemeData, resolveAmbientStage, saveStageTheme} = require('../../utils/stage-theme');
const pageHelpers = require('../../utils/page-helpers');
const privacy = require('../../utils/privacy-consent');

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
    deletingAccount: false,
    profileError: '',
    avatarReviewPending: false,
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
    if (!privacy.canEnter()) return;
    this.syncDraft();
  },
  onHide() {
    pageHelpers.pauseBackdropVideo(this);
  },
  onShow() {
    if (!privacy.canEnter()) return;
    pageHelpers.resumeBackdropVideo(this);
    this.syncDraft();
    fetchProfile().then((profile) => {
      if (this.data.profileUpdating || !profile) return;
      this.setData({
        draft: {...this.data.draft, avatarUrl: profile.avatarUrl},
        avatarReviewPending: this.data.avatarReviewPending && profile.avatarUrl === this.data.draft.avatarUrl,
      });
    });
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

    this.setData({profileUpdating: true, profileError: ''});
    try {
      const profile = await uploadAvatar(avatarUrl);
      this.setData({draft: {...this.data.draft, avatarUrl: profile.avatarUrl}, avatarReviewPending: profile.avatarReview === 'pending'});
      wx.showToast({title: '头像已提交审核，通过后生效', icon: 'none'});
    } catch (error) {
      this.setData({profileError: error.message || '头像上传失败，请重试'});
    } finally {
      this.setData({profileUpdating: false});
    }
  },
  openPrivacyPolicy() {
    wx.navigateTo({url: '/pages/legal/privacy/index'});
  },
  openUserAgreement() {
    wx.navigateTo({url: '/pages/legal/agreement/index'});
  },
  onContactSupport() {
    wx.setClipboardData({
      data: '10434812@qq.com',
      success: () => wx.showToast({title: '客服邮箱已复制', icon: 'none'}),
    });
  },
  onBack() {
    wx.navigateBack({delta: 1, fail: () => wx.reLaunch({url: '/pages/home/index'})});
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
  async onLogout() {
    if (this.data.deletingAccount) return;
    logout();
    gameStore.resetToHome();
    playerStats.clearLocalData();
    clearProfileData();
    wx.showToast({title: '已退出登录', icon: 'none'});
    setTimeout(() => wx.reLaunch({url: '/pages/home/index'}), 300);
  },
  async onRevokePrivacy() {
    if (this.data.deletingAccount) return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '撤回隐私授权',
        content: '撤回后将停止当前授权会话并退出当前账号。重新使用需要主动同意协议并完成微信隐私授权。确定继续吗？',
        confirmText: '确认撤回',
        confirmColor: '#c96a10',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;
    // 隐私政策承诺：撤回后停止当前授权会话，重新使用需要主动确认（I-7）
    privacy.revoke();
    logout();
    gameStore.resetToHome();
    playerStats.clearLocalData();
    clearProfileData();
    wx.showToast({title: '已撤回隐私授权', icon: 'none'});
    setTimeout(() => wx.reLaunch({url: '/pages/boot/index'}), 500);
  },
  async onDeleteAccount() {
    if (this.data.deletingAccount) return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '注销账号',
        content: '注销后个人资料、锦鲤币、商城库存将删除，对局记录会匿名保留，且无法恢复。确定继续吗？',
        confirmText: '确认注销',
        confirmColor: '#c96a10',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;

    this.setData({deletingAccount: true});
    try {
      await deleteAccount();
      gameStore.resetToHome();
      playerStats.clearLocalData();
      clearProfileData();
      wx.showToast({title: '账号已注销', icon: 'none'});
      setTimeout(() => wx.reLaunch({url: '/pages/boot/index'}), 500);
    } catch (error) {
      console.warn('[profile] delete account error:', error);
      wx.showToast({title: error.message || '注销失败，请稍后重试', icon: 'none'});
      this.setData({deletingAccount: false});
    }
  },
  async onSaveProfile() {
    if (this.data.profileUpdating) return;
    if (!this.data.canSave) {
      playCue('actionFail', {volume: 0.7});
      playVibrate('light');
      wx.showToast({title: '请先完善头像和昵称', icon: 'none'});
      return;
    }
    this.setData({profileUpdating: true, profileError: ''});
    try {
      const profile = await requestUpdate({ nickName: this.data.draft.nickName });
      this.setData({draft: profile, canSave: hasValidProfile(profile)});
      playCue('pairSelf', {volume: 0.8});
      playVibrate('medium');
      wx.showToast({title: '资料保存成功', icon: 'none'});
      setTimeout(() => wx.navigateBack({delta: 1}), 300);
    } catch (error) {
      this.setData({profileError: error.message || '资料保存失败，请重试'});
      wx.showToast({title: '未保存，请检查提示后重试', icon: 'none'});
    } finally {
      this.setData({profileUpdating: false});
    }
  },
});
