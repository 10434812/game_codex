const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_AVATAR} = require('../../utils/constants');
const api = require('../../utils/api-client');
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
    uploading: false,
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
    const tempUrl = e.detail && e.detail.avatarUrl ? e.detail.avatarUrl : '';
    if (!tempUrl) {
      return;
    }
    this.setData({uploading: true});
    const token = api.getToken();
    const uploadTask = wx.uploadFile({
      url: api.getBaseUrl() + '/user/avatar',
      filePath: tempUrl,
      name: 'file',
      header: token ? {Authorization: 'Bearer ' + token} : {},
      success: (res) => {
        try {
          const body = JSON.parse(res.data);
          if (body && body.code === 0 && body.data && body.data.avatarUrl) {
            const permanentUrl = body.data.avatarUrl;
            const updated = updateProfile({avatarUrl: permanentUrl});
            this.setData({draft: updated, canSave: hasValidProfile(updated), uploading: false});
            requestUpdate({nickName: updated.nickName, avatarUrl: updated.avatarUrl}).catch(() => {});
          } else {
            this.setData({uploading: false});
            wx.showToast({title: '头像上传失败', icon: 'none'});
          }
        } catch (err) {
          this.setData({uploading: false});
          wx.showToast({title: '头像上传失败', icon: 'none'});
        }
      },
      fail: () => {
        this.setData({uploading: false});
        const draft = {...this.data.draft, avatarUrl: tempUrl};
        this.setData({draft, canSave: hasValidProfile(draft)});
        wx.showToast({title: '已暂存，稍后上传', icon: 'none'});
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
