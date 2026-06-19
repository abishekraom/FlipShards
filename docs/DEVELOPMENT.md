# Development

## Requirements

- Node.js
- pnpm

Recommended:

```sh
corepack enable
```

Install dependencies:

```sh
pnpm install
```

## Run Locally

```sh
pnpm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Build

```sh
pnpm run build
```

## Typecheck

```sh
pnpm exec tsc -b
```

## Lint

```sh
pnpm run lint
```

## CoflNet Refresh Rate

The app can auto-refresh CoflNet data every 5 minutes, but the toggle is off by default.

The CoflNet snapshot endpoint has returned rate-limit headers shaped like a per-minute budget. Normal manual loads use the faster loader, but enabling auto-refresh requires a confirmation warning because non-premium Cofl tokens may be rate limited or blocked.

## Debugging

If the app stays locked:

- confirm `public/fusion-data.json` loaded
- paste a valid CoflNet token into the modal
- inspect browser Network requests for `401`, `403`, `429`, CORS, or no-content responses

If the table is empty:

- lower minimum profit and volume filters
- check whether CoflNet loaded all required shard snapshots
- inspect the console for failed snapshot requests

If prices look reversed:

- read [Pricing And Profit](PRICING_AND_PROFIT.md)
- remember that CoflNet `buyPrice` means buy-instantly price
- remember that CoflNet `sellPrice` means sell-instantly price

## Repository Setup

This project is now intended to be pushed to a new FlipShards repository, not the original SkyShards remote.

After the new repo is created:

```sh
git remote add origin <NEW_REPO_URL>
git push -u origin <branch>
```
