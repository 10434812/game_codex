const {getNavLayout} = require('../../utils/nav');
const shopStore = require('../../utils/shop-store');

const CATEGORY_OPTIONS = [
  {key: 'skin', label: '皮肤'},
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
  return {
    text: `${item.price} 金币购买`,
    action: 'buy',
    disabled: false,
  };
}

function buildGoods(category) {
  return shopStore.buildGoodsView(category).map((item) => ({
    ...item,
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
    goods: [],
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    this.syncPage();
  },
  onShow() {
    this.syncPage();
  },
  syncPage() {
    const state = shopStore.getStoreState();
    const activeCategory = this.data.activeCategory || 'skin';
    this.setData({
      coins: state.coins,
      goods: buildGoods(activeCategory),
    });
  },
  onSwitchCategory(e) {
    const category = e.currentTarget.dataset.category;
    if (!category || category === this.data.activeCategory) {
      return;
    }
    this.setData({
      activeCategory: category,
      goods: buildGoods(category),
    });
  },
  onTapAction(e) {
    const category = e.currentTarget.dataset.category;
    const itemId = e.currentTarget.dataset.itemId;
    const action = e.currentTarget.dataset.action;
    if (!category || !itemId || !action || action === 'equipped') {
      return;
    }

    const result =
      action === 'buy' ? shopStore.purchaseItem(category, itemId) : shopStore.equipItem(category, itemId);

    if (!result.ok) {
      wx.showToast({title: result.message || '操作失败', icon: 'none'});
      return;
    }

    wx.showToast({title: result.message || '操作成功', icon: 'none'});
    this.syncPage();
  },
  onBack() {
    wx.navigateBack({delta: 1});
  },
});
