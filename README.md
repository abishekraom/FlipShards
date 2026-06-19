# FlipShards

FlipShards is a standalone Hypixel SkyBlock shard fusion profit calculator.

It loads live Bazaar snapshot data from CoflNet, combines it with shard fusion recipe data, and ranks opportunities by profit, ROI, volume, and risk. It also includes a custom craft calculator for planning exact output quantities.

## Credits

- **SkyShards**: source of the shard metadata and fusion recipe graph used in `public/fusion-data.json`.
- **CoflNet**: source of live Bazaar snapshot price, volume, and moving-week market data.

FlipShards is a separate project and is not affiliated with, endorsed by, or maintained by SkyShards or CoflNet.

## Features

- Live CoflNet-token-gated market loading.
- No mock price mode.
- Token is kept in page memory only and clears on refresh or close.
- Optional 5-minute CoflNet auto-refresh, off by default.
- Fusion-aware optimizer that compares direct Bazaar acquisition against recursive shard fusion.
- Ranked opportunities table with profit, ROI, cost, after-tax revenue, volume, average insta-buy data, and risk.
- Rarity and shard-type filters powered by the local fusion metadata.
- Risk labels based on average weekly insta-buy activity.
- Acquisition tree for the selected shard.
- Craft Calculations tab for custom output quantities.

## Quick Start

Install dependencies:

```sh
pnpm install
```

Start the app:

```sh
pnpm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Build for production:

```sh
pnpm run build
```

## Important Files

- [src/profit/ProfitApp.tsx](src/profit/ProfitApp.tsx): main FlipShards UI
- [src/profit/coflnet.ts](src/profit/coflnet.ts): CoflNet fetch and snapshot normalization
- [src/profit/optimizer.ts](src/profit/optimizer.ts): recursive fusion-aware optimizer
- [src/profit/recipes.ts](src/profit/recipes.ts): recipe normalization
- [src/profit/types.ts](src/profit/types.ts): shared types
- [public/fusion-data.json](public/fusion-data.json): shard metadata and fusion recipe data credited to SkyShards

## Documentation

- [Concepts](docs/CONCEPTS.md)
- [Pricing And Profit](docs/PRICING_AND_PROFIT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Security](docs/SECURITY.md)

## Deployment Status

This working copy has been detached from the original SkyShards remote. Wait to add a new `origin` until the FlipShards repository is created.

When the new repository exists:

```sh
git remote add origin <NEW_REPO_URL>
git push -u origin <branch>
```
