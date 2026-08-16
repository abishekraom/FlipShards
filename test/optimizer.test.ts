import assert from "node:assert/strict";
import test from "node:test";
import { ProfitOptimizer } from "../src/profit/optimizer";
import type { ProfitSettings, RecipeBook, Shard, ShardPrice } from "../src/profit/types";
import { createPrice } from "./helpers";

const makeShard = (id: string, internalId = `SHARD_${id}`): Shard => ({
  id,
  name: id,
  family: "Test",
  type: "Testing",
  rarity: "common",
  fuse_amount: 5,
  internal_id: internalId,
});

const makeDirectBook = (): RecipeBook => ({
  shards: { A: makeShard("A") },
  recipesByResult: {},
});

const settings = (buyMode: ProfitSettings["buyMode"], sellMode: ProfitSettings["sellMode"]): ProfitSettings => ({
  buyMode,
  sellMode,
  taxRate: 0.1,
  rarityFilter: "all",
  typeFilter: "all",
  minimumProfit: 0,
  minimumVolume: 0,
  sortMode: "profit",
});

test("preserves fixed-price optimizer parity for all four mode pairs", () => {
  const book = makeDirectBook();
  const price = createPrice("A", {
    buyOrderPrice: 80,
    instaBuyPrice: 100,
    sellOrderPrice: 100,
    instaSellPrice: 80,
    buyVolume: 11,
    sellVolume: 22,
  });
  const optimizer = new ProfitOptimizer(book, { A: price });
  const cases = [
    { buyMode: "BUY_ORDER" as const, sellMode: "SELL_ORDER" as const, cost: 80, gross: 100, afterTax: 90, profit: 10, roi: 12.5 },
    { buyMode: "BUY_ORDER" as const, sellMode: "INSTA_SELL" as const, cost: 80, gross: 80, afterTax: 72, profit: -8, roi: -10 },
    { buyMode: "INSTA_BUY" as const, sellMode: "SELL_ORDER" as const, cost: 100, gross: 100, afterTax: 90, profit: -10, roi: -10 },
    { buyMode: "INSTA_BUY" as const, sellMode: "INSTA_SELL" as const, cost: 100, gross: 80, afterTax: 72, profit: -28, roi: -28 },
  ];

  for (const expected of cases) {
    const [result] = optimizer.calculateAllProfits(settings(expected.buyMode, expected.sellMode));
    assert.ok(result);
    assert.equal(result.totalCost, expected.cost);
    assert.equal(result.grossRevenue, expected.gross);
    assert.ok(Math.abs(result.revenueAfterTax - expected.afterTax) < 1e-9);
    assert.ok(Math.abs(result.profit - expected.profit) < 1e-9);
    assert.ok(Math.abs(result.roi - expected.roi) < 1e-9);
    assert.equal(result.buyVolume, 11);
    assert.equal(result.sellVolume, 22);
    assert.equal(result.buyActivity7d, 33);
    assert.equal(result.sellActivity7d, 44);
  }
});

test("keeps liquidity direction and provisional activity risk thresholds", () => {
  const book = makeDirectBook();
  const price = createPrice("A", { buyVolume: 11, sellVolume: 22, buyActivity7d: 22_000 });
  const optimizer = new ProfitOptimizer(book, { A: price });
  const [result] = optimizer.calculateAllProfits(settings("BUY_ORDER", "SELL_ORDER"));

  assert.ok(result);
  assert.equal(Math.min(result.buyVolume, result.sellVolume), 11);
  assert.equal(result.risk, "LOW");
});

test("keeps cheaper fusion routes and missing direct inputs available", () => {
  const shards = { A: makeShard("A"), B: makeShard("B"), C: makeShard("C") };
  const book: RecipeBook = {
    shards,
    recipesByResult: {
      C: [
        {
          resultShardId: "C",
          resultQuantity: 1,
          inputs: [
            { shardId: "A", quantity: 1 },
            { shardId: "B", quantity: 1 },
          ],
        },
      ],
    },
  };
  const prices: Record<string, ShardPrice> = {
    A: createPrice("A", { buyOrderPrice: 100 }),
    B: createPrice("B", { buyOrderPrice: 100 }),
    C: createPrice("C", { buyOrderPrice: 500, sellOrderPrice: 400, instaBuyPrice: 500, instaSellPrice: 400 }),
  };
  delete prices.C;
  const optimizer = new ProfitOptimizer(book, prices);
  const acquisition = optimizer.getBestAcquisition("C", "BUY_ORDER");

  assert.equal(acquisition.available, true);
  assert.equal(acquisition.tree?.method, "FUSE");
  assert.equal(acquisition.unitCost, 200);
});
