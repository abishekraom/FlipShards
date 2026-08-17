# Concepts

## Shards

Each shard has:

- a short recipe ID, such as `R16`
- a display name, such as `Cropeetle`
- a Bazaar item tag, such as `SHARD_CROPEETLE`
- a rarity, such as `rare`
- a type, such as `Farming`
- a `fuse_amount`, meaning how many of that shard are consumed when it is used as a fusion input

## Recipes

Recipes come from `public/fusion-data.json`, with attribution to SkyShards.

FlipShards normalizes each recipe into:

- output shard ID
- output quantity
- input shard IDs
- input quantities

## Market Data

Market data comes from the official Hypixel Bazaar snapshot endpoint:

```text
https://api.hypixel.net/v2/skyblock/bazaar
```

The app loads one snapshot after the fusion catalog is ready and supports manual reloads. See [Pricing And Profit](PRICING_AND_PROFIT.md) for the authoritative field mapping and activity heuristic, and [Architecture](ARCHITECTURE.md) for validation, coverage, atomic replacement, and stale-state behavior.

Rarity and type filters come from the local shard metadata, so they do not require an extra API.

## Acquisition Tree

For every shard, FlipShards compares:

- buying the shard directly from Bazaar
- recursively fusing cheaper input shards

The acquisition tree shows the chosen path.

## Craft Calculations

The Craft Calculations tab lets you load a selected shard and enter a desired output quantity.

If a recipe produces more than requested, FlipShards shows both requested and produced quantities and assumes all produced shards are sellable.
