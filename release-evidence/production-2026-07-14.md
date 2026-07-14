# FindMnemo production release evidence

Date: 2026-07-14

## Deployment

- Vercel project: `findmnemo`
- Preferred production URL: `https://findmnemo.vercel.app`
- Legacy production alias: `https://mnemosync.vercel.app`
- Deployment: `dpl_CADo4SpN9LEvuzE45wY2LRtqdDFT`
- State: `READY`
- Framework/build: Vite production build

## Verification

- `npm run verify:ci`: pass — 62 test files and 294 tests, plus ontology, observed-work, workflow, routing, privacy, public-release, lint, browser build, companion build, and source lifecycle checks.
- Companion origin regression: pass — exact `findmnemo.vercel.app` and legacy `mnemosync.vercel.app` origins are accepted; lookalike origins remain rejected.
- Companion runtime preflight: pass — both production origins receive exact CORS responses with the approved mutation methods and headers.
- Hosted routes: pass — `/`, `/demo`, and `/app` return HTTP 200 at the preferred URL with CSP, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
- Bundle identity: pass — both production URLs serve the current `index-D82ViYSi.js` and `index-DmLHswQQ.css` assets.
- Vercel authentication gate: disabled for this public static client; the hosted UI exposes no Gmail credentials or companion-owned operational data.

The companion remains loopback-only. Pairing, rotating browser sessions, exact-origin checks, browser nonces, and protocol validation still protect its private APIs.
