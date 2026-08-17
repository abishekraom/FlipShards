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

## Test

```sh
pnpm test
```

## Lint

```sh
pnpm run lint
```

## Official Snapshot Loading

Each initial load and manual reload makes one browser request to `https://api.hypixel.net/v2/skyblock/bazaar`. The app uses normal browser cache behavior, no cache-busting, no automatic retry, and a bounded client timeout. It does not assert a Hypixel rate limit or update cadence.

A valid partial snapshot is usable and reports expected, matched, loaded, missing, and malformed coverage. The currently observed catalog can be 320/321 because Rainbug is absent. A failed refresh keeps the previous valid map visible as stale; a failed first load remains unavailable. No API key, token, timer, persistent history, or CoflNet runtime fallback is used.

## Debugging

If the app stays unavailable:

- confirm `public/fusion-data.json` loaded
- inspect the snapshot status for the safe error message
- inspect browser Network requests for HTTP, JSON, schema, timeout, or CORS failures

If the table is empty:

- lower minimum profit and volume filters
- check the visible snapshot coverage and whether the target is unavailable
- inspect the console for CSP or unrelated application errors, never raw response payloads

If prices look reversed:

- read [Pricing And Profit](PRICING_AND_PROFIT.md)
- verify `sellPrice` maps to Buy Order and Insta Sell
- verify `buyPrice` maps to Insta Buy and Sell Order

## Local-versus-Deployed Parity Checklist

Run a production-equivalent local preview and compare it with the deployed app using the same browser, viewport, timezone, and static graph revision. Record pass/fail and the official snapshot timestamp. Live numbers need not equal the old source because source semantics and timestamps differ; fixed fixtures must match exactly.

- Static graph: same 321 SkyShards catalog, names, recipes, fusion and craft trees.
- Workflow: no token gate, one official request on initial load, then manual reload only.
- Modes: `BUY_ORDER -> SELL_ORDER`, `BUY_ORDER -> INSTA_SELL`, `INSTA_BUY -> SELL_ORDER`, and `INSTA_BUY -> INSTA_SELL`.
- Price direction: `sellPrice` for Buy Order/Insta Sell; `buyPrice` for Insta Buy/Sell Order.
- Profit: profit, ROI, Bazaar tax, gross and after-tax revenue, and produced quantities.
- Volume/liquidity: `sellVolume -> buyVolume`, `buyVolume -> sellVolume`, minimum-volume filter, and liquidity ranking.
- Risk/activity: visible official seven-day labels and clearly provisional heuristic wording.
- Coverage: 320/321 missing Rainbug is unavailable; no zero price or stale backfill; 321/321 fixture is accepted.
- Failed refresh: prior values remain unchanged and are visibly stale; first-load failure remains unavailable.
- Network/security: no per-item requests, no retry/timer, no API key or token, no raw payload logs, and no CSP violation for `api.hypixel.net`.

## Repository Setup

This project is now intended to be pushed to a new FlipShards repository, not the original SkyShards remote.

After the new repo is created:

```sh
git remote add origin <NEW_REPO_URL>
git push -u origin <branch>
```
