# Architecture

FlipShards is a standalone Vite + React single-page app.

## Data Flow

```text
public/fusion-data.json
  -> normalizeFusionData()
  -> RecipeBook
  -> one official Hypixel Bazaar snapshot request
  -> validated compact price map and coverage state
  -> ShardPrice map
  -> ProfitOptimizer
  -> ProfitResult[]
  -> ProfitApp UI
```

## Modules

- `src/profit/ProfitApp.tsx`: UI, snapshot status, filters, ranked table, acquisition tree, craft calculator.
- `src/profit/hypixel.ts`: one official Hypixel Bazaar request, strict validation, action-side mapping, and compact snapshot normalization.
- `src/profit/snapshot-state.ts`: atomic replacement and stale retention transitions.
- `src/profit/optimizer.ts`: cheapest direct-or-fused acquisition search and profit ranking.
- `src/profit/recipes.ts`: converts raw fusion data into normalized recipe inputs and output quantities.
- `src/profit/types.ts`: shared app types.
- `src/profit/format.ts`: display formatters.

## Optimizer Shape

The optimizer uses an iterative cheapest-cost pass over the recipe graph:

```text
start with direct Bazaar costs
repeat:
  for each fusion recipe:
    calculate output unit cost from current input costs
    update the output shard if fusion is cheaper
until no costs change
```

After costs stabilize, the acquisition tree is built by following the selected direct/fusion choices.

## Snapshot Boundary

The app performs one browser-side GET to the official Hypixel Bazaar endpoint for each manual load. It uses normal browser cache behavior, `credentials: omit`, an AbortController timeout, and no automatic retry. Raw responses are parsed locally and are not retained in React state, storage, or logs.

A valid partial response replaces the active map atomically with its validated records. A transport, HTTP, timeout, JSON, schema, or zero-usable failure retains the previous in-memory map as stale. A first-load failure remains unavailable. There is no persistent history, scheduled refresh, server proxy, API key, or runtime CoflNet fallback.
