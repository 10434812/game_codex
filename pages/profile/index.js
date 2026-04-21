const {getNavLayout} = require('../../utils/nav');
const {getCachedProfile, hasValidProfile, updateProfile} = require('../../utils/user-profile');

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
      wx.showToast({title: '请先选择头像并填写昵称', icon: 'none'});
      return;
    }
    const profile = updateProfile(this.data.draft);
    this.setData({draft: profile, canSave: hasValidProfile(profile)});
    wx.showToast({title: '资料已更新', icon: 'none'});
    setTimeout(() => {
      wx.navigateBack({delta: 1});
    }, 300);
  },
});
