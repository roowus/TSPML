# Portal browser-test findings

> Detailed record of what headless (`scripts/smoke.mjs`) + manual browser runs revealed about the portal playing the real PolyTrack game. Updated 2026-07-31. This is the honest "what actually happens today" — separate from the unit-tested engines, which all pass.

## TL;DR — current end-to-end status

The transformed bundle is **proven to run** in a real browser (the biggest risk in the project is retired). But the portal does **not yet reach playable gameplay** — PolyTrack itself throws up two gates that TSPML must handle:

```
portal loads → real bundle fetched via /api/proxy → transformed main.bundle.js RUNS
  (badge fires, WebGL canvas inits to 804×452) ✅
  → PolyTrack "unofficial version" warning (origin allowlist) 🚧 issue #8
  → (past it) "Unhandled Rejection: Failed to load track" 🚧 issue #9
  → online/leaderboard requests 400/502 🚧 issue #7
```

So today: **boots + transforms + renders the warning/error screens, but is not yet playable end-to-end.** All four blockers are network/origin/game-self-protection issues, **not** transform problems — the transform pipeline is validated.

## What's proven (the wins)

| Claim | Evidence |
|---|---|
| Cross-build symbol matching is viable | M1 drift spike: game-logic match **0.85** |
| The bundle can be surgically transformed | M3 spike: `node --check` passes, 211==211 modules |
| A **transformed** bundle actually **runs** in a browser | Headless smoke + your manual run: green `TSPML ✔ LIVE` badge in the DOM + console, WebGL canvas inits to 804×452 (not the empty 300×150 default), **0 JS errors** |
| The proxy serves the real live bundle | curl: byte-exact 1,782,239-byte 0.6.2 `main.bundle.js`, SSRF guard returns 400 for non-kodub hosts |

## Findings (in order of discovery)

### 1. Proxied HTML relative-URL bug — FOUND & FIXED ✅
The game iframe is at `/api/proxy?version=0.6.2`. Its relative `<script src="main.bundle.js">` resolved to `/api/main.bundle.js` (404) because the document URL treats `proxy` as a filename. **Fix:** inject `<base href="/api/proxy/">` into the proxied HTML (route.ts). *My earlier curl tests missed this — they always used the full path. Only a real browser load exposed it.*

### 2. PolyTrack's "unofficial version" gate 🚧 (issue #8)
The screen that looks like the menu is actually PolyTrack's **anti-unofficial warning**: *"It seems like you are playing an unofficial version of PolyTrack… visit crazygames.com/game/polytrack."* The game checks its origin against an allowlist (`kodub.com`, `crazygames.com`, `webgamer.io`, `kongregate.com`) and, served from `localhost`, refuses to load gameplay (no Play button; only warning + footer controls). The check lives in the **webpack bootstrap** (runs before the module graph), so a module anchor won't reach it — it needs AST/browser tracing. **Fix (M4):** a transform that forces the official-host check to pass. This is the same problem PML solves with Origin-spoofing.

### 3. "Failed to load track" 🚧 (issue #9)
Once past the unofficial gate, the game throws `Unhandled Rejection: Failed to load track` (red error screen). Track data is fetched from a kodub backend endpoint that **either** 400s through the proxy (Origin not trusted) **or** bypassed the service worker on first load (SW was still "registering," not active) → went direct to `kodub.com` → CORS-failed. **Fix (M7/M8):** ensure the SW is active before the game fetches (reload-on-active), and that the proxy correctly forwards the track-data endpoint.

### 4. Online features 400/502 🚧 (issue #7)
Leaderboard/multiplayer XHR/websocket calls fail through the proxy (`Failed to connect to server`). Online/origin handling is M8.

## What this means for the roadmap

- **M4's first task = neutralize the unofficial gate (issue #8).** It's the blocker for the portal reaching the real game, and a strong, concrete showcase of the transform pipeline on a live problem.
- **M7/M8 = make the proxy + service worker fully carry the game's runtime network** (track data, leaderboard, multiplayer), including SW-active-before-fetch and correct origin forwarding. Issues #7 and #9.
- The transform pipeline, loader, and mappings are **not** the blockers — they're validated. The remaining work is delivery/network/origin.

## Reproduce

```bash
pnpm install --ignore-scripts
pnpm --filter @tspml/transform build
TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev   # http://localhost:3000
# in another shell:
pnpm --filter @tspml/portal smoke                    # headless: badge PASS, probe shows the gate/track error
```
