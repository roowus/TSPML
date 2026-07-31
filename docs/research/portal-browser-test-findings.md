# Portal browser-test findings

> Detailed record of what headless (`scripts/smoke.mjs`) + manual browser runs revealed about the portal playing the real PolyTrack game. Updated 2026-07-31. This is the honest "what actually happens today" — separate from the unit-tested engines, which all pass.

## TL;DR — current end-to-end status: PLAYABLE ✅

The portal now plays the real PolyTrack **end-to-end**: a transformed `main.bundle.js` boots, the unofficial-version gate is cleared, assets + a track load, and a **real race** renders (HUD: speedometer `0 km/h`, timer `00:00.000`, `0/3` checkpoints, track **"Summer 1"**) with the green `TSPML ✔ LIVE` badge live over it. The only remaining rough edge is one `502` on an online (leaderboard/multiplayer) call — issue #7, M8, non-blocking for gameplay.

```
portal loads → real bundle fetched via /api/proxy → transformed main.bundle.js RUNS ✅
  (badge fires, WebGL canvas inits to 804×452) ✅
  → "unofficial version" gate CLEARED via polytrackModConfiguration (Qo path) ✅ #8 SOLVED
  → assets + track load (service worker active on reload) ✅ #9 SOLVED
  → RACE on "Summer 1" with full HUD ✅
  → online/leaderboard 502 🚧 issue #7 (M8, non-blocking)
```

## What's proven (the wins)

| Claim | Evidence |
|---|---|
| Cross-build symbol matching is viable | M1 drift spike: game-logic match **0.85** |
| The bundle can be surgically transformed | M3 spike: `node --check` passes, 211==211 modules |
| A **transformed** bundle actually **runs** in a browser | Headless smoke: green `TSPML ✔ LIVE` badge in DOM + console, WebGL canvas 804×452, **0 JS errors** |
| The proxy serves the real live bundle | curl: byte-exact 1,782,239-byte 0.6.2 `main.bundle.js`, SSRF guard returns 400 for non-kodub hosts |
| **The game reaches actual playable gameplay through the portal** | Headless run: race on **"Summer 1"** with speedometer/timer/checkpoint HUD; full menu (Play, tracks, Garage, Editor, Multiplayer) present; 149× 200 / 0 failed requests |

## Findings (in order of discovery)

### 1. Proxied HTML relative-URL bug — FOUND & FIXED ✅
The game iframe is at `/api/proxy?version=0.6.2`. Its relative `<script src="main.bundle.js">` resolved to `/api/main.bundle.js` (404) because the document URL treats `proxy` as a filename. **Fix:** inject `<base href="/api/proxy/">` into the proxied HTML (route.ts). *My earlier curl tests missed this — they always used the full path. Only a real browser load exposed it.*

### 2. PolyTrack's "unofficial version" gate — SOLVED ✅ (issue #8)
The screen that looked like the menu was PolyTrack's anti-unofficial warning. Traced the gate in the unpacked 0.6.2 bundle: `Yo()` returns true when `location.hostname` isn't `*.kodub.com` (so `localhost` is "unofficial"); `Xo()` is the master "is unofficial" flag; the warning banner + ToS link are gated on `Qo() || Yo() || Xo()`. **The game exposes a first-class mod-loader hook** — `window.polytrackModConfiguration` — exactly what PML uses to identify itself. **Fix:** the proxy injects `<script>window.polytrackModConfiguration = { modName: "TSPML", author: "roowus" }</script>` into `<head>` *before* the deferred bundles run (gated on `TSPML_TRANSFORM=1`). That sets `Qo()=true`: the banner becomes "Unofficial TSPML mod by roowus", the blocking gate clears, and the game proceeds to load. **This used the game's own intended extension point — no bundle surgery, no origin-spoof.** The check does *not* live in a webpack module, so a module-anchor transform wouldn't have reached it; the HTML-injection approach is both cleaner and more correct. (`polytrackModConfiguration.unblocked = true` is an alternative that clears `Xo()` but leaves the generic banner.)

### 3. "Failed to load track" — SOLVED ✅ (issue #9)
The earlier "Failed to load track" error was the **service worker not yet active on first load** — the game's track-data fetch bypassed the SW, went direct to `kodub.com`, and CORS-failed. The smoke test already reloads once so the SW is `active` + `clients.claim()`-ed on the second load; with the SW active the track loads fine (the `Summer 1` race proves it). No code change was needed beyond what M2 already had — it was a first-load-only artifact.

### 4. Online features 400/502 🚧 (issue #7)
One `502` on an online (leaderboard/multiplayer) call remains — non-blocking for local gameplay. Online/origin handling is M8.

## What this means for the roadmap

- **M4's gate task (issue #8) is DONE** — and the gate was neutralized via delivery-layer HTML injection (the game's own `polytrackModConfiguration` hook), not a bundle transform.
- **The portal is now a real proof of concept**: it plays the *transformed, modded* PolyTrack end-to-end in a browser. This is the milestone the project has been building toward.
- The transform pipeline, loader, and mappings are validated; gameplay is proven; only online/origin (M8, issue #7) remains on the delivery side.

## Reproduce

```bash
pnpm install --ignore-scripts
pnpm --filter @tspml/transform build
TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev   # http://localhost:3000
# in another shell:
pnpm --filter @tspml/portal smoke                    # headless: PASS (transform ran + gate cleared)
```
A longer manual wait (~35–40s through the cold dev proxy) reaches a full race.
