# Architecture

FlipShards is a standalone Vite + React single-page app.

## Data Flow

```text
public/fusion-data.json
  -> normalizeFusionData()
  -> RecipeBook
  -> CoflNet token gate
  -> CoflNet snapshots
  -> ShardPrice map
  -> ProfitOptimizer
  -> ProfitResult[]
  -> ProfitApp UI
```

## Modules

- `src/profit/ProfitApp.tsx`: UI, token gate, filters, ranked table, acquisition tree, craft calculator.
- `src/profit/coflnet.ts`: live CoflNet snapshot fetching, retry/backoff, memory cache, field normalization.
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

## Client-Side Token Tradeoff

FlipShards does not persist CoflNet tokens. The token is only held in page memory.

Because requests are made from the browser, the active token is still visible to that browser's own developer tools while requests are in flight. A future backend proxy can hide the token from browser code if stronger protection is needed.
