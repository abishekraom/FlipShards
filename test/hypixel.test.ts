import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHypixelSnapshot,
  fetchHypixelShardPrices,
  HypixelSnapshotError,
  HYPIXEL_BAZAAR_ENDPOINT,
} from "../src/profit/hypixel";
import { clonePayload, createPayload, createRecipeBook, RAINBUG_ID, RAINBUG_TAG, SNAPSHOT_TIMESTAMP } from "./helpers";

test("maps official prices to the four action-side price concepts exactly", () => {
  const book = createRecipeBook(2);
  const payload = createPayload(book, [RAINBUG_TAG]);
  const report = buildHypixelSnapshot(book, payload, 123);
  const price = report.prices.R1;

  assert.ok(price);
  assert.equal(price.buyOrderPrice, 80);
  assert.equal(price.instaSellPrice, 80);
  assert.equal(price.instaBuyPrice, 100);
  assert.equal(price.sellOrderPrice, 100);
  assert.equal(price.source, "hypixel-bazaar");
});

test("maps current volumes and moving-week activity by official order side", () => {
  const book = createRecipeBook(2);
  const payload = createPayload(book, [RAINBUG_TAG]);
  const product = payload.products.SHARD_TEST_001 as { quick_status: Record<string, unknown> };
  product.quick_status.sellVolume = 0;
  const report = buildHypixelSnapshot(book, payload);
  const price = report.prices.R1;

  assert.ok(price);
  assert.equal(price.buyVolume, 0);
  assert.equal(price.sellVolume, 22);
  assert.equal(price.buyActivity7d, 33);
  assert.equal(price.sellActivity7d, 44);
  assert.equal("averageInstaBuys" in price, false);
  assert.equal("averageInstaSells" in price, false);
});

test("uses one valid official timestamp for every mapped record", () => {
  const book = createRecipeBook(3);
  const report = buildHypixelSnapshot(book, createPayload(book, [RAINBUG_TAG]));
  const expectedIso = new Date(SNAPSHOT_TIMESTAMP).toISOString();

  assert.equal(report.lastUpdatedMs, SNAPSHOT_TIMESTAMP);
  assert.equal(report.lastUpdated, expectedIso);
  for (const price of Object.values(report.prices)) assert.equal(price.lastUpdated, expectedIso);
});

test("rejects invalid timestamps without a local-time fallback", () => {
  const book = createRecipeBook(2);
  const invalidTimestamps: unknown[] = [undefined, "1700000000000", 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1];

  for (const timestamp of invalidTimestamps) {
    const payload = createPayload(book, [RAINBUG_TAG]);
    payload.lastUpdated = timestamp;
    assert.throws(
      () => buildHypixelSnapshot(book, payload),
      (error: unknown) => error instanceof HypixelSnapshotError && error.code === "schema"
    );
  }
});

test("reports the observed 320/321 partial coverage without fabricating Rainbug", () => {
  const book = createRecipeBook();
  const report = buildHypixelSnapshot(book, createPayload(book, [RAINBUG_TAG]));

  assert.deepEqual(report.coverage, {
    expected: 321,
    matched: 320,
    loaded: 320,
    missing: 1,
    malformed: 0,
    ignored: 0,
  });
  assert.equal(report.prices[RAINBUG_ID], undefined);
});

test("accepts complete 321/321 coverage and counts ignored official products", () => {
  const book = createRecipeBook();
  const payload = createPayload(book);
  payload.products.UNUSED_OFFICIAL_PRODUCT = { quick_status: {} };
  const report = buildHypixelSnapshot(book, payload);

  assert.equal(report.coverage.expected, 321);
  assert.equal(report.coverage.matched, 321);
  assert.equal(report.coverage.loaded, 321);
  assert.equal(report.coverage.missing, 0);
  assert.equal(report.coverage.malformed, 0);
  assert.equal(report.coverage.ignored, 1);
});

test("counts malformed products and keeps only valid compact records", () => {
  const book = createRecipeBook(5);
  const payload = createPayload(book, [RAINBUG_TAG]);
  const products = payload.products as Record<string, { product_id: string; quick_status?: Record<string, unknown> }>;
  delete products.SHARD_TEST_001.quick_status;
  products.SHARD_TEST_002.quick_status!.productId = "SHARD_WRONG";
  products.SHARD_TEST_003.product_id = "SHARD_WRONG";

  const report = buildHypixelSnapshot(book, payload);
  assert.equal(report.coverage.matched, 4);
  assert.equal(report.coverage.loaded, 1);
  assert.equal(report.coverage.malformed, 3);
  assert.deepEqual(Object.keys(report.prices), ["R4"]);
});

