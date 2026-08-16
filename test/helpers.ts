import type { RecipeBook, Shard, ShardPrice } from "../src/profit/types";

export interface QuickStatusFixture {
  productId: string;
  buyPrice: number;
  sellPrice: number;
  buyVolume: number;
  sellVolume: number;
  buyMovingWeek: number;
  sellMovingWeek: number;
}

export interface ProductFixture {
  product_id: string;
  quick_status: QuickStatusFixture;
  sell_summary?: unknown[];
  buy_summary?: unknown[];
}

export interface BazaarFixture {
  success: boolean;
  lastUpdated: unknown;
  products: Record<string, unknown>;
}

export const RAINBUG_TAG = "SHARD_RAINBUG";
export const RAINBUG_ID = "L49";
export const SNAPSHOT_TIMESTAMP = 1_700_000_000_000;

export const createRecipeBook = (count = 321): RecipeBook => {
  const shards: Record<string, Shard> = {};
  for (let index = 0; index < count; index += 1) {
    const isRainbug = index === 0;
    const id = isRainbug ? RAINBUG_ID : `R${index}`;
    const internalId = isRainbug ? RAINBUG_TAG : `SHARD_TEST_${String(index).padStart(3, "0")}`;
    shards[id] = {
      id,
      name: isRainbug ? "Rainbug" : `Test Shard ${index}`,
      family: "Test",
      type: "Testing",
      rarity: "common",
      fuse_amount: 5,
      internal_id: internalId,
    };
  }
  return { shards, recipesByResult: {} };
};

export const createPayload = (recipeBook: RecipeBook, omitTags: string[] = []): BazaarFixture => {
  const products: Record<string, unknown> = {};
  for (const shard of Object.values(recipeBook.shards)) {
    if (omitTags.includes(shard.internal_id)) continue;
    products[shard.internal_id] = {
      product_id: shard.internal_id,
      quick_status: {
        productId: shard.internal_id,
        buyPrice: 80,
        sellPrice: 100,
        buyVolume: 22,
        sellVolume: 11,
        buyMovingWeek: 44,
        sellMovingWeek: 33,
      },
    } satisfies ProductFixture;
  }
  return { success: true, lastUpdated: SNAPSHOT_TIMESTAMP, products };
};

export const clonePayload = (payload: BazaarFixture): BazaarFixture => structuredClone(payload);

export const createPrice = (shardId: string, overrides: Partial<ShardPrice> = {}): ShardPrice => ({
  shardId,
  itemTag: `SHARD_${shardId}`,
  buyOrderPrice: 80,
  instaBuyPrice: 100,
  sellOrderPrice: 100,
  instaSellPrice: 80,
  buyVolume: 11,
  sellVolume: 22,
  buyActivity7d: 33,
  sellActivity7d: 44,
  lastUpdated: new Date(SNAPSHOT_TIMESTAMP).toISOString(),
  source: "hypixel-bazaar",
  ...overrides,
});
