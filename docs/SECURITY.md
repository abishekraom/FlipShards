# Security

FlipShards requires a CoflNet API token to load live Bazaar data.

## Token Handling

- The token is entered through a startup modal.
- The token is kept only in React page memory.
- The token is not written to `localStorage` or `sessionStorage`.
- The input field is cleared after submit.
- Refreshing or closing the page clears the token.

## Browser Limitation

This is a client-side app:

```text
browser -> CoflNet
```

The app avoids persistent storage and logging, but a browser-held token cannot be hidden from that same browser's developer tools while requests are being made.

For stronger protection, add a backend proxy:

```text
browser -> FlipShards API -> CoflNet
```

## External Requests

Production pages make browser requests to:

- CoflNet, for live Bazaar snapshot data after the user enters a token.
- Google Fonts, for the bundled visual design fonts.

No CoflNet token is sent to Google Fonts. If a stricter self-contained privacy posture is needed, replace the font import with self-hosted font files before deployment.

## Do Not Commit Tokens

Never commit real tokens in:

- source files
- docs
- screenshots
- examples
- issue text
- pull request text

Use placeholders:

```text
Authorization: Bearer <COFLNET_TOKEN>
```

## Rate Limiting

FlipShards reduces CoflNet pressure by:

- using low concurrency
- retrying transient failures
- respecting `Retry-After`
- memory-caching snapshots briefly

Avoid repeatedly pressing reload after a rate-limit response.
