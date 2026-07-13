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

function requestWechatPayment(payment) {
  return new Promise((resolve, reject) => {
    if (!wx.requestPayment) {
      reject(new Error('当前环境不支持微信支付'));
      return;
    }
    wx.requestPayment({
      ...payment,
      success: resolve,
      fail: (err) => {
        reject(new Error((err && err.errMsg) || '微信支付取消或失败'));
      },
    });
  });
}

function choosePurchaseMethod(item) {
  return new Promise((resolve, reject) => {
    if (!wx.showActionSheet) {
      resolve('coin');
      return;
    }
    wx.showActionSheet({
      itemList: [`锦鲤币购买 ${formatCoinAmount(item.price)}`, `微信支付 ${formatWechatAmount(item.price)}`],
      success(res) {
        resolve(res.tapIndex === 1 ? 'wechat' : 'coin');
      },
      fail(err) {
        const message = err && err.errMsg ? err.errMsg : '';
        if (message.includes('cancel')) {
          resolve('');
          return;
        }
        reject(new Error(message || '请选择支付方式'));
      },
    });
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
    avatarUrl: '',
    defaultAvatar: DEFAULT_AVATAR,
    stageName: DEFAULT_STAGE_THEME_DATA.stageName,
    stageImage: DEFAULT_STAGE_THEME_DATA.stageImage,
    stageVideo: DEFAULT_STAGE_THEME_DATA.stageVideo,
    stageThemeKey: DEFAULT_STAGE_THEME_DATA.stageThemeKey,
    stageThemeStyle: DEFAULT_STAGE_THEME_DATA.stageThemeStyle,
    payEnabled: false,
    payStatusText: '微信支付未开启',
    payHintText: '当前使用锦鲤币完成购买，后续可在后台开启微信支付联调。',
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
    const payGoodsDesc = runtimeConfig.getValue('wechat.pay_goods_desc', '锦鲤前程锦鲤币充值');
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
    const item = this.data.goods.find((goodsItem) => goodsItem.id === itemId);
    let hasApiSession = api.isLoggedIn();
    if (!hasApiSession && action === 'buy' && this.data.payEnabled && item && item.price > 0) {
      await userProfile.login();
      hasApiSession = api.isLoggedIn();
    }

    // Try API first
    if (hasApiSession) {
      if (action === 'buy') {
        if (this.data.payEnabled && item && item.price > 0) {
          const method = await choosePurchaseMethod(item);
          if (!method) {
            return;
          }
          if (method === 'wechat') {
            await this.startWechatPayment(itemId);
            return;
          }
        }
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
    } else if (action === 'buy' && this.data.payEnabled && item && item.price > 0) {
      wx.showToast({title: '请先完成微信登录', icon: 'none'});
      return;
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
  async startWechatPayment(itemId) {
    let loadingVisible = false;
    const showPaymentLoading = (title) => {
      wx.showLoading({title});
      loadingVisible = true;
    };
    const hidePaymentLoading = () => {
      if (loadingVisible) {
        wx.hideLoading();
        loadingVisible = false;
      }
    };

    try {
      showPaymentLoading('正在拉起支付');
      const order = await api.post('/payments/wechat/jsapi', {itemId});
      hidePaymentLoading();
      await requestWechatPayment(order.payment);
      showPaymentLoading('正在确认支付');
      await api.post(`/payments/wechat/orders/${order.orderNo}/sync`);
      await shopStore.refreshInventory();
      hidePaymentLoading();
      playCue('pairSelf', {volume: 0.8});
      playVibrate('medium');
      wx.showToast({title: '支付成功', icon: 'success'});
      this.syncPage();
    } catch (err) {
      hidePaymentLoading();
      playCue('actionFail', {volume: 0.7});
      wx.showToast({title: (err && err.message) || '支付未完成', icon: 'none'});
    }
  },
  onBack() {
    playCue('tap', {volume: 0.6});
    playVibrate('light');
    wx.navigateBack({delta: 1});
  },
});
