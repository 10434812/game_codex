const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const userProfile = require('../../utils/user-profile');
const {DEFAULT_AVATAR} = require('../../utils/constants');
const {formatNumber} = require('../../utils/format');
const {playCue, playVibrate} = require('../../utils/audio');
const runtimeConfig = require('../../utils/runtime-config');
const {createStageThemeData, resolveAmbientStage, saveStageTheme} = require('../../utils/stage-theme');

const COINS_PER_CNY = 100;

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

function formatWechatAmount(value) {
  const amount = Math.max(0, Number(value) || 0);
  return `¥${(amount / COINS_PER_CNY).toFixed(2)}`;
}

function buildGoods(category) {
  return shopStore.buildGoodsView(category).map((item) => ({
    ...item,
    coinPriceText: item.price === 0 ? '免费' : formatCoinAmount(item.price),
    cashPriceText: item.price === 0 ? '免费' : formatWechatAmount(item.price),
    status: buildStatus(item),
  }));
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
    avatarUrl: '',
    defaultAvatar: DEFAULT_AVATAR,
    stageName: DEFAULT_STAGE_THEME_DATA.stageName,
    stageImage: DEFAULT_STAGE_THEME_DATA.stageImage,
    stageVideo: DEFAULT_STAGE_THEME_DATA.stageVideo,
    stageThemeKey: DEFAULT_STAGE_THEME_DATA.stageThemeKey,
    stageThemeStyle: DEFAULT_STAGE_THEME_DATA.stageThemeStyle,
    payEnabled: false,
    payStatusText: '微信支付未开启',
    payHintText: '当前使用幸运金币完成购买，后续可在后台开启微信支付联调。',
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    runtimeConfig.fetchRemoteConfig().finally(() => {
      this.syncPage();
    });
  },
  onShow() {
    this.syncPage();
  },
  syncPage() {
    const state = shopStore.getStoreState();
    const gameState = gameStore.getState();
    const theme = saveStageTheme(resolveAmbientStage(gameState));
    const profile = userProfile.getCachedProfile();
    const activeCategory = this.data.activeCategory || 'skin';
    const payEnabled = runtimeConfig.getBoolean('wechat.pay_enabled', false);
    const payGoodsDesc = runtimeConfig.getValue('wechat.pay_goods_desc', '锦鲤前程幸运金币充值');
    const payCurrency = runtimeConfig.getValue('wechat.pay_currency', 'CNY');
    this.setData({
      coins: state.coins,
      balanceText: formatCoinAmount(state.coins),
      goods: buildGoods(activeCategory),
      avatarUrl: profile.avatarUrl,
      stageName: theme.stageName,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
      payEnabled,
      payStatusText: payEnabled ? '微信支付配置已开启' : '微信支付未开启',
      payHintText: payEnabled
        ? `后台已开启支付配置，默认商品为“${payGoodsDesc}”，结算币种 ${payCurrency}。`
        : '当前使用锦鲤币完成购买，商品右上角同步展示微信支付等价金额。',
    });
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
      goods: buildGoods(category),
    });
  },
  async onTapAction(e) {
    const category = e.currentTarget.dataset.category;
    const itemId = e.currentTarget.dataset.itemId;
    const action = e.currentTarget.dataset.action;
    if (!category || !itemId || !action || action === 'equipped') {
      return;
    }

    // Try API first
    if (api.isLoggedIn()) {
      if (action === 'buy') {
        const apiSuccess = await shopStore.buyViaApi(itemId);
        if (apiSuccess) {
          playCue('pairSelf', {volume: 0.8});
          playVibrate('medium');
          wx.showToast({title: '购买成功', icon: 'success'});
          this.syncPage();
          return;
        }
      } else if (action === 'equip') {
        const apiSuccess = await shopStore.equipViaApi(itemId, category);
        if (apiSuccess) {
          playCue('tap', {volume: 0.7});
          playVibrate('light');
          this.syncPage();
          return;
        }
      }
    }

    // Fall back to local
    const result =
      action === 'buy' ? shopStore.purchaseItem(category, itemId) : shopStore.equipItem(category, itemId);

    if (!result.ok) {
      playCue('actionFail', {volume: 0.7});
      wx.showToast({title: result.message || '操作未完成', icon: 'none'});
      return;
    }

    if (action === 'buy') {
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
