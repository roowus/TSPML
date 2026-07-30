# Injection & delivery

> **Locked decision:** the flagship is a **Vercel-hosted portal website** (like `web.polymodloader.com`) that plays the modded game, using a **CORS proxy + origin handling** to load the real game. The browser extension and userscript are **secondary** resilient fallbacks.

## The hard problem (CSP + CORS)

A naive portal **cannot** run the real game:

- **`frame-ancestors`** in PolyTrack's CSP excludes `tspml.dev`, so the portal **cannot iframe** the game.
- Different origin → page-context `fetch()` of the bundles hits **CORS** (Kodub sends no `Access-Control-Allow-Origin`).
- The game's *runtime* requests (chunk loads, leaderboard/multiplayer XHR) originate from the portal origin, which the backend may reject.

So the portal works **only** via a **service worker + server-side proxy** that fetches Kodub's assets with the right headers and serves them to the page.

## Architecture (portal path)

```
  Browser (tspml.vercel.app)
   │
   ├── Service Worker (same origin) intercepts all requests to kodub.com/*
   │        │
   │        └── rewrites them to  /api/proxy?url=<kodub-url>
   │
   └── /api/proxy  (Vercel edge/serverless function)
            │
            ├── fetches the asset from kodub.com
            ├── sets Origin/Referer server-side (official desktop origin) ──▶ backend trusts it
            ├── caches aggressively (edge + IndexedDB by bundle hash)
            └── returns to the page  (CORS-open to tspml.vercel.app)
   │
   Loader: fetch proxied bundles → AST transform (mappings-resolved, in a helper Web Worker)
           → run transformed game in the page → mods bind via the API bridge
```

- The **service worker** is registered on the portal origin; it intercepts the game's own `kodub.com` fetches and routes them through `/api/proxy`, so the transformed game "thinks" it's talking to Kodub while all traffic is proxied and origin-corrected.
- **`/api/proxy`** (Vercel function) fetches server-side and forwards `Origin`/`Referer` to the official desktop origin (`app-polytrack-desktop.kodub.com`) for the leaderboard/multiplayer endpoints — the same trick PML's Electron uses, done server-side. This is the "figure out the origin" piece and an acknowledged **ToS gray area** (see [safety-and-fairness.md](./safety-and-fairness.md)).
- **No game bundle is ever committed to the repo** — everything is fetched live (or cached) through the proxy.

## Secondary paths (resilient fallback)

- **Browser extension** (`source/extension`, MV3 + `declarativeNetRequest`): rewrites the game's script responses at the **network layer**, *outside* page CSP, so it is immune to a `script-src` change and runs on the **real `kodub.com` origin** (multiplayer/leaderboards intact with no proxy). The review recommends treating this as the most *resilient* path; we keep it secondary for go-to-market but it is the fallback if the proxy gets blocked.
- **Userscript** (Tampermonkey): one-click, runs on real `kodub.com`. Fragilities: Chrome MV3 is progressively disabling userscripts, and a single `script-src` CSP change breaks it (the userscript must race the parser with a `MutationObserver` to strip `<script>` nodes, then re-inject transformed source — works only because there is no `script-src` today).

## Transform pipeline (performance)

A cold-start Babel AST parse+transform of ~5 MB of JS on the main thread is multi-second blocking work. Mitigations:

- Run the **entire AST pipeline inside a helper Web Worker** (`source/transform`).
- **Lazy-transform** numbered chunks — only when a loaded mod declares a hook resolved into them.
- **Cache transformed bundles in IndexedDB keyed by `bundleHash`**, so the pipeline runs once per game update, not per page load.
- Publish cold-start + per-tick input-latency budgets as release acceptance criteria ("no worse than +X ms vs vanilla").

## Offline-first

The loader must run with **zero network access** for already-installed mods (all code + map cached in IndexedDB by hash). Network is only required for discovery, publish, and map updates. Mirror the current map inside the extension/userscript bundle as a last-resort fallback.

## Known risks

- **Kodub blocks the proxy IP** or objects to origin-forwarding → extension/userscript paths survive.
- **CSP tightens** (`script-src`) → userscript dies; extension survives; portal unaffected (proxy is server-side).
- **Legal/ToS** → fetch live (never redistribute), honest docs, takedown-compliance plan, position TSPML as a fan tool.