test("rejects invalid numeric values per product and never converts them to zero", () => {
  const book = createRecipeBook(6);
  const payload = createPayload(book, [RAINBUG_TAG]);
  const products = payload.products as Record<string, { quick_status: Record<string, unknown> }>;
  products.SHARD_TEST_001.quick_status.sellPrice = "100";
  products.SHARD_TEST_002.quick_status.buyPrice = 0;
  products.SHARD_TEST_003.quick_status.buyVolume = -1;
  products.SHARD_TEST_004.quick_status.sellMovingWeek = Number.POSITIVE_INFINITY;

  const report = buildHypixelSnapshot(book, payload);
  assert.equal(report.coverage.loaded, 1);
  assert.equal(report.coverage.malformed, 4);
  assert.equal(report.prices.R1, undefined);
  assert.equal(report.prices.R2, undefined);
});

test("rejects top-level failure, missing products, and zero-usable snapshots", () => {
  const book = createRecipeBook(2);
  const valid = createPayload(book, [RAINBUG_TAG]);
  const topLevelFailures: unknown[] = [
    { ...valid, success: false },
    { success: true, lastUpdated: SNAPSHOT_TIMESTAMP },
    { ...valid, products: [] },
  ];

  for (const payload of topLevelFailures) {
    assert.throws(
      () => buildHypixelSnapshot(book, payload),
      (error: unknown) => error instanceof HypixelSnapshotError && error.code === "schema"
    );
  }

  const emptyProducts = { ...valid, products: {} };
  assert.throws(
    () => buildHypixelSnapshot(book, emptyProducts),
    (error: unknown) => error instanceof HypixelSnapshotError && error.code === "no-usable-products"
  );

  const noUsable = clonePayload(valid);
  const product = noUsable.products.SHARD_TEST_001 as { quick_status: Record<string, unknown> };
  product.quick_status.buyPrice = -1;
  assert.throws(
    () => buildHypixelSnapshot(book, noUsable),
    (error: unknown) => error instanceof HypixelSnapshotError && error.code === "no-usable-products"
  );
});

test("does not retain order summaries or the raw response", () => {
  const book = createRecipeBook(2);
  const payload = createPayload(book, [RAINBUG_TAG]);
  const product = payload.products.SHARD_TEST_001 as { sell_summary: unknown[]; buy_summary: unknown[] };
  product.sell_summary = [{ pricePerUnit: 1 }];
  product.buy_summary = [{ pricePerUnit: 2 }];
  const report = buildHypixelSnapshot(book, payload);
  const price = report.prices.R1;

  assert.ok(price);
  assert.equal("products" in report, false);
  assert.deepEqual(Object.keys(price).sort(), [
    "buyActivity7d",
    "buyOrderPrice",
    "buyVolume",
    "instaBuyPrice",
    "instaSellPrice",
    "itemTag",
    "lastUpdated",
    "sellActivity7d",
    "sellOrderPrice",
    "sellVolume",
    "shardId",
    "source",
  ]);
});

test("performs one safe browser request with normal cache and no credential headers", async () => {
  const book = createRecipeBook(2);
  const payload = createPayload(book, [RAINBUG_TAG]);
  let calls = 0;
  let receivedInit: RequestInit | undefined;
  const report = await fetchHypixelShardPrices(book, undefined, async (input, init) => {
    calls += 1;
    receivedInit = init;
    assert.equal(String(input), HYPIXEL_BAZAAR_ENDPOINT);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  assert.equal(calls, 1);
  assert.equal(receivedInit?.cache, "default");
  assert.equal(receivedInit?.credentials, "omit");
  assert.deepEqual(receivedInit?.headers, { Accept: "application/json" });
  assert.ok(receivedInit?.signal instanceof AbortSignal);
  assert.equal(report.coverage.loaded, 1);
});

test("classifies HTTP, JSON, network, and timeout failures without a candidate", async () => {
  const book = createRecipeBook(2);
  const failureCases: Array<{ name: string; fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>; code: string; timeout?: number }> = [
    {
      name: "http",
      fetchImpl: async () => new Response(null, { status: 503 }),
      code: "http",
    },
    {
      name: "json",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid"); } } as Response),
      code: "json",
    },
    {
      name: "network",
      fetchImpl: async () => { throw new TypeError("network"); },
      code: "network",
    },
    {
      name: "timeout",
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      code: "timeout",
      timeout: 5,
    },
  ];

  for (const failureCase of failureCases) {
    await assert.rejects(
      () => fetchHypixelShardPrices(book, undefined, failureCase.fetchImpl, failureCase.timeout),
      (error: unknown) => error instanceof HypixelSnapshotError && error.code === failureCase.code,
      failureCase.name
    );
  }
});
