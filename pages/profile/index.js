const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_AVATAR} = require('../../utils/constants');
const {getCachedProfile, hasValidProfile, updateProfile, requestUpdate} = require('../../utils/user-profile');
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
    defaultAvatar: DEFAULT_AVATAR,
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
  onRequestWechatProfile() {
    playCue('tap', {volume: 0.7});
    playVibrate('light');

    if (!wx.getUserProfile) {
      wx.showToast({title: '当前微信版本不支持授权资料', icon: 'none'});
      return;
    }

    wx.getUserProfile({
      desc: '用于完善游戏头像和昵称',
      success: (res) => {
        const info = res && res.userInfo ? res.userInfo : {};
        const updated = updateProfile({
          nickName: info.nickName,
          avatarUrl: info.avatarUrl,
        });
        this.setData({draft: updated, canSave: hasValidProfile(updated)});
        requestUpdate({nickName: updated.nickName, avatarUrl: updated.avatarUrl}).catch(() => {});
      },
      fail: () => {
        wx.showToast({title: '未获取微信资料', icon: 'none'});
      },
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
