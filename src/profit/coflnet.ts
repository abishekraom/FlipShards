import type { RecipeBook, ShardPrice } from "./types";

interface CoflNetSnapshot {
  productId: string;
  buyPrice?: number;
  buyVolume?: number;
  sellPrice?: number;
  sellVolume?: number;
  buyMovingWeek?: number;
  sellMovingWeek?: number;
  averageInstaBuys?: number;
  averageInstaSells?: number;
  averageInstaBuy?: number;
  averageInstaSell?: number;
  timeStamp?: string;
}

export interface CoflNetLoadReport {
  prices: Record<string, ShardPrice>;
  loaded: number;
  failed: number;
  errors: string[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_DELAY_MS = 160;
const snapshotCache = new Map<string, { savedAt: number; snapshot: CoflNetSnapshot }>();

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const readCachedSnapshot = (itemTag: string): CoflNetSnapshot | null => {
  const cached = snapshotCache.get(itemTag);
  if (!cached) return null;

  if (Date.now() - cached.savedAt > CACHE_TTL_MS) {
    snapshotCache.delete(itemTag);
    return null;
  }
  return cached.snapshot;
};

const writeCachedSnapshot = (itemTag: string, snapshot: CoflNetSnapshot) => {
  snapshotCache.set(itemTag, { savedAt: Date.now(), snapshot });
};

const normalizeSnapshot = (shardId: string, itemTag: string, snapshot: CoflNetSnapshot): ShardPrice => {
  const buyPrice = snapshot.buyPrice ?? null;
  const sellPrice = snapshot.sellPrice ?? null;
  const averageInstaBuys = snapshot.buyMovingWeek ?? snapshot.averageInstaBuys ?? snapshot.averageInstaBuy ?? 0;
  const averageInstaSells = snapshot.sellMovingWeek ?? snapshot.averageInstaSells ?? snapshot.averageInstaSell ?? 0;

  // CoflNet follows Hypixel's Bazaar UI naming:
  // buyPrice is what you pay to buy instantly from sell offers.
  // sellPrice is what you receive when selling instantly into buy orders.
  return {
    shardId,
    itemTag,
    buyOrderPrice: sellPrice,
    instaBuyPrice: buyPrice,
    sellOrderPrice: buyPrice,
    instaSellPrice: sellPrice,
    buyVolume: snapshot.buyVolume ?? 0,
    sellVolume: snapshot.sellVolume ?? 0,
    averageInstaBuys,
    averageInstaSells,
    lastUpdated: snapshot.timeStamp ?? new Date().toISOString(),
    source: "coflnet",
  };
};

export const fetchCoflNetShardPrices = async (
  recipeBook: RecipeBook,
  apiToken: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<CoflNetLoadReport> => {
  const entries = Object.values(recipeBook.shards);
  const prices: Record<string, ShardPrice> = {};
  let cursor = 0;
  let loaded = 0;
  let failed = 0;
  const errors: string[] = [];
  const concurrency = 2;

  const worker = async () => {
    while (cursor < entries.length) {
      const shard = entries[cursor];
      cursor += 1;
      if (!shard) continue;

      try {
        const cached = readCachedSnapshot(shard.internal_id);
        const snapshot =
          cached ??
          (await fetchSnapshot(shard.internal_id, apiToken));

        if (!cached) writeCachedSnapshot(shard.internal_id, snapshot);
        prices[shard.id] = normalizeSnapshot(shard.id, shard.internal_id, snapshot);
        loaded += 1;
      } catch (error) {
        failed += 1;
        if (errors.length < 8) {
          errors.push(`${shard.internal_id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      onProgress?.(loaded + failed, entries.length);
      await sleep(REQUEST_DELAY_MS);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { prices, loaded, failed, errors };
};

const fetchSnapshot = async (itemTag: string, apiToken: string): Promise<CoflNetSnapshot> => {
  const headers: HeadersInit = {};
  if (apiToken.trim()) {
    headers.Authorization = `Bearer ${apiToken.trim()}`;
  }

  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`https://sky.coflnet.com/api/bazaar/${encodeURIComponent(itemTag)}/snapshot`, { headers });
    lastStatus = response.status;

    if (response.ok) {
      return response.json() as Promise<CoflNetSnapshot>;
    }

    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(`CoflNet snapshot failed for ${itemTag}: ${response.status}`);
    }

    const retryAfter = Number(response.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * 2 ** attempt;
    await sleep(delay);
  }

  throw new Error(`CoflNet snapshot failed for ${itemTag}: ${lastStatus}`);
};
