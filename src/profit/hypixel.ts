import type { RecipeBook, ShardPrice } from "./types";

export const HYPIXEL_BAZAAR_ENDPOINT = "https://api.hypixel.net/v2/skyblock/bazaar";
export const HYPIXEL_REQUEST_TIMEOUT_MS = 10_000;

export interface SnapshotCoverage {
  expected: number;
  matched: number;
  loaded: number;
  missing: number;
  malformed: number;
  ignored: number;
}

export interface SnapshotLoadReport {
  prices: Record<string, ShardPrice>;
  coverage: SnapshotCoverage;
  lastUpdatedMs: number;
  lastUpdated: string;
  receivedAtMs: number;
}

export type SnapshotLoadErrorCode = "network" | "timeout" | "http" | "json" | "schema" | "no-usable-products";

export class HypixelSnapshotError extends Error {
  readonly code: SnapshotLoadErrorCode;
  readonly status?: number;

  constructor(code: SnapshotLoadErrorCode, message: string, status?: number) {
    super(message);
    this.name = "HypixelSnapshotError";
    this.code = code;
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const isPlainRecord = (value: unknown): value is JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isValidTimestamp = (value: unknown): value is number => {
  if (!isFiniteNumber(value) || value <= 0 || value > 8.64e15) return false;
  return Number.isFinite(new Date(value).getTime());
};

const getExpectedTags = (recipeBook: RecipeBook): Map<string, string> => {
  const expectedTags = new Map<string, string>();
  const shardIds = new Set<string>();
  for (const shard of Object.values(recipeBook.shards)) {
    if (!shard || typeof shard.id !== "string" || typeof shard.internal_id !== "string" || shard.internal_id.length === 0) {
      throw new HypixelSnapshotError("schema", "SkyShards catalog contains an invalid item identity");
    }
    if (expectedTags.has(shard.internal_id) || shardIds.has(shard.id)) {
      throw new HypixelSnapshotError("schema", "SkyShards catalog contains duplicate item identities");
    }
    expectedTags.set(shard.internal_id, shard.id);
    shardIds.add(shard.id);
  }
  return expectedTags;
};

const readProduct = (
  product: unknown,
  itemTag: string,
  shardId: string,
  lastUpdated: string
): ShardPrice | null => {
  if (!isPlainRecord(product)) return null;

  if (product.product_id !== itemTag) return null;

  const quickStatus = product.quick_status;
  if (!isPlainRecord(quickStatus) || quickStatus.productId !== itemTag) return null;

  const fields = ["buyPrice", "sellPrice", "buyVolume", "sellVolume", "buyMovingWeek", "sellMovingWeek"] as const;
  for (const field of fields) {
    if (!isFiniteNumber(quickStatus[field])) return null;
  }

  const buyPrice = quickStatus.buyPrice as number;
  const sellPrice = quickStatus.sellPrice as number;
  const buyVolume = quickStatus.buyVolume as number;
  const sellVolume = quickStatus.sellVolume as number;
  const buyMovingWeek = quickStatus.buyMovingWeek as number;
  const sellMovingWeek = quickStatus.sellMovingWeek as number;
  if (buyPrice <= 0 || sellPrice <= 0 || buyVolume < 0 || sellVolume < 0 || buyMovingWeek < 0 || sellMovingWeek < 0) {
    return null;
  }

  return {
    shardId,
    itemTag,
    buyOrderPrice: buyPrice,
    instaBuyPrice: sellPrice,
    sellOrderPrice: sellPrice,
    instaSellPrice: buyPrice,
    buyVolume: sellVolume,
    sellVolume: buyVolume,
    buyActivity7d: sellMovingWeek,
    sellActivity7d: buyMovingWeek,
    lastUpdated,
    source: "hypixel-bazaar",
  };
};

export const buildHypixelSnapshot = (
  recipeBook: RecipeBook,
  payload: unknown,
  receivedAtMs = Date.now()
): SnapshotLoadReport => {
  const expectedTags = getExpectedTags(recipeBook);
  if (!isPlainRecord(payload) || payload.success !== true || !isValidTimestamp(payload.lastUpdated) || !isPlainRecord(payload.products)) {
    throw new HypixelSnapshotError("schema", "Hypixel Bazaar response was malformed");
  }

  const lastUpdatedMs = payload.lastUpdated;
  const lastUpdated = new Date(lastUpdatedMs).toISOString();
  const products = payload.products;
  const prices: Record<string, ShardPrice> = {};
  let matched = 0;
  let malformed = 0;

  for (const [itemTag, shardId] of expectedTags) {
    if (!Object.prototype.hasOwnProperty.call(products, itemTag)) continue;
    matched += 1;
    const price = readProduct(products[itemTag], itemTag, shardId, lastUpdated);
    if (price) prices[shardId] = price;
    else malformed += 1;
  }

  const coverage: SnapshotCoverage = {
    expected: expectedTags.size,
    matched,
    loaded: Object.keys(prices).length,
    missing: expectedTags.size - matched,
    malformed,
    ignored: Object.keys(products).filter((itemTag) => !expectedTags.has(itemTag)).length,
  };

  if (coverage.loaded === 0) {
    throw new HypixelSnapshotError("no-usable-products", "No usable SkyShards products were present");
  }

  return {
    prices,
    coverage,
    lastUpdatedMs,
    lastUpdated,
    receivedAtMs,
  };
};

const toSnapshotError = (error: unknown): HypixelSnapshotError => {
  if (error instanceof HypixelSnapshotError) return error;
  return new HypixelSnapshotError("network", "Unable to reach the Hypixel Bazaar snapshot");
};

export const fetchHypixelShardPrices = async (
  recipeBook: RecipeBook,
  signal?: AbortSignal,
  fetchImpl: FetchImplementation = globalThis.fetch,
  timeoutMs = HYPIXEL_REQUEST_TIMEOUT_MS
): Promise<SnapshotLoadReport> => {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortExternalRequest = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortExternalRequest, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await fetchImpl(HYPIXEL_BAZAAR_ENDPOINT, {
        cache: "default",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new HypixelSnapshotError("timeout", "Hypixel Bazaar request timed out");
      throw toSnapshotError(error);
    }

    if (!response.ok) {
      throw new HypixelSnapshotError("http", `Hypixel Bazaar returned HTTP ${response.status}`, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new HypixelSnapshotError("json", "Hypixel Bazaar returned invalid JSON");
    }

    return buildHypixelSnapshot(recipeBook, payload);
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortExternalRequest);
  }
};
