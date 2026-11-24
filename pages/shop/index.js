const analytics = require('../../utils/analytics');
const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const userProfile = require('../../utils/user-profile');
const {DEFAULT_AVATAR} = require('../../utils/constants');
const {formatNumber} = require('../../utils/format');
const {playCue, playVibrate} = require('../../utils/audio');
const {createStageThemeData, resolveAmbientStage, saveStageTheme} = require('../../utils/stage-theme');
const pageHelpers = require('../../utils/page-helpers');
const privacy = require('../../utils/privacy-consent');

const CATEGORY_OPTIONS = [
  {key: 'skin', label: '皮肤'},
  {key: 'ring', label: '光环'},
  {key: 'pet', label: '宠物'},
];
const DEFAULT_STAGE_THEME_DATA = createStageThemeData();

function buildStatus(item) {
  if (item.equipped) {
    return {
      text: '使用中',
      action: 'equipped',
      disabled: true,
    };
  }
  if (item.owned) {
    return {
      text: '设为使用',
      action: 'equip',
      disabled: false,
    };
  }
  if (item.price === 0) {
    return {
      text: '免费领取',
      action: 'buy',
      disabled: false,
    };
  }
  return {
    text: formatCoinAmount(item.price),
    action: 'buy',
    disabled: false,
  };
}

function formatCoinAmount(value) {
  const amount = Math.max(0, Number(value) || 0);
  return formatNumber(amount);
}

function buildGoods(category, disabled = false) {
  return shopStore.buildGoodsView(category).map((item) => {
    const status = buildStatus(item);
    return {
      ...item,
      coinPriceText: item.price === 0 ? '免费' : formatCoinAmount(item.price),
      status: {...status, disabled: disabled || status.disabled},
    };
  });
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    categories: CATEGORY_OPTIONS,
    activeCategory: 'skin',
    coins: 0,
    balanceText: '0',
    goods: [],
    assetMessage: '',
    syncFailed: false,
    syncing: false,
    actionPending: false,
    loginRequired: !api.isLoggedIn(),
    loginPending: false,
    avatarUrl: '',
    defaultAvatar: DEFAULT_AVATAR,
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
    this.syncPage();
  },
  onHide() {
    pageHelpers.pauseBackdropVideo(this);
  },
  onShow() {
    if (!privacy.canEnter()) return;
    pageHelpers.resumeBackdropVideo(this);
    this.syncPage();
    this.refreshAccountAssets();
  },
  syncPage() {
    const state = shopStore.getStoreState();
    const gameState = gameStore.getState();
    const theme = saveStageTheme(resolveAmbientStage(gameState));
    const profile = userProfile.getCachedProfile();
    const activeCategory = this.data.activeCategory || 'skin';
    this.setData({
      coins: api.isLoggedIn() ? state.coins : 0,
      loginRequired: !api.isLoggedIn(),
      balanceText: !api.isLoggedIn() || state.assetSource === 'server' && state.syncStatus !== 'ready'
        ? '--' : formatCoinAmount(state.coins),
      goods: buildGoods(activeCategory, !api.isLoggedIn() || this.data.actionPending ||
        (state.assetSource === 'server' && state.syncStatus !== 'ready')),
      assetMessage: state.assetSource !== 'server'
        ? '微信登录后查看锦鲤币和装备'
        : state.syncStatus === 'ready' ? '账号资产已与服务器同步'
          : state.syncStatus === 'error' ? '账号资产同步失败，确认最新余额和库存前暂停操作'
            : '正在同步账号资产…',
      syncFailed: state.assetSource === 'server' && state.syncStatus === 'error',
      avatarUrl: profile.avatarUrl,
      stageName: theme.stageName,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
    });
  },
  async loginForShop() {
    if (this.data.loginPending) return;
    this.setData({loginPending: true});
    try {
      await userProfile.ensureLogin();
      await this.refreshAccountAssets();
    } catch (error) {
      wx.showToast({title: error.message || '微信登录失败，请重试', icon: 'none'});
    } finally {
      this.setData({loginPending: false});
      this.syncPage();
    }
  },
  async refreshAccountAssets() {
    if (!api.isLoggedIn() || this.data.syncing) return;
    this.setData({syncing: true});
    const pending = shopStore.refreshInventory();
    this.syncPage();
    try {
      await pending;
    } catch (error) {
      wx.showToast({title: error.message || '资产同步失败，请重试', icon: 'none'});
    } finally {
      this.setData({syncing: false});
      this.syncPage();
    }
  },
  onSwitchCategory(e) {
    const category = e.currentTarget.dataset.category;
    if (!category || category === this.data.activeCategory) {
      return;
    }
    playCue('tap', {volume: 0.6});
    playVibrate('light');
    this.setData({
      activeCategory: category,
      goods: buildGoods(category, !api.isLoggedIn() || this.data.actionPending ||
        (shopStore.getStoreState().assetSource === 'server' && shopStore.getStoreState().syncStatus !== 'ready')),
    });
  },
  async onTapAction(e) {
    const category = e.currentTarget.dataset.category;
    const itemId = e.currentTarget.dataset.itemId;
    const action = e.currentTarget.dataset.action;
    if (!category || !itemId || !['buy', 'equip'].includes(action) ||
        this.data.actionPending || this.data.syncing) {
      return;
    }
    const hasApiSession = api.isLoggedIn();
    if (!hasApiSession) { await this.loginForShop(); return; }
    if (hasApiSession && shopStore.getStoreState().syncStatus !== 'ready') {
      wx.showToast({title: '请先重新同步账号资产', icon: 'none'});
      return;
    }
    this.setData({actionPending: true});
    this.syncPage();
    let result;
    try {
      result = await (action === 'buy' ? shopStore.buyViaApi(itemId) : shopStore.equipViaApi(itemId, category));
    } finally {
      this.setData({actionPending: false});
      this.syncPage();
    }
    if (!result.ok) {
      playCue('actionFail', {volume: 0.7});
      wx.showToast({title: result.message || '操作未完成', icon: 'none'});
      return;
    }

    if (action === 'buy') {
      analytics.track('shop_buy', {itemId});
      playCue('pairSelf', {volume: 0.8});
      playVibrate('medium');
    } else {
      playCue('tap', {volume: 0.7});
      playVibrate('light');
    }

    wx.showToast({title: result.message || '操作已完成', icon: 'none'});
    this.syncPage();
  },
  onBack() {
    playCue('tap', {volume: 0.6});
    playVibrate('light');
    wx.navigateBack({delta: 1});
  },
});
