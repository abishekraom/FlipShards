# Pricing And Profit

This file is the source of truth for Bazaar price interpretation.

Hypixel and CoflNet naming is confusing because `buyPrice` and `sellPrice` are named from the player action shown in Bazaar, not from our internal profit workflow.

## CoflNet Snapshot Fields

CoflNet endpoint:

```text
https://sky.coflnet.com/api/bazaar/{ITEM_TAG}/snapshot
```

Important fields:

- `buyPrice`: the price to buy instantly from existing sell offers
- `buyVolume`: available volume on the instant-buy / sell-offer side
- `sellPrice`: the price received when selling instantly into existing buy orders
- `sellVolume`: available volume on the instant-sell / buy-order side

## App Price Mapping

The app normalizes CoflNet fields into clearer names:

| App field | CoflNet field | Meaning |
| --- | --- | --- |
| `buyOrderPrice` | `sellPrice` | Cost basis when acquiring inputs through buy orders |
| `instaBuyPrice` | `buyPrice` | Cost when instantly buying inputs from sell offers |
| `sellOrderPrice` | `buyPrice` | Gross revenue when listing output as a sell offer |
| `instaSellPrice` | `sellPrice` | Gross revenue when instantly selling output into buy orders |

Example:

```text
Buy instantly: 177,457
Sell instantly: 91,950
```

This means:

- `177,457` is the sell-offer side, used for instant-buy input cost and sell-order output revenue
- `91,950` is the buy-order side, used for buy-order input cost and instant-sell output revenue

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

Risk labels are based on CoflNet's average insta-buys per week, because this is closest to the in-game signal used to judge whether a shard can realistically move.

| Risk | Average insta-buys per week |
| --- | --- |
| `HIGH` | below 9,000 |
| `MEDIUM HIGH` | 9,000 to 9,999 |
| `MEDIUM` | 10,000 to 19,999 |
| `MEDIUM LOW` | 20,000 to 21,999 |
| `LOW` | 22,000 or more |

These labels are not guarantees. They are a quick way to avoid treating thin markets as safe.

## Known Accuracy Gaps

Current gaps:

- no outbid increment for buy orders
- no undercut increment for sell offers
- no partial-fill modeling
- no stale-price age warning yet
- no explicit slippage model

Good future improvements:

- add configurable outbid/undercut amount
- calculate spread warning
- calculate stale-data warning
- use recent history to detect manipulated markets
- separate displayed top-of-book price from conservative executable price
