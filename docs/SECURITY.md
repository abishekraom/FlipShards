# Security

FlipShards makes a direct browser request to the official Hypixel Bazaar snapshot endpoint. The initial implementation does not require or contain an API key, token, proxy, scheduled collector, or persistent market storage.

## Browser Request

```text
browser -> https://api.hypixel.net/v2/skyblock/bazaar
```

The request uses `credentials: omit`, normal browser cache behavior, an `Accept: application/json` header, and an AbortController timeout. It does not add cache-busting, automatic retries, or secrets. The raw response is not placed in React state, browser storage, or logs. Only the validated compact price map, timestamps, safe coverage metadata, and a safe error message are retained in page memory.

Google Fonts remain an unrelated external style dependency. If a stricter self-contained privacy posture is needed, replace the font import with self-hosted font files before deployment.

## CSP and Console Hygiene

`vercel.json` permits only `https://api.hypixel.net` for the market request in `connect-src`; unrelated security headers and route rewrites remain unchanged. User-facing errors expose only a safe message and an HTTP status when applicable. Development diagnostics, if added later, must never include raw products, order summaries, response bodies, keys, or tokens.

## Upstream Changes

CORS or authentication requirements can change. If the official endpoint begins requiring an API key, stop and review a separate secure integration rather than adding a browser secret or workaround. A failed request must remain visibly unavailable or stale.
