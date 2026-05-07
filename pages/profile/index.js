const {getNavLayout} = require('../../utils/nav');
const {getCachedProfile, hasValidProfile, updateProfile} = require('../../utils/user-profile');
const {playCue, playVibrate} = require('../../utils/audio');

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    draft: getCachedProfile(),
    canSave: false,
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
    this.setData({
      draft,
      canSave: hasValidProfile(draft),
    });
  },
  onChooseAvatar(e) {
    playVibrate('light');
    const avatarUrl = e.detail && e.detail.avatarUrl ? e.detail.avatarUrl : '';
    const draft = {
      ...this.data.draft,
      avatarUrl,
    };
    this.setData({
      draft,
      canSave: hasValidProfile(draft),
    });
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
  onSaveProfile() {
    if (!this.data.canSave) {
      playCue('actionFail', {volume: 0.7});
      playVibrate('light');
      wx.showToast({title: '请先完善头像和昵称', icon: 'none'});
      return;
    }
    const profile = updateProfile(this.data.draft);
    this.setData({draft: profile, canSave: hasValidProfile(profile)});
    playCue('pairSelf', {volume: 0.8});
    playVibrate('medium');
    wx.showToast({title: '资料保存成功', icon: 'none'});
    setTimeout(() => {
      wx.navigateBack({delta: 1});
    }, 300);
  },
});
