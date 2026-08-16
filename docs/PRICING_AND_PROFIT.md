# Pricing And Profit

This file is the source of truth for Bazaar price interpretation.

Hypixel names Bazaar values from the order side, while FlipShards names them from the player's action. The adapter preserves the existing optimizer concepts without parsing order summaries.

## Official Snapshot Fields

The client requests one snapshot after the fusion catalog loads and one per manual reload:

```text
https://api.hypixel.net/v2/skyblock/bazaar
```

The adapter reads only `success`, top-level `lastUpdated`, each expected product identity, and `quick_status`. `sell_summary` and `buy_summary` are intentionally not retained.

## App Price Mapping

| App field | Hypixel field | Meaning |
| --- | --- | --- |
| `buyOrderPrice` | `quick_status.buyPrice` | Cost basis when acquiring inputs through buy orders |
| `instaBuyPrice` | `quick_status.sellPrice` | Cost when instantly buying inputs from sell offers |
| `sellOrderPrice` | `quick_status.sellPrice` | Gross revenue when listing output as a sell offer |
| `instaSellPrice` | `quick_status.buyPrice` | Gross revenue when instantly selling output into buy orders |
| `buyVolume` | `quick_status.sellVolume` | Internal buy-side available volume |
| `sellVolume` | `quick_status.buyVolume` | Internal sell-side available volume |
| `buyActivity7d` | `quick_status.sellMovingWeek` | Official seven-day value used as buy-side activity |
| `sellActivity7d` | `quick_status.buyMovingWeek` | Official seven-day value used as sell-side activity |

A valid top-level `lastUpdated` timestamp is used for every mapped record. Missing or malformed products are omitted and shown in coverage; they are never converted to zero or backfilled from an older snapshot.

Example:

```text
Hypixel sellPrice: 177,457
Hypixel buyPrice: 91,950
```

Therefore, directly doing `INSTA_BUY -> INSTA_SELL` on the same shard should lose money before tax:

```text
91,950 - 177,457 = -85,507
```

## Profit Formula

There is no fusion fee.

There is Bazaar tax on the output sale:

```text
revenueAfterTax = grossSellPrice * (1 - taxRate)
profit = revenueAfterTax - totalInputCost
roi = profit / totalInputCost * 100
```

The UI tax input is a percent. For example:

```text
1.25% -> 0.0125
```

## Fusion Cost Formula

For a recipe:

```text
5x A + 5x B -> 2x C
```

Per one output shard:

```text
cost(C) = (bestCost(A) * 5 + bestCost(B) * 5) / 2
```

The optimizer compares this against direct market cost:

```text
bestCost(C) = min(directCost(C), fusionCost(C))
```

## Ranking

The app can sort by:

- raw profit
- ROI
- liquidity-adjusted score
- volume

Liquidity score is only a ranking helper. It is not profit.

Current formula:

```text
score = max(0, profit) * log(volume + 1) * liquidityFactor
```

## Risk Labels

Risk labels use `buyActivity7d` and the retained thresholds below as a provisional compatibility heuristic over official seven-day activity. They are not a CoflNet average, forecast, or guarantee.

| Risk | Official seven-day buy activity |
| --- | --- |
| `HIGH` | below 9,000 |
| `MEDIUM HIGH` | 9,000 to 9,999 |
| `MEDIUM` | 10,000 to 19,999 |
| `MEDIUM LOW` | 20,000 to 21,999 |
| `LOW` | 22,000 or more |

These labels are not guarantees. They are a quick way to avoid treating thin markets as safe while a future demand model remains out of scope.

## Known Accuracy Gaps

Current gaps:

- no outbid increment for buy orders
- no undercut increment for sell offers
- no partial-fill modeling
- freshness is shown at load time, but there is no automatic refresh
- no explicit slippage model

Good future improvements:

- add configurable outbid/undercut amount
- calculate spread warning
- calculate stale-data warning
- use recent history to detect manipulated markets
- separate displayed top-of-book price from conservative executable price
