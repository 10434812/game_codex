const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const shopStore = require('../../utils/shop-store');
const userProfile = require('../../utils/user-profile');
const {DEFAULT_AVATAR} = require('../../utils/constants');
const {formatCurrency} = require('../../utils/format');
const {playCue, playVibrate} = require('../../utils/audio');
const runtimeConfig = require('../../utils/runtime-config');

const CATEGORY_OPTIONS = [
  {key: 'skin', label: '皮肤'},
  {key: 'ring', label: '光环'},
  {key: 'pet', label: '宠物'},
];

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
    text: `${formatCurrency(item.price)} 购买`,
    action: 'buy',
    disabled: false,
  };
}

function buildGoods(category) {
  return shopStore.buildGoodsView(category).map((item) => ({
    ...item,
    priceText: item.price === 0 ? '免费' : formatCurrency(item.price),
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
    balanceText: '¥0',
    goods: [],
    avatarUrl: '',
    defaultAvatar: DEFAULT_AVATAR,
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
    const profile = userProfile.getCachedProfile();
    const activeCategory = this.data.activeCategory || 'skin';
    const payEnabled = runtimeConfig.getBoolean('wechat.pay_enabled', false);
    const payGoodsDesc = runtimeConfig.getValue('wechat.pay_goods_desc', '锦鲤前程幸运金币充值');
    const payCurrency = runtimeConfig.getValue('wechat.pay_currency', 'CNY');
    this.setData({
      coins: state.coins,
      balanceText: formatCurrency(state.coins),
      goods: buildGoods(activeCategory),
      avatarUrl: profile.avatarUrl,
      payEnabled,
      payStatusText: payEnabled ? '微信支付配置已开启' : '微信支付未开启',
      payHintText: payEnabled
        ? `后台已开启支付配置，默认商品为“${payGoodsDesc}”，结算币种 ${payCurrency}。`
        : '当前使用幸运金币完成购买，后续可在后台开启微信支付联调。',
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
