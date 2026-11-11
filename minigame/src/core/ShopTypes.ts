/**
 * 商城数据类型（原 utils/shop-store.js 的 GOODS / DEFAULT_STATE 形状）。
 */

export interface ShopItemBase {
  id: string;
  category: string;
  name: string;
  price: number;
  accent: string;
  description: string;
}

export interface SkinItem extends ShopItemBase {
  skinClass: string;
  skinIcon: string;
  skinImage: string;
  rarity: string;
  theme: string;
}

export interface PetItem extends ShopItemBase {
  petIcon: string;
  petLabel: string;
  petImage: string;
}

export interface RingItem extends ShopItemBase {
  ringIcon: string;
  ringLabel: string;
  ringImage: string;
}

export type ShopItem = SkinItem | PetItem | RingItem;

export interface ShopCatalog {
  skin: SkinItem[];
  pet: PetItem[];
  ring: RingItem[];
}

export interface LedgerRecord {
  id: string;
  type: string;
  title: string;
  amount: number;
  balanceAfter: number;
  createdAt: number;
}

export interface ShopState {
  coins: number;
  ownedSkins: string[];
  ownedPets: string[];
  ownedRings: string[];
  equippedSkinId: string;
  equippedPetId: string;
  equippedRingId: string;
  records: LedgerRecord[];
  /** 'guest' 为本地游客存档，'server' 为当前登录会话的服务器快照。 */
  assetSource?: string;
  syncStatus?: string;
  syncError?: string;
}

export type GoodsViewItem = ShopItem & {
  rarityLabel: string;
  owned: boolean;
  equipped: boolean;
  canBuy: boolean;
};

export interface EquippedDisplay {
  coins: number;
  assetSource: string;
  syncStatus: string;
  equippedSkinId: string;
  equippedPetId: string;
  equippedRingId: string;
  skinClass: string;
  skinName: string;
  skinImage: string;
  ringName: string;
  ringImage: string;
  ringAccent: string;
  petIcon: string;
  petLabel: string;
  petImage: string;
  petAccent: string;
}

export interface ShopActionResult {
  ok: boolean;
  code: string;
  message: string;
  state?: ShopState;
  item?: ShopItem;
  delta?: number;
  committed?: boolean;
}

export type ShopCategory = 'skin' | 'pet' | 'ring';
